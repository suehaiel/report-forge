// ReportForge — AI document-to-report platform (RESWATER)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");

// --- load .env ---
try {
  const env = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch (e) {}

const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/image", express.static(path.join(__dirname, "image"))); // official RESWATER logo asset
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

// --- tiny auth (in-memory tokens) ---
const tokens = new Map(); // token -> {role, name}
function auth(requiredRole) {
  return (req, res, next) => {
    const t = (req.headers.authorization || "").replace("Bearer ", "");
    const s = tokens.get(t);
    if (!s) return res.status(401).json({ error: "Not logged in" });
    if (requiredRole === "admin" && s.role !== "admin") return res.status(403).json({ error: "Admin only" });
    req.session = s;
    next();
  };
}

app.post("/api/login", (req, res) => {
  const { role, name, password } = req.body || {};
  const ok =
    (role === "partner" && password === process.env.PARTNER_PASSWORD) ||
    (role === "admin" && password === process.env.ADMIN_PASSWORD);
  if (!ok) return res.status(401).json({ error: "Wrong password" });
  const token = crypto.randomBytes(24).toString("hex");
  tokens.set(token, { role, name: name || role });
  res.json({ token, role, name: name || role });
});

// --- document text extraction ---
app.post("/api/extract", auth(), upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const name = req.file.originalname.toLowerCase();
    let text = "";
    if (name.endsWith(".docx")) {
      const r = await mammoth.extractRawText({ buffer: req.file.buffer });
      text = r.value;
    } else if (name.endsWith(".pdf")) {
      const r = await pdfParse(req.file.buffer);
      text = r.text;
    } else if (name.endsWith(".txt") || name.endsWith(".md")) {
      text = req.file.buffer.toString("utf8");
    } else {
      return res.status(400).json({ error: "Unsupported file type. Use DOCX, PDF or TXT." });
    }
    text = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) return res.status(422).json({ error: "No readable text found in the document (it may be a scanned image PDF)." });
    res.json({ text, chars: text.length, filename: req.file.originalname });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Extraction failed: " + e.message });
  }
});

// --- the report data model (also used as the manual-mode template) ---
const EMPTY_REPORT = {
  title: "", bestPracticeName: "", projectName: "", category: "", documentType: "",
  location: { name: "", country: "", region: "", lat: null, lng: null },
  description: "",
  executiveSummary: "",
  keyFacts: [],            // [{label, value, unit}]
  overview: { what: "", problem: "", importance: "" },
  technical: { description: "", technologies: [], materials: [], processSteps: [], operations: "" },
  performance: { metrics: [], qualitative: [] },   // metrics: [{name, value, unit, context}]
  environmentalImpacts: [], // [{aspect, description}]
  socialEconomicImpacts: [],
  sdgs: [],                // [{number, justification}]
  innovation: { description: "", trl: null },
  barriers: [],
  funding: [],             // [{source, amount, mechanism}]
  implementationContext: "",
  lessonsLearned: [],
  recommendations: [],
  replication: { potential: "", conditions: "", where: "" },
  references: [],
  keywords: []
};

// --- content validation: normalize shape and strip empty/invalid/duplicate data before rendering ---
const rfClone = o => JSON.parse(JSON.stringify(o));
const rfText = v => typeof v === "string" && v.trim() !== "";
const rfArr = v => Array.isArray(v) ? v : [];
const rfUniq = a => { const seen = new Set(); return a.filter(x => { const k = JSON.stringify(x); if (seen.has(k)) return false; seen.add(k); return true; }); };
const rfNum = v => { const n = parseFloat(String(v ?? "").replace(/[, ]/g, "")); return isNaN(n) ? null : n; };

