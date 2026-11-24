// app.js - everything the page does (except the 3d drawing, that's view3d.js)
//
// people type in stuff they can actually build (heights, widths, layer counts, diaphragm spots),
// we check it, turn it into the 11 columns algorithm.py wants [xc,bft,tft,bfb,tfb,hw,tw,bg,tg,sw,a]
// and send it to server.js, which hands it to runner.py. algorithm.py itself never gets touched.

////////////////////////////// frontend sec. 0 //////////////////////////////
// 0. constants + state
"use strict";

const L = 1200, LAYER = 1.27, TRAIN_SPAN = 856, LEAD_MAX = L + TRAIN_SPAN; // span, one sheet of matboard, first->last wheel
const WHEEL_OFFSETS = [0, 176, 340, 516, 680, 856]; // same as algorithm.WHEEL_OFFSETS
// slider/play range. starts with the nose of the train just short of the bridge, ends once the last car is off
const LEAD_MIN = -130, LEAD_END = LEAD_MAX + 130;
// the 11 columns runner.py expects, same order as param in bridge_parameters()
const COLS = ["xc", "bft", "tft", "bfb", "tfb", "hw", "tw", "bg", "tg", "sw", "a"];
// what the table asks for. mm = any positive number, layers = whole number >= 1
const FIELDS = [
  { k: "xc", mm: true }, { k: "H", mm: true }, { k: "bft", mm: true }, { k: "bfb", mm: true },
  { k: "nt", layers: true }, { k: "nb", layers: true }, { k: "nw", layers: true }, { k: "bg", mm: true },
];
// design 0 from appendix II, used as the starting point + the reset button
const DESIGN0 = () => ({
  rows: [
    { xc: 0, H: 76.27, bft: 100, bfb: 80, nt: 1, nb: 1, nw: 1, bg: 5 },
    { xc: 1200, H: 76.27, bft: 100, bfb: 80, nt: 1, nb: 1, nw: 1, bg: 5 },
  ],
  dias: [0, 400, 800, 1200],
  glue: 1,
});

let S = DESIGN0(); // the design being edited (rows, diaphragms, glue layers)
let sel = 0;       // selected table row
let result = null;        // moving train result (the envelope one)
let pos = null;           // train parked at one spot
let lead = 600 + TRAIN_SPAN / 2; // where the front wheel is. starts with the train centred on the span
let loco = true, heatMode = "pos", playing = false;
const $ = (id) => document.getElementById(id);
const r4 = (v) => Math.round(v * 1e4) / 1e4; // round to 4 decimals so 1.27*3 doesnt come out as 3.8100000000000005
// number -> "1,234.5", infinities show as ∞
const fmt = (v, d = 1) => (v == null || !isFinite(v) ? "∞" : Number(Object.is(v, -0) ? 0 : v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));

////////////////////////////// frontend sec. 1 //////////////////////////////
// 1. editor table (one row per cross-section)

// rebuilds the whole table from S.rows. cheap enough to just redo it on every change
function renderRows() {
  const tb = $("rowsTable").tBodies[0];
  tb.innerHTML = "";
  const last = S.rows.length - 1;
  S.rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    if (i === sel) tr.className = "sel";
    const fixed = i === 0 || i === last;
    const grip = document.createElement("td");
    grip.className = "grip" + (fixed ? " locked" : "");
    grip.textContent = fixed ? "" : "⠿";
    if (!fixed) {
      grip.title = "Drag to reorder";
      // only make the row draggable once you grab the handle, otherwise selecting text in the inputs drags the row
      grip.addEventListener("pointerdown", () => (tr.draggable = true));
    }
    tr.appendChild(grip);
    FIELDS.forEach((f) => {
      const td = document.createElement("td");
      const inp = document.createElement("input");
      inp.type = "number";
      inp.step = f.layers ? "1" : "any";
      inp.min = f.layers ? "1" : "0";
      inp.value = row[f.k];
      inp.dataset.i = i; inp.dataset.k = f.k;
      if (f.k === "xc" && fixed) inp.disabled = true; // first and last rows are always at 0 and 1200
      inp.addEventListener("input", () => { row[f.k] = inp.value === "" ? NaN : Number(inp.value); refresh(false); });
      inp.addEventListener("focus", () => select(i));
      td.appendChild(inp);
      tr.appendChild(td);
    });
    const td = document.createElement("td");
    td.style.whiteSpace = "nowrap";
    const ed = document.createElement("button");
    ed.className = "row-ed"; ed.title = "Edit this section in 2D"; ed.textContent = "✎";
    ed.onclick = (e) => { e.stopPropagation(); openSecEd(i); };
    td.appendChild(ed);
    if (!fixed) {
      const b = document.createElement("button");
      b.className = "del"; b.title = "Delete row"; b.textContent = "×";
      b.onclick = () => { S.rows.splice(i, 1); sel = Math.min(sel, S.rows.length - 1); refresh(); };
      td.appendChild(b);
    }
    tr.appendChild(td);
    tr.addEventListener("click", () => select(i));
    if (!fixed) wireDrag(tr, i);
    tb.appendChild(tr);
  });
}
// highlights a row + tells the 3d view and section editor which one to show
function select(i) {
  if (sel === i) return;
  sel = i;
  [...$("rowsTable").tBodies[0].rows].forEach((tr, j) => tr.classList.toggle("sel", j === sel));
  pushScene();
  secSync();
}

// drag to reorder. only the middle rows can move.
// note: positions stay where they are (so they still go up), it's the section values that move between slots
let dragFrom = null;
// hooks up the html5 drag events for one row
function wireDrag(tr, i) {
  tr.addEventListener("dragstart", (e) => {
    dragFrom = i; tr.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(i));
  });
  tr.addEventListener("dragend", () => {
    tr.draggable = false; tr.classList.remove("dragging"); dragFrom = null;
    document.querySelectorAll("#rowsTable tr").forEach((r) => r.classList.remove("drop-before", "drop-after"));
  });
  tr.addEventListener("dragover", (e) => {
    if (dragFrom == null) return;
    e.preventDefault();
    const r = tr.getBoundingClientRect(), before = e.clientY < r.top + r.height / 2;
    document.querySelectorAll("#rowsTable tr").forEach((x) => x.classList.remove("drop-before", "drop-after"));
    tr.classList.add(before ? "drop-before" : "drop-after");
  });
  tr.addEventListener("drop", (e) => {
    e.preventDefault();
    if (dragFrom == null) return;
    const r = tr.getBoundingClientRect(), before = e.clientY < r.top + r.height / 2;
    moveRow(dragFrom, before ? i : i + 1);
  });
}
// actually moves the row. "to" is the index it should end up at before we take it out
function moveRow(from, to) {
  const slots = S.rows.map((r) => r.xc);
  const [moved] = S.rows.splice(from, 1);
  if (from < to) to--; // everything after "from" shifted up by one when we spliced it out
  to = Math.max(1, Math.min(S.rows.length - 1, to)); // never before the first or after the last row
  S.rows.splice(to, 0, moved);
  S.rows.forEach((r, k) => (r.xc = slots[k]));
  sel = to;
  refresh();
}

// new row goes halfway between the selected row and the next one, copying the selected row's values
// so it's valid straight away
function addRow() {
  const i = Math.min(sel, S.rows.length - 2);
  const a = S.rows[i], b = S.rows[i + 1];
  if (!(b.xc - a.xc >= 2)) return flash(`No room between ${a.xc} mm and ${b.xc} mm for a new row.`);
  S.rows.splice(i + 1, 0, { ...a, xc: Math.round((a.xc + b.xc) / 2) });
  sel = i + 1;
  refresh();
}

// diaphragm chips. 0 and 1200 can't be removed
function renderDias() {
  const box = $("diaList");
  box.innerHTML = "";
  [...S.dias].sort((a, b) => a - b).forEach((d) => {
    const c = document.createElement("span");
    const fixed = d === 0 || d === L;
    c.className = "dchip" + (fixed ? " fixed" : "");
    c.textContent = d;
    if (!fixed) {
      const b = document.createElement("button");
      b.textContent = "×"; b.title = "Remove";
      b.onclick = () => { S.dias = S.dias.filter((v) => v !== d); renderDias(); refresh(false); };
      c.appendChild(b);
    }
    box.appendChild(c);
  });
}
// adds the diaphragm typed in the little box
function addDia() {
  const v = Number($("diaInput").value);
  if ($("diaInput").value === "" || !isFinite(v)) return;
  if (v <= 0 || v >= L) return flash(`Diaphragm at ${v} mm is off the bridge (must be between 0 and ${L} mm).`);
  if (S.dias.includes(v)) return flash(`There is already a diaphragm at ${v} mm.`);
  S.dias.push(v); S.dias.sort((a, b) => a - b);
  $("diaInput").value = "";
  renderDias(); refresh(false);
}
// replaces all diaphragms with n evenly spaced panels (so n + 1 diaphragms)
function evenDias() {
  const n = Math.round(Number($("diaEvenN").value));
  if (!(n >= 1 && n <= 120)) return flash("Number of panels must be a whole number from 1 to 120.");
  S.dias = Array.from({ length: n + 1 }, (_, k) => r4((L * k) / n));
  renderDias(); refresh(false);
}

////////////////////////////// frontend sec. 2 //////////////////////////////
// 2. validation (the rules from the design doc)
const NAMES = { xc: "Position", H: "Total height", bft: "Top flange width", bfb: "Bottom width", nt: "Top flange layers", nb: "Bottom flange layers", nw: "Web layers", bg: "Glue tab width" };

