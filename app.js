const STORAGE_KEY = "cfi_field_tool_v1_1";

let model = null;      // decision-tree.json
let products = null;   // products.json
let arcsite = null;    // arscite-objects.json

let state = {
  job: { address: "", homeowner: "", date: "", notes: "" },
  answers: {},               // questionId -> optionValue
  tags: [],                  // derived tags
  suggestedSolutionIds: [],  // derived
  flightPlans: {},           // solutionId -> [{item, unit, qty, notes, arcsiteObject}]
  promptsDone: {},           // promptId -> boolean
  solutionNotes: {}          // solutionId -> [notes]
};

const FIELD_PROMPTS = [
  { id: "pep", text: "PEP complete + safe access documented" },
  { id: "access_photo", text: "Photo: access/entry path (wide angle)" },
  { id: "baseline_outside", text: "Photo: hygrometer reading outside entrance (control)" },
  { id: "wide_angle_all", text: "Photos: wide-angle tour (counterclockwise, whole space)" },
  { id: "baseline_inside", text: "Photo: hygrometer reading inside space" },
  { id: "moisture_bottom", text: "Moisture meter reading at base of first corner (photo)" },
  { id: "moisture_mid", text: "Moisture meter reading mid-wall same spot (photo)" },
  { id: "moisture_top", text: "Moisture meter reading top of wall same vertical plane (photo)" },
  { id: "sketch_live", text: "All data + obstructions recorded on field-sketch as you go" },
  { id: "discharge_route", text: "Discharge path planned: topography + obstructions considered" }
];

async function init() {
  [model, products, arcsite] = await Promise.all([
    fetch("./decision-tree.json").then(r => r.json()),
    fetch("./products.json").then(r => r.json()),
    fetch("./arscite-objects.json").then(r => r.json())
  ]);

  loadState();
  bindJobFields();
  renderQuestions();
  renderFieldPrompts();
  computeAndRender();
  renderMiniCheat();

  document.getElementById("resetAnswers").onclick = () => {
    state.answers = {};
    saveState();
    renderQuestions();
    computeAndRender();
  };

  document.getElementById("saveNow").onclick = () => {
    saveJobFields();
    saveState();
    toast("Saved.");
  };

  document.getElementById("exportBtn").onclick = exportJSON;
  document.getElementById("importFile").addEventListener("change", importJSON);

  document.getElementById("closeFlightPlan").onclick = () => {
    document.getElementById("flightPlanCard").style.display = "none";
  };

  document.getElementById("addLineItem").onclick = () => addCustomLineItem();

  document.getElementById("openCheat").onclick = () => window.open("./cheat-sheet.md", "_blank");

  // ✅ Preview + print handlers (match your index.html IDs)
  document.getElementById("togglePreview").onclick = () => toggleHandoffPreview();
  document.getElementById("printSummary").onclick = () => printHandoff();

  document.getElementById("copySummary").onclick = async () => {
    const text = buildSummaryText();
    try {
      await navigator.clipboard.writeText(text);
      toast("Summary copied.");
    } catch {
      alert("Copy failed. You can manually select/copy from the summary box.");
    }
  };
}

function bindJobFields() {
  document.getElementById("jobAddress").value = state.job.address;
  document.getElementById("jobHomeowner").value = state.job.homeowner;
  document.getElementById("jobDate").value = state.job.date;
  document.getElementById("jobNotes").value = state.job.notes;

  ["jobAddress","jobHomeowner","jobDate","jobNotes"].forEach(id => {
    document.getElementById(id).addEventListener("input", () => {
      saveJobFields();
      saveState();
      refreshSummaryAndPreview();
    });
  });
}

function saveJobFields() {
  state.job.address = document.getElementById("jobAddress").value || "";
  state.job.homeowner = document.getElementById("jobHomeowner").value || "";
  state.job.date = document.getElementById("jobDate").value || "";
  state.job.notes = document.getElementById("jobNotes").value || "";
}