function validateReport(raw) {
  const warnings = [];
  const src = raw && typeof raw === "object" ? raw : {};
  const r = Object.assign(rfClone(EMPTY_REPORT), src);
  // guarantee well-typed nested objects (fixes undefined variables downstream)
  r.location    = Object.assign(rfClone(EMPTY_REPORT.location),    src.location    || {});
  r.overview    = Object.assign(rfClone(EMPTY_REPORT.overview),    src.overview    || {});
  r.technical   = Object.assign(rfClone(EMPTY_REPORT.technical),   src.technical   || {});
  r.performance = Object.assign(rfClone(EMPTY_REPORT.performance), src.performance || {});
  r.innovation  = Object.assign(rfClone(EMPTY_REPORT.innovation),  src.innovation  || {});
  r.replication = Object.assign(rfClone(EMPTY_REPORT.replication), src.replication || {});

  // plain string arrays: trim, drop empties, dedupe
  const cleanStrings = a => rfUniq(rfArr(a).map(x => String(x ?? "").trim()).filter(rfText));
  r.keywords = cleanStrings(r.keywords);
  r.barriers = cleanStrings(r.barriers);
  r.lessonsLearned = cleanStrings(r.lessonsLearned);
  r.recommendations = cleanStrings(r.recommendations);
  r.references = cleanStrings(r.references);
  r.technical.technologies = cleanStrings(r.technical.technologies);
  r.technical.materials = cleanStrings(r.technical.materials);
  r.technical.processSteps = cleanStrings(r.technical.processSteps);
  r.performance.qualitative = cleanStrings(r.performance.qualitative);

  // keyFacts must have a value
  r.keyFacts = rfUniq(rfArr(r.keyFacts)
    .map(f => ({ label: String(f?.label ?? "").trim(), value: String(f?.value ?? "").trim(), unit: String(f?.unit ?? "").trim() }))
    .filter(f => rfText(f.value)));

  // metrics must have a numeric value (feeds charts)
  r.performance.metrics = rfArr(r.performance.metrics)
    .map(m => ({ name: String(m?.name ?? "").trim(), value: rfNum(m?.value), unit: String(m?.unit ?? "").trim(), context: String(m?.context ?? "").trim() }))
    .filter(m => rfText(m.name) && m.value !== null);

  // impacts: need at least one of aspect/description
  const cleanImp = a => rfUniq(rfArr(a)
    .map(x => ({ aspect: String(x?.aspect ?? "").trim(), description: String(x?.description ?? "").trim() }))
    .filter(x => rfText(x.aspect) || rfText(x.description)));
  r.environmentalImpacts = cleanImp(r.environmentalImpacts);
  r.socialEconomicImpacts = cleanImp(r.socialEconomicImpacts);

  // funding rows need some content
  r.funding = rfUniq(rfArr(r.funding)
    .map(f => ({ source: String(f?.source ?? "").trim(), amount: String(f?.amount ?? "").trim(), mechanism: String(f?.mechanism ?? "").trim() }))
    .filter(f => rfText(f.source) || rfText(f.amount) || rfText(f.mechanism)));

  // SDGs: integer 1–17, unique (guards against broken SDG assets)
  const seenSdg = new Set();
  r.sdgs = rfArr(r.sdgs)
    .map(s => ({ number: parseInt(s?.number), justification: String(s?.justification ?? "").trim() }))
    .filter(s => {
      if (!(s.number >= 1 && s.number <= 17)) { warnings.push("Dropped out-of-range SDG"); return false; }
      if (seenSdg.has(s.number)) { warnings.push("Dropped duplicate SDG " + s.number); return false; }
      seenSdg.add(s.number); return true;
    });

  // numeric guards
  const trl = rfNum(r.innovation.trl); r.innovation.trl = (trl !== null && trl >= 1 && trl <= 9) ? trl : null;
  r.location.lat = rfNum(r.location.lat);
  r.location.lng = rfNum(r.location.lng);

  // structural warnings (informational — do not block)
  if (!rfText(r.bestPracticeName) && !rfText(r.title) && !rfText(r.projectName)) warnings.push("No title / best-practice name");
  if (!rfText(r.description) && !rfText(r.executiveSummary)) warnings.push("No description or summary");
  if (!r.keyFacts.length) warnings.push("No key facts");

  return { report: r, warnings };
}

