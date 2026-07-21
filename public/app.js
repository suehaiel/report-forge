/* ReportForge frontend */
"use strict";

// ---------- state ----------
let session = JSON.parse(localStorage.getItem("rf_session") || "null");
let report = null;                 // the data model being edited
let provenance = "manual";         // "document" | "manual"
let sourceFilename = null;
let submissionId = null;
let editedFields = new Set();
let charts = [];

const SDG = {
  1:["No Poverty","#e5243b"],2:["Zero Hunger","#dda63a"],3:["Good Health & Well-Being","#4c9f38"],
  4:["Quality Education","#c5192d"],5:["Gender Equality","#ff3a21"],6:["Clean Water & Sanitation","#26bde2"],
  7:["Affordable & Clean Energy","#fcc30b"],8:["Decent Work & Economic Growth","#a21942"],
  9:["Industry, Innovation & Infrastructure","#fd6925"],10:["Reduced Inequalities","#dd1367"],
  11:["Sustainable Cities & Communities","#fd9d24"],12:["Responsible Consumption & Production","#bf8b2e"],
  13:["Climate Action","#3f7e44"],14:["Life Below Water","#0a97d9"],15:["Life on Land","#56c02b"],
  16:["Peace, Justice & Strong Institutions","#00689d"],17:["Partnerships for the Goals","#19486a"]
};

// ---------- helpers ----------
const $ = id => document.getElementById(id);
const views = ["loginView","homeView","editorView","reportView","adminView"];
function show(view){ views.forEach(v => $(v).classList.toggle("hidden", v!==view)); window.scrollTo(0,0); }
function esc(s){ return String(s??"").replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
async function api(path, opts={}){
  opts.headers = Object.assign({}, opts.headers, { Authorization: "Bearer " + (session?.token||"") });
  if (opts.json){ opts.headers["Content-Type"]="application/json"; opts.body = JSON.stringify(opts.json); delete opts.json; }
  const r = await fetch(path, opts);
  const data = await r.json().catch(()=>({}));
  if (r.status===401){ logout(); throw new Error("Session expired — please sign in again."); }
  if (!r.ok) throw new Error(data.error || ("HTTP "+r.status));
  return data;
}
function hasText(v){ return v!=null && String(v).trim()!==""; }
function anyText(arr){ return Array.isArray(arr) && arr.some(x=> typeof x==="string" ? hasText(x) : Object.values(x||{}).some(hasText)); }

// ---------- auth ----------
let loginRole = "partner";
$("tabPartner").onclick = ()=>{ loginRole="partner"; $("tabPartner").classList.add("active"); $("tabAdmin").classList.remove("active"); };
$("tabAdmin").onclick   = ()=>{ loginRole="admin";   $("tabAdmin").classList.add("active"); $("tabPartner").classList.remove("active"); };
$("loginBtn").onclick = async ()=>{
  $("loginErr").textContent="";
  try{
    const data = await api("/api/login",{method:"POST",json:{role:loginRole,name:$("loginName").value.trim(),password:$("loginPass").value}});
    session = data; localStorage.setItem("rf_session", JSON.stringify(data));
    enterApp();
  }catch(e){ $("loginErr").textContent = e.message; }
};
$("loginPass").addEventListener("keydown",e=>{ if(e.key==="Enter") $("loginBtn").click(); });
function logout(){ session=null; localStorage.removeItem("rf_session"); $("userBox").classList.add("hidden"); show("loginView"); }
$("logoutBtn").onclick = logout;
$("homeBtn").onclick = ()=> show("homeView");
$("adminBtn").onclick = openAdmin;
function enterApp(){
  $("userBox").classList.remove("hidden");
  $("userLabel").textContent = `${session.name} · ${session.role}`;
  $("adminBtn").classList.toggle("hidden", session.role!=="admin");
  // partners can only fill and submit — report generation/download is admin-only
  $("genReportBtn").classList.toggle("hidden", session.role!=="admin");
  $("saveDraftBtn").textContent = session.role==="admin" ? "Save submission" : "Submit to admin";
  $("saveDraftBtn").classList.toggle("btn-primary", session.role!=="admin");
  $("downloadPdfBtn").textContent = pdfBtnLabel();
  show(session.role==="admin" ? "adminView" : "homeView");
  if (session.role==="admin") openAdmin();
}
if (session) enterApp();

// ---------- home / upload ----------
$("modeUpload").onclick = ()=> $("uploadPanel").classList.toggle("hidden");
$("modeManual").onclick = async ()=>{
  const {report:tpl} = await api("/api/template");
  startEditor(tpl, "manual", null);
};
$("browseBtn").onclick = ()=> $("fileInput").click();
$("fileInput").onchange = e=>{ if(e.target.files[0]) processFile(e.target.files[0]); };
const dz = $("dropzone");
["dragenter","dragover"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add("drag");}));
["dragleave","drop"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove("drag");}));
dz.addEventListener("drop", e=>{ const f=e.dataTransfer.files[0]; if(f) processFile(f); });