// checks every row + the global stuff. returns the messages and which cells to paint red
// note: every rule here stops a divide by zero or a nonsense number further down in algorithm.py
function validate() {
  const errs = [], cells = new Set();
  const bad = (i, ks, msg) => { ks.forEach((k) => cells.add(`${i}:${k}`)); errs.push(msg); };
  const rows = S.rows;
  if (rows.length < 2) errs.push("A design needs at least a start and an end cross-section.");

  rows.forEach((r, i) => {
    const n = `Row ${i + 1}`;
    let ok = true;
    FIELDS.forEach(({ k, layers }) => {
      const v = r[k];
      if (k === "xc") { if (!isFinite(v)) { bad(i, [k], `${n}: position must be a number.`); ok = false; } return; }
      if (layers) { if (!(Number.isInteger(v) && v >= 1)) { bad(i, [k], `${n}: ${NAMES[k].toLowerCase()} must be a whole number of at least 1 (got ${isFinite(v) ? v : "nothing"}).`); ok = false; } }
      else if (!(isFinite(v) && v > 0)) { bad(i, [k], `${n}: ${NAMES[k].toLowerCase()} must be greater than 0 mm (got ${isFinite(v) ? v : "nothing"}).`); ok = false; }
    });
    if (!ok) return;
    const tft = r.nt * LAYER, tfb = r.nb * LAYER, tw = r.nw * LAYER, tg = S.glue * LAYER;
    const hw = r.H - tft - tfb;
    // top has to overhang, otherwise flange tip buckling divides by (bft - sw) = 0
    if (!(r.bft > r.bfb)) bad(i, ["bft", "bfb"], `${n}: the top flange (${r.bft} mm) must be wider than the bottom (${r.bfb} mm) so it overhangs the webs.`);
    if (!(hw > 0)) bad(i, ["H", "nt", "nb"], `${n}: height ${r.H} mm is too small for the flanges (${fmt(tft + tfb, 2)} mm) plus a web.`);
    if (!(2 * r.bg + 2 * tw <= r.bfb)) bad(i, ["bg", "nw", "bfb"], `${n}: glue tabs (2 × ${r.bg} mm) don't fit between the webs (2 × ${fmt(tw, 2)} mm) inside a ${r.bfb} mm bottom.`);
    if (hw > 0 && !(tg < hw)) bad(i, ["H"], `${n}: the glue tab (${fmt(tg, 2)} mm) is thicker than the web is tall (${fmt(hw, 2)} mm).`);
  });

  if (rows.length >= 2) {
    if (rows[0].xc !== 0) bad(0, ["xc"], `Row 1 must be at 0 mm (it is at ${rows[0].xc} mm).`);
    if (rows[rows.length - 1].xc !== L) bad(rows.length - 1, ["xc"], `The last row must be at ${L} mm.`);
    for (let i = 1; i < rows.length; i++) {
      if (!(rows[i].xc > rows[i - 1].xc)) bad(i, ["xc"], `Row ${i + 1} is at ${rows[i].xc} mm but row ${i} is at ${rows[i - 1].xc} mm. Positions must increase.`);
    }
  }
  const d = S.dias;
  if (!d.includes(0) || !d.includes(L)) errs.push(`Diaphragm positions must include 0 and ${L} mm.`);
  d.forEach((v) => { if (v < 0 || v > L) errs.push(`Diaphragm at ${v} mm is off the bridge.`); });
  if (new Set(d).size !== d.length) errs.push("Diaphragm positions contain a duplicate.");
  if (!(Number.isInteger(S.glue) && S.glue >= 1)) errs.push("Glue tab layers must be a whole number of at least 1.");
  return { errs, cells };
}

// linear interpolation of one table field along the span (like np.interp, clamps at the ends)
function lin(p, k) {
  const rows = S.rows;
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i], b = rows[i + 1];
    if (p >= a.xc && p <= b.xc) return a[k] + ((b[k] - a[k]) * (p - a.xc)) / (b.xc - a.xc);
  }
  return rows[p <= rows[0].xc ? 0 : rows.length - 1][k];
}

// handout sec 1.5 rules. these are only warnings, they don't change any numbers
function handoutChecks() {
  const out = [], rows = S.rows, ok = (t) => out.push({ ok: true, t }), warn = (t) => out.push({ ok: false, t });
  const H0 = rows[0].H, H1 = rows[rows.length - 1].H, D = H0; // both ends sit on the supports, so deck height = end height
  if (Math.abs(H0 - H1) > 1e-6) warn(`Ends have different heights (${H0} vs ${H1} mm). Both ends rest on the supports, so the deck can't be level unless they match.`);
  else ok(`Deck is flat and level at ${fmt(D, 2)} mm above the supports.`);
  const m20 = Math.abs(D / 20 - Math.round(D / 20)) < 1e-6;
  if (D >= 200) warn(`Deck is ${fmt(D, 2)} mm above the supports; it must be less than 200 mm.`);
  else if (!m20) warn(`Deck is ${fmt(D, 2)} mm above the supports; the handout needs a multiple of 20 mm (nearest: ${Math.max(20, Math.floor(D / 20) * 20)} or ${Math.ceil(D / 20) * 20} mm).`);
  else ok(`Deck height ${D} mm is a multiple of 20 mm and under 200 mm.`);
  if (Math.abs(lin(30, "H") - H0) > 1e-6 || Math.abs(lin(L - 30, "H") - H1) > 1e-6) warn("The 60 mm resting on each support must be flat underneath: keep the height constant for the first and last 30 mm of the span.");
  else ok("Flat 60 mm bearing at both ends.");
  // the bottom is allowed to hang below the supports, but only 200 mm and inside the 30 deg lines (figure 3)
  const tan30 = Math.tan(Math.PI / 6);
  let worst = null;
  for (let x = 0; x <= L; x += 5) {
    const hang = lin(x, "H") - D, lim = Math.min(200, Math.max(0, Math.min(x - 25, L - 25 - x)) * tan30);
    if (hang > lim + 1e-6 && (!worst || hang - lim > worst.over)) worst = { x, hang, lim, over: hang - lim };
  }
  if (worst) warn(`At ${worst.x} mm the bottom is ${fmt(worst.hang, 1)} mm below the supports; the limit there is ${fmt(worst.lim, 1)} mm (200 mm max, 30° from the support plates).`);
  else ok("Bottom stays inside the allowed envelope below the supports.");
  const minW = Math.min(...rows.map((r) => r.bft));
  if (minW < 100) warn(`Deck is ${minW} mm wide somewhere; it must be at least 100 mm.`);
  else ok(`Deck is at least 100 mm wide (min ${minW} mm).`);
  return out;
}
// green ticks / yellow warnings in the handout checks box
function renderChecks(valid) {
  if (!valid) { $("checks").innerHTML = '<div class="empty">Fix the inputs first.</div>'; return; }
  $("checks").innerHTML = handoutChecks().map((c) => `<div class="check-item ${c.ok ? "ok" : "warn"}"><b>${c.ok ? "✓" : "!"}</b><span>${c.t}</span></div>`).join("");
}

////////////////////////////// frontend sec. 3 //////////////////////////////
// 3. converting the table into the 11 simulator columns

// tft/tfb/tw/tg = layers * 1.27, hw = height - flanges, sw = bottom width - tw, a = gap between diaphragms.
// note: layer counts and diaphragm spacing are steps, not slopes. "1.5 layers" can't be built, so when they
// change we add an extra row 1 mm before so np.interp sees a step instead of a ramp
function convert() {
  const rows = S.rows, ds = [...S.dias].sort((a, b) => a - b);
  const layersAt = (p) => { let r = rows[0]; for (const q of rows) if (q.xc <= p) r = q; return r; }; // last row at or before p
  // length of the diaphragm panel that p sits in
  const gapAt = (p) => {
    for (let i = 0; i < ds.length - 1; i++) if (p >= ds[i] && p < ds[i + 1]) return ds[i + 1] - ds[i];
    return ds[ds.length - 1] - ds[ds.length - 2];
  };
  // one 11-column row at position p. widths/height are interpolated, layers come from row lr
  const make = (p, lr, gap) => {
    const H = lin(p, "H"), bft = lin(p, "bft"), bfb = lin(p, "bfb"), bg = lin(p, "bg");
    const tft = lr.nt * LAYER, tfb = lr.nb * LAYER, tw = lr.nw * LAYER, tg = S.glue * LAYER;
    return [p, bft, tft, bfb, tfb, H - tfb - tft, tw, bg, tg, bfb - tw, gap].map(r4);
  };
  const same = (a, b) => a.nt === b.nt && a.nb === b.nb && a.nw === b.nw;

  // rows go at every table row, plus every diaphragm where the panel length changes
  const B = new Set(rows.map((r) => r.xc));
  for (let i = 1; i < ds.length - 1; i++) if (ds[i] - ds[i - 1] !== ds[i + 1] - ds[i]) B.add(ds[i]);
  const out = [];
  [...B].sort((a, b) => a - b).forEach((p) => {
    if (p > 0) {
      const lb = layersAt(p - 1), la = layersAt(p), gb = gapAt(p - 1), ga = gapAt(p);
      const prev = out.length ? out[out.length - 1][0] : -Infinity;
      if ((!same(lb, la) || gb !== ga) && p - 1 > prev) out.push(make(p - 1, lb, gb)); // the "1 mm before" row
    }
    out.push(make(p, layersAt(p), gapAt(p)));
  });
  return out;
}