const ANALYSIS_PROMPT = `You are a meticulous technical analyst for EU-funded environmental and research projects.
Extract structured information from the document below and return ONLY a JSON object with EXACTLY this shape (same keys, same nesting):

${JSON.stringify(EMPTY_REPORT, null, 2)}

STRICT RULES — factual accuracy is critical:
- NEVER invent, estimate, or guess any number, cost, location, coordinate, date, percentage or claim. Only use information explicitly present in the document.
- If information for a field is not in the document, use "" for strings, null for numbers, and [] for arrays. Do not fill gaps.
- "lat"/"lng": only if explicit coordinates appear in the document; otherwise null. If only a city/country is named, fill location.name/country but keep lat/lng null.
- "bestPracticeName": a SHORT distinctive name for the practice/solution/technology ONLY — 2 to 5 words, excluding the hosting organisation, university or city. E.g. "CAM Green Roof" (NOT "CAM Green Roof at University of Cagliari"). Never use the programme/project name here. If no distinct practice name exists, leave "".
- "description": a clear 2-3 sentence plain-language description of WHAT the practice physically is and does (the solution itself). Extract/synthesise it from the document. Never output the programme name here.
- "executiveSummary": a thorough SCIENTIFIC SYNTHESIS of the ENTIRE document — 1 to 2 dense paragraphs covering the objective, the technical/methodological approach, the key quantitative results and their significance, and the conclusion. Analytical, scientific, evidence-based tone. This is the main summary of the whole document, not a slogan.
- "keywords": 4-10 short topical keywords or tags describing the practice (e.g. "green roof", "stormwater", "nature-based solution"). Plain strings, lowercase where natural.
- "overview.what" MUST describe the physical/technical solution itself (materials, mechanism, scale) — NEVER the programme or project name. If you cannot describe the solution, leave "".
- "keyFacts": 4-10 short headline facts actually stated (e.g. budget, duration, partners, capacity, beneficiaries). value should be the figure/text, unit optional.
- "performance.metrics": ONLY quantitative indicators with explicit numeric values from the document. "value" must be a number (strip separators), "unit" its unit, "context" one sentence of context.
- Array item shapes (use these exact keys): keyFacts -> {"label","value","unit"}; performance.metrics -> {"name","value","unit","context"}; environmentalImpacts and socialEconomicImpacts -> {"aspect","description"}; sdgs -> {"number","justification"} where "number" is an integer 1-17; funding -> {"source","amount","mechanism"}. All other arrays are arrays of plain strings.
- "sdgs": Sustainable Development Goals. Include a goal (number 1-17) only when the document explicitly mentions it OR its subject matter clearly and directly maps to it (e.g. water reuse -> SDG 6). Give a one-line justification tied to the document.
- "technical.processSteps": ordered steps of the technical process/workflow if described, as short strings.
- Summaries and descriptions must be faithful, concise, professional English (translate if the source is another language).
- Return ONLY the JSON object. No markdown, no commentary.`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callGroq(messages, { temperature = 0.1, json = true, maxTokens = 8000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature,
        max_tokens: maxTokens,
        ...(json ? { response_format: { type: "json_object" } } : {}),
        messages
      })
    });
    if (resp.ok) {
      const data = await resp.json();
      return data.choices[0].message.content;
    }
    const body = await resp.text();
    // TPM rate limit: wait for the minute window to reset, then retry
    if ((resp.status === 429 || resp.status === 413) && attempt < 3) {
      const m = body.match(/try again in ([\d.]+)s/i);
      const wait = m ? Math.ceil(parseFloat(m[1]) * 1000) + 2000 : 25000;
      console.log(`Groq rate limit — waiting ${Math.round(wait / 1000)}s (attempt ${attempt + 1})`);
      await sleep(wait);
      continue;
    }
    throw new Error(`Groq API ${resp.status}: ${body.slice(0, 400)}`);
  }
}

// Free tier is ~12k tokens/minute. Keep every single request well under that:
// ~4 chars per token, prompt overhead ~1.5k tokens -> chunk docs at ~24k chars.
const CHUNK_CHARS = 24000;