function prog(pct, txt){ $("progBar").style.width=pct+"%"; $("progTxt").textContent=txt||""; }

async function processFile(file){
  try{
    prog(15,"Reading document…");
    const fd = new FormData(); fd.append("file", file);
    const ext = await api("/api/extract",{method:"POST",body:fd});
    prog(45,`Extracted ${ext.chars.toLocaleString()} characters — AI is analyzing… (large documents can take 1–3 minutes on the free tier)`);
    const an = await api("/api/analyze",{method:"POST",json:{text:ext.text}});
    prog(100,"Done — review the extracted information");
    setTimeout(()=>prog(0,""),1200);
    startEditor(an.report, "document", ext.filename);
  }catch(e){
    prog(0,""); alert("Failed: "+e.message);
  }
}

// ---------- editor ----------
function startEditor(rep, source, filename){
  report = rep; provenance = source; sourceFilename = filename;
  submissionId = null; editedFields = new Set();
  buildEditor(); show("editorView");
}

function get(path){ return path.split(".").reduce((o,k)=>o?.[k], report); }
function set(path,val){
  const ks = path.split("."); let o = report;
  for(let i=0;i<ks.length-1;i++) o = o[ks[i]];
  o[ks[ks.length-1]] = val;
  editedFields.add(path);
  markBadge(path);
}
function badgeFor(path){
  if (provenance==="manual" || editedFields.has(path)) return `<span class="badge manual">manual</span>`;
  return `<span class="badge extracted">extracted</span>`;
}
function markBadge(path){
  const el = document.querySelector(`[data-badge="${path}"]`);
  if (el) el.innerHTML = `<span class="badge manual">manual</span>`;
}

function fieldHTML(path,label,hint,type="input"){
  const v = get(path);
  const inner = type==="textarea"
    ? `<textarea data-bind="${path}">${esc(v)}</textarea>`
    : `<input data-bind="${path}" value="${esc(v)}">`;
  return `<div class="field"><label>${label} <span data-badge="${path}">${hasText(v)?badgeFor(path):""}</span></label>${hint?`<div class="hint">${hint}</div>`:""}${inner}</div>`;
}
function listHTML(path,label,hint,cols){
  // cols: array of {key,ph,width}  — items are objects; or null for plain string list
  const items = get(path)||[];
  const gridCols = cols ? cols.map(c=>c.width||"1fr").join(" ")+" 30px" : "1fr 30px";
  const rows = items.map((it,i)=>{
    const cells = cols
      ? cols.map(c=>`<input data-list="${path}" data-i="${i}" data-k="${c.key}" placeholder="${c.ph}" value="${esc(it?.[c.key])}">`).join("")
      : `<input data-list="${path}" data-i="${i}" placeholder="" value="${esc(it)}">`;
    return `<div class="row" style="grid-template-columns:${gridCols}">${cells}<button class="del" data-del="${path}" data-i="${i}">✕</button></div>`;
  }).join("");
  return `<div class="field"><label>${label}</label>${hint?`<div class="hint">${hint}</div>`:""}
    <div class="rowList" data-listbox="${path}">${rows}</div>
    <button class="addRow" data-add="${path}" data-cols='${cols?JSON.stringify(cols.map(c=>c.key)):"null"}'>+ Add</button></div>`;
}

