"use strict";
// Static, backend-free annotation UI. Data (unit index, references, taxonomy) is bundled under
// data/; PDFs stream from the public HF dataset; annotations persist in localStorage + export.

const CFG = window.KB_CONFIG || { HF_BASE: "", DATA: "data/" };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = { units: [], filtered: [], taxonomy: { categories: [] },
  current: null, rating: "", tax: {}, done: false };
const viewer = { doc: null, pages: [], observer: null, onScroll: null };
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

// ---------- helpers ----------
async function fetchText(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status + " " + url); return r.text(); }
function parseCSV(text) {
  const rows = []; let i = 0, f = "", row = [], q = false;
  while (i < text.length) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else if (c !== "\r") f += c;
    i++;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}
function csvObjects(text) {
  const rows = parseCSV(text).filter(r => r.length && !(r.length === 1 && r[0] === ""));
  if (!rows.length) return [];
  const h = rows[0];
  return rows.slice(1).map(r => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""])));
}
const uid = u => `${u.deck_id}||${u.file}`;
const annKey = u => "kbann:" + uid(u);
function loadAnn(u) { try { return JSON.parse(localStorage.getItem(annKey(u))) || null; } catch (e) { return null; } }
function saveAnn(u, ann) { try { localStorage.setItem(annKey(u), JSON.stringify(ann)); } catch (e) {} }
function annState(ann) { return !ann ? "not_started" : ann.done ? "done" : (ann.rating || (ann.tax && Object.keys(ann.tax).length)) ? "in_progress" : "not_started"; }
function pdfURL(u) { return CFG.HF_BASE + u.rel_path + "deck/" + encodeURIComponent(u.file); }

// ---------- boot ----------
async function init() {
  wire();
  try { state.taxonomy = JSON.parse(await fetchText(CFG.DATA + "taxonomy.json")); } catch (e) { state.taxonomy = { categories: [] }; }
  try { state.units = csvObjects(await fetchText(CFG.DATA + "units.csv")); }
  catch (e) { $("#deck-list").innerHTML = `<div class="di-empty">Couldn't load data/units.csv</div>`; return; }
  const venues = [...new Set(state.units.map(u => u.venue).filter(Boolean))].sort();
  $("#f-venue").innerHTML = '<option value="">All venues</option>' + venues.map(v => `<option>${esc(v)}</option>`).join("");
  applyFilters();
  renderOverall();
}
function wire() {
  ["search", "f-category", "f-venue", "f-status"].forEach(id => $("#" + id).addEventListener("input", applyFilters));
  $("#f-scope").addEventListener("change", applyFilters);
  $("#btn-export").addEventListener("click", exportAnnotations);
  $("#btn-save").addEventListener("click", () => sendToSheet(persist(false), "Saved"));
  $("#btn-submit").addEventListener("click", submitReview);
  const rid = $("#reviewer-id");
  if (rid) {
    rid.value = reviewerId();
    rid.addEventListener("input", () => { try { localStorage.setItem("kb_reviewer", rid.value.trim()); } catch (e) {} });
  }
  if (CFG.SHEET_ENDPOINT) $("#sync-note").textContent = "Saved in browser + shared sheet";
  $$(".r-btn").forEach(b => b.addEventListener("click", () => setRating(b.dataset.r)));
  $("#prev-page").addEventListener("click", () => gotoPage(getPage() - 1));
  $("#next-page").addEventListener("click", () => gotoPage(getPage() + 1));
  $("#page-input").addEventListener("change", () => gotoPage(getPage()));
  $("#tax-toggle").addEventListener("click", () => $("#tax-panel").classList.toggle("collapsed"));
}