function renderQuestions() {
  const host = document.getElementById("questionHost");
  host.innerHTML = "";

  model.questions.forEach(q => {
    const wrap = document.createElement("div");
    wrap.className = "q";

    const qt = document.createElement("div");
    qt.className = "qt";
    qt.textContent = q.text;
    wrap.appendChild(qt);

    const opts = document.createElement("div");
    opts.className = "opts";

    q.options.forEach(opt => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "opt" + (state.answers[q.id] === opt.value ? " active" : "");
      btn.textContent = opt.label;

      btn.onclick = () => {
        state.answers[q.id] = opt.value;
        saveState();
        renderQuestions();
        computeAndRender();
      };

      opts.appendChild(btn);
    });

    wrap.appendChild(opts);
    host.appendChild(wrap);
  });
}

function deriveTagsFromAnswers() {
  const tags = new Set();
  model.questions.forEach(q => {
    const val = state.answers[q.id];
    if (!val) return;
    const opt = q.options.find(o => o.value === val);
    (opt?.tags || []).forEach(t => tags.add(t));
  });
  return Array.from(tags);
}

function applyRules(tags) {
  state.solutionNotes = state.solutionNotes || {};
  const tset = new Set(tags);

  (model.rules || []).forEach(rule => {
    const ok = (rule.ifAllTags || []).every(t => tset.has(t));
    if (!ok) return;

    if (rule.then?.addNotesToSolution && rule.then?.note) {
      const sid = rule.then.addNotesToSolution;
      state.solutionNotes[sid] = state.solutionNotes[sid] || [];
      if (!state.solutionNotes[sid].includes(rule.then.note)) state.solutionNotes[sid].push(rule.then.note);
    }
  });
}

function filterSolutionsByTags(tags) {
  const tset = new Set(tags);
  return model.solutions
    .filter(s => s.tags.some(t => tset.has(t)))
    .map(s => s.id);
}

function computeAndRender() {
  state.tags = deriveTagsFromAnswers();
  applyRules(state.tags);
  state.suggestedSolutionIds = filterSolutionsByTags(state.tags);

  state.suggestedSolutionIds.forEach(id => {
    if (!state.flightPlans[id]) {
      const sol = model.solutions.find(s => s.id === id);
      state.flightPlans[id] = structuredClone(sol?.defaults?.flightPlan || []);
    }
  });

  saveState();
  renderSolutions();
  refreshSummaryAndPreview();
}

function renderSolutions() {
  const host = document.getElementById("solutionHost");
  host.innerHTML = "";

  if (state.suggestedSolutionIds.length === 0) {
    host.innerHTML = `<div class="hint">No solutions suggested yet. Answer the checklist above.</div>`;
    return;
  }

  state.suggestedSolutionIds.forEach(id => {
    const sol = model.solutions.find(s => s.id === id);
    const chip = document.createElement("div");
    chip.className = "chip";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = sol.name;
    btn.onclick = () => openFlightPlan(id);

    chip.appendChild(btn);
    host.appendChild(chip);
  });
}

function openFlightPlan(solutionId) {
  const sol = model.solutions.find(s => s.id === solutionId);
  const host = document.getElementById("flightPlanHost");
  const hintsHost = document.getElementById("flightPlanHints");
  const title = document.getElementById("flightPlanTitle");

  host.innerHTML = "";
  hintsHost.innerHTML = "";
  title.textContent = `Flight Plan — ${sol.name}`;

  const p = products?.solutions?.[solutionId];
  const notes = [];

  if (p?.productOptions?.length) {
    notes.push(`<strong>Product + spacing hints (edit products.json to match branch standards):</strong>`);
    notes.push("<ul>");
    p.productOptions.forEach(po => {
      notes.push(`<li><strong>${escapeHtml(po.name)}</strong> — <em>${escapeHtml(po.spacingRule)}</em><br><span class="hint">${escapeHtml(po.notes)}</span></li>`);
    });
    notes.push("</ul>");
  }

  const ruleNotes = state.solutionNotes?.[solutionId] || [];
  if (ruleNotes.length) {
    notes.push(`<strong>Eligibility notes:</strong><ul>${ruleNotes.map(n => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`);
  }

  hintsHost.innerHTML = notes.join("");

  const lines = state.flightPlans[solutionId] || [];
  lines.forEach((line, idx) => host.appendChild(renderLineItem(solutionId, line, idx, sol)));

  document.getElementById("flightPlanCard").style.display = "block";
  document.getElementById("flightPlanCard").scrollIntoView({ behavior: "smooth" });
  document.getElementById("flightPlanCard").dataset.openSolutionId = solutionId;
}