// the simulator rows table (collapsed by default)
function renderCsv(out) {
  $("csvTable").innerHTML = "<thead><tr>" + COLS.map((c) => `<th>${c}</th>`).join("") + "</tr></thead><tbody>" +
    out.map((r) => "<tr>" + r.map((v) => `<td>${v}</td>`).join("") + "</tr>").join("") + "</tbody>";
}
// same rows as a .csv file
function downloadCsv() {
  const v = validate();
  if (v.errs.length) return showErrors(v.errs);
  const csv = COLS.join(",") + "\n" + convert().map((r) => r.join(",")).join("\n") + "\n";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "bridge_design.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

////////////////////////////// frontend sec. 4 //////////////////////////////
// 4. refresh (runs after every edit)

// red error boxes at the bottom of the editor
function showErrors(list) { $("errors").innerHTML = list.map((e) => `<div class="err">${e}</div>`).join(""); }
let flashTimer;
// shows a message for a few seconds then puts the normal errors back
function flash(msg) { showErrors([msg]); clearTimeout(flashTimer); flashTimer = setTimeout(() => refresh(false), 3500); }

let lastValid = false, booting = true; // booting = don't start live runs before the page is set up
// the one function everything calls after changing S. validates, redraws, kicks off the live updates
function refresh(redrawTable = true) {
  if (redrawTable) renderRows();
  const v = validate();
  document.querySelectorAll("#rowsTable input").forEach((inp) => inp.classList.toggle("bad", v.cells.has(`${inp.dataset.i}:${inp.dataset.k}`)));
  showErrors(v.errs);
  lastValid = !v.errs.length;
  $("runBtn").disabled = !lastValid;
  renderChecks(lastValid);
  if (lastValid) { renderCsv(convert()); requestPosition(); }
  if (!booting) scheduleRun();
  pushScene();
  secSync();
  return v;
}

////////////////////////////// frontend sec. 5 //////////////////////////////
// 5. talking to the server

// the bits every request needs (rows + load case)
function baseRequest() {
  const lc = $("loadCase").value;
  return {
    rows: convert(), load_case: lc,
    freight_weight: lc === "LC2_pass" ? Number($("freight").value) : null,
    loco_leading: loco,
  };
}
// POST to server.js, which passes it to runner.py and gives back its json
async function api(body) {
  const res = await fetch("/api/simulate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}

// the moving train run (the "Failure" panel). the button calls it, and with "Live" on it also runs ~350 ms
// after you stop typing. only the newest answer gets shown, if you edit mid-run it queues one more
let runSeq = 0, runBusy = false, runAgain = false, runTimer = 0;
// called on every edit. waits a bit so typing "120" is one run, not three
function scheduleRun() {
  clearTimeout(runTimer);
  if (!lastValid) { setStale(true); return; }
  setStale(true);
  if ($("liveToggle").checked) runTimer = setTimeout(run, 350);
}
// fades the results panel while they're out of date
function setStale(on) {
  $("results").classList.toggle("stale", on && !!result);
  if (on && result) $("status").textContent = $("liveToggle").checked ? "Updating…" : "Inputs changed: press Run";
}
async function run() {
  clearTimeout(runTimer); // in case the button beat the timer
  const v = validate();
  if (v.errs.length) { refresh(false); return; }
  const body = { ...baseRequest(), step: Math.max(1, Math.round(Number($("step").value) || 1)) };
  if (body.load_case === "LC2_pass" && !(body.freight_weight > 0)) return showErrors(["Lighter freight car weight must be greater than 0 N."]);
  if (runBusy) { runAgain = true; return; }
  runBusy = true; runAgain = false;
  const seq = ++runSeq, t0 = performance.now();
  $("status").textContent = "Running…";
  try {
    const d = await api(body);
    if (seq === runSeq && !runAgain) { // ignore it if something changed while we were waiting
      if (!d.ok) { result = null; showErrors([d.error || "Simulation failed."]); $("status").textContent = "Failed"; clearResults(); }
      else { result = d; showResults(d); setStale(false); $("status").textContent = `Updated in ${((performance.now() - t0) / 1000).toFixed(1)} s`; }
    }
  } catch (e) {
    showErrors([`Could not reach the server: ${e.message}`]);
    $("status").textContent = "Failed";
  } finally {
    runBusy = false;
    $("runBtn").disabled = !lastValid;
    pushScene();
    if (runAgain) run();
  }
}

// train parked at one spot (the train bar). only one request at a time, and we always finish on the
// latest slider position so dragging doesn't pile up hundreds of requests
let posBusy = false, posAgain = false;
async function requestPosition() {
  if (!lastValid) return;
  if (posBusy) { posAgain = true; return; }
  const lc = $("loadCase").value;
  if (lc === "LC2_pass" && !(Number($("freight").value) > 0)) return;
  posBusy = true; posAgain = false;
  try {
    const d = await api({ ...baseRequest(), mode: "position", x_lead: lead });
    if (d.ok) { pos = d; showPosition(); }
    else { pos = null; showPosition(d.error); }
  } catch { /* server unreachable: run() reports it */ }
  posBusy = false;
  pushScene();
  if (calc.open && calc.source === "pos") { clearTimeout(calc.t); calc.t = setTimeout(loadCalc, 250); }
  if (posAgain) requestPosition();
}

////////////////////////////// frontend sec. 6 //////////////////////////////
// 6. showing the results

// failure_load() names -> what we show on screen
const MODE_LABEL = {
  tension: "Tension (bottom)", compression: "Compression (top)", shear: "Matboard shear", glue: "Glue shear",
  "buckling in the middle flange": "Buckling · top flange mid", "buckling in the side flanges": "Buckling · top flange tips",
  "buckling in the webs": "Buckling · webs", "shear buckling": "Shear buckling",
};
// blanks the results panel (before the first run, or if a run fails)
function clearResults() {
  ["pFail", "mode", "xFail", "minFos", "trainW", "ybar", "Ival"].forEach((id) => ($(id).textContent = "—"));
  $("modes").innerHTML = '<div class="empty">No results</div>';
  drawCharts();
}
// fills the results panel from a moving train run
function showResults(d) {
  $("pFail").textContent = fmt(d.p_fail, 1);
  $("mode").textContent = MODE_LABEL[d.mode] || d.mode;
  $("xFail").textContent = `${fmt(d.x_fail, 0)} mm`;
  $("minFos").textContent = fmt(d.min_fos, 3);
  $("trainW").textContent = `${fmt(d.train_total, 1)} N`;
  $("ybar").textContent = fmt(d.props.ybar_mid, 2);
  $("Ival").textContent = fmt(d.props.I_mid, 0);
  // plain english version of the fos, so nobody has to remember what < 1 means
  const v = $("verdict");
  v.className = "verdict " + (d.min_fos < 1 ? "bad" : "good");
  v.textContent = d.min_fos < 1
    ? `FOS ${fmt(d.min_fos, 3)} < 1: this ${fmt(d.train_total, 0)} N train would break the bridge. It can carry a train of about ${fmt(d.p_fail, 0)} N (= ${fmt(d.min_fos, 3)} × ${fmt(d.train_total, 0)} N).`
    : `FOS ${fmt(d.min_fos, 3)} ≥ 1: carries this ${fmt(d.train_total, 0)} N train. Predicted failure when the train weighs about ${fmt(d.p_fail, 0)} N (= ${fmt(d.min_fos, 3)} × ${fmt(d.train_total, 0)} N).`;
  const minP = d.p_fail;
  $("modes").innerHTML = [...d.modes].sort((a, b) => (a.p_fail ?? Infinity) - (b.p_fail ?? Infinity)).map((m) => {
    const u = m.p_fail ? Math.max(2, (minP / m.p_fail) * 100) : 0;
    return `<div class="mode-row${m.name === d.mode ? " weak" : ""}" data-x="${m.x}" data-mode="${m.name}" title="min FOS ${fmt(m.min_fos, 3)} at x = ${fmt(m.x, 0)} mm. Click for the calculation.">
      <span>${MODE_LABEL[m.name] || m.name}</span><div class="bar"><i style="width:${u}%"></i></div><span>${fmt(m.p_fail, 0)} N</span></div>`;
  }).join("");
  document.querySelectorAll("#modes .mode-row").forEach((r) => r.addEventListener("click", () =>
    openCalc({ source: "env", x: Number(r.dataset.x), sec: "fos", mode: r.dataset.mode })));
  drawCharts();
  if (calc.open && calc.source === "env") loadCalc();
}

// fills the train bar readouts from a parked train result
function showPosition(err) {
  const set = (id, t) => ($(id).textContent = t);
  if (!pos) {
    ["roRA", "roRB", "roV", "roM", "roFos"].forEach((id) => set(id, "—"));
    $("trainHint").textContent = err || "";
    return drawCharts();
  }
  const onCount = pos.on.filter(Boolean).length;
  $("trainHint").textContent = onCount ? `${onCount} of 6 axles on the span` : "Train is off the span";
  set("roRA", `${fmt(pos.RA, 1)} N`);
  set("roRB", `${fmt(pos.RB, 1)} N`);
  set("roV", onCount ? `${fmt(pos.Vmax, 1)} N @ ${fmt(pos.Vmax_x, 0)}` : "0");
  set("roM", onCount ? `${fmt(pos.Mmax / 1000, 1)} N·m @ ${fmt(pos.Mmax_x, 0)}` : "0");
  $("roFos").textContent = pos.min_fos == null ? "—" : `${fmt(pos.min_fos, 3)} · ${MODE_LABEL[pos.mode] || pos.mode} → ${fmt(pos.p_fail, 0)} N`;
  $("roFos").title = pos.min_fos == null ? "" : `If the train stayed here, it would fail at ${fmt(pos.p_fail, 1)} N total by ${pos.mode} at x = ${fmt(pos.x_fail, 0)} mm`;
  drawCharts();
}

////////////////////////////// frontend sec. 7 //////////////////////////////
// 7. charts (sfd/bmd vs capacity, like output_plots in algorithm.py)

const C = { x: "#e0675d", y: "#7fbf5f", z: "#5d9be0", m: "#e6d55a", p: "#c58be8", here: "#ffb347" };
// sizes a canvas for the screen's pixel ratio so lines aren't blurry, returns the context
function setupCanvas(cv) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}
// draws one chart. it also remembers what it drew (cv._st) so hovering can put a crosshair on it later
function chart(cv, legendEl, opt) {
  if (!cv.clientWidth) return;
  const { g, w, h } = setupCanvas(cv);
  legendEl.innerHTML = "";
  cv._st = null;
  if (!opt) { g.fillStyle = "#666"; g.font = "11px Segoe UI, sans-serif"; g.fillText("Run a simulation to see results", 12, h / 2); return; }
  const pad = { l: 8, r: 8, t: 16, b: 16 };
  const X = (x) => pad.l + (x / L) * (w - pad.l - pad.r);
  const span = opt.ymax - opt.ymin || 1;
  const Y = (v) => { const f = (v - opt.ymin) / span; return opt.invert ? pad.t + f * (h - pad.t - pad.b) : h - pad.b - f * (h - pad.t - pad.b); };
  const clampY = (v) => Y(Math.max(opt.ymin, Math.min(opt.ymax, v)));
  g.strokeStyle = "#777"; g.lineWidth = 1;
  g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(L), Y(0)); g.stroke();
  const line = (ys, color, lw = 1.2, alpha = 1, sign = 1) => {
    g.save(); g.globalAlpha = alpha; g.strokeStyle = color; g.lineWidth = lw;
    g.beginPath(); let pen = false;
    ys.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      const px = X(opt.x[i]), py = clampY(sign * v);
      pen ? g.lineTo(px, py) : g.moveTo(px, py); pen = true;
    });
    g.stroke(); g.restore();
  };
  g.save(); g.beginPath(); g.rect(pad.l, 0, w - pad.l - pad.r, h); g.clip();
  opt.curves.forEach((c) => line(c, "#bbb", 0.7, 0.22));
  opt.series.forEach((s) => { line(s.y, s.color, 1.4); if (s.mirror) line(s.y, s.color, 1.4, 1, -1); });
  if (opt.here) line(opt.here, C.here, 2.2);
  if (opt.xmark != null) {
    g.setLineDash([3, 3]); g.strokeStyle = "#e0675d"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(X(opt.xmark), pad.t); g.lineTo(X(opt.xmark), h - pad.b); g.stroke(); g.setLineDash([]);
  }
  // hover crosshair + a dot on every line at that x
  const hi = cv._hoverIdx;
  if (hi != null && hi < opt.x.length) {
    const px = X(opt.x[hi]);
    g.strokeStyle = "rgba(255,255,255,.7)"; g.lineWidth = 1; g.setLineDash([2, 3]);
    g.beginPath(); g.moveTo(px, pad.t - 6); g.lineTo(px, h - pad.b + 6); g.stroke(); g.setLineDash([]);
    const dot = (v, color, sign = 1) => {
      if (v == null) return;
      g.fillStyle = color; g.strokeStyle = "#111"; g.lineWidth = 1;
      g.beginPath(); g.arc(px, clampY(sign * v), 3.2, 0, Math.PI * 2); g.fill(); g.stroke();
    };
    if (opt.env) { dot(opt.env[hi], "#f2f2f2"); if (opt.envMirror) dot(opt.env[hi], "#f2f2f2", -1); }
    opt.series.forEach((s) => { dot(s.y[hi], s.color); if (s.mirror) dot(s.y[hi], s.color, -1); });
    if (opt.here) dot(opt.here[hi], C.here);
  }
  g.restore();
  g.fillStyle = "#aaa"; g.font = "10px Segoe UI, sans-serif";
  const top = opt.invert ? opt.ymin : opt.ymax, bot = opt.invert ? opt.ymax : opt.ymin;
  g.fillText(opt.tick(top), 10, 11);
  g.fillText(opt.tick(bot), 10, h - 4);
  g.textAlign = "right"; g.fillText(opt.unit, w - 10, 11); g.textAlign = "left";
  const items = [{ name: "All train positions", color: "#bbb" }, ...(opt.here ? [{ name: "Train here", color: C.here }] : []), ...opt.series];
  legendEl.innerHTML = items.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join("");
  cv._st = { opt, pad, w, legendEl };
}