// ---------- sidebar ----------
function applyFilters() {
  const q = $("#search").value.trim().toLowerCase(), cat = $("#f-category").value,
    ven = $("#f-venue").value, st = $("#f-status").value, scope = $("#f-scope").checked;
  state.filtered = state.units.filter(u => {
    if (scope && u.scope && u.scope !== "in") return false;
    if (cat && u.category !== cat) return false;
    if (ven && u.venue !== ven) return false;
    if (st && annState(loadAnn(u)) !== st) return false;
    if (q && !(`${u.title} ${u.venue} ${u.file}`.toLowerCase().includes(q))) return false;
    return true;
  });
  renderDeckList();
}
function renderDeckList() {
  const el = $("#deck-list");
  if (!state.filtered.length) { el.innerHTML = '<div class="di-empty">No decks match.</div>'; return; }
  const curUid = state.current ? uid(state.current) : null;
  el.innerHTML = state.filtered.map(u => {
    const s = annState(loadAnn(u));
    const cat = u.category === "tutorial" ? "tutorial" : u.category === "keynote" ? "keynote" : "invited";
    const active = uid(u) === curUid ? " active" : "";
    return `<div class="deck-item${active}" data-uid="${esc(uid(u))}">
      <div class="di-title">${esc(u.title)}</div>
      <div class="di-meta"><span class="dot ${s}" title="${s}"></span>
        <span class="pill">${cat}</span><span>${esc(u.venue)} ${esc(u.year)}</span></div>
    </div>`;
  }).join("");
  $$(".deck-item", el).forEach(d => d.addEventListener("click", () => {
    const u = state.units.find(x => uid(x) === d.dataset.uid); if (u) selectUnit(u);
  }));
}
function renderOverall() {
  const tot = state.units.length;
  let done = 0, prog = 0;
  state.units.forEach(u => { const s = annState(loadAnn(u)); if (s === "done") done++; else if (s === "in_progress") prog++; });
  $("#overall").innerHTML = `<b>${done}</b> submitted · <b>${prog}</b> in progress <span class="of-total">of ${tot}</span>`;
}

// ---------- select + render a unit ----------
async function selectUnit(u) {
  state.current = u;
  const ann = loadAnn(u) || {};
  state.rating = ann.rating || "";
  state.tax = {};
  (state.taxonomy.categories || []).forEach(c => { state.tax[c.key] = new Set((ann.tax && ann.tax[c.key]) || []); });
  state.done = !!ann.done;

  $("#empty").hidden = true; $("#review").hidden = false;
  const catLabel = u.category === "tutorial" ? "Tutorial" : u.category === "keynote" ? "Keynote" : "Invited talk";
  $("#deck-badges").innerHTML = `<span class="badge">${esc(catLabel)}</span>` +
    `<span class="badge gray">${esc(u.venue)} ${esc(u.year)}</span>`;
  $("#deck-title").textContent = u.title;
  $("#deck-sub").innerHTML = `<code>${esc(u.deck_id)}</code> · ${esc(u.file)}`;
  const viewable = (u.ext || "").toLowerCase() === "pdf";
  $("#file-label").textContent = u.file;
  $("#open-ext").href = pdfURL(u);
  ["prev-page", "next-page", "page-input"].forEach(id => { $("#" + id).disabled = !viewable; });

  renderRating(); renderTaxonomy(); renderSubmitState(); hideSubmitWarning();
  renderDeckList();
  await renderRefs(u);
  teardownViewer();
  if (viewable) { $("#page-input").value = 1; renderPdf(u); }
  else $("#viewer-holder").innerHTML = `<div class="viewer-msg">This file is <b>${esc(u.ext || "non-PDF")}</b> — <a class="btn" href="${pdfURL(u)}" target="_blank" rel="noopener">open it ↗</a></div>`;
}

// ---------- references (main only, per unit) ----------
async function renderRefs(u) {
  const box = $("#refs-table"); box.innerHTML = '<div class="di-empty">Loading references…</div>';
  let rows = [];
  try {
    const all = csvObjects(await fetchText(CFG.DATA + "refs/" + u.deck_id + "/references.csv"));
    rows = all.filter(r => (r.provenance || "").endsWith(":central") &&
      (!r.slide_file || r.slide_file === u.file) && (r.title || r.link));
  } catch (e) { rows = []; }
  if (u !== state.current) return;
  $("#refs-summary").textContent = `${rows.length} main reference${rows.length === 1 ? "" : "s"} on this unit`;
  box.innerHTML = rows.length ? rows.map(r => {
    const ttl = r.title || (r.authors ? `${r.authors}${r.year ? ", " + r.year : ""}` : "(untitled citation)");
    const link = r.link ? ` <a href="${esc(r.link)}" target="_blank" rel="noopener">link ↗</a>` : "";
    const meta = [r.authors, r.year, r.arxiv_id].filter(Boolean).map(esc).join(" · ");
    return `<div class="ref-row"><div class="rr-title">${esc(ttl)}${link}</div>${meta ? `<div class="rr-meta">${meta}</div>` : ""}</div>`;
  }).join("") : '<div class="di-empty">No main references listed for this unit.</div>';
}