function renderLineItem(solutionId, line, idx, sol) {
  const wrap = document.createElement("div");
  wrap.style.display = "grid";
  wrap.style.gridTemplateColumns = "1fr";
  wrap.style.gap = "8px";
  wrap.style.marginBottom = "10px";
  wrap.style.paddingBottom = "10px";
  wrap.style.borderBottom = "1px dashed rgba(255,255,255,0.08)";

  const top = document.createElement("div");
  top.className = "line";

  const item = document.createElement("input");
  item.value = line.item || "";
  item.placeholder = "Line item (e.g., drain, sump, beam, supports...)";
  item.oninput = () => updateLine(solutionId, idx, { item: item.value });

  const unit = document.createElement("select");
  (sol.flightPlanUnits || ["EA", "LF", "SF"]).forEach(u => {
    const opt = document.createElement("option");
    opt.value = u;
    opt.textContent = u;
    unit.appendChild(opt);
  });
  unit.value = line.unit || (sol.flightPlanUnits?.[0] || "EA");
  unit.onchange = () => updateLine(solutionId, idx, { unit: unit.value });

  const qty = document.createElement("input");
  qty.type = "number";
  qty.step = "1";
  qty.min = "0";
  qty.value = Number(line.qty || 0);
  qty.oninput = () => updateLine(solutionId, idx, { qty: Number(qty.value || 0) });

  top.appendChild(item);
  top.appendChild(unit);
  top.appendChild(qty);

  const bottom = document.createElement("div");
  bottom.className = "line";
  bottom.style.gridTemplateColumns = "2fr 1fr 1fr";

  const notes = document.createElement("input");
  notes.value = line.notes || "";
  notes.placeholder = "Notes (obstructions, access, routing, etc.)";
  notes.oninput = () => updateLine(solutionId, idx, { notes: notes.value });

  const arc = document.createElement("select");
  const arcOpts = ["(ArcSite object)…", ...(arcsite?.objects || [])];
  arcOpts.forEach(name => {
    const opt = document.createElement("option");
    opt.value = name === "(ArcSite object)…" ? "" : name;
    opt.textContent = name;
    arc.appendChild(opt);
  });
  arc.value = line.arcsiteObject || "";
  arc.onchange = () => updateLine(solutionId, idx, { arcsiteObject: arc.value });

  const del = document.createElement("button");
  del.className = "danger";
  del.type = "button";
  del.textContent = "Remove";
  del.onclick = () => {
    state.flightPlans[solutionId].splice(idx, 1);
    saveState();
    openFlightPlan(solutionId);
    refreshSummaryAndPreview();
  };

  bottom.appendChild(notes);
  bottom.appendChild(arc);
  bottom.appendChild(del);

  wrap.appendChild(top);
  wrap.appendChild(bottom);

  return wrap;
}

function updateLine(solutionId, idx, patch) {
  const current = state.flightPlans[solutionId][idx];
  state.flightPlans[solutionId][idx] = { ...current, ...patch };
  saveState();
  refreshSummaryAndPreview();
}

function addCustomLineItem() {
  const solutionId = document.getElementById("flightPlanCard").dataset.openSolutionId;
  if (!solutionId) return;
  const sol = model.solutions.find(s => s.id === solutionId);

  state.flightPlans[solutionId].push({
    item: "",
    unit: sol.flightPlanUnits?.[0] || "EA",
    qty: 0,
    notes: "",
    arcsiteObject: ""
  });

  saveState();
  openFlightPlan(solutionId);
  refreshSummaryAndPreview();
}