// hovering a chart shows the values under the mouse, clicking pins it there (click again to unpin)
function wireChartHover(cv) {
  const tip = $("chartTip");
  const idxAt = (e) => {
    const st = cv._st; if (!st) return null;
    const r = cv.getBoundingClientRect();
    const x = ((e.clientX - r.left - st.pad.l) / (st.w - st.pad.l - st.pad.r)) * L;
    const xs = st.opt.x, step = xs[1] - xs[0];
    return Math.max(0, Math.min(xs.length - 1, Math.round((x - xs[0]) / step)));
  };
  const show = (i, e) => {
    const st = cv._st; if (!st || i == null) return;
    cv._hoverIdx = i;
    chart(cv, st.legendEl, st.opt);
    const o = st.opt, unit = o.unit.split(" ")[0], d = o.digits ?? 1;
    const val = (v) => (v == null ? "∞" : `${fmt(v, d)} ${unit}`);
    const rows = [];
    if (o.env) rows.push(["#f2f2f2", o.envName, val(o.env[i])]);
    if (o.here) rows.push([C.here, "Train here", val(o.here[i])]);
    o.series.forEach((s) => {
      const dem = o.env ? Math.abs(o.env[i]) : null, cap = s.y[i];
      const fos = dem && cap != null ? ` <em>FOS ${fmt(cap / dem, 2)}</em>` : "";
      rows.push([s.color, s.name, `${s.mirror ? "±" : ""}${val(cap)}${fos}`]);
    });
    tip.innerHTML = `<b>x = ${fmt(o.x[i], 0)} mm</b>${cv._pinned != null ? ' <span class="pin">pinned</span>' : ""}` +
      rows.map(([c, n, v]) => `<div><i style="background:${c}"></i>${n}<span>${v}</span></div>`).join("");
    tip.hidden = false;
    const r = cv.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    const px = r.left + st.pad.l + (o.x[i] / L) * (st.w - st.pad.l - st.pad.r);
    let left = px - tw - 14; if (left < 8) left = px + 14;
    tip.style.left = `${Math.min(window.innerWidth - tw - 8, left)}px`;
    tip.style.top = `${Math.max(8, Math.min(window.innerHeight - th - 8, (e ? e.clientY : r.top + 40) - th / 2))}px`;
  };
  const hide = () => {
    cv._hoverIdx = null; $("chartTip").hidden = true;
    if (cv._st) chart(cv, cv._st.legendEl, cv._st.opt);
  };
  cv.addEventListener("mousemove", (e) => { if (cv._pinned == null) show(idxAt(e), e); });
  cv.addEventListener("mouseleave", () => { if (cv._pinned == null) hide(); });
  cv.addEventListener("click", (e) => {
    if (cv._pinned != null) { cv._pinned = null; show(idxAt(e), e); return; }
    cv._pinned = idxAt(e); show(cv._pinned, e);
  });
  cv._refreshHover = () => { if (cv._pinned != null) show(cv._pinned); else if (cv._hoverIdx != null) hide(); };
}

// biggest |value| over a few arrays, ignoring nulls (null = infinite capacity)
const maxOf = (arrs) => Math.max(0, ...arrs.flat().filter((v) => v != null).map(Math.abs));
// smallest value over a few arrays. used so the weakest capacity line always fits on the chart
const minOfMax = (arrs) => Math.min(...arrs.map((a) => Math.min(...a.filter((v) => v != null))));
// redraws both charts from the latest results
// note: the bmd is drawn positive-down like the plots in algorithm.py (invert_yaxis)
function drawCharts() {
  if (!result) { chart($("sfdChart"), $("sfdLegend"), null); chart($("bmdChart"), $("bmdLegend"), null); return; }
  const d = result, e = d.env, here = pos && pos.x.length === d.x.length ? pos : null;
  const isShear = ["shear", "glue", "shear buckling"].includes(d.mode);
  const vS = [
    { name: "Matboard shear", y: e.Vf_shear, color: C.x, mirror: true },
    { name: "Glue shear", y: e.Vf_glue, color: C.y, mirror: true },
    { name: "Shear buckling", y: e.Vf_buckV, color: C.z, mirror: true },
  ];
  const vmax = Math.max(maxOf([d.SFD]) * 1.15, minOfMax(vS.map((s) => s.y)) * 1.1);
  chart($("sfdChart"), $("sfdLegend"), { x: d.x, curves: d.SFDi, series: vS, here: here && here.V, env: d.SFD, envMirror: true, envName: "Envelope |V|", digits: 1, ymin: -vmax, ymax: vmax, unit: "N", tick: (v) => fmt(v, 0), xmark: isShear ? d.x_fail : null });
  const mS = [
    { name: "Tension", y: e.Mf_tens, color: C.x },
    { name: "Compression", y: e.Mf_comp, color: C.y },
    { name: "Buckling · flange mid", y: e.Mf_buck1, color: C.z },
    { name: "Buckling · flange tips", y: e.Mf_buck2, color: C.m },
    { name: "Buckling · webs", y: e.Mf_buck3, color: C.p },
  ];
  const mmax = Math.max(maxOf([d.BMD]) * 1.15, minOfMax(mS.map((s) => s.y)) * 1.1);
  const mmin = Math.min(0, ...d.BMDi.flat().filter((v) => v != null));
  chart($("bmdChart"), $("bmdLegend"), { x: d.x, curves: d.BMDi, series: mS, here: here && here.M, env: d.BMD, envName: "Envelope M", digits: 0, ymin: mmin, ymax: mmax, invert: true, unit: "N·mm (+ down)", tick: (v) => (Math.abs(v) >= 1e4 ? v.toExponential(1) : fmt(Math.abs(v) < 0.5 ? 0 : v, 0)), xmark: isShear ? null : d.x_fail });
  ["sfdChart", "bmdChart"].forEach((id) => $(id)._refreshHover && $(id)._refreshHover());
}

////////////////////////////// frontend sec. 8 //////////////////////////////
// 8. 3d view (the drawing itself is in view3d.js)