function buildEditor(){
  const S = (title, inner, open=false)=>`<details class="secBlock" ${open?"open":""}><summary>${title}</summary><div class="body">${inner}</div></details>`;
  $("editorSections").innerHTML = [
    S("1 · General information",
      `<div class="grid2">${fieldHTML("bestPracticeName","Best practice name","Shown as the main title on the cover — the name of the practice/solution")}${fieldHTML("projectName","Programme / project name","e.g. RESWATER")}</div>
       <div class="grid2">${fieldHTML("category","Category","e.g. Water reuse, Climate adaptation, NCWR")}${fieldHTML("documentType","Document type","e.g. Best Practice Inventory Form")}</div>
       ${fieldHTML("title","Fallback title","Used on the cover only if no best practice name is set")}`, true),
    S("2 · Location & coordinates",
      `<div class="grid2">${fieldHTML("location.name","Site / city")}${fieldHTML("location.country","Country")}</div>
       <div class="grid2">${fieldHTML("location.lat","Latitude","Decimal degrees, e.g. 36.8065 — leave empty if unknown")}${fieldHTML("location.lng","Longitude","e.g. 10.1815")}</div>
       ${fieldHTML("location.region","Region")}`),
    S("3 · Description & summary",
      `${fieldHTML("description","Short description","2–3 sentences on what the practice is — shown right after Key Facts","textarea")}
       ${fieldHTML("executiveSummary","Scientific summary","Scientific synthesis of the whole document — objective, method, key results, significance","textarea")}`),
    S("4 · Key facts (KPI cards)", listHTML("keyFacts","Key facts","Headline figures shown as KPI cards on the report",[{key:"label",ph:"Label (e.g. Total budget)"},{key:"value",ph:"Value (e.g. €2.81M)"},{key:"unit",ph:"Unit (optional)",width:"120px"}])),
    S("5 · Overview",
      `${fieldHTML("overview.what","What is the solution?","", "textarea")}
       ${fieldHTML("overview.problem","What problem does it address?","", "textarea")}
       ${fieldHTML("overview.importance","Why is it important?","", "textarea")}`),
    S("6 · Technical description",
      `${fieldHTML("technical.description","Technical description","", "textarea")}
       ${listHTML("technical.technologies","Technologies",null,null)}
       ${listHTML("technical.materials","Materials / infrastructure",null,null)}
       ${listHTML("technical.processSteps","Process steps","Ordered steps — rendered as a process diagram",null)}
       ${fieldHTML("technical.operations","Operation & maintenance","", "textarea")}`),
    S("7 · Performance & data",
      `${listHTML("performance.metrics","Quantitative metrics","Only real numbers from the source — rendered as charts",[{key:"name",ph:"Indicator"},{key:"value",ph:"Value (number)",width:"130px"},{key:"unit",ph:"Unit",width:"110px"},{key:"context",ph:"Context"}])}
       ${listHTML("performance.qualitative","Qualitative indicators",null,null)}`),
    S("8 · Environmental impact", listHTML("environmentalImpacts","Environmental impacts",null,[{key:"aspect",ph:"Aspect (e.g. Water savings)",width:"220px"},{key:"description",ph:"Description"}])),
    S("9 · Social & economic impact", listHTML("socialEconomicImpacts","Social & economic impacts",null,[{key:"aspect",ph:"Aspect (e.g. Beneficiaries)",width:"220px"},{key:"description",ph:"Description"}])),
    S("10 · SDG alignment", listHTML("sdgs","Sustainable Development Goals","Goal number 1–17 + why it applies",[{key:"number",ph:"№ (1–17)",width:"90px"},{key:"justification",ph:"Justification"}])),
    S("11 · Innovation & TRL",
      `${fieldHTML("innovation.description","Innovation","", "textarea")}
       ${fieldHTML("innovation.trl","Technology Readiness Level (1–9)","Leave empty if not stated")}`),
    S("12 · Barriers, funding & implementation",
      `${listHTML("barriers","Barriers",null,null)}
       ${listHTML("funding","Funding",null,[{key:"source",ph:"Source / programme"},{key:"amount",ph:"Amount",width:"160px"},{key:"mechanism",ph:"Mechanism",width:"180px"}])}
       ${fieldHTML("implementationContext","Implementation context","", "textarea")}`),
    S("13 · Lessons learned & recommendations",
      `${listHTML("lessonsLearned","Lessons learned",null,null)}
       ${listHTML("recommendations","Recommendations",null,null)}`),
    S("14 · Replication & upscaling",
      `${fieldHTML("replication.potential","Replication potential","", "textarea")}
       ${fieldHTML("replication.conditions","Conditions for replication","", "textarea")}
       ${fieldHTML("replication.where","Where could it be replicated?","", "textarea")}`),
    S("15 · References & sources", listHTML("references","References / links",null,null)),
    S("16 · Keywords", listHTML("keywords","Keywords / tags","Short topical tags shown at the end of the report",null)),
  ].join("");

  // bindings
  $("editorSections").querySelectorAll("[data-bind]").forEach(el=>{
    el.addEventListener("input", ()=> set(el.dataset.bind, el.value));
  });
  $("editorSections").addEventListener("input", e=>{
    const el = e.target;
    if (el.dataset.list){
      const arr = get(el.dataset.list);
      if (el.dataset.k) arr[+el.dataset.i][el.dataset.k] = el.value;
      else arr[+el.dataset.i] = el.value;
      editedFields.add(el.dataset.list);
    }
  });
  $("editorSections").addEventListener("click", e=>{
    const el = e.target;
    if (el.dataset.add!==undefined && el.classList.contains("addRow")){
      const keys = JSON.parse(el.dataset.cols);
      get(el.dataset.add).push(keys ? Object.fromEntries(keys.map(k=>[k,""])) : "");
      editedFields.add(el.dataset.add);
      rebuildKeepOpen();
    } else if (el.dataset.del!==undefined && el.classList.contains("del")){
      get(el.dataset.del).splice(+el.dataset.i,1);
      editedFields.add(el.dataset.del);
      rebuildKeepOpen();
    }
  });
}
function rebuildKeepOpen(){
  const open = [...$("editorSections").querySelectorAll("details")].map(d=>d.open);
  buildEditor();
  [...$("editorSections").querySelectorAll("details")].forEach((d,i)=>d.open = open[i]);
}