async function condenseLargeDoc(text) {
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK_CHARS) chunks.push(text.slice(i, i + CHUNK_CHARS));
  const notes = [];
  for (let i = 0; i < chunks.length; i++) {
    console.log(`Condensing chunk ${i + 1}/${chunks.length}…`);
    const note = await callGroq([
      { role: "system", content: "You compress technical project documents. Extract ALL concrete facts from the text as dense bullet notes: names, titles, locations, coordinates, dates, durations, budgets, costs, funding sources, partners, technologies, materials, process steps, quantitative indicators with exact numbers and units, environmental and social impacts, SDGs, TRL, barriers, lessons learned, recommendations, replication notes, links/references. Keep every number exactly as written. Do NOT add anything not in the text. Output plain bullet lines only." },
      { role: "user", content: chunks[i] }
    ], { json: false, maxTokens: 2500 });
    notes.push(note);
    if (i < chunks.length - 1) await sleep(21000); // stay under the per-minute token budget
  }
  return notes.join("\n");
}

// deep-merge parsed result onto the template so missing keys never break the UI
function conform(template, value) {
  if (Array.isArray(template)) return Array.isArray(value) ? value : [];
  if (template !== null && typeof template === "object") {
    const out = {};
    for (const k of Object.keys(template)) out[k] = conform(template[k], value && typeof value === "object" ? value[k] : undefined);
    return out;
  }
  if (value === undefined || value === null) return template === "" ? "" : null;
  return value;
}

app.post("/api/analyze", auth(), async (req, res) => {
  try {
    if (!GROQ_API_KEY) return res.status(500).json({ error: "GROQ_API_KEY not configured on the server." });
    let text = (req.body.text || "").slice(0, 200000);
    if (!text.trim()) return res.status(400).json({ error: "No text to analyze" });
    if (text.length > CHUNK_CHARS) {
      // Too large for one request on the free tier: condense chunk-by-chunk first
      text = await condenseLargeDoc(text);
      if (text.length > CHUNK_CHARS) text = text.slice(0, CHUNK_CHARS);
      await sleep(21000); // fresh minute window before the big structured call
    }
    let raw = await callGroq([
      { role: "system", content: ANALYSIS_PROMPT },
      { role: "user", content: "DOCUMENT:\n\n" + text }
    ]);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // one retry asking the model to fix its JSON
      raw = await callGroq([
        { role: "system", content: "Fix this into valid JSON only, no commentary." },
        { role: "user", content: raw }
      ]);
      parsed = JSON.parse(raw);
    }
    res.json({ report: conform(EMPTY_REPORT, parsed) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "AI analysis failed: " + e.message });
  }
});

app.get("/api/template", auth(), (req, res) => res.json({ report: JSON.parse(JSON.stringify(EMPTY_REPORT)) }));

// --- submissions (partners save; admin lists all) ---
app.post("/api/submissions", auth(), (req, res) => {
  const id = req.body.id || crypto.randomBytes(8).toString("hex");
  const record = {
    id,
    submittedBy: req.session.name,
    role: req.session.role,
    source: req.body.source || "manual", // "document" | "manual"
    filename: req.body.filename || null,
    updatedAt: new Date().toISOString(),
    report: req.body.report
  };
  fs.writeFileSync(path.join(DATA_DIR, id + ".json"), JSON.stringify(record, null, 2));
  res.json({ ok: true, id });
});

app.get("/api/submissions", auth("admin"), (req, res) => {
  const list = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json")).map(f => {
    const r = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
    return { id: r.id, title: r.report?.title || r.report?.projectName || "(untitled)", submittedBy: r.submittedBy, source: r.source, filename: r.filename, updatedAt: r.updatedAt };
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json({ submissions: list });
});

app.get("/api/submissions/:id", auth(), (req, res) => {
  const f = path.join(DATA_DIR, req.params.id.replace(/[^a-z0-9]/gi, "") + ".json");
  if (!fs.existsSync(f)) return res.status(404).json({ error: "Not found" });
  res.json(JSON.parse(fs.readFileSync(f, "utf8")));
});

app.delete("/api/submissions/:id", auth("admin"), (req, res) => {
  const f = path.join(DATA_DIR, req.params.id.replace(/[^a-z0-9]/gi, "") + ".json");
  if (fs.existsSync(f)) fs.unlinkSync(f);
  res.json({ ok: true });
});