function renderFieldPrompts() {
  const host = document.getElementById("fieldPrompts");
  host.innerHTML = "";

  FIELD_PROMPTS.forEach(p => {
    const row = document.createElement("div");
    row.className = "item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!state.promptsDone[p.id];
    cb.onchange = () => {
      state.promptsDone[p.id] = cb.checked;
      saveState();
      refreshSummaryAndPreview();
    };

    const txt = document.createElement("div");
    txt.textContent = p.text;

    row.appendChild(cb);
    row.appendChild(txt);
    host.appendChild(row);
  });
}

function renderMiniCheat() {
  const host = document.getElementById("miniCheat");
  host.innerHTML = `
  <strong>Field rules:</strong> wide→narrow photos; baseline hygrometer outside/inside; moisture readings bottom→mid→top in same plane; everything goes on field-sketch.
  <br><br>
  <strong>Units:</strong> Poly = SF; crack caulk = LF. Beams = LF; sister joists = LF; supports = EA. Drains = LF; liners = SF; sumps/dehu = EA.
  <br><br>
  <strong>ArcSite:</strong> Use the dropdown on each line item to match your ArcSite objects (edit arscite-objects.json).
  `;
}

function buildSummaryText() {
  const lines = [];
  const { address, homeowner, date, notes } = state.job;

  lines.push("CFI JOB SUMMARY");
  lines.push("===============");
  if (address) lines.push(`Address: ${address}`);
  if (homeowner) lines.push(`Homeowner: ${homeowner}`);
  if (date) lines.push(`Date: ${date}`);
  if (notes) lines.push(`Notes: ${notes}`);
  lines.push("");

  lines.push("ANSWERS");
  lines.push("-------");
  model.questions.forEach(q => {
    const val = state.answers[q.id];
    if (!val) return;
    const opt = q.options.find(o => o.value === val);
    lines.push(`- ${q.text}: ${opt?.label || val}`);
  });
  lines.push("");

  lines.push("SUGGESTED SOLUTION TYPES");
  lines.push("------------------------");
  if (!state.suggestedSolutionIds.length) {
    lines.push("- (none yet)");
  } else {
    state.suggestedSolutionIds.forEach(id => {
      const sol = model.solutions.find(s => s.id === id);
      const disp = products?.solutions?.[id]?.displayName || sol.name;
      lines.push(`- ${disp}`);
      const rn = state.solutionNotes?.[id] || [];
      rn.forEach(n => lines.push(`  • NOTE: ${n}`));
    });
  }
  lines.push("");

  lines.push("FLIGHT PLAN QUANTITIES");
  lines.push("----------------------");
  state.suggestedSolutionIds.forEach(id => {
    const sol = model.solutions.find(s => s.id === id);
    lines.push(`\n${sol.name}`);
    const fp = state.flightPlans[id] || [];
    if (!fp.length) {
      lines.push("  (no line items)");
      return;
    }
    fp.forEach(li => {
      const qty = Number(li.qty || 0);
      const unit = li.unit || "";
      const obj = li.arcsiteObject ? ` [ArcSite: ${li.arcsiteObject}]` : "";
      const note = li.notes ? ` — ${li.notes}` : "";
      lines.push(`  • ${li.item || "(item)"}: ${qty} ${unit}${obj}${note}`);
    });
  });
  lines.push("");

  lines.push("FIELD PROMPTS COMPLETION");
  lines.push("------------------------");
  FIELD_PROMPTS.forEach(p => {
    lines.push(`- [${state.promptsDone[p.id] ? "x" : " "}] ${p.text}`);
  });

  return lines.join("\n");
}

function renderSummary() {
  const host = document.getElementById("summaryHost");
  const text = buildSummaryText();
  host.innerHTML = `<div class="summary"><pre>${escapeHtml(text)}</pre></div>`;
}

/* ===== Preview + Print helpers ===== */