// ---------- PDF viewer with selectable text layer ----------
function renderPdf(u) {
  const holder = $("#viewer-holder");
  holder.innerHTML = '<div class="pdf-scroll" id="pdf-scroll"><div class="pdf-loading">Loading slides…</div></div>';
  if (!window.pdfjsLib) { holder.innerHTML = '<div class="viewer-msg">PDF viewer failed to load.</div>'; return; }
  pdfjsLib.getDocument({ url: pdfURL(u), disableRange: true }).promise.then(doc => {
    if (!state.current || uid(state.current) !== uid(u)) { try { doc.destroy(); } catch (e) {} return; }
    viewer.doc = doc; viewer.pages = [];
    const scroll = $("#pdf-scroll"); scroll.innerHTML = "";
    doc.getPage(1).then(p1 => {
      const aspect = (v => v.width / v.height)(p1.getViewport({ scale: 1 }));
      $("#page-input").max = doc.numPages;
      for (let i = 1; i <= doc.numPages; i++) {
        const pg = document.createElement("div");
        pg.className = "pdf-page"; pg.dataset.page = i; pg.style.aspectRatio = String(aspect);
        pg.innerHTML = `<div class="pp-num">${i}</div><div class="pp-canvas"></div><div class="pp-textlayer"></div>`;
        scroll.appendChild(pg); viewer.pages.push(pg);
      }
      viewer.observer = new IntersectionObserver(ents => ents.forEach(en => {
        if (en.isIntersecting) { viewer.observer.unobserve(en.target); renderPageInto(en.target); }
      }), { root: scroll, rootMargin: "800px 0px" });
      viewer.pages.forEach(el => viewer.observer.observe(el));
      viewer.onScroll = throttle(() => {
        const top = scroll.scrollTop + 8; let cur = 1;
        for (const el of viewer.pages) { if (el.offsetTop <= top) cur = +el.dataset.page; else break; }
        if (getPage() !== cur) $("#page-input").value = cur;
      }, 120);
      scroll.addEventListener("scroll", viewer.onScroll);
    });
  }).catch(e => {
    holder.innerHTML = `<div class="viewer-msg">Couldn't load this PDF (the dataset may be private, or cross-origin blocked).<br>
      <a class="btn" href="${pdfURL(u)}" target="_blank" rel="noopener">Open it ↗</a></div>`;
  });
}
async function renderPageInto(el) {
  if (!viewer.doc) return;
  try {
    const page = await viewer.doc.getPage(+el.dataset.page);
    const cssW = el.clientWidth || 400, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const base = page.getViewport({ scale: 1 }), sc = cssW / base.width;
    const vp = page.getViewport({ scale: sc * dpr }), vpCss = page.getViewport({ scale: sc });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    canvas.style.width = "100%"; canvas.style.height = "auto";
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    const holder = el.querySelector(".pp-canvas"); if (holder) holder.replaceChildren(canvas);
    const tl = el.querySelector(".pp-textlayer");
    if (tl) {
      tl.replaceChildren();
      tl.style.width = Math.floor(vpCss.width) + "px"; tl.style.height = Math.floor(vpCss.height) + "px";
      tl.style.setProperty("--scale-factor", String(sc));
      try {
        const tc = await page.getTextContent(); let ok = false;
        if (pdfjsLib.renderTextLayer) {
          try { const t = pdfjsLib.renderTextLayer({ textContentSource: tc, container: tl, viewport: vpCss, textDivs: [] }); await (t && t.promise ? t.promise : t); ok = tl.childElementCount > 0; } catch (e) { ok = false; }
        }
        if (!ok && pdfjsLib.Util) {
          const frag = document.createDocumentFragment();
          for (const it of tc.items) { if (!it.str) continue; const m = pdfjsLib.Util.transform(vpCss.transform, it.transform); const fh = Math.hypot(m[2], m[3]); const s = document.createElement("span"); s.textContent = it.str; s.style.left = m[4] + "px"; s.style.top = (m[5] - fh) + "px"; s.style.fontSize = fh + "px"; frag.appendChild(s); }
          tl.appendChild(frag);
        }
      } catch (e) {}
    }
  } catch (e) {}
}
function teardownViewer() {
  if (viewer.observer) { viewer.observer.disconnect(); viewer.observer = null; }
  const s = $("#pdf-scroll"); if (s && viewer.onScroll) s.removeEventListener("scroll", viewer.onScroll);
  if (viewer.doc) { try { viewer.doc.destroy(); } catch (e) {} viewer.doc = null; }
  viewer.pages = [];
}
function throttle(fn, ms) { let t = 0, p = null; return (...a) => { const n = Date.now(); if (n - t >= ms) { t = n; fn(...a); } else { clearTimeout(p); p = setTimeout(() => { t = Date.now(); fn(...a); }, ms - (n - t)); } }; }
function getPage() { return Math.max(1, parseInt($("#page-input").value, 10) || 1); }
function gotoPage(n) { n = Math.max(1, n | 0); $("#page-input").value = n; const el = viewer.pages[n - 1]; if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }

// ---------- rating ----------
function setRating(r) { state.rating = state.rating === r ? "" : r; renderRating(); hideSubmitWarning(); persist(false); }
function renderRating() { $$(".r-btn").forEach(b => b.classList.toggle("on", b.dataset.r === state.rating)); }

// ---------- taxonomy ----------
function taxCats() { return state.taxonomy.categories || []; }
const GROUP_LABELS = { visual: "Visual Style" };
function taxBlocks() {
  const cats = taxCats(), blocks = [];
  for (let i = 0; i < cats.length;) {
    const g = cats[i].group;
    if (!g) { blocks.push({ cat: cats[i] }); i++; }
    else { const run = []; while (i < cats.length && cats[i].group === g) run.push(cats[i++]); blocks.push({ group: g, cats: run }); }
  }
  return blocks;
}
function modeLabel(c) { return c.single ? `<span class="tgh-mode">pick one</span>` : `<span class="tgh-mode">select all</span>`; }
function chipsHTML(c) {
  const sel = state.tax[c.key] || new Set();
  return `<div class="tax-chips">` + (c.concepts || []).map(x =>
    `<button type="button" class="tax-chip${sel.has(String(x.id)) ? " on" : ""}" data-key="${esc(c.key)}" data-id="${esc(String(x.id))}" title="${esc(x.desc || "")}"><span class="tc-label">${esc(x.label || x.id)}</span></button>`
  ).join("") + `</div>`;
}
function descsHTML(c) {
  const items = (c.concepts || []).filter(x => x.desc); if (!items.length) return "";
  return `<details class="tax-desc"><summary>What these mean</summary><dl>` +
    items.map(x => `<dt>${esc(x.label || x.id)}</dt><dd>${esc(x.desc)}</dd>`).join("") + `</dl></details>`;
}
function catBlock(c) {
  const sel = state.tax[c.key] || new Set();
  return `<div class="tax-group" data-key="${esc(c.key)}">
    <div class="tax-group-head${sel.size ? " filled" : ""}"><span class="tgh-label">${esc(c.label || c.key)}</span>
      <span class="tgh-count" data-key="${esc(c.key)}">${sel.size}</span>${modeLabel(c)}
      ${c.desc ? `<span class="tgh-desc">${esc(c.desc)}</span>` : ""}</div>
    ${chipsHTML(c)}${descsHTML(c)}</div>`;
}
function groupBlock(b) {
  const filled = b.cats.filter(c => (state.tax[c.key] || new Set()).size).length;
  const subs = b.cats.map(c => {
    const sel = state.tax[c.key] || new Set();
    return `<div class="tax-sub" data-key="${esc(c.key)}">
      <div class="tax-sub-head${sel.size ? " filled" : ""}"><span class="tgh-sublabel">${esc(c.tab || c.label)}</span>
        <span class="tgh-count" data-key="${esc(c.key)}">${sel.size}</span>${modeLabel(c)}
        ${c.desc ? `<span class="tgh-desc">${esc(c.desc)}</span>` : ""}</div>
      ${chipsHTML(c)}${descsHTML(c)}</div>`;
  }).join("");
  return `<div class="tax-group tax-visual" data-group="${esc(b.group)}">
    <div class="tax-group-head"><span class="tgh-label">${esc(GROUP_LABELS[b.group] || b.group)}</span>
      <span class="tgh-count">${filled}/${b.cats.length}</span><span class="tgh-mode">show all</span></div>
    <div class="tax-subs">${subs}</div></div>`;
}
function renderTaxonomy() {
  const body = $("#tax-body");
  body.innerHTML = taxBlocks().map(b => b.group ? groupBlock(b) : catBlock(b.cat)).join("");
  $$(".tax-chip", body).forEach(btn => btn.addEventListener("click", () => toggleConcept(btn.dataset.key, btn.dataset.id)));
  updateTaxSummary();
}
function toggleConcept(key, id) {
  const cat = taxCats().find(c => c.key === key);
  const sel = state.tax[key] || (state.tax[key] = new Set());
  if (cat && cat.single) { if (sel.has(id)) sel.clear(); else { sel.clear(); sel.add(id); } }
  else { if (sel.has(id)) sel.delete(id); else sel.add(id); }
  const body = $("#tax-body");
  $$(`.tax-chip[data-key="${CSS.escape(key)}"]`, body).forEach(b => b.classList.toggle("on", sel.has(b.dataset.id)));
  const cnt = body.querySelector(`.tgh-count[data-key="${CSS.escape(key)}"]`);
  if (cnt) { cnt.textContent = sel.size; cnt.parentElement.classList.toggle("filled", sel.size > 0); }
  updateTaxSummary(); hideSubmitWarning(); persist(false);
}
function updateTaxSummary() {
  const n = taxCats().filter(c => (state.tax[c.key] || new Set()).size).length;
  $("#tax-summary").textContent = `${n}/${taxCats().length} set`;
}