// how much of the screen the side panels cover, so the 3d view centres in the space that's left
function insets() {
  const ed = $("editor"), rs = $("results");
  return {
    left: ed.classList.contains("min") ? 0 : ed.getBoundingClientRect().right,
    right: rs.classList.contains("min") ? 0 : window.innerWidth - rs.getBoundingClientRect().left,
  };
}
const view = View3D.create($("viewport"), { insets });

// hands view3d.js everything it needs to draw. called a lot, view3d only redraws once per frame anyway
function pushScene() {
  if (!lastValid) return; // while the inputs are broken just keep showing the last good bridge
  const rows = convert();
  const D = S.rows[0].H;
  const Hmax = Math.max(...S.rows.map((r) => r.H));
  let util = null;
  if (heatMode === "pos" && pos) util = { x: pos.x, u: pos.util };
  if (heatMode === "env" && result) util = { x: result.x, u: result.util };
  // the train's position comes straight from the slider so it moves smoothly. the loads/reactions come
  // from the last answer and catch up a few ms later
  const wheelPos = WHEEL_OFFSETS.map((o) => lead - o);
  const train = {
    wheelPos, on: wheelPos.map((p) => p >= 0 && p <= L),
    loads: pos ? pos.wheel_loads : null, RA: pos ? pos.RA : 0, RB: pos ? pos.RB : 0, total: pos ? pos.train_total : 1,
    locoCar: loco ? 0 : 2,
  };
  view.setScene({
    rows, D, Hmax, dias: [...S.dias], selX: S.rows[sel] ? S.rows[sel].xc : null,
    heat: !!util, util, train, showTrain: $("showTrain").checked, showForces: $("showForces").checked, xray: $("xray").checked,
    fail: result ? { x: result.x_fail, label: `Envelope: ${fmt(result.p_fail, 0)} N · ${MODE_LABEL[result.mode] || result.mode} @ ${fmt(result.x_fail, 0)} mm` } : null,
  });
}

////////////////////////////// frontend sec. 9 //////////////////////////////
// 9. train bar (parking the train + play)

// moves the train to lead-wheel position v
function setLead(v, fromSlider) {
  lead = Math.max(LEAD_MIN, Math.min(LEAD_END, Number(v) || 0));
  if (!fromSlider) $("leadSlider").value = Math.round(lead);
  $("leadInput").value = Math.round(lead);
  pushScene();
  requestPosition();
}
let playT = 0;
// one frame of the play animation, ~380 mm/s
function playLoop(t) {
  if (!playing) return;
  const dt = playT ? Math.min(0.1, (t - playT) / 1000) : 0;
  playT = t;
  lead = Math.min(LEAD_END, lead + 380 * dt);
  $("leadSlider").value = Math.round(lead);
  $("leadInput").value = Math.round(lead);
  pushScene();
  requestPosition();
  if (lead >= LEAD_END) return togglePlay(); // one full crossing, then stop
  requestAnimationFrame(playLoop);
}
// play/pause. pressing play at the end starts a new crossing
function togglePlay() {
  playing = !playing;
  $("playBtn").textContent = playing ? "❚❚" : "▶";
  playT = 0;
  if (playing && lead >= LEAD_END - 1) lead = LEAD_MIN; // start again from just before the bridge
  if (playing) requestAnimationFrame(playLoop);
}

////////////////////////////// frontend sec. 10 //////////////////////////////
// 10. panels (minimize + keeping the train bar between the side panels)

// puts the train bar between whatever panels are open
function layoutBars() {
  const ed = $("editor"), rs = $("results"), tb = $("trainbar");
  const left = ed.classList.contains("min") ? 12 : ed.getBoundingClientRect().right + 12;
  const right = rs.classList.contains("min") ? 12 : window.innerWidth - rs.getBoundingClientRect().left + 12;
  if (tb.classList.contains("min")) { tb.style.left = `${(left + window.innerWidth - right) / 2}px`; tb.style.right = "auto"; }
  else { tb.style.left = `${left}px`; tb.style.right = `${right}px`; tb.style.transform = ""; }
  view.request();
}
document.querySelectorAll(".panel").forEach((p) => {
  const btn = p.querySelector(".min-btn");
  const toggle = () => {
    const m = p.classList.toggle("min");
    btn.textContent = m ? "▢" : "–";
    btn.title = m ? "Restore" : "Minimize";
    layoutBars();
    if (!m) drawCharts();
  };
  btn.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
  p.querySelector(".panel-title").addEventListener("dblclick", toggle);
});

////////////////////////////// frontend sec. 11 //////////////////////////////
// 11. calculation window (the fx button)

// same order runner.py lists the modes in, so we can highlight the right table row
const MODE_ORDER = ["tension", "compression", "shear", "glue", "buckling in the middle flange", "buckling in the side flanges", "buckling in the webs", "shear buckling"];
// what the window is showing right now
const calc = { open: false, source: "env", x: 600, sec: "fos", mode: null, t: 0, seq: 0 };
// escapes text before it goes into innerHTML
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// where the governing failure happens, for the moving train or the parked one
function failX(source) {
  if (source === "pos") return pos && pos.x_fail != null ? pos.x_fail : pos ? pos.Mmax_x : 600;
  return result ? result.x_fail : 600;
}
// opens the window. o = { source: "env" | "pos", x, sec (which step to scroll to), mode (row to highlight) }
function openCalc(o = {}) {
  calc.source = o.source || calc.source;
  calc.x = Math.round(o.x != null ? o.x : failX(calc.source));
  calc.sec = o.sec || calc.sec;
  calc.mode = o.mode || null;
  const p = $("calc");
  p.hidden = false; p.classList.remove("min");
  p.querySelector(".min-btn").textContent = "–";
  calc.open = true;
  document.querySelectorAll("#calcSrc button").forEach((b) => b.classList.toggle("on", b.dataset.v === calc.source));
  $("calcX").value = calc.x;
  $("calcJump").value = calc.sec;
  loadCalc(true);
}
// asks runner.py for the "explain" breakdown at calc.x
async function loadCalc(scroll) {
  if (!calc.open) return;
  if (!lastValid) { $("calcBody").innerHTML = '<div class="empty" style="padding:10px">Fix the highlighted inputs first.</div>'; return; }
  const seq = ++calc.seq;
  const lc = baseRequest();
  $("calcIntro").textContent = "Calculating…";
  try {
    const d = await api({ ...lc, mode: "explain", source: calc.source, x: calc.x, x_lead: lead, step: Math.max(1, Math.round(Number($("step").value) || 1)) });
    if (seq !== calc.seq) return; // a newer request is on its way
    if (!d.ok) { $("calcIntro").textContent = ""; $("calcBody").innerHTML = `<div class="err" style="margin:8px">${esc(d.error)}</div>`; return; }
    renderCalc(d);
    if (scroll) jumpCalc(calc.sec);
  } catch (e) { $("calcIntro").textContent = `Could not reach the server: ${e.message}`; }
}
// turns runner.py's sections/steps/tables into html. all the maths lives in runner.py, this only lays it out
function renderCalc(d) {
  $("calcIntro").textContent = d.source === "pos"
    ? `Train parked with its lead wheel at ${fmt(lead, 0)} mm. Every number below comes from algorithm.py's own functions at x = ${fmt(d.x, 0)} mm.`
    : `Moving train: the program tries every train position and keeps the worst shear and moment at each x (the envelope). Every number below comes from algorithm.py's own functions at x = ${fmt(d.x, 0)} mm.`;
  const hlIdx = calc.mode ? MODE_ORDER.indexOf(calc.mode) : null;
  const table = (t, hl) => !t ? "" : `<div class="table-wrap"><table class="mono"><thead><tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${
    t.rows.map((r, i) => `<tr class="${i === hl ? "hl" : ""}">${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>${
    t.foot ? `<tfoot><tr>${t.foot.map((c) => `<td>${esc(c)}</td>`).join("")}</tr></tfoot>` : ""}</table></div>`;
  const steps = (st) => st.map((x) => `<div class="calc-step"><div class="lbl">${esc(x.label)}</div><div class="eq">
      <div class="frm">${esc(x.formula)}</div>
      ${x.sub ? `<div class="sub">= ${esc(x.sub)}</div>` : ""}
      ${x.value !== "" && x.value != null ? `<div class="val">= ${esc(x.value)} ${esc(x.unit)}</div>` : ""}</div>
      ${x.note ? `<div class="note">${esc(x.note)}</div>` : ""}</div>`).join("");
  $("calcBody").innerHTML = d.sections.map((sec) => {
    const hl = sec.id === "fos" ? (hlIdx != null && hlIdx >= 0 ? hlIdx : sec.highlight) : null;
    const tableFirst = ["centroid", "I", "fos"].includes(sec.id);
    const body = tableFirst ? table(sec.table, hl) + steps(sec.steps || []) : steps(sec.steps || []) + table(sec.table, hl);
    return `<section class="calc-sec" id="calc-${sec.id}"><h4>${esc(sec.title)}</h4>${body}</section>`;
  }).join("");
}
// scrolls the window to a step and flashes it
function jumpCalc(id) {
  const el = $(`calc-${id}`); if (!el) return;
  const body = $("calc").querySelector(".panel-body");
  body.scrollTop = el.offsetTop - body.querySelector(".calc-controls").offsetHeight - 6;
  el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 900);
}
// lets a floating window be dragged around by its title bar
function makeDraggable(p, h) {
  let d = null;
  h.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    const r = p.getBoundingClientRect();
    d = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    h.setPointerCapture(e.pointerId);
  });
  h.addEventListener("pointermove", (e) => {
    if (!d) return;
    p.style.left = `${Math.max(0, Math.min(window.innerWidth - 120, e.clientX - d.dx))}px`;
    p.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, e.clientY - d.dy))}px`;
  });
  h.addEventListener("pointerup", () => (d = null));
}
makeDraggable($("calc"), $("calcHead"));
document.querySelectorAll(".calc-open").forEach((b) => b.addEventListener("click", (e) => {
  e.stopPropagation();
  const at = b.dataset.at;
  const x = b.dataset.x != null ? Number(b.dataset.x) : at === "posfail" ? failX("pos") : failX(b.dataset.src);
  openCalc({ source: b.dataset.src, x, sec: b.dataset.sec });
}));
$("calcIcon").onclick = () => openCalc({ source: "env", x: failX("env"), sec: "fos" });
$("calcClose").onclick = () => { $("calc").hidden = true; calc.open = false; };
segWireCalc();
// envelope / parked train toggle in the window
function segWireCalc() {
  document.querySelectorAll("#calcSrc button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#calcSrc button").forEach((x) => x.classList.toggle("on", x === b));
    calc.source = b.dataset.v; calc.mode = null; loadCalc();
  }));
}
$("calcX").addEventListener("change", (e) => { calc.x = Math.max(0, Math.min(L, Math.round(Number(e.target.value) || 0))); e.target.value = calc.x; calc.mode = null; loadCalc(); });
$("calcFailBtn").onclick = () => { calc.x = Math.round(failX(calc.source)); $("calcX").value = calc.x; calc.mode = null; loadCalc().then(() => jumpCalc("fos")); };
$("calcJump").addEventListener("change", (e) => { calc.sec = e.target.value; jumpCalc(calc.sec); });