$("saveDraftBtn").onclick = async ()=>{
  try{
    const r = await api("/api/submissions",{method:"POST",json:{id:submissionId,report,source:provenance,filename:sourceFilename}});
    submissionId = r.id;
    $("saveDraftBtn").textContent = session.role==="admin" ? "Saved ✓" : "Submitted ✓";
    setTimeout(()=>{ $("saveDraftBtn").textContent = session.role==="admin" ? "Save submission" : "Submit to admin"; },1800);
  }catch(e){ alert(e.message); }
};
$("genReportBtn").onclick = ()=>{ renderReport(); show("reportView"); };
$("backToEditBtn").onclick = ()=> show("editorView");

// Convert the internal report model into the custom "data" JSON schema
// (same shape as the sample cam_green_roof…_data.json files).
function toCustomJSON(r){
  const numOr = (v)=>{ const n = parseFloat(String(v??"").replace(/[, ]/g,"")); return isNaN(n)?null:n; };
  const loc = r.location||{}, ov = r.overview||{}, t = r.technical||{}, perf = r.performance||{}, inn = r.innovation||{}, rep = r.replication||{};

  // techSpecs: derive from keyFacts (label -> value[+unit])
  const techSpecs = {};
  (r.keyFacts||[]).forEach(f=>{
    if (!f || !String(f.label||"").trim()) return;
    const key = String(f.label).trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
    techSpecs[key] = [f.value, f.unit].filter(x=>x!=null&&String(x).trim()!=="").join(" ").trim();
  });

  // performance: map known metrics into the fixed numeric fields, keep the rest by slug
  const performance = {};
  (perf.metrics||[]).forEach(m=>{
    if (!m) return;
    const v = numOr(m.value); if (v===null) return;
    const n = String(m.name||"").toLowerCase();
    if (/retain/.test(n)) performance.waterRetainedPct = v;
    else if (/flood|peak/.test(n)) performance.floodPeakReductionPct = v;
    else if (/harvest/.test(n)) performance.harvestedWaterM3 = v;
    else if (/storage|capacity/.test(n)) performance.storageCapacityLiters = v;
    else if (/energy/.test(n)) performance.energyConsumptionKwh = v;
    else performance[n.replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"")] = v;
  });

  // sdgs object: { sdgN: true } for every aligned goal
  const sdgs = {};
  (r.sdgs||[]).forEach(s=>{ const num = parseInt(s && s.number); if (num>=1 && num<=17) sdgs["sdg"+num] = true; });

  const impactStrings = arr => (arr||[]).map(x=>{
    if (typeof x === "string") return x;
    return [x.aspect, x.description].filter(v=>v&&String(v).trim()).join(" — ");
  }).filter(v=>String(v).trim());

  const trlNum = numOr(inn.trl);

  return {
    title: r.title || r.projectName || "",
    partnerName: r.projectName || "",
    country: loc.country || "",
    city: loc.region || loc.name || "",
    ncwrType: r.documentType || "",
    bestPracticeType: r.category || "",
    mainImageBase64: "",
    organisation: r.projectName || "",
    contactName: "",
    locationDetails: loc.name || "",
    trl: trlNum!==null ? "TRL "+trlNum : "",
    year: "",
    monitoring: "",
    funding: (r.funding||[]).map(f=>f&&f.source).filter(Boolean).join(", "),
    latitude: loc.lat!=null ? String(loc.lat) : "",
    longitude: loc.lng!=null ? String(loc.lng) : "",
    mapZoom: 14,
    urbanChallenge: ov.problem || "",
    implementedSolution: ov.what || "",
    mainBenefits: (perf.qualitative||[]).filter(Boolean).join(" "),
    whyImportant: r.executiveSummary || ov.importance || "",
    stakeholders: r.implementationContext ? r.implementationContext.split(/,|·/).map(s=>s.trim()).filter(Boolean) : [],
    sdgs,
    architectureSteps: (t.processSteps||[]).filter(Boolean),
    techSpecs,
    technologiesUsed: (t.technologies||[]).filter(Boolean),
    performance,
    economics: (r.funding||[]).reduce((o,f,i)=>{ if(f&&(f.source||f.amount)) o["funding_"+(i+1)] = [f.source,f.amount,f.mechanism].filter(Boolean).join(" — "); return o; }, {}),
    environmentalImpacts: impactStrings(r.environmentalImpacts),
    socialImpacts: impactStrings(r.socialEconomicImpacts),
    replicationLevel: rep.potential || "",
    replicationConditions: rep.conditions ? { general: rep.conditions } : {},
    lessonsLearned: (r.lessonsLearned||[]).filter(Boolean)
  };
}