// ---------- persist / submit / export ----------
function serializeTax() { const o = {}; taxCats().forEach(c => { const s = [...(state.tax[c.key] || [])]; if (s.length) o[c.key] = s; }); return o; }
function persist(done) {
  if (!state.current) return null;
  const ann = { rating: state.rating, tax: serializeTax(), done: done === undefined ? state.done : done,
    updated: new Date().toISOString() };
  state.done = ann.done;
  saveAnn(state.current, ann);
  renderDeckList(); renderOverall();
  return ann;
}

function reviewerId() { try { return localStorage.getItem("kb_reviewer") || ""; } catch (e) { return ""; } }

// Fire-and-forget POST to a Google Apps Script Web App (text/plain avoids a CORS preflight;
// no-cors means we can't read the reply, but the row still lands in the sheet). localStorage
// remains the durable copy, so a failed send never loses the annotation.
function pushToSheet(u, ann) {
  if (!CFG.SHEET_ENDPOINT || !u || !ann) return;
  const payload = { reviewer: reviewerId(), deck_id: u.deck_id, file: u.file, venue: u.venue,
    year: u.year, title: u.title, category: u.category, rating: ann.rating, done: !!ann.done,
    taxonomy: ann.tax || {}, updated: ann.updated };
  try {
    fetch(CFG.SHEET_ENDPOINT, { method: "POST", mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) });
  } catch (e) {}
}

function sendToSheet(ann, verb) {
  if (CFG.SHEET_ENDPOINT && state.current && ann) { pushToSheet(state.current, ann); toast(verb + " & sent to sheet"); }
  else toast(verb + " (browser only)");
}
function requiredCats() { return taxCats().filter(c => c.required); }
function validateSubmit() {
  const missing = []; let warnEmpty = false;
  if (!state.rating) { missing.push("a Yes / No / Irrelevant slide deck rating"); return { ok: false, missing, warnEmpty }; }
  if (state.rating === "irrelevant") return { ok: true, missing, warnEmpty };
  if (state.rating === "yes") requiredCats().forEach(c => { if (!(state.tax[c.key] && state.tax[c.key].size)) missing.push(c.label || c.key); });
  return { ok: missing.length === 0, missing, warnEmpty };
}
function submitReview() {
  if (!state.current) return;
  if (state.done) { persist(false); renderSubmitState(); toast("Reopened"); return; }
  const v = validateSubmit();
  if (!v.ok) { showSubmitWarning(v.missing); return; }
  hideSubmitWarning();
  const msg = state.rating === "irrelevant" ? "Submit this deck as an irrelevant slide deck?" : "Submit this review?";
  if (!confirm(msg)) return;
  const a = persist(true); renderSubmitState(); sendToSheet(a, "Submitted ✓");
}
function renderSubmitState() {
  const b = $("#btn-submit"); if (!b) return;
  b.textContent = state.done ? "✓ Submitted — reopen" : "Confirm & submit";
  b.classList.toggle("submitted", state.done);
}
function showSubmitWarning(missing) {
  const el = $("#submit-warning"); if (!el) return;
  el.innerHTML = `<span class="sw-icon" aria-hidden="true">⚠</span><div class="sw-body">` +
    `<div class="sw-title">Can't submit yet</div><div class="sw-list">Still needed: ${missing.map(esc).join(" &middot; ")}</div></div>`;
  el.hidden = false;
}
function hideSubmitWarning() { const el = $("#submit-warning"); if (el) el.hidden = true; }

function exportAnnotations() {
  const out = [];
  for (const u of state.units) { const a = loadAnn(u); if (a && (a.rating || a.done || (a.tax && Object.keys(a.tax).length)))
    out.push({ deck_id: u.deck_id, file: u.file, title: u.title, venue: u.venue, year: u.year,
      rating: a.rating || "", done: !!a.done, taxonomy: a.tax || {}, updated: a.updated || "" }); }
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = "annotations.json"; a.click(); URL.revokeObjectURL(a.href);
  toast(`Exported ${out.length} annotated deck(s)`);
}

let toastTimer;
function toast(msg) {
  let t = $("#toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.className = "show"; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ""; }, 2200);
}

init();
