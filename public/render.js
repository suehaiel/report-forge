/* ReportForge — shared report renderer (preview + server-side PDF) */
(function(){
"use strict";

const SDG_DATA = {
  1:["No Poverty","#e5243b"],2:["Zero Hunger","#dda63a"],3:["Good Health & Well-Being","#4c9f38"],
  4:["Quality Education","#c5192d"],5:["Gender Equality","#ff3a21"],6:["Clean Water & Sanitation","#26bde2"],
  7:["Affordable & Clean Energy","#fcc30b"],8:["Decent Work & Economic Growth","#a21942"],
  9:["Industry, Innovation & Infrastructure","#fd6925"],10:["Reduced Inequalities","#dd1367"],
  11:["Sustainable Cities & Communities","#fd9d24"],12:["Responsible Consumption & Production","#bf8b2e"],
  13:["Climate Action","#3f7e44"],14:["Life Below Water","#0a97d9"],15:["Life on Land","#56c02b"],
  16:["Peace, Justice & Strong Institutions","#00689d"],17:["Partnerships for the Goals","#19486a"]
};

// Simple white pictograms per SDG (drawn inline so the PDF stays self-contained)
const SDG_ICON = {
  1:`<circle cx="12" cy="6.5" r="2.6" fill="#fff"/><path d="M6 20c0-4 2.7-6 6-6s6 2 6 6" fill="#fff"/>`,
  2:`<path d="M12 4c3 3 4 6 4 9a4 4 0 0 1-8 0c0-3 1-6 4-9Z" fill="#fff"/>`,
  3:`<path d="M12 20C6 15.5 4 11.7 4 8.4A3.7 3.7 0 0 1 12 6a3.7 3.7 0 0 1 8 2.4c0 3.3-2 7.1-8 11.6Z" fill="#fff"/>`,
  4:`<path d="M2 9l10-4 10 4-10 4Z" fill="#fff"/><path d="M6 12v4c0 1.6 2.7 3 6 3s6-1.4 6-3v-4" fill="none" stroke="#fff" stroke-width="1.8"/>`,
  5:`<circle cx="12" cy="9" r="4.2" fill="none" stroke="#fff" stroke-width="2"/><path d="M12 13v7M9 17h6" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`,
  6:`<path d="M12 3s7 8 7 12a7 7 0 0 1-14 0c0-4 7-12 7-12Z" fill="#fff"/>`,
  7:`<circle cx="12" cy="12" r="4" fill="#fff"/><g stroke="#fff" stroke-width="1.8" stroke-linecap="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></g>`,
  8:`<path d="M4 20V12M9 20V7M14 20v-6M19 20V4" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>`,
  9:`<circle cx="12" cy="12" r="3" fill="#fff"/><g stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M18.4 5.6l-2 2M7.6 16.4l-2 2"/></g>`,
  10:`<path d="M5 10h14M5 14h14" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><path d="M9 6l-4 4 4 4M15 10l4 4-4 4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  11:`<g fill="#fff"><rect x="4" y="10" width="6" height="10"/><rect x="12" y="5" width="8" height="15"/></g><g fill="#155a9c"><rect x="14" y="8" width="2" height="2"/><rect x="17" y="8" width="2" height="2"/><rect x="14" y="12" width="2" height="2"/><rect x="17" y="12" width="2" height="2"/></g>`,
  12:`<path d="M8 5l3 5H5l1.5-2.6M16 8l3 5-2.9.2 1.4 2.4M14 19l-3-5 5.2.1-1.3 2.3M10 19H5l3-5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  13:`<circle cx="12" cy="9.5" r="3.2" fill="#fff"/><path d="M4 17c2.5-2.5 4.5-2.5 7 0M13 17c2.5-2.5 4.5-2.5 7 0" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>`,
  14:`<path d="M3 12c4-5 9-5 12 0-3 5-8 5-12 0Z" fill="#fff"/><path d="M15 12l5-3v6Z" fill="#fff"/><circle cx="7" cy="11" r="1" fill="#0a97d9"/>`,
  15:`<rect x="11" y="13" width="2" height="7" fill="#fff"/><circle cx="12" cy="9" r="5" fill="#fff"/>`,
  16:`<path d="M12 3l7 3v5c0 4-3 7-7 9-4-2-7-5-7-9V6Z" fill="#fff"/><path d="M9 12l2 2 4-4" fill="none" stroke="#00689d" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  17:`<circle cx="9" cy="12" r="4" fill="none" stroke="#fff" stroke-width="2"/><circle cx="15" cy="12" r="4" fill="none" stroke="#fff" stroke-width="2"/>`
};
const sdgIcon = n => `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">${SDG_ICON[n]||`<circle cx="12" cy="12" r="7" fill="none" stroke="#fff" stroke-width="2"/><circle cx="12" cy="12" r="2.5" fill="#fff"/>`}</svg>`;

const escT = s => String(s??"").replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const hasText = v => v!=null && String(v).trim()!=="";
const anyText = a => Array.isArray(a) && a.some(x=> typeof x==="string" ? hasText(x) : Object.values(x||{}).some(hasText));
const num = v => { const n = parseFloat(String(v).replace(/[, ]/g,"")); return isNaN(n)?null:n; };

let liveCharts = [], liveMap = null;

function secHtml(kick,title,inner,allowBreak){
  // `kick` (the small uppercase label above the title) is intentionally not rendered.
  return `<div class="rsec${allowBreak?" allowBreak":""}"><h2 class="secT">${title}</h2><div class="secRule"></div>${inner}</div>`;
}

/**
 * Render the full report into `container`.
 * Returns a Promise that resolves when charts are drawn and map tiles are loaded.
 */
window.RF_render = function(r, container){
  liveCharts.forEach(c=>c.destroy()); liveCharts=[]; if (liveMap){ liveMap.remove(); liveMap=null; }
  const sec = secHtml, secAB = (k,t,i)=>secHtml(k,t,i,true);
  const DOC = [];
  const locLine = [r.location.name, r.location.country].filter(hasText).join(", ");
  const dateStr = new Date().toLocaleDateString("en-GB",{year:"numeric",month:"long",day:"numeric"});
  const wm = `<div class="wm">RES<span>WATER</span><small>Interreg NEXT MED · Co-funded by the European Union</small></div>`;

  // Cover is a contained banner (~1/3 of the first page), NOT a full page. The report
  // content flows directly beneath it on the same page. The header logo is stamped into
  // the reserved top margin by the server, so the banner carries no logo of its own.
  const cover = `<div class="coverBanner">
    <div class="coverBody">
      ${hasText(r.category)?`<span class="cat">${escT(r.category)}</span>`:""}
      <h1>${escT(r.bestPracticeName||r.title||r.projectName||"Untitled report")}</h1>
      <div class="meta">
        ${hasText(r.projectName)&&r.projectName!==r.title?`<div><strong>${escT(r.projectName)}</strong></div>`:""}
        ${hasText(locLine)?`<div>📍 ${escT(locLine)}</div>`:""}
        ${hasText(r.documentType)?`<div>${escT(r.documentType)}</div>`:""}
      </div>
    </div>
  </div>`;

  // ---- Ordered front matter: At a Glance → Description → Keywords → Images → Visual Documentation → Scientific Summary ----
  // 1. At a Glance (Key Facts) — flows across pages; the heading stays glued to the first cards
  const facts = (r.keyFacts||[]).filter(f=>hasText(f.value));
  if (facts.length)
    DOC.push(secAB("At a glance","At a Glance",
      `<div class="kpiGrid">${facts.map(f=>`<div class="kpi"><div class="v">${escT(f.value)}${hasText(f.unit)?" "+escT(f.unit):""}</div>${hasText(f.label)?`<div class="l">${escT(f.label)}</div>`:""}</div>`).join("")}</div>`));

  // 2. Description
  if (hasText(r.description))
    DOC.push(sec("Description","Description",`<p>${escT(r.description)}</p>`));

  // 3. Keywords
  const keywords = (r.keywords||[]).filter(hasText);
  if (keywords.length)
    DOC.push(sec("Keywords","Keywords & Tags",
      `<div class="kwGrid">${keywords.map(k=>`<span class="kw">${escT(k)}</span>`).join("")}</div>`));

  // 4. Visual Documentation — ONE dedicated page: the heading at the top, the rest of the
  //    page left blank for images to be pasted in later. The next section starts on a new page.
  DOC.push(`<div class="rsec imgPage"><h2 class="secT">Visual Documentation</h2><div class="secRule"></div></div>`);

  // 6. Scientific Summary
  if (hasText(r.executiveSummary))
    DOC.push(secAB("Summary","Scientific Summary",`<p>${escT(r.executiveSummary)}</p>`));

  const lat = num(r.location.lat), lng = num(r.location.lng);
  if (lat!==null && lng!==null)
    DOC.push(sec("Geography","Geographic Context",
      `<p>${escT([r.location.name,r.location.region,r.location.country].filter(hasText).join(" · "))} — coordinates ${lat.toFixed(4)}, ${lng.toFixed(4)}</p><div class="mapBox" id="rfMap"></div>`));
  else if (hasText(locLine))
    DOC.push(sec("Geography","Geographic Context",`<p>${escT([r.location.name,r.location.region,r.location.country].filter(hasText).join(" · "))}</p><p class="na">Coordinates not provided — map not available.</p>`));

  const ov = r.overview||{};
  // guard: drop a "what it is" that is really just the programme/project name (too short to be a real description)
  const ovWhat = (hasText(ov.what) && ov.what.trim().split(/\s+/).length >= 4) ? ov.what : "";
  if (hasText(ovWhat)||hasText(ov.problem)||hasText(ov.importance))
    DOC.push(sec("Overview","Project Overview",
      [ovWhat&&`<p><strong>What it is.</strong> ${escT(ovWhat)}</p>`,
       ov.problem&&`<p><strong>The problem it addresses.</strong> ${escT(ov.problem)}</p>`,
       ov.importance&&`<p><strong>Why it matters.</strong> ${escT(ov.importance)}</p>`].filter(Boolean).join("")));

  const t = r.technical||{};
  if (hasText(t.description)||anyText(t.technologies)||anyText(t.materials)||hasText(t.operations))
    DOC.push(secAB("Technology","Technical Description",
      [t.description&&`<p>${escT(t.description)}</p>`,
       anyText(t.technologies)&&`<p><strong>Technologies:</strong></p><ul class="clean">${t.technologies.filter(hasText).map(x=>`<li>${escT(x)}</li>`).join("")}</ul>`,
       anyText(t.materials)&&`<p><strong>Materials & infrastructure:</strong></p><ul class="clean">${t.materials.filter(hasText).map(x=>`<li>${escT(x)}</li>`).join("")}</ul>`,
       t.operations&&`<p><strong>Operation & maintenance.</strong> ${escT(t.operations)}</p>`].filter(Boolean).join("")));

  const steps = (t.processSteps||[]).filter(hasText);
  if (steps.length)
    DOC.push(secAB("Process","System & Process Visualization",
      `<div class="flow">${steps.map((s,i)=>`<div class="flowStep"><div class="n">${i+1}</div><div class="t">${escT(s)}</div></div>`).join("")}</div>`));

  const metrics = ((r.performance||{}).metrics||[]).map(m=>({...m, value:num(m.value)})).filter(m=>hasText(m.name)&&m.value!==null);
  const qual = ((r.performance||{}).qualitative||[]).filter(hasText);
  if (metrics.length || qual.length){
    let inner = "";
    if (metrics.length){
      const pct = metrics.filter(m=>/%|percent/i.test(m.unit||""));
      const other = metrics.filter(m=>!pct.includes(m));
      if (other.length) inner += `<div class="chartBox" style="height:${Math.min(420, Math.max(160, other.length*42+70))}px"><canvas id="rfChartBar"></canvas></div>`;
      if (pct.length)   inner += `<div class="chartBox" style="height:260px;max-width:420px;margin:18px auto 0"><canvas id="rfChartPct"></canvas></div>`;
      inner += `<table class="dataT"><thead><tr><th>Indicator</th><th>Value</th><th>Unit</th><th>Context</th></tr></thead><tbody>${
        metrics.map(m=>`<tr><td>${escT(m.name)}</td><td><strong>${m.value.toLocaleString()}</strong></td><td>${escT(m.unit||"")}</td><td>${escT(m.context||"")}</td></tr>`).join("")
      }</tbody></table>`;
    } else {
      inner += `<p class="na">No sufficient quantitative data was provided — qualitative indicators are shown instead.</p>`;
    }
    if (qual.length) inner += `<ul class="clean" style="margin-top:12px">${qual.map(x=>`<li>${escT(x)}</li>`).join("")}</ul>`;
    DOC.push(secAB("Data","Performance & Data",inner));
  }

  const impCards = (arr,cls)=>`<div class="impGrid">${arr.map(x=>`<div class="imp ${cls}"><div class="a">${escT(x.aspect||"")}</div><div class="d">${escT(x.description||"")}</div></div>`).join("")}</div>`;
  const env = (r.environmentalImpacts||[]).filter(x=>hasText(x.aspect)||hasText(x.description));
  if (env.length) DOC.push(sec("Environment","Environmental Impact",impCards(env,"")));
  const soc = (r.socialEconomicImpacts||[]).filter(x=>hasText(x.aspect)||hasText(x.description));
  if (soc.length) DOC.push(sec("Society & economy","Social & Economic Impact",impCards(soc,"blue")));

  // One analytical chart: how the documented impact is distributed across dimensions.
  // Uses only counts of effects actually extracted from the document (no invented values);
  // rendered only when BOTH dimensions carry data, so the comparison is meaningful.
  if (env.length && soc.length){
    const total = env.length + soc.length;
    const lead = env.length===soc.length ? "evenly split between the environmental and social & economic dimensions"
      : `concentrated in the ${env.length>soc.length ? "environmental" : "social & economic"} dimension (${Math.max(env.length,soc.length)} of ${total} documented effects)`;
    DOC.push(secAB("Impact analysis","Documented Impacts by Dimension",
      `<div class="chartBox" style="height:170px;max-width:520px"><canvas id="rfChartImpact"></canvas></div>
       <p class="chartCap">Number of distinct effects the source document records in each impact dimension. Counts reflect only effects explicitly stated in the document.</p>
       <p class="chartInsight"><strong>Insight.</strong> The project's documented impact is ${escT(lead)}.</p>`));
  }

  const sdgs = (r.sdgs||[]).map(s=>({...s, number:parseInt(s.number)})).filter(s=>SDG_DATA[s.number]);
  if (sdgs.length)
    DOC.push(sec("Agenda 2030","SDG Alignment",
      `<div class="sdgGrid">${sdgs.map(s=>`<div class="sdg" style="background:${SDG_DATA[s.number][1]}"><div class="sdgTop"><span class="sdgIcon">${sdgIcon(s.number)}</span><span class="n">${s.number}</span></div><div class="t">${SDG_DATA[s.number][0]}</div>${hasText(s.justification)?`<div class="j">${escT(s.justification)}</div>`:""}</div>`).join("")}</div>`));

  const inn = r.innovation||{};
  const trl = num(inn.trl);
  if (hasText(inn.description) || trl!==null)
    DOC.push(sec("Innovation","Innovation & Technology Readiness",
      [inn.description&&`<p>${escT(inn.description)}</p>`,
       trl!==null&&trl>=1&&trl<=9&&`<p><strong>TRL ${trl} / 9</strong></p><div class="trlBar">${Array.from({length:9},(_,i)=>`<div class="${i<trl?"on":""}"></div>`).join("")}</div><div class="trlLabels"><span>Research</span><span>Development</span><span>Deployment</span></div>`].filter(Boolean).join("")));

  const barriers = (r.barriers||[]).filter(hasText);
  const funding = (r.funding||[]).filter(f=>hasText(f.source)||hasText(f.amount));
  if (barriers.length||funding.length||hasText(r.implementationContext))
    DOC.push(secAB("Context","Barriers, Funding & Implementation",
      [barriers.length&&`<p><strong>Barriers:</strong></p><ul class="clean">${barriers.map(x=>`<li>${escT(x)}</li>`).join("")}</ul>`,
       funding.length&&`<p><strong>Funding:</strong></p><table class="dataT"><thead><tr><th>Source</th><th>Amount</th><th>Mechanism</th></tr></thead><tbody>${funding.map(f=>`<tr><td>${escT(f.source||"")}</td><td>${escT(f.amount||"")}</td><td>${escT(f.mechanism||"")}</td></tr>`).join("")}</tbody></table>`,
       hasText(r.implementationContext)&&`<p>${escT(r.implementationContext)}</p>`].filter(Boolean).join("")));

  const lessons = (r.lessonsLearned||[]).filter(hasText);
  const recs = (r.recommendations||[]).filter(hasText);
  if (lessons.length||recs.length)
    DOC.push(secAB("Learning","Lessons Learned & Recommendations",
      [lessons.length&&`<p><strong>Lessons learned:</strong></p><ul class="clean">${lessons.map(x=>`<li>${escT(x)}</li>`).join("")}</ul>`,
       recs.length&&`<p><strong>Recommendations:</strong></p><ul class="clean">${recs.map(x=>`<li>${escT(x)}</li>`).join("")}</ul>`].filter(Boolean).join("")));

  const rep = r.replication||{};
  if (hasText(rep.potential)||hasText(rep.conditions)||hasText(rep.where))
    DOC.push(sec("Scaling","Replication & Upscaling Potential",
      [rep.potential&&`<p><strong>Potential.</strong> ${escT(rep.potential)}</p>`,
       rep.conditions&&`<p><strong>Conditions.</strong> ${escT(rep.conditions)}</p>`,
       rep.where&&`<p><strong>Where.</strong> ${escT(rep.where)}</p>`].filter(Boolean).join("")));

  const refs = (r.references||[]).filter(hasText);
  if (refs.length)
    DOC.push(secAB("Sources","References & Sources",
      `<ul class="clean refList">${refs.map(x=>{
        const url = /^https?:\/\//i.test(String(x).trim());
        return `<li>${url?`<a href="${escT(String(x).trim())}">${escT(String(x).trim())}</a>`:escT(x)}</li>`;
      }).join("")}</ul>`));

  container.classList.add("rf-report");
  container.innerHTML = `<div class="page">
    <div class="docHeader">${wm}<img src="/image/images.png" alt="RESWATER · Interreg NEXT MED"></div>
    ${cover}
    <div class="doc">${DOC.join("")}
      <div class="docFooter"><span>RESWATER · Interreg NEXT MED — Co-funded by the European Union</span><span>${dateStr}</span></div>
    </div>
  </div>`;

  const waits = [];

  // charts (no animation — deterministic for PDF capture)
  const barEl = container.querySelector("#rfChartBar");
  if (barEl){
    const other = metrics.filter(m=>!/%|percent/i.test(m.unit||""));
    liveCharts.push(new Chart(barEl,{type:"bar",
      data:{labels:other.map(m=>m.name+(m.unit?` (${m.unit})`:"")),datasets:[{data:other.map(m=>m.value),backgroundColor:"rgba(46,107,214,.82)",borderRadius:6}]},
      options:{animation:false,responsive:true,maintainAspectRatio:false,indexAxis:"y",plugins:{legend:{display:false},title:{display:true,text:"Quantitative indicators"}},scales:{x:{grid:{color:"rgba(20,39,92,.08)"}}}}}));
  }
  const pctEl = container.querySelector("#rfChartPct");
  if (pctEl){
    const pct = metrics.filter(m=>/%|percent/i.test(m.unit||""));
    liveCharts.push(new Chart(pctEl,{type:"doughnut",
      data:{labels:pct.map(m=>m.name),datasets:[{data:pct.map(m=>m.value),backgroundColor:["#2E6BD6","#FFC61A","#14275C","#2FA69B","#4C86E0","#E0A200"]}]},
      options:{animation:false,responsive:true,maintainAspectRatio:false,plugins:{title:{display:true,text:"Percentage indicators (%)"},legend:{position:"bottom"}}}}));
  }
  // Impact distribution: documented effects per dimension (horizontal comparison bar)
  const impEl = container.querySelector("#rfChartImpact");
  if (impEl){
    liveCharts.push(new Chart(impEl,{type:"bar",
      data:{labels:["Environmental","Social & economic"],datasets:[{label:"Documented effects",data:[env.length,soc.length],backgroundColor:["#3E9C6B","#2E6BD6"],borderRadius:6,maxBarThickness:34}]},
      options:{animation:false,responsive:true,maintainAspectRatio:false,indexAxis:"y",
        plugins:{legend:{display:false},title:{display:true,text:"Documented effects by impact dimension"}},
        scales:{x:{beginAtZero:true,ticks:{precision:0,stepSize:1},title:{display:true,text:"Number of documented effects"},grid:{color:"rgba(20,39,92,.08)"}},y:{grid:{display:false}}}}}));
  }

  // map — wait for tiles before declaring ready
  const mapEl = container.querySelector("#rfMap");
  if (mapEl && lat!==null && lng!==null){
    waits.push(new Promise(resolve=>{
      liveMap = L.map(mapEl,{scrollWheelZoom:false,zoomControl:false,attributionControl:true}).setView([lat,lng], 10);
      const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap contributors",crossOrigin:true});
      let done = false;
      const finish = ()=>{ if(!done){ done=true; resolve(); } };
      tiles.on("load", finish);
      setTimeout(finish, 6000); // fallback if a tile stalls
      tiles.addTo(liveMap);
      L.marker([lat,lng]).addTo(liveMap).bindPopup(escT(locLine||"Project site")).openPopup();
      setTimeout(()=>liveMap.invalidateSize(), 200);
    }));
  }

  // wait for fonts + images
  if (document.fonts && document.fonts.ready) waits.push(document.fonts.ready);
  waits.push(...[...container.querySelectorAll("img")].map(img=>img.complete?Promise.resolve():new Promise(r=>{img.onload=img.onerror=r;})));

  return Promise.all(waits).then(()=>{ window.__RF_READY = true; });
};

// Override the app's preview renderer when running inside the main app
if (document.getElementById("reportPages")){
  window.renderReport = function(){
    window.__RF_READY = false;
    RF_render(window.RF_getReport ? RF_getReport() : report, document.getElementById("reportPages"));
  };
}
})();