////////////////////////////// frontend sec. 12 //////////////////////////////
// 12. 2d cross-section editor
// draws the selected row to scale and lets you drag its edges. every edit goes straight into S.rows,
// so the table, 3d view and live results all follow along
const sec = { open: false, seq: 0, props: null, propsFor: "", drag: null, hover: null, t: 0, view: null, pendingRefresh: false };

// opens the editor on row i
function openSecEd(i) {
  if (i != null) select(i);
  const p = $("secEd");
  p.hidden = false; p.classList.remove("min");
  p.querySelector(".min-btn").textContent = "–";
  sec.open = true;
  secSync();
}

// the 11-column simulator row that belongs to this table row (the one exactly at its position)
function simRowFor(r) {
  const rows = convert().filter((q) => q[0] === r4(r.xc));
  return rows[rows.length - 1];
}

// refills the side panel + redraws, called whenever the table or selection changes
function secSync() {
  if (!sec.open) return;
  const r = S.rows[sel];
  if (!r) return;
  $("secRow").innerHTML = S.rows.map((q, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>Row ${i + 1} · ${q.xc} mm</option>`).join("");
  for (const inp of document.querySelectorAll("#secEd input[data-k]")) {
    if (document.activeElement !== inp) inp.value = isFinite(r[inp.dataset.k]) ? r4(r[inp.dataset.k]) : "";
  }
  document.querySelectorAll("#secEd .stepper").forEach((st) => {
    const k = st.dataset.k;
    st.querySelector("output").textContent = k === "glue" ? S.glue : r[k];
  });
  // only this row's problems
  const v = validate(), mine = v.errs.filter((e) => e.startsWith(`Row ${sel + 1}:`));
  $("secErrs").innerHTML = mine.map((e) => `<div class="err">${esc(e)}</div>`).join("");
  drawSec();
  if (!mine.length && lastValid) {
    clearTimeout(sec.t);
    sec.t = setTimeout(fetchSecProps, 120);
  } else { sec.props = null; showSecProps(); }
}

// asks runner.py for ybar, I, Q and the buckling capacities of just this section
async function fetchSecProps() {
  const r = S.rows[sel]; if (!r || !lastValid) return;
  const row = simRowFor(r); if (!row) return;
  const key = row.join(",");
  const seq = ++sec.seq;
  try {
    const d = await api({ mode: "section", row });
    if (seq !== sec.seq) return; // an older answer, a newer one is on the way
    sec.props = d.ok ? d : null; sec.propsFor = key;
    showSecProps(d.ok ? null : d.error);
    drawSec();
  } catch { /* server down, the main panel already says so */ }
}

// the properties list on the right
function showSecProps(err) {
  const p = sec.props;
  if (!p) { $("secProps").innerHTML = `<span class="sub">${esc(err || "—")}</span><span></span>`; return; }
  const row = (a, b) => `<span>${a}</span><span>${b}</span>`;
  $("secProps").innerHTML =
    row("Area A", `${fmt(p.area, 1)} mm²`) + row("Centroid ȳ (from bottom)", `${fmt(p.ybar, 2)} mm`) +
    row("I", `${fmt(p.I, 0)} mm⁴`) + row("Q at centroid", `${fmt(p.Qcent, 0)} mm³`) + row("Q at glue line", `${fmt(p.Qglue, 0)} mm³`) +
    row('<span class="sub">σ buckling · flange mid</span>', `${fmt(p.S_buck1, 3)} MPa`) +
    row('<span class="sub">σ buckling · flange tips</span>', `${fmt(p.S_buck2, 3)} MPa`) +
    row('<span class="sub">σ buckling · webs</span>', `${fmt(p.S_buck3, 3)} MPa`) +
    row('<span class="sub">τ shear buckling</span>', `${fmt(p.T_buck, 3)} MPa`) +
    (p.top_heavy ? row('<span style="color:#e0675d">centroid is inside the top flange</span>', "") : "");
}

// section geometry in mm, y measured up from the bottom of the section
function secGeom(r) {
  const tft = r.nt * LAYER, tfb = r.nb * LAYER, tw = r.nw * LAYER, tg = S.glue * LAYER, H = r.H, hw = H - tft - tfb;
  return { tft, tfb, tw, tg, H, hw, bft: r.bft, bfb: r.bfb, bg: r.bg };
}

// draws the section to scale with dimensions, the centroid line and the drag handles
function drawSec() {
  if (!sec.open) return;
  const cv = $("secCanvas"), r = S.rows[sel];
  if (!cv.clientWidth || !r) return;
  const { g, w, h } = setupCanvas(cv);
  const G = secGeom(r);
  if (![G.H, G.bft, G.bfb, G.bg].every((v) => isFinite(v) && v > 0)) { g.fillStyle = "#888"; g.fillText("Enter positive dimensions to draw the section", 16, 24); return; }
  // freeze the scale while dragging, otherwise the drawing moves under the mouse
  const view = sec.drag ? sec.view : (() => {
    const wide = Math.max(G.bft, G.bfb), k = Math.min((w - 200) / wide, (h - 120) / G.H);
    return { k, cx: w / 2, y0: 56 };
  })();
  sec.view = view;
  const { k, cx, y0 } = view;
  const PX = (z) => cx + z * k, PY = (y) => y0 + (G.H - y) * k; // mm -> pixels. deck top is always at y0
  // faint 10 mm grid
  g.strokeStyle = "rgba(255,255,255,.05)"; g.lineWidth = 1;
  for (let z = -300; z <= 300; z += 10) { g.beginPath(); g.moveTo(PX(z), 0); g.lineTo(PX(z), h); g.stroke(); }
  for (let y = -50; y <= 400; y += 10) { g.beginPath(); g.moveTo(0, PY(y)); g.lineTo(w, PY(y)); g.stroke(); }
  // the pieces
  const rect = (z0, z1, ya, yb, fill, layers) => {
    if (!(z1 > z0 && yb > ya)) return;
    g.fillStyle = fill; g.fillRect(PX(z0), PY(yb), (z1 - z0) * k, (yb - ya) * k);
    g.strokeStyle = "#2a2a2a"; g.lineWidth = 1; g.strokeRect(PX(z0), PY(yb), (z1 - z0) * k, (yb - ya) * k);
    if (layers > 1) { // show each 1.27 mm layer
      g.strokeStyle = "rgba(0,0,0,.25)";
      for (let n = 1; n < layers; n++) { const yy = ya + ((yb - ya) * n) / layers; g.beginPath(); g.moveTo(PX(z0), PY(yy)); g.lineTo(PX(z1), PY(yy)); g.stroke(); }
    }
  };
  const paper = "#e8e2d4", glue = "#e8952f", hb = G.bfb / 2;
  rect(-hb, hb, 0, G.tfb, paper, r.nb);
  rect(-hb, -hb + G.tw, G.tfb, G.tfb + G.hw, paper);
  rect(hb - G.tw, hb, G.tfb, G.tfb + G.hw, paper);
  rect(-hb + G.tw, -hb + G.tw + G.bg, G.H - G.tft - G.tg, G.H - G.tft, glue);
  rect(hb - G.tw - G.bg, hb - G.tw, G.H - G.tft - G.tg, G.H - G.tft, glue);
  rect(-G.bft / 2, G.bft / 2, G.H - G.tft, G.H, paper, r.nt);
  // centroid from the backend (only if it was computed for exactly this shape)
  const row = lastValid ? simRowFor(r) : null;
  if (sec.props && row && sec.propsFor === row.join(",")) {
    const yc = PY(sec.props.ybar);
    g.setLineDash([6, 4]); g.strokeStyle = "#e0675d"; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(PX(-Math.max(G.bft, G.bfb) / 2 - 30), yc); g.lineTo(PX(Math.max(G.bft, G.bfb) / 2 + 30), yc); g.stroke(); g.setLineDash([]);
    label(g, Math.max(8, PX(-Math.max(G.bft, G.bfb) / 2 - 30)), yc - 5, `ȳ = ${fmt(sec.props.ybar, 2)} mm`, "#e0675d", "left");
  }
  // dimensions
  dim(g, PX(-G.bft / 2), PY(G.H) - 18, PX(G.bft / 2), PY(G.H) - 18, `${fmt(G.bft, 1)} mm`);
  dim(g, PX(-hb), PY(0) + 22, PX(hb), PY(0) + 22, `${fmt(G.bfb, 1)} mm`);
  const xr = PX(Math.max(G.bft / 2, hb)) + 26;
  dim(g, xr, PY(G.H), xr, PY(0), `${fmt(G.H, 2)} mm`, true);
  label(g, PX(hb - G.tw - G.bg / 2), PY(G.H - G.tft - G.tg) + 14, `tab ${fmt(G.bg, 1)}`, "#e8952f", "center");
  label(g, PX(G.bft / 2) + 6, PY(G.H - G.tft / 2) + 4, `${r.nt}×1.27`, "#aaa", "left");
  label(g, PX(hb) + 6, PY(G.tfb / 2) + 4, `${r.nb}×1.27`, "#aaa", "left");
  label(g, PX(hb - G.tw) - 6, PY(G.tfb + G.hw / 2), `web ${r.nw}×1.27`, "#aaa", "right");
  // drag handles
  sec.handles = [
    { k: "bft", x: PX(G.bft / 2), y: PY(G.H - G.tft / 2), axis: "x", tip: "top flange width" },
    { k: "bfb", x: PX(hb), y: PY(G.tfb / 2), axis: "x", tip: "bottom width" },
    { k: "H", x: PX(0), y: PY(0), axis: "y", tip: "total height (deck stays put, bottom moves)" },
    { k: "bg", x: PX(hb - G.tw - G.bg), y: PY(G.H - G.tft - G.tg / 2), axis: "x", tip: "glue tab width" },
  ];
  for (const hd of sec.handles) {
    const on = sec.hover === hd.k || (sec.drag && sec.drag.k === hd.k);
    g.fillStyle = on ? "#ffd27a" : "#e8952f"; g.strokeStyle = "#1a1a1a"; g.lineWidth = 1.5;
    g.beginPath(); g.rect(hd.x - 5, hd.y - 5, 10, 10); g.fill(); g.stroke();
    if (on) label(g, hd.x + 10, hd.y - 10, hd.tip, "#ffd27a", "left");
  }
  g.fillStyle = "#777"; g.font = "11px Segoe UI, sans-serif"; g.textAlign = "left";
  g.fillText(`Row ${sel + 1} · x = ${r.xc} mm · to scale`, 10, h - 10);
}

// small helpers for the 2d drawing
// text label
function label(g, x, y, text, color, align) {
  g.font = "11px Segoe UI, sans-serif"; g.fillStyle = color; g.textAlign = align || "left";
  g.fillText(text, x, y); g.textAlign = "left";
}
// dimension line with end ticks and the number in the middle
function dim(g, x1, y1, x2, y2, text, vertical) {
  g.strokeStyle = "#9cc3f0"; g.fillStyle = "#9cc3f0"; g.lineWidth = 1;
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  const tick = (x, y) => { g.beginPath(); vertical ? (g.moveTo(x - 5, y), g.lineTo(x + 5, y)) : (g.moveTo(x, y - 5), g.lineTo(x, y + 5)); g.stroke(); };
  tick(x1, y1); tick(x2, y2);
  g.font = "11px Segoe UI, sans-serif";
  if (vertical) { g.save(); g.translate(x1 + 14, (y1 + y2) / 2); g.rotate(-Math.PI / 2); g.textAlign = "center"; g.fillText(text, 0, 0); g.restore(); }
  else { g.textAlign = "center"; g.fillText(text, (x1 + x2) / 2, y1 - 5); g.textAlign = "left"; }
}

// mouse: hover finds a handle, dragging changes that one dimension
(() => {
  const cv = $("secCanvas");
  const at = (e) => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    return (sec.handles || []).find((hd) => Math.abs(hd.x - x) <= 8 && Math.abs(hd.y - y) <= 8);
  };
  cv.addEventListener("pointerdown", (e) => {
    const hd = at(e); if (!hd) return;
    sec.drag = { k: hd.k };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener("pointermove", (e) => {
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    if (!sec.drag) {
      const hd = at(e);
      const k = hd ? hd.k : null;
      cv.style.cursor = hd ? (hd.axis === "x" ? "ew-resize" : "ns-resize") : "default";
      if (k !== sec.hover) { sec.hover = k; drawSec(); }
      return;
    }
    const { k: sc, cx, y0 } = sec.view, row = S.rows[sel], G = secGeom(row);
    const snap = (v) => (e.shiftKey ? Math.round(v * 10) / 10 : Math.round(v));
    const z = Math.abs((mx - cx) / sc);
    let v;
    if (sec.drag.k === "bft") v = Math.max(10, snap(2 * z));
    if (sec.drag.k === "bfb") v = Math.max(10, snap(2 * z));
    if (sec.drag.k === "bg") v = Math.max(0.5, snap(G.bfb / 2 - G.tw - z));
    if (sec.drag.k === "H") v = Math.max(5, snap((my - y0) / sc));
    if (v === row[sec.drag.k]) return;
    row[sec.drag.k] = v;
    // one refresh per frame is plenty while dragging
    if (!sec.pendingRefresh) { sec.pendingRefresh = true; requestAnimationFrame(() => { sec.pendingRefresh = false; refresh(); }); }
  });
  const up = () => { if (sec.drag) { sec.drag = null; drawSec(); } };
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);
  new ResizeObserver(() => drawSec()).observe(cv.parentElement);
})();

// side panel inputs
document.querySelectorAll("#secEd input[data-k]").forEach((inp) => inp.addEventListener("input", () => {
  S.rows[sel][inp.dataset.k] = inp.value === "" ? NaN : Number(inp.value);
  refresh();
}));
document.querySelectorAll("#secEd .stepper button").forEach((b) => b.addEventListener("click", () => {
  const k = b.closest(".stepper").dataset.k, d = Number(b.dataset.d);
  if (k === "glue") { S.glue = Math.max(1, (S.glue || 1) + d); $("glueLayers").value = S.glue; }
  else S.rows[sel][k] = Math.max(1, (S.rows[sel][k] || 1) + d);
  refresh();
}));
$("secRow").addEventListener("change", (e) => select(Number(e.target.value)));
$("secEdBtn").onclick = () => openSecEd(sel);
$("secEdClose").onclick = () => { $("secEd").hidden = true; sec.open = false; };
makeDraggable($("secEd"), $("secEdHead"));

////////////////////////////// frontend sec. 13 //////////////////////////////
// 13. importing a csv (replaces the rows in the table)
//
// two layouts work:
//   table layout      xc, H, bft, bfb, nt, nb, nw, bg   (same columns as the editor table)
//                     plus optional "# diaphragms: 0 400 800 1200" and "# glue_layers: 1" lines
//   simulator layout  the 11 columns "Download CSV" gives you (xc,bft,tft,bfb,tfb,hw,tw,bg,tg,sw,a).
//                     thicknesses get turned back into layer counts and the diaphragms are rebuilt from a
// the header row is optional. without one, 8 columns = table layout and 11 = simulator layout

let undoImport = null; // the design from before the last import, for the undo button

// header names people might actually type -> our field names
const IMPORT_ALIASES = {
  xc: ["xc", "x", "position", "pos"],
  H: ["h", "height", "totalheight"],
  bft: ["bft", "topwidth", "topflangewidth", "deckwidth"],
  bfb: ["bfb", "bottomwidth", "bottomflangewidth"],
  nt: ["nt", "toplayers", "topflangelayers"],
  nb: ["nb", "bottomlayers", "bottomflangelayers"],
  nw: ["nw", "weblayers"],
  bg: ["bg", "gluetabwidth", "gluetab", "tabwidth"],
};
const SIM_COLS = ["xc", "bft", "tft", "bfb", "tfb", "hw", "tw", "bg", "tg", "sw", "a"];
// "Top flange width (mm)" -> "topflangewidth"
const squash = (t) => t.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z]/g, "");

// turns the file's text into { rows, dias, glue, layout, warnings }. throws an Error with a readable
// message (and the line number) if something can't be used
function parseBridgeCsv(text) {
  let dias = null, glue = null;
  const lines = [];
  text.replace(/^﻿/, "").split(/\r?\n/).forEach((raw, i) => {
    const t = raw.trim();
    if (!t) return;
    // "# diaphragms: ..." and "# glue_layers: ..." settings, any other # line is just a comment
    if (t.startsWith("#")) {
      const m = t.slice(1).match(/^\s*([a-z _]+)\s*[:=]\s*(.*)$/i);
      if (m && squash(m[1]).startsWith("diaphragm")) dias = m[2].split(/[\s,;]+/).filter(Boolean).map((v) => num(v, i + 1, "diaphragm"));
      if (m && squash(m[1]).startsWith("gluelayer")) glue = num(m[2].trim(), i + 1, "glue layers");
      return;
    }
    lines.push({ n: i + 1, cells: t.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, "")) });
  });
  if (!lines.length) throw new Error("The file has no rows in it.");

  // header row? (any cell that isn't a number)
  let header = null;
  if (lines[0].cells.some((c) => c !== "" && !isFinite(Number(c)))) header = lines.shift();
  if (lines.length < 2) throw new Error("A design needs at least 2 rows (one at 0 mm and one at 1200 mm).");

  // work out which column is which
  let layout, idx = {};
  if (header) {
    const names = header.cells.map(squash);
    if (SIM_COLS.every((c) => names.includes(c))) { layout = "sim"; SIM_COLS.forEach((c) => (idx[c] = names.indexOf(c))); }
    else {
      layout = "table";
      for (const [k, al] of Object.entries(IMPORT_ALIASES)) {
        idx[k] = names.findIndex((nm) => al.includes(nm));
        if (idx[k] < 0) throw new Error(`Line ${header.n}: couldn't find a column for ${NAMES[k].toLowerCase()} (expected one of: ${al.join(", ")}).`);
      }
    }
  } else {
    const w = lines[0].cells.length;
    if (w === 11) { layout = "sim"; SIM_COLS.forEach((c, i) => (idx[c] = i)); }
    else if (w === 8) { layout = "table"; FIELDS.forEach((f, i) => (idx[f.k] = i)); }
    else throw new Error(`Line ${lines[0].n} has ${w} columns. Use 8 (xc, H, bft, bfb, nt, nb, nw, bg) or the 11 simulator columns, or add a header row.`);
  }
  const val = (ln, k) => num(ln.cells[idx[k]], ln.n, k);

  const warnings = [];
  let rows;
  if (layout === "table") {
    rows = lines.map((ln) => Object.fromEntries(FIELDS.map((f) => [f.k, val(ln, f.k)])));
  } else {
    // simulator layout: thickness -> layers, and they have to come out whole
    const layers = (v, ln, k) => {
      const n = Math.round(v / LAYER);
      if (n < 1 || Math.abs(n * LAYER - v) > 0.005) throw new Error(`Line ${ln.n}: ${k} = ${v} mm isn't a whole number of 1.27 mm layers.`);
      return n;
    };
    const sim = lines.map((ln) => Object.fromEntries(SIM_COLS.map((c) => [c, val(ln, c)])));
    rows = sim.map((r, i) => {
      const ln = lines[i], tw = r.tw;
      if (Math.abs(r.sw - (r.bfb - tw)) > 0.01) warnings.push(`Line ${ln.n}: sw = ${r.sw} isn't bottom width − web thickness (${r4(r.bfb - tw)}). The editor always works sw out itself, so this one was ignored.`);
      return { xc: r.xc, H: r4(r.tft + r.tfb + r.hw), bft: r.bft, bfb: r.bfb, nt: layers(r.tft, ln, "tft"), nb: layers(r.tfb, ln, "tfb"), nw: layers(r.tw, ln, "tw"), bg: r.bg };
    });
    // glue tab layers are one setting for the whole bridge
    const g = sim.map((r, i) => layers(r.tg, lines[i], "tg"));
    if (new Set(g).size > 1) throw new Error(`Glue tab thickness changes along the bridge (${[...new Set(g)].map((n) => r4(n * LAYER)).join(", ")} mm). The editor only has one glue tab layer count for the whole bridge.`);
    if (glue == null) glue = g[0];
    // rebuild the diaphragms by walking along the span: each one is "a" further than the last
    if (dias == null) {
      const aAt = (p) => { let a = sim[0].a; for (const r of sim) if (r.xc <= p) a = r.a; return a; };
      const ds = [0];
      while (ds[ds.length - 1] < L - 1e-6 && ds.length < 500) ds.push(r4(ds[ds.length - 1] + aAt(ds[ds.length - 1])));
      if (Math.abs(ds[ds.length - 1] - L) < 1e-3) { ds[ds.length - 1] = L; dias = ds; }
      else warnings.push("Couldn't work out the diaphragm positions from the a column, so the current diaphragms were kept.");
    }
    // drop the "1 mm before a change" rows that the export adds, the editor puts them back by itself
    rows = rows.filter((r, i) => i === 0 || i === rows.length - 1 || !(rows[i + 1].xc - r.xc <= 1 + 1e-9));
    // the export also adds a row everywhere the diaphragm spacing changes. if a row has the same layers as
    // the one before and its height/widths sit on the straight line between its neighbours, the table
    // doesn't need it, so take it out (the analysis comes out exactly the same either way)
    const onLine = (a, m, b, k) => Math.abs(a[k] + ((b[k] - a[k]) * (m.xc - a.xc)) / (b.xc - a.xc) - m[k]) < 0.005;
    for (let i = 1; i < rows.length - 1; ) {
      const a = rows[i - 1], m = rows[i], b = rows[i + 1];
      const spare = a.nt === m.nt && a.nb === m.nb && a.nw === m.nw && ["H", "bft", "bfb", "bg"].every((k) => onLine(a, m, b, k));
      if (spare) rows.splice(i, 1); else i++;
    }
  }

  // the first and last positions are locked in the table, so they have to be right in the file
  if (rows[0].xc !== 0) throw new Error(`The first row has to be at 0 mm (the file's first row is at ${rows[0].xc} mm).`);
  if (rows[rows.length - 1].xc !== L) throw new Error(`The last row has to be at ${L} mm (the file's last row is at ${rows[rows.length - 1].xc} mm).`);
  if (dias && (!dias.includes(0) || !dias.includes(L))) throw new Error(`The diaphragm list has to include 0 and ${L} mm.`);
  return { rows, dias, glue, layout, warnings };
}