// --- server-side PDF generation (real text PDF via headless Chrome + pdf-lib typesetting) ---
const puppeteer = require("puppeteer");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const printJobs = new Map(); // token -> report data (one-shot)

const LOGO_PATH = path.join(__dirname, "image/images.png");
const mm = v => v * 72 / 25.4; // millimetres -> PDF points

// Reserved-zone geometry (points). Content is rendered inside puppeteer margins;
// the header logo and footer are stamped into those reserved margins here.
// The header zone is deliberately taller than the logo so there is a clear gap +
// separator line between the header and the first content section ("At a Glance").
const HEADER_MARGIN_MM = 30;  // top reserved zone height (content begins below this)
const FOOTER_MARGIN_MM = 18;  // bottom reserved zone height
const SIDE_MM = 15;           // aligns with the content's internal side padding
const LOGO_W_MM = 32;         // header logo width (aspect-preserved); sized so the taller
                              // Interreg/RESWATER lockup clears the header rule below it
const LOGO_TOP_MM = 11;       // logo top edge from the page top
const HEADER_RULE_MM = 26.5;  // separator line below the header (from page top)
const FOOTER_RULE_MM = 12.5;  // separator line above the footer (from page bottom)
const FOOTER_TEXT_MM = 7.5;   // footer text baseline from page bottom

// The stamped header/footer use pdf-lib's built-in Helvetica, which is limited to the
// WinAnsi (CP1252) character set. Transliterate anything outside it (e.g. Turkish "İ/ı",
// Eastern-European letters) to a safe fallback so drawText never throws.
const PDF_SPECIAL = { "İ": "I", "ı": "i", "Ł": "L", "ł": "l", "Đ": "D", "đ": "d", "Ø": "O", "ø": "o", "Æ": "AE", "æ": "ae", "Œ": "OE", "œ": "oe", "Þ": "Th", "þ": "th", "ß": "ss", "Ŋ": "N", "ŋ": "n", "·": "-" };
function pdfSafe(s) {
  return String(s ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")  // strip combining diacritics (é->e, İ->I, ş->s…)
    .replace(/[İıŁłĐđØøÆæŒœÞþßŊŋ·]/g, m => PDF_SPECIAL[m] || m) // letters that don't decompose
    .replace(/[^\x20-\x7e]/g, "");                          // drop anything still outside ASCII printable
}

// Footer text for a report: left = project name (uppercased). The centre phrase was
// removed by request — the footer now carries only the title (left) and page number (right).
function footerTexts(r) {
  const leftText = pdfSafe(String(r.bestPracticeName || r.title || r.projectName || "").toUpperCase());
  return { leftText };
}

// Build a reusable stamper bound to one output document (embeds logo + fonts once).
async function makeStamper(doc) {
  const logo = fs.existsSync(LOGO_PATH) ? await doc.embedPng(fs.readFileSync(LOGO_PATH)) : null;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontB = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.078, 0.153, 0.361), muted = rgb(0.447, 0.482, 0.6), line = rgb(0.80, 0.82, 0.88);
  const left = mm(SIDE_MM);
  const logoW = mm(LOGO_W_MM), logoH = logo ? logoW * (logo.height / logo.width) : 0;
  // Stamp the fixed header (logo + rule) and footer (title · programme · Page X of Y) on one page.
  return function stamp(pg, { leftText, pageNo, total, cover }) {
    // The cover (first) page carries NO header and NO footer — just the banner + content.
    if (cover) return;
    const { width: W, height: H } = pg.getSize();
    if (logo) pg.drawImage(logo, { x: left, y: H - mm(LOGO_TOP_MM) - logoH, width: logoW, height: logoH });
    pg.drawLine({ start: { x: left, y: H - mm(HEADER_RULE_MM) }, end: { x: W - left, y: H - mm(HEADER_RULE_MM) }, thickness: 0.6, color: line });
    const size = 8, textY = mm(FOOTER_TEXT_MM);
    pg.drawLine({ start: { x: left, y: mm(FOOTER_RULE_MM) }, end: { x: W - left, y: mm(FOOTER_RULE_MM) }, thickness: 0.6, color: line });
    if (leftText) pg.drawText(leftText, { x: left, y: textY, size, font: fontB, color: ink });
    const pn = `Page ${pageNo} of ${total}`;
    const pw = font.widthOfTextAtSize(pn, size);
    pg.drawText(pn, { x: W - left - pw, y: textY, size, font, color: muted });
  };
}