function pdfBtnLabel(){ return session?.role==="admin" ? "⬇ Download PDF" : "⬇ Download JSON"; }
function reportFileBase(){
  return (report.bestPracticeName||report.title||report.projectName||"report")
    .toLowerCase().replace(/[^\w\- ]+/g,"").trim().replace(/\s+/g,"_") || "report";
}
function triggerDownload(blob, fname){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = fname;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
}
async function downloadPDF(btn){
  btn.disabled = true; btn.textContent = "Generating…";
  try{
    const resp = await fetch("/api/pdf", {
      method:"POST",
      headers:{ "Content-Type":"application/json", Authorization:"Bearer "+(session?.token||"") },
      body: JSON.stringify({ report })
    });
    if (resp.status===401){ logout(); throw new Error("Session expired — please sign in again."); }
    if (!resp.ok){ const e = await resp.json().catch(()=>({})); throw new Error(e.error||("HTTP "+resp.status)); }
    triggerDownload(await resp.blob(), reportFileBase()+".pdf");
    btn.textContent = "Downloaded ✓";
  }catch(e){ alert("PDF export failed: " + e.message); btn.textContent = pdfBtnLabel(); }
  finally{ btn.disabled = false; setTimeout(()=>{ btn.textContent = pdfBtnLabel(); }, 1800); }
}
function downloadJSON(btn){
  try{
    const blob = new Blob([JSON.stringify(toCustomJSON(report), null, 2)], { type: "application/json" });
    triggerDownload(blob, reportFileBase()+"_data.json");
    btn.textContent = "Downloaded ✓";
    setTimeout(()=>{ btn.textContent = pdfBtnLabel(); }, 1800);
  }catch(e){ alert("JSON export failed: " + e.message); }
}
$("downloadPdfBtn").onclick = ()=>{
  const btn = $("downloadPdfBtn");
  if (session?.role==="admin") downloadPDF(btn); else downloadJSON(btn);
};

// ---- Export All Submissions (admin) — one combined PDF, generated server-side with progress ----
if ($("exportAllBtn")){
  let exporting = false;
  $("exportAllBtn").onclick = async ()=>{
    if (exporting) return;               // prevent duplicate clicks
    exporting = true;
    const btn = $("exportAllBtn");
    const label = "Export All Submissions";
    const order = $("exportOrder") ? $("exportOrder").value : "oldest";
    btn.disabled = true; btn.textContent = "Generating combined PDF…";
    try{
      const start = await api("/api/pdf-all?order="+encodeURIComponent(order), { method:"POST" });
      const jobId = start.jobId;
      let failed = [];
      // poll progress
      for(;;){
        await new Promise(r=>setTimeout(r, 700));
        const s = await api("/api/pdf-all/status/"+jobId);
        if (s.message) btn.textContent = s.message.length>42 ? s.message.slice(0,40)+"…" : s.message;
        failed = s.failed || [];
        if (s.status==="done") break;
        if (s.status==="error") throw new Error(s.error || "Export failed");
      }
      // download the finished PDF
      btn.textContent = "Preparing download…";
      const resp = await fetch("/api/pdf-all/download/"+jobId, { headers:{ Authorization:"Bearer "+(session?.token||"") } });
      if (!resp.ok){ const e = await resp.json().catch(()=>({})); throw new Error(e.error || ("HTTP "+resp.status)); }
      const cd = resp.headers.get("Content-Disposition") || "";
      const m = cd.match(/filename="?([^"]+)"?/);
      triggerDownload(await resp.blob(), m ? m[1] : "RESWATER_Combined_Submissions.pdf");
      btn.textContent = failed.length ? `Download ready ✓ (${failed.length} skipped)` : "Download ready ✓";
      if (failed.length) alert("Some submissions were skipped:\n\n" + failed.map(f=>"• "+f.name+" — "+f.error).join("\n"));
      setTimeout(()=>{ btn.textContent = label; }, 3500);
    }catch(e){
      alert("Export failed: " + e.message);
      btn.textContent = label;
    }finally{
      btn.disabled = false; exporting = false;
    }
  };
}