function refreshSummaryAndPreview() {
  renderSummary();
  const previewHost = document.getElementById("handoffPreview");
  if (previewHost && previewHost.style.display !== "none") renderHandoffPreview();
}

function getHandoffWarnings() {
  const w = [];
  if (!state.job.address?.trim()) w.push("Missing Address");
  if (!state.job.date?.trim()) w.push("Missing Date");

  const promptsMissing = FIELD_PROMPTS.filter(p => !state.promptsDone[p.id]).length;
  if (promptsMissing) w.push(`Field prompts incomplete (${promptsMissing} unchecked)`);

  return w;
}

function buildHandoffInnerHtml(text) {
  const warnings = getHandoffWarnings();
  const warnBlock = warnings.length
    ? `<div class="warn"><strong>⚠ Review before submitting:</strong><ul>${warnings.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div>`
    : "";

  const metaParts = [];
  if (state.job.address) metaParts.push(escapeHtml(state.job.address));
  if (state.job.date) metaParts.push(escapeHtml(state.job.date));

  return `
    <div class="handoff-sheet">
      <div class="handoff-title">CFI Job Summary</div>
      <div class="handoff-meta">${metaParts.join(" • ")}</div>
      ${warnBlock}
      <pre>${escapeHtml(text)}</pre>
    </div>
  `;
}

function renderHandoffPreview() {
  const host = document.getElementById("handoffPreview");
  const text = buildSummaryText();
  host.innerHTML = buildHandoffInnerHtml(text);
}

function toggleHandoffPreview() {
  const host = document.getElementById("handoffPreview");
  const btn = document.getElementById("togglePreview");

  const isOpen = host.style.display !== "none";
  if (isOpen) {
    host.style.display = "none";
    btn.textContent = "Preview Handoff";
    return;
  }

  renderHandoffPreview();
  host.style.display = "block";
  btn.textContent = "Hide Preview";
  host.scrollIntoView({ behavior: "smooth", block: "start" });
}

function printHandoff() {
  saveJobFields();

  const criticalMissing = [];
  if (!state.job.address?.trim()) criticalMissing.push("Address");
  if (!state.job.date?.trim()) criticalMissing.push("Date");

  if (criticalMissing.length) {
    alert("Cannot print yet. Missing: " + criticalMissing.join(", "));
    return;
  }

  const warnings = getHandoffWarnings();
  if (warnings.length) {
    const ok = confirm("Handoff warnings:\n\n- " + warnings.join("\n- ") + "\n\nPrint anyway?");
    if (!ok) return;
  }

  const previewHost = document.getElementById("handoffPreview");
  if (previewHost && previewHost.style.display !== "none") renderHandoffPreview();

  window.print();
}

/* ===== Export / Import / Storage ===== */

function exportJSON() {
  saveJobFields();
  const payload = {
    exportedAt: new Date().toISOString(),
    modelVersion: model.version,
    state
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;

  const safeAddr = (state.job.address || "job").replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
  a.download = `CFI_${safeAddr}_${state.job.date || "date"}.json`;

  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importJSON(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(reader.result);
      if (!payload?.state) throw new Error("Invalid file.");
      state = payload.state;
      saveState();
      bindJobFields();
      renderQuestions();
      renderFieldPrompts();
      computeAndRender();
      renderMiniCheat();
      toast("Imported.");
    } catch (err) {
      alert("Import failed: " + err.message);
    }
  };
  reader.readAsText(file);
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    state = { ...state, ...parsed };
  } catch { /* ignore */ }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function toast(msg) {
  const t = document.createElement("div");
  t.textContent = msg;
  t.style.position = "fixed";
  t.style.bottom = "14px";
  t.style.left = "50%";
  t.style.transform = "translateX(-50%)";
  t.style.background = "rgba(0,0,0,0.7)";
  t.style.color = "white";
  t.style.padding = "10px 12px";
  t.style.borderRadius = "10px";
  t.style.zIndex = "9999";
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1200);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

init();

// PWA offline caching (register the service worker)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