// Append one report (its full-bleed cover + zoned content pages) to `out`, recording
// per-page metadata so header/footer can be stamped later with continuous numbering.
async function addReportToDoc(out, meta, contentBuf, report) {
  // The cover is now a banner at the top of page 1 (part of the content flow), so every
  // page is a stamped content page — there is no longer a separate full-bleed cover page.
  const ft = footerTexts(report);
  const contentDoc = await PDFDocument.load(contentBuf);
  const cps = await out.copyPages(contentDoc, contentDoc.getPageIndices());
  cps.forEach((p, idx) => { out.addPage(p); meta.push({ content: true, cover: idx === 0, leftText: ft.leftText }); });
}

// Stamp every content page across the document with continuous page numbers.
async function stampDoc(out, meta) {
  const stamp = await makeStamper(out);
  const pages = out.getPages();
  const total = pages.length;
  for (let i = 0; i < pages.length; i++) {
    const m = meta[i];
    if (m && m.content) stamp(pages[i], { leftText: m.leftText, pageNo: i + 1, total, cover: m.cover });
  }
}

// Render one validated report to a single content PDF buffer. The cover banner is part
// of the content flow (top of page 1) and every page reserves the header/footer zones,
// so one render pass is enough. Reused for single and combined export.
async function renderContent(browser, cleanReport) {
  const token = crypto.randomBytes(16).toString("hex");
  let page;
  try {
    printJobs.set(token, cleanReport);
    page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 1400, deviceScaleFactor: 2 });
    await page.goto(`http://localhost:${PORT}/print.html?t=${token}`, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForFunction("window.__RF_READY === true", { timeout: 30000 });
    const err = await page.evaluate(() => window.__RF_ERROR || null);
    if (err) throw new Error(err);
    await new Promise(r => setTimeout(r, 350));
    // Margins come from the @page rules in print.html (per-page: first page has no top
    // reserve so the cover banner is flush to the top). preferCSSPageSize honours them.
    return await page.pdf({ printBackground: true, preferCSSPageSize: true });
  } finally {
    printJobs.delete(token);
    if (page) await page.close().catch(() => {});
  }
}

// Single-report PDF: cover banner + content, stamped with header/footer + Page X of Y.
async function typesetPDF(contentBuf, r) {
  const out = await PDFDocument.create();
  const meta = [];
  await addReportToDoc(out, meta, contentBuf, r);
  await stampDoc(out, meta);
  return out.save();
}
let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--font-render-hinting=none"] });
    browserPromise.then(b => b.on("disconnected", () => { browserPromise = null; }));
  }
  return browserPromise;
}

// one-shot data endpoint consumed by print.html inside headless Chrome
app.get("/api/print-data/:token", (req, res) => {
  const data = printJobs.get(req.params.token);
  if (!data) return res.status(404).json({ error: "expired" });
  res.json({ report: data });
});

app.post("/api/pdf", auth("admin"), async (req, res) => {
  try {
    if (!req.body.report) return res.status(400).json({ error: "No report data" });
    // validate & normalize content BEFORE it reaches the renderer
    const { report: cleanReport, warnings } = validateReport(req.body.report);
    if (warnings.length) { console.warn("PDF validation warnings:", warnings.join("; ")); res.setHeader("X-Report-Warnings", encodeURIComponent(warnings.join("; "))); }
    const browser = await getBrowser();
    const contentBuf = await renderContent(browser, cleanReport);
    const finalPdf = await typesetPDF(contentBuf, cleanReport);

    const fbase = (cleanReport.bestPracticeName || cleanReport.title || "report").toLowerCase().replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "report";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fbase}.pdf"`);
    res.send(Buffer.from(finalPdf));
  } catch (e) {
    console.error("PDF error:", e);
    res.status(500).json({ error: "PDF generation failed: " + e.message });
  }
});

