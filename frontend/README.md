# Bridge Simulator — Frontend

A small Node.js + HTML/CSS/JS UI for entering bridge designs and running them through `../algorithm.py`.
`algorithm.py` is **not modified**: `runner.py` imports it and calls its functions.

## Run

Requirements: Node.js 16+, Python 3 with `numpy` and `matplotlib` (the same things `algorithm.py` needs). No npm packages.

```bash
cd frontend
npm start            # or: node server.js
```

Open http://localhost:3000. Use `PORT=4000` to change the port, or `PYTHON=path/to/python` if Python isn't found
(on Windows it tries `python`, then `py`, then `python3`).

## How it works

- **You enter buildable values** per cross-section row: position, total height, top/bottom width, layer counts
  (top flange, bottom flange, webs), glue tab width. Globals: diaphragm positions and glue tab layers.
- **The frontend computes** the simulator's 11 columns `xc, bft, tft, bfb, tfb, hw, tw, bg, tg, sw, a`:
  thicknesses = layers × 1.27, `hw = height − tfb − tft`, `sw = bottom width − tw`, `a` = gap between the diaphragms
  either side. Layer counts and diaphragm spacing change as steps (an extra row 1 mm before each change), widths and
  height taper linearly. Open **Simulator rows** to see the table or download it as CSV.
- **Validation** runs on every edit and highlights the offending cells (positive sizes, top wider than bottom,
  height > flanges, glue tabs fit between webs, glue tab thinner than web height, positions 0 … 1200 increasing,
  diaphragms include 0 and 1200). The "centroid inside the top flange" check runs on the server.
- **Deck stays flat.** Total height hangs *down* from a level deck. The ends rest on the supports, so the deck sits
  at the end height above them. The *Handout checks* list flags §1.5 rules (deck height a multiple of 20 mm and
  under 200 mm, flat 60 mm bearings, bottom within 200 mm / 30° below the supports, deck ≥ 100 mm wide).
- **⇪ Import CSV** (or drop a .csv on the editor panel) replaces every row. Two layouts work:
  - the table's own columns, header optional: `xc, H, bft, bfb, nt, nb, nw, bg`
    (or names like `Position, Total height, Top flange width, ...`), plus optional lines
    `# diaphragms: 0, 400, 800, 1200` and `# glue_layers: 1`
  - the 11 columns from **Download CSV**. Thicknesses become layer counts again, the diaphragms are rebuilt
    from `a`, and the extra rows the export adds are removed, so export → import gives back the same table.

  Files that can't be built are rejected with the line number (e.g. a thickness that isn't a whole number of
  1.27 mm layers, or first/last rows not at 0 and 1200). **Undo** restores the table from before the import.
- **Reorder rows** by dragging the ⠿ handle on any middle row. Positions stay in increasing order; the section moves.
- **3D view:** drag to orbit, right-drag (or Shift-drag) to pan, scroll to zoom, double-click to reset.
  Built-in canvas renderer, no libraries or internet needed.
- **Train position:** slide or type the lead-wheel position (0 = front wheel on the left support, 2056 = last wheel
  leaving), or use Centre / Max M / Max V / ▶ play. Shows reactions, max |V| and M, and the FOS if the train
  stayed there. Wheel loads and reactions are drawn as arrows; the beam is coloured by demand ÷ capacity
  (for this position or the whole envelope). The orange curves on the charts are V(x) and M(x) for this position.
- **ƒx Calculation details** (buttons in the results panel, train bar, or click any failure mode): a movable,
  resizable window showing every formula with the numbers substituted in: train loads, reactions, V and M, the
  cross-section, ȳ, I, Q, stresses, capacities and the FOS for each mode at a chosen x, for either the moving-train
  envelope or the train at the slider position. All numbers come from `algorithm.py`'s functions.
- **Charts:** hover over the shear or moment chart to see every value at that x (envelope, train here, each
  capacity and its FOS). Click to pin the readout, click again to unpin.
- **X-ray front** (top toolbar): fades the web nearest the camera (and the deck when looking down) so the
  diaphragms show, each outlined and labelled with its position.
- **✎ Cross-section editor** (button under the table, or the pencil on any row): the section drawn to scale.
  Drag the orange handles for top width, bottom width, total height and glue tab width (Shift = 0.1 mm steps),
  use the steppers for layer counts, and read ȳ, I, Q and the buckling capacities straight from `algorithm.py`.
  Folded-down deck edges (in the README's parameter list) aren't in `algorithm.py` yet, so that part is written
  but commented out in `public/section-extras.js`, together with the backend changes it needs.
- **Panels** minimize with – (or double-click the title bar).
- `server.js` keeps one Python worker (`runner.py --serve`) alive and sends it the rows; the worker runs `train_loads → envelopes → sectional_properties →
  applied_stress → capacities → factors_of_safety → failure_load → failure_envelopes`.
  `P` is set to the selected train's total weight so the failure load matches the load case.

Check: Design 0 under Load Case 1 gives ȳ = 41.43 mm, I ≈ 418 352 mm⁴, failure ≈ 247 N by middle-flange buckling.