// "12.5" -> 12.5, anything else -> an error that says where
function num(c, line, what) {
  const v = Number(c);
  if (c === undefined || c === "" || !isFinite(v)) throw new Error(`Line ${line}: ${what} "${c ?? ""}" isn't a number.`);
  return v;
}

// reads the file and swaps the table over. the old design is kept so undo can bring it back
function importCsvFile(file) {
  if (!file) return;
  const rd = new FileReader();
  rd.onload = () => {
    let got;
    try { got = parseBridgeCsv(String(rd.result)); }
    catch (e) { return showImportNote(`Couldn't import ${esc(file.name)}: ${esc(e.message)}`, "bad"); }
    undoImport = JSON.stringify(S);
    S = { rows: got.rows, dias: got.dias ? [...got.dias].sort((a, b) => a - b) : S.dias, glue: got.glue ?? S.glue };
    sel = 0;
    $("glueLayers").value = S.glue;
    renderDias();
    refresh();
    const what = got.layout === "sim" ? "simulator columns" : "table columns";
    showImportNote(`Imported ${got.rows.length} rows from ${esc(file.name)} (${what})` +
      (got.dias ? `, diaphragms at ${got.dias.join(", ")} mm` : "") + ". " +
      `<button class="btn ghost small" id="undoImportBtn">Undo</button>` +
      got.warnings.map((w) => `<div class="warn-line">! ${esc(w)}</div>`).join(""), "good");
    $("undoImportBtn").onclick = () => {
      if (!undoImport) return;
      S = JSON.parse(undoImport); undoImport = null; sel = 0;
      $("glueLayers").value = S.glue;
      renderDias(); refresh();
      showImportNote("Import undone.", "");
    };
  };
  rd.onerror = () => showImportNote(`Couldn't read ${esc(file.name)}.`, "bad");
  rd.readAsText(file);
}