// ---------- report rendering ----------
const secAB=(k,t,i)=>sec(k,t,i,true);
function sec(kick,title,inner,allowBreak){
  return `<div class="rsec${allowBreak?" allowBreak":""}"><div class="secKick">${kick}</div><h2 class="secT">${title}</h2><div class="secRule"></div>${inner}</div>`;
}
function renderReport(){
  charts.forEach(c=>c.destroy()); charts=[];
  const r = report, P = [];
  const num = v => { const n = parseFloat(String(v).replace(/[, ]/g,"")); return isNaN(n)?null:n; };

  // cover
  const locLine = [r.location.name, r.location.country].filter(hasText).join(", ");
  const dateStr = new Date().toLocaleDateString("en-GB",{year:"numeric",month:"long",day:"numeric"});
  const wm = `<div class="wm">RES<span>WATER</span><small>Interreg NEXT MED · Co-funded by the European Union</small></div>`;
  P.push(`<div class="page cover">
    <div class="coverHead">${wm}<div class="logoBox"><img src="interreg.png" alt="Interreg NEXT MED — Co-funded by the European Union"></div></div>
    <div class="coverBody">
      ${hasText(r.category)?`<span class="cat">${esc(r.category)}</span>`:""}
      <h1>${esc(r.title||r.projectName||"Untitled report")}</h1>
      <div class="meta">
        ${hasText(r.projectName)&&r.projectName!==r.title?`<div><strong>${esc(r.projectName)}</strong></div>`:""}
        ${hasText(locLine)?`<div>📍 ${esc(locLine)}</div>`:""}
        ${hasText(r.documentType)?`<div>${esc(r.documentType)}</div>`:""}
      </div>
    </div>
    <div class="brandline"><span>RESWATER · Technical report</span><span>${dateStr}</span></div>
  </div>`);
  const DOC = []; // flowing sections collected here, wrapped in one page at the end
  const push_ = P.push.bind(P);
  P.push = html => DOC.push(html);

  if (hasText(r.executiveSummary))
    P.push(sec("Summary","Executive Summary",`<p>${esc(r.executiveSummary)}</p>`));

  const facts = (r.keyFacts||[]).filter(f=>hasText(f.value)||hasText(f.label));
  if (facts.length)
    P.push(sec("At a glance","Key Facts",
      `<div class="kpiGrid">${facts.map(f=>`<div class="kpi"><div class="v">${esc(f.value)}${hasText(f.unit)?" "+esc(f.unit):""}</div><div class="l">${esc(f.label)}</div></div>`).join("")}</div>`));

  const lat = num(r.location.lat), lng = num(r.location.lng);
  if (lat!==null && lng!==null)
    P.push(sec("Geography","Geographic Context",
      `<p>${esc([r.location.name,r.location.region,r.location.country].filter(hasText).join(" · "))} — coordinates ${lat.toFixed(4)}, ${lng.toFixed(4)}</p><div id="map"></div>`));
  else if (hasText(locLine))
    P.push(sec("Geography","Geographic Context",`<p>${esc([r.location.name,r.location.region,r.location.country].filter(hasText).join(" · "))}</p><p class="na">Coordinates not provided — map not available.</p>`));

  const ov = r.overview;
  if (hasText(ov.what)||hasText(ov.problem)||hasText(ov.importance))
    P.push(sec("Overview","Project Overview",
      [ov.what&&`<p><strong>What it is.</strong> ${esc(ov.what)}</p>`,
       ov.problem&&`<p><strong>The problem it addresses.</strong> ${esc(ov.problem)}</p>`,
       ov.importance&&`<p><strong>Why it matters.</strong> ${esc(ov.importance)}</p>`].filter(Boolean).join("")));

  const t = r.technical;
  if (hasText(t.description)||anyText(t.technologies)||anyText(t.materials)||hasText(t.operations))
    P.push(secAB("Technology","Technical Description",
      [t.description&&`<p>${esc(t.description)}</p>`,
       anyText(t.technologies)&&`<p><strong>Technologies:</strong></p><ul class="clean">${t.technologies.filter(hasText).map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`,
       anyText(t.materials)&&`<p><strong>Materials & infrastructure:</strong></p><ul class="clean">${t.materials.filter(hasText).map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`,
       t.operations&&`<p><strong>Operation & maintenance.</strong> ${esc(t.operations)}</p>`].filter(Boolean).join("")));

  const steps = (t.processSteps||[]).filter(hasText);
  if (steps.length)
    P.push(secAB("Process","System & Process Visualization",
      `<div class="flow">${steps.map((s,i)=>`<div class="flowStep"><div class="n">${i+1}</div><div class="t">${esc(s)}</div></div>`).join("")}</div>`));

  const metrics = (r.performance.metrics||[]).map(m=>({...m, value:num(m.value)})).filter(m=>hasText(m.name)&&m.value!==null);
  const qual = (r.performance.qualitative||[]).filter(hasText);
  if (metrics.length || qual.length){
    let inner = "";
    if (metrics.length){
      const pct = metrics.filter(m=>/%|percent/i.test(m.unit||""));
      const other = metrics.filter(m=>!pct.includes(m));
      if (other.length) inner += `<div class="chartBox"><canvas id="chartBar" height="${Math.max(120, other.length*36)}"></canvas></div>`;
      if (pct.length)   inner += `<div class="chartBox" style="max-width:420px;margin:18px auto 0"><canvas id="chartPct" height="220"></canvas></div>`;
      inner += `<ul class="clean" style="margin-top:16px">${metrics.map(m=>`<li><strong>${esc(m.name)}:</strong> ${m.value.toLocaleString()} ${esc(m.unit||"")}${hasText(m.context)?" — "+esc(m.context):""}</li>`).join("")}</ul>`;
    } else {
      inner += `<p class="na">No sufficient quantitative data was provided — qualitative indicators are shown instead.</p>`;
    }
    if (qual.length) inner += `<ul class="clean">${qual.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`;
    P.push(secAB("Data","Performance & Data",inner));
  }

  const impCards = (arr,cls)=>`<div class="impGrid">${arr.map(x=>`<div class="imp ${cls}"><div class="a">${esc(x.aspect||"")}</div><div class="d">${esc(x.description||"")}</div></div>`).join("")}</div>`;
  const env = (r.environmentalImpacts||[]).filter(x=>hasText(x.aspect)||hasText(x.description));
  if (env.length) P.push(sec("Environment","Environmental Impact",impCards(env,"")));
  const soc = (r.socialEconomicImpacts||[]).filter(x=>hasText(x.aspect)||hasText(x.description));
  if (soc.length) P.push(sec("Society & economy","Social & Economic Impact",impCards(soc,"blue")));

  const sdgs = (r.sdgs||[]).map(s=>({...s, number:parseInt(s.number)})).filter(s=>SDG[s.number]);
  if (sdgs.length)
    P.push(sec("Agenda 2030","SDG Alignment",
      `<div class="sdgGrid">${sdgs.map(s=>`<div class="sdg" style="background:${SDG[s.number][1]}"><div class="n">${s.number}</div><div class="t">${SDG[s.number][0]}</div>${hasText(s.justification)?`<div class="j">${esc(s.justification)}</div>`:""}</div>`).join("")}</div>`));

  const trl = num(r.innovation.trl);
  if (hasText(r.innovation.description) || trl!==null)
    P.push(sec("Innovation","Innovation & Technology Readiness",
      [r.innovation.description&&`<p>${esc(r.innovation.description)}</p>`,
       trl!==null&&trl>=1&&trl<=9&&`<p><strong>TRL ${trl} / 9</strong></p><div class="trlBar">${Array.from({length:9},(_,i)=>`<div class="${i<trl?"on":""}"></div>`).join("")}</div><div class="trlLabels"><span>Research</span><span>Development</span><span>Deployment</span></div>`].filter(Boolean).join("")));

  const barriers = (r.barriers||[]).filter(hasText);
  const funding = (r.funding||[]).filter(f=>hasText(f.source)||hasText(f.amount));
  if (barriers.length||funding.length||hasText(r.implementationContext))
    P.push(secAB("Context","Barriers, Funding & Implementation",
      [barriers.length&&`<p><strong>Barriers:</strong></p><ul class="clean">${barriers.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`,
       funding.length&&`<p><strong>Funding:</strong></p><ul class="clean">${funding.map(f=>`<li>${esc(f.source)}${hasText(f.amount)?" — "+esc(f.amount):""}${hasText(f.mechanism)?" ("+esc(f.mechanism)+")":""}</li>`).join("")}</ul>`,
       r.implementationContext&&`<p>${esc(r.implementationContext)}</p>`].filter(Boolean).join("")));

  const lessons = (r.lessonsLearned||[]).filter(hasText);
  const recs = (r.recommendations||[]).filter(hasText);
  if (lessons.length||recs.length)
    P.push(secAB("Learning","Lessons Learned & Recommendations",
      [lessons.length&&`<p><strong>Lessons learned:</strong></p><ul class="clean">${lessons.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`,
       recs.length&&`<p><strong>Recommendations:</strong></p><ul class="clean">${recs.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`].filter(Boolean).join("")));

  const rep = r.replication;
  if (hasText(rep.potential)||hasText(rep.conditions)||hasText(rep.where))
    P.push(sec("Scaling","Replication & Upscaling Potential",
      [rep.potential&&`<p><strong>Potential.</strong> ${esc(rep.potential)}</p>`,
       rep.conditions&&`<p><strong>Conditions.</strong> ${esc(rep.conditions)}</p>`,
       rep.where&&`<p><strong>Where.</strong> ${esc(rep.where)}</p>`].filter(Boolean).join("")));

  const refs = (r.references||[]).filter(hasText);
  if (refs.length)
    P.push(secAB("Sources","References & Sources",
      `<ul class="clean refList">${refs.map(x=>{
        const url = /^https?:\/\//i.test(x.trim());
        return `<li>${url?`<a href="${esc(x.trim())}" target="_blank" rel="noopener">${esc(x.trim())}</a>`:esc(x)}</li>`;
      }).join("")}</ul>`));

  P.push = push_;
  P.push(`<div class="page">
    <div class="docHeader">${wm}<img src="interreg.png" alt="Interreg NEXT MED — Co-funded by the European Union"></div>
    <div class="doc">
      ${DOC.join("")}
      <div class="docFooter"><span>RESWATER · Interreg NEXT MED — Co-funded by the European Union</span><span>${dateStr}</span></div>
    </div>
  </div>`);
  $("reportPages").innerHTML = P.join("");

  // map
  if (lat!==null && lng!==null && document.getElementById("map")){
    setTimeout(()=>{
      const map = L.map("map",{scrollWheelZoom:false}).setView([lat,lng], 10);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap contributors",crossOrigin:true}).addTo(map);
      L.marker([lat,lng]).addTo(map).bindPopup(esc(locLine||"Project site")).openPopup();
      setTimeout(()=>map.invalidateSize(),300);
    },50);
  }
  // charts
  if (document.getElementById("chartBar")){
    const other = metrics.filter(m=>!/%|percent/i.test(m.unit||""));
    charts.push(new Chart($("chartBar"),{type:"bar",
      data:{labels:other.map(m=>m.name+(m.unit?` (${m.unit})`:"")),datasets:[{data:other.map(m=>m.value),backgroundColor:"rgba(42,143,157,.75)",borderRadius:6}]},
      options:{indexAxis:"y",plugins:{legend:{display:false},title:{display:true,text:"Quantitative indicators"}},scales:{x:{grid:{color:"rgba(26,95,122,.08)"}}}}}));
  }
  if (document.getElementById("chartPct")){
    const pct = metrics.filter(m=>/%|percent/i.test(m.unit||""));
    charts.push(new Chart($("chartPct"),{type:"doughnut",
      data:{labels:pct.map(m=>m.name),datasets:[{data:pct.map(m=>m.value),backgroundColor:["#2a8f9d","#7fae3f","#0e3a4d","#b09a5e","#fd9d24","#26bde2"]}]},
      options:{plugins:{title:{display:true,text:"Percentage indicators (%)"},legend:{position:"bottom"}}}}));
  }
}