// ---- Combined "Export All Submissions" — one PDF with every valid report, continuous numbering ----
const combinedJobs = new Map(); // jobId -> progress/result
function pruneJobs() { const now = Date.now(); for (const [k, j] of combinedJobs) if (now - j.createdAt > 15 * 60 * 1000) combinedJobs.delete(k); }
const safeName = s => String(s || "").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");

function loadSubmissions(order) {
  const recs = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json")).map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8")); } catch { return null; }
  }).filter(Boolean);
  const nameOf = r => String(r.report?.bestPracticeName || r.report?.title || r.report?.projectName || "").toLowerCase();
  const dateOf = r => r.updatedAt || "";
  if (order === "newest") recs.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  else if (order === "alpha") recs.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  else recs.sort((a, b) => dateOf(a).localeCompare(dateOf(b))); // oldest first (default)
  return recs;
}

// Start an async combined-export job; returns a jobId the client polls for progress.
app.post("/api/pdf-all", auth("admin"), (req, res) => {
  const order = String(req.query.order || (req.body && req.body.order) || "oldest");
  const recs = loadSubmissions(order);
  if (!recs.length) return res.status(400).json({ error: "No submissions to export" });

  const jobId = crypto.randomBytes(12).toString("hex");
  const job = {
    status: "running", current: 0, total: recs.length, message: "Starting…",
    failed: [], pdf: null, error: null, createdAt: Date.now(),
    filename: `RESWATER_Combined_Submissions_${new Date().toISOString().slice(0, 10)}.pdf`
  };
  combinedJobs.set(jobId, job);
  pruneJobs();
  res.json({ jobId, total: recs.length });

  // generate in the background, sequentially, reusing the existing report renderer
  (async () => {
    const browser = await getBrowser();
    const out = await PDFDocument.create();
    const meta = [];
    let included = 0;
    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      const nm = rec.report?.bestPracticeName || rec.report?.title || rec.report?.projectName || `Submission ${i + 1}`;
      job.current = i + 1;
      job.message = `Preparing submission ${i + 1} of ${recs.length}: ${nm}`;
      try {
        const { report: clean } = validateReport(rec.report || {});
        const empty = !clean.keyFacts.length && !rfText(clean.description) && !rfText(clean.executiveSummary)
          && !clean.sdgs.length && !clean.environmentalImpacts.length && !clean.socialEconomicImpacts.length
          && !rfText(clean.technical.description) && !clean.performance.metrics.length;
        if (empty) { job.failed.push({ name: nm, error: "empty / invalid — skipped" }); continue; }
        const contentBuf = await renderContent(browser, clean);
        await addReportToDoc(out, meta, contentBuf, clean); // buffer dropped after copy
        included++;
      } catch (e) {
        console.error("combined: submission failed:", nm, e.message);
        job.failed.push({ name: nm, error: e.message });
      }
    }
    if (!included) { job.status = "error"; job.error = "No valid submissions could be rendered."; return; }
    job.message = "Generating final document…";
    await stampDoc(out, meta); // continuous Page X of Y across the whole document
    job.pdf = Buffer.from(await out.save());
    job.included = included;
    job.status = "done";
    job.message = "Download ready";
  })().catch(e => { job.status = "error"; job.error = e.message; console.error("combined export error:", e); });
});

app.get("/api/pdf-all/status/:id", auth("admin"), (req, res) => {
  const j = combinedJobs.get(req.params.id);
  if (!j) return res.status(404).json({ error: "job not found" });
  res.json({ status: j.status, current: j.current, total: j.total, message: j.message, failed: j.failed, error: j.error, included: j.included || 0, ready: j.status === "done" });
});

app.get("/api/pdf-all/download/:id", auth("admin"), (req, res) => {
  const j = combinedJobs.get(req.params.id);
  if (!j) return res.status(404).json({ error: "job not found" });
  if (j.status !== "done" || !j.pdf) return res.status(409).json({ error: "not ready" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName(j.filename)}"`);
  res.send(j.pdf);
  setTimeout(() => combinedJobs.delete(req.params.id), 60000); // free memory after download
});

app.listen(PORT, () => console.log(`ReportForge running at http://localhost:${PORT}`));