// the little message under the import button (html is built by us, file names are escaped)
function showImportNote(html, kind) {
  const el = $("importNote");
  el.className = "import-note " + (kind || "");
  el.innerHTML = html;
  el.hidden = false;
}

$("importBtn").onclick = () => $("csvFile").click();
$("csvFile").addEventListener("change", (e) => { importCsvFile(e.target.files[0]); e.target.value = ""; }); // reset so the same file can be picked again
// dropping a .csv anywhere on the editor panel works too
$("editor").addEventListener("dragover", (e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); $("editor").classList.add("file-over"); } });
$("editor").addEventListener("dragleave", (e) => { if (!$("editor").contains(e.relatedTarget)) $("editor").classList.remove("file-over"); });
$("editor").addEventListener("drop", (e) => {
  $("editor").classList.remove("file-over");
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  importCsvFile(e.dataTransfer.files[0]);
});

////////////////////////////// frontend sec. 14 //////////////////////////////
// 14. wiring up the buttons, then start
document.querySelectorAll(".group h3").forEach((h) => h.addEventListener("click", () => {
  const s = h.parentElement, open = s.dataset.open !== "1";
  s.dataset.open = open ? "1" : "0";
  h.querySelector(".caret").textContent = open ? "▼" : "▶";
  if (open) drawCharts();
}));
// little helper for the segmented buttons: lights up the clicked one and calls fn with its value
const segWire = (id, fn) => document.querySelectorAll(`#${id} button`).forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(`#${id} button`).forEach((x) => x.classList.toggle("on", x === b));
  fn(b.dataset.v || b.dataset.view);
}));
segWire("viewSeg", (v) => view.setView(v));
segWire("locoSeg", (v) => { loco = v === "1"; requestPosition(); scheduleRun(); });
segWire("heatSeg", (v) => { heatMode = v; pushScene(); });
$("addRowBtn").onclick = addRow;
$("diaAddBtn").onclick = addDia;
$("diaInput").addEventListener("keydown", (e) => e.key === "Enter" && addDia());
$("diaEvenBtn").onclick = evenDias;
$("glueLayers").addEventListener("input", (e) => { S.glue = e.target.value === "" ? NaN : Number(e.target.value); refresh(false); });
$("loadCase").addEventListener("change", (e) => { $("freightRow").hidden = e.target.value !== "LC2_pass"; requestPosition(); scheduleRun(); });
$("freight").addEventListener("input", () => { requestPosition(); scheduleRun(); });
$("step").addEventListener("input", scheduleRun);
$("liveToggle").addEventListener("change", (e) => { if (e.target.checked && $("results").classList.contains("stale")) run(); else setStale($("results").classList.contains("stale")); });
$("runBtn").onclick = run;
$("runIcon").onclick = run;
$("csvBtn").onclick = downloadCsv;
$("resetBtn").onclick = () => { S = DESIGN0(); sel = 0; $("glueLayers").value = 1; renderDias(); refresh(); };
$("leadSlider").addEventListener("input", (e) => { if (playing) togglePlay(); setLead(e.target.value, true); });
$("leadInput").addEventListener("change", (e) => setLead(e.target.value));
$("playBtn").onclick = togglePlay;
$("centreBtn").onclick = () => setLead(L / 2 + TRAIN_SPAN / 2);
$("maxMBtn").onclick = () => (result ? setLead(result.worst_m_lead) : flash("Run a simulation first to find the worst positions."));
$("maxVBtn").onclick = () => (result ? setLead(result.worst_v_lead) : flash("Run a simulation first to find the worst positions."));
$("showForces").onchange = pushScene;
$("showTrain").onchange = pushScene;
$("xray").onchange = pushScene;
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run(); });
window.addEventListener("resize", () => { layoutBars(); drawCharts(); });

wireChartHover($("sfdChart"));
wireChartHover($("bmdChart"));
renderDias();
refresh();
booting = false;
clearResults();
layoutBars();
run();