// ---------- admin ----------
async function openAdmin(){
  show("adminView");
  try{
    const {submissions} = await api("/api/submissions");
    $("adminEmpty").classList.toggle("hidden", submissions.length>0);
    $("adminRows").innerHTML = submissions.map(s=>`<tr>
      <td><strong>${esc(s.title)}</strong>${s.filename?`<br><span class="hint">${esc(s.filename)}</span>`:""}</td>
      <td>${esc(s.submittedBy)}</td>
      <td><span class="badge ${s.source==="document"?"extracted":"manual"}">${s.source}</span></td>
      <td>${new Date(s.updatedAt).toLocaleString()}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost" data-open="${s.id}">Open</button>
        <button class="btn btn-danger" data-rm="${s.id}">Delete</button>
      </td></tr>`).join("");
  }catch(e){ alert(e.message); }
}
$("adminRows").addEventListener("click", async e=>{
  const openId = e.target.dataset.open, rmId = e.target.dataset.rm;
  if (openId){
    const rec = await api("/api/submissions/"+openId);
    report = rec.report; provenance = rec.source; sourceFilename = rec.filename;
    submissionId = rec.id; editedFields = new Set();
    buildEditor(); show("editorView");
  } else if (rmId && confirm("Delete this submission?")){
    await api("/api/submissions/"+rmId,{method:"DELETE"});
    openAdmin();
  }
});

