// section-extras.js
//
// NOTE: NOT LOADED YET. index.html doesn't include this file on purpose.
//
// the README asks for a "folded-down deck edge length" parameter, but algorithm.py doesn't model it yet:
// sectional_properties() only knows the bottom flange, 2 webs, top flange and 2 glue tabs, and capacities()
// has no idea the deck tips are folded down. if we turned this on now the 3d view and the 2d editor would
// show lips that the numbers completely ignore, which is worse than not having it.
//
// so everything below is written out and commented. once the backend changes at the bottom are in,
// uncomment it, add <script src="section-extras.js"></script> after app.js in index.html, and add the
// "lip" column to the runner (see runner changes).
//
// what it adds:
//   1. a "Folded edge" stepper in the 2d section editor (mm, per row, 0 = no fold)
//   2. lips drawn hanging down from both deck tips in the 2d editor
//   3. a 12th column "lip" in the rows sent to the backend


// ---------------------------------------------------------------- 1. the input
//
// // every row gets a lip length, 0 means a flat deck like design 0
// S.rows.forEach((r) => { if (r.lip == null) r.lip = 0; });
//
// // extra field in the section editor side panel, right under "Glue tab width"
// (() => {
//   const field = document.createElement("div");
//   field.className = "field";
//   field.innerHTML = '<label>Folded deck edge</label><div class="xyz"><span class="chip z">lip</span>' +
//     '<input id="secLip" type="number" min="0" step="0.5" data-k="lip"></div>';
//   document.querySelector("#secBg").closest(".field").after(field);
//   $("secLip").addEventListener("input", (e) => {
//     S.rows[sel].lip = e.target.value === "" ? 0 : Math.max(0, Number(e.target.value));
//     refresh();
//   });
// })();
//
// // new rows should copy the lip too (addRow already spreads {...a} so nothing to do there)


// ---------------------------------------------------------------- 2. validation
//
// // a lip can't be longer than the gap between the deck and the bottom of the web,
// // and it has to stay outside the webs (it hangs off the overhang, not inside the box)
// const _validate = validate;
// validate = function () {
//   const v = _validate();
//   S.rows.forEach((r, i) => {
//     const tft = r.nt * LAYER, overhang = (r.bft - r.bfb) / 2;
//     if (r.lip < 0) { v.errs.push(`Row ${i + 1}: folded edge can't be negative.`); v.cells.add(`${i}:lip`); }
//     if (r.lip > r.H - tft) { v.errs.push(`Row ${i + 1}: folded edge (${r.lip} mm) is longer than the section is deep.`); v.cells.add(`${i}:lip`); }
//     if (r.lip > 0 && overhang < LAYER) { v.errs.push(`Row ${i + 1}: no overhang to fold down (top and bottom are the same width).`); v.cells.add(`${i}:lip`); }
//   });
//   return v;
// };


// ---------------------------------------------------------------- 3. conversion (12th column)
//
// // convert() makes rows of 11 numbers. tack the lip on the end, interpolated like the widths are
// const _convert = convert;
// convert = function () {
//   return _convert().map((row) => [...row, r4(lin(row[0], "lip"))]);
// };
// // COLS gets the new name so the csv download matches
// COLS.push("lip");


// ---------------------------------------------------------------- 4. drawing the lips in 2d
//
// const _drawSec = drawSec;
// drawSec = function () {
//   _drawSec();
//   const r = S.rows[sel]; if (!r || !(r.lip > 0) || !sec.view) return;
//   const g = $("secCanvas").getContext("2d"), G = secGeom(r), { k, cx, y0 } = sec.view;
//   const PX = (z) => cx + z * k, PY = (y) => y0 + (G.H - y) * k;
//   g.fillStyle = "#e8e2d4"; g.strokeStyle = "#2a2a2a";
//   for (const side of [-1, 1]) {
//     const zOut = side * G.bft / 2, zIn = zOut - side * G.tft;   // lip is one deck thickness wide
//     const x0 = PX(Math.min(zOut, zIn)), w = G.tft * k, top = PY(G.H - G.tft), h = r.lip * k;
//     g.fillRect(x0, top, w, h); g.strokeRect(x0, top, w, h);
//   }
// };


// ---------------------------------------------------------------- 5. what the backend needs (python)
//
// runner.py: section_arrays() expects 11 columns. change the check to accept 11 or 12 and pass the
// lip array through:
//
//     param = np.array(rows, dtype=float)
//     lip = np.interp(x, param[:, 0], param[:, 11]) if param.shape[1] > 11 else np.zeros_like(x)
//
// algorithm.py (whoever owns it): the two lips are just two more rectangles, so sec. 3 grows by one
// part, same pattern as the glue tabs:
//
//     # folded-down deck edges (lips). there are TWO of them, one at each tip
//     ybarlip = tfb + hw - lip / 2          # they hang down from the underside of the deck
//     Alip = tft * lip                      # one deck thickness wide
//     Ilip = tft * lip ** 3 / 12
//
//     ybar = (... + 2 * Alip * ybarlip) / (... + 2 * Alip)
//     I    = ... + 2 * (Ilip + Alip * (ybar - ybarlip) ** 2)
//     Qcent = ... + 2 * Alip * (ybarlip - ybar)     # lips sit above the centroid for any sane design
//
// sec. 5 (capacities): the flange tips are no longer free edges once they're folded, so case 2
// (0.425k) is too conservative. the usual move is to check the lip itself as a free-edge plate
// instead:
//
//     S_buck_lip = 0.425 * buck_const * (tft / lip) ** 2     # lip in compression, one edge free
//
// and treat the deck overhang as supported on both edges (k = 4) when lip > 0. double check this with
// the TA before trusting it, CIV102 only covers the 4 / 0.425 / 6 / 5 cases directly.
//
// sec. 6/7: add FOS_lip = S_buck_lip / S_top (with the stress at the bottom of the lip if we want to be
// picky) and a "buckling in the folded edges" entry in failure_load()'s dict.
