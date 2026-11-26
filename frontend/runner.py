# runner.py - the middle man between the website and algorithm.py
#
# algorithm.py gets imported as is, we DON'T change it. this file just calls its functions in the same order
# as the calculation procedure in the handout (sec 3.1) and packs the answers up as json for the page.
#
# two ways to run it:
#   python runner.py           one json request on stdin -> one json answer on stdout
#   python runner.py --serve   one request per line, one answer per line. server.js keeps this running
#                              so it doesn't have to import numpy/matplotlib again every time
#
# the "mode" in a request picks what we do:
#   "envelope" (default)  moving train -> envelopes, capacities, FOS, failure load (the results panel)
#   "position"            train parked at one spot -> reactions, V(x), M(x) and the FOS for just that spot
#   "explain"             every formula + number behind the answer at one x (the fx window)
#   "section"             properties of one cross-section (the 2d section editor)

############################## runner sec. 0 ##############################
# 0. setup
import json
import math
import os
import sys

os.environ.setdefault("MPLBACKEND", "Agg")  # algorithm.py imports pyplot, this stops it trying to open a window
# algorithm.py lives one folder up
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import numpy as np
import algorithm as alg

EVERY = 5  # only send every 5th point for the charts (1201 -> 241 points), plenty for a plot
# same names (and order) as the dict in failure_load()
MODE_NAMES = ["tension", "compression", "shear", "glue",
              "buckling in the middle flange", "buckling in the side flanges",
              "buckling in the webs", "shear buckling"]


############################## runner sec. 1 ##############################
# 1. helpers

# numpy stuff -> plain python json can handle. inf and nan turn into null (the page shows null as ∞)
def clean(v):
    if isinstance(v, np.ndarray):
        return [clean(float(t)) for t in v]
    if isinstance(v, (np.floating, float)):
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    if isinstance(v, np.integer):
        return int(v)
    return v


# same thing bridge_parameters() does, but with the rows from the page instead of the design 0 defaults
# rows are [xc, bft, tft, bfb, tfb, hw, tw, bg, tg, sw, a], same columns as param
def section_arrays(x, rows):
    param = np.array(rows, dtype=float)
    if param.ndim != 2 or param.shape[1] != 11:
        raise ValueError("expected rows of 11 columns")
    return [np.interp(x, param[:, 0], param[:, i + 1]) for i in range(10)]


############################## runner sec. 2 ##############################
# 2. stuff every mode needs

# train loads + section properties + capacities (sec. 1, 3 and 5 of algorithm.py)
def setup(req):
    x = alg.x
    load_case = req.get("load_case", "LC1")
    freight = req.get("freight_weight")
    loco_leading = bool(req.get("loco_leading", True))
    wo, wl = alg.train_loads(load_case, None if freight is None else float(freight), loco_leading)
    # note: failure_load() does minFOS * P using the global P (400), so for load case 2 we have to set it
    # to this train's actual weight or the failure load comes out wrong
    alg.P = float(np.sum(wl))

    bft, tft, bfb, tfb, hw, tw, bg, tg, sw, a = section_arrays(x, req["rows"])
    ybar, ybot, ytop, I, Qcent, Qglue = alg.sectional_properties(bft, tft, bfb, tfb, hw, tw, bg, tg)

    # web buckling divides by (ytop - tft), so if the centroid is up inside the top flange it blows up
    bad = np.where(ytop - tft <= 0)[0]
    if len(bad):
        return None, {"ok": False, "code": "top_heavy", "x": clean(x[bad[0]]),
                      "error": "This section is too top-heavy: the centroid is inside the top flange. "
                               "Reduce top flange layers or increase the height."}
    with np.errstate(divide="ignore", invalid="ignore"):
        caps = alg.capacities(bft, tft, tw, hw, sw, a, ytop)
    s = dict(x=x, wo=wo, wl=wl, tw=tw, tft=tft, bg=bg, ybar=ybar, ybot=ybot, ytop=ytop, I=I, Qcent=Qcent, Qglue=Qglue, caps=caps)
    return s, None


# FOS arrays (sec. 4 + 6) for a shear V(x) >= 0 and a moment M(x)
def fos_for(s, V, M):
    with np.errstate(divide="ignore", invalid="ignore"):
        stress = alg.applied_stress(V, M, s["ybot"], s["ytop"], s["I"], s["Qcent"], s["Qglue"], s["tw"], s["bg"], s["tft"])
        return alg.factors_of_safety(*stress, *s["caps"])


# how close to failing each x is: max over the 8 modes of 1/FOS. 1.0 = fails, used to colour the 3d beam
def utilization(fos):
    F = np.vstack([np.asarray(f, dtype=float) for f in fos])
    with np.errstate(divide="ignore", invalid="ignore"):
        u = np.where((F > 0) & np.isfinite(F), 1.0 / F, 0.0)
    return u.max(axis=0)


# smallest FOS of each mode, where it happens, and the train weight that would break it
def per_mode(fos, x):
    modes = []
    for name, f in zip(MODE_NAMES, fos):
        f = np.asarray(f, dtype=float)
        finite = np.where(np.isfinite(f) & (f > 0), f, np.inf)
        i = int(np.argmin(finite))
        modes.append({"name": name, "min_fos": clean(finite[i]), "x": clean(x[i]),
                      "p_fail": clean(finite[i] * alg.P)})
    return modes


############################## runner sec. 3 ##############################
# 3. moving train (the results panel)

# the full thing: train at every position -> envelopes -> FOS -> failure load. same as sec. 1-8 of algorithm.py
def run_envelope(req):
    s, err = setup(req)
    if err:
        return err
    x, wo, wl = s["x"], s["wo"], s["wl"]
    step = max(1, int(req.get("step", 1)))

    SFD, BMD, SFDi, BMDi = alg.envelopes(x, wo, wl, alg.L, step)
    fos = fos_for(s, SFD, BMD)
    with np.errstate(divide="ignore", invalid="ignore"):
        minFOS, Pf, weakest, x_fail = alg.failure_load(*fos)
        fenv = alg.failure_envelopes(*s["caps"], s["I"], s["ybot"], s["ytop"], s["Qcent"], s["Qglue"], s["tw"], s["bg"], s["tft"])

    env_names = ["Mf_tens", "Mf_comp", "Vf_shear", "Vf_glue", "Mf_buck1", "Mf_buck2", "Mf_buck3", "Vf_buckV"]
    envs = {n: clean(np.broadcast_to(np.asarray(e, dtype=float), x.shape)[::EVERY]) for n, e in zip(env_names, fenv)}

    # which lead-wheel position gave the worst M and the worst V (for the Max M / Max V buttons)
    # note: envelopes() walks x_lead = 0, step, 2*step, ... so index * step = position
    worst_m_lead = int(np.argmax(BMDi.max(axis=1))) * step
    worst_v_lead = int(np.argmax(np.abs(SFDi).max(axis=1))) * step

    pick = max(1, len(SFDi) // 20)  # ~20 of the individual train positions is enough grey lines on the chart
    mid = len(x) // 2
    return {
        "ok": True, "mode_kind": "envelope",
        "x": clean(x[::EVERY]),
        "train_total": alg.P,
        "wheel_offsets": clean(wo.astype(float)),
        "wheel_loads": clean(wl),
        "min_fos": clean(minFOS), "p_fail": clean(Pf), "mode": weakest, "x_fail": clean(x_fail),
        "modes": per_mode(fos, x),
        "SFD": clean(SFD[::EVERY]), "BMD": clean(BMD[::EVERY]),
        "SFDi": [clean(r[::EVERY]) for r in SFDi[::pick]],
        "BMDi": [clean(r[::EVERY]) for r in BMDi[::pick]],
        "env": envs,
        "util": clean(utilization(fos)[::EVERY]),
        "worst_m_lead": worst_m_lead, "worst_v_lead": worst_v_lead,
        "props": {"ybar_mid": clean(s["ybar"][mid]), "I_mid": clean(s["I"][mid]), "ytop_mid": clean(s["ytop"][mid])},
    }


############################## runner sec. 4 ##############################
# 4. parked train (the train bar)

# train stopped with its front wheel at x_lead: reactions, V(x), M(x), and the FOS for only this position
def run_position(req):
    s, err = setup(req)
    if err:
        return err
    x, wo, wl = s["x"], s["wo"], s["wl"]
    x_lead = float(req.get("x_lead", 0))
    pos = alg.wheel_positions(x_lead, wo)
    on = (pos >= 0) & (pos <= alg.L)
    RA, RB = alg.reactions(pos, wl, alg.L)
    V_right = alg.sfd(x, pos, wl, alg.L)
    V_left = alg.sfd(x - 1e-9, pos, wl, alg.L)
    M = alg.bmd(x, pos, wl, alg.L)
    Vabs = np.maximum(np.abs(V_right), np.abs(V_left))  # check just left and right of each wheel, like envelopes() does

    # note: wheel loads only push down so M can't really be negative on a simple span, but float noise gives
    # stuff like -1e-12 which turns into a massive negative FOS. clip it to 0
    fos = fos_for(s, Vabs, np.maximum(M, 0.0))
    result = {"ok": True, "mode_kind": "position", "x_lead": x_lead,
              "wheel_pos": clean(pos.astype(float)), "wheel_loads": clean(wl), "on": [bool(t) for t in on],
              "RA": clean(RA), "RB": clean(RB), "train_total": alg.P,
              "x": clean(x[::EVERY]), "V": clean(V_right[::EVERY]), "M": clean(M[::EVERY]),
              "Vmax": clean(Vabs.max()), "Vmax_x": clean(x[int(np.argmax(Vabs))]),
              "Mmax": clean(M.max()), "Mmax_x": clean(x[int(np.argmax(M))]),
              "util": clean(utilization(fos)[::EVERY])}
    if not on.any():
        result.update(min_fos=None, p_fail=None, mode=None, x_fail=None)
        return result
    with np.errstate(divide="ignore", invalid="ignore"):
        minFOS, Pf, weakest, x_fail = alg.failure_load(*fos)
    result.update(min_fos=clean(minFOS), p_fail=clean(Pf), mode=weakest, x_fail=clean(x_fail))
    return result


############################## runner sec. 5 ##############################
# 5. explain (the fx calculation window)

# number -> short readable string, picks decimals based on how big it is
def f(v, d=None):
    v = float(v)
    if not math.isfinite(v):
        return "∞"
    if d is None:
        a = abs(v)
        d = 0 if a >= 10000 else 1 if a >= 1000 else 2 if a >= 10 else 3 if a >= 0.1 else 5
    out = f"{v:,.{d}f}"
    return "0" if out in ("-0", "-0.0") or set(out) <= set("-0.,") else out


# one line in the window: name, formula, formula with numbers in it, answer
def step(label, formula, sub, value, unit="", note=None):
    return {"label": label, "formula": formula, "sub": sub, "value": value, "unit": unit, "note": note}


# reactions, V and M at x0 for one train position, written out step by step
# the numbers come from reactions() / sfd() / bmd(), the strings just show where they came from
def demand_steps(x0, x_lead, wo, wl, which):
    L = alg.L
    pos = alg.wheel_positions(x_lead, wo)
    on = (pos >= 0) & (pos <= L)
    RA, RB = alg.reactions(pos, wl, L)
    xs = np.array([x0, x0 - 1e-9])
    Vr, Vl = alg.sfd(xs, pos, wl, L)
    M = float(alg.bmd(np.array([x0]), pos, wl, L)[0])
    idx = [i for i in range(len(pos)) if on[i]]
    st = []
    st.append(step("Wheels on the span", "xᵢ = lead − offsetᵢ, kept if 0 ≤ xᵢ ≤ 1200",
                   ", ".join(f"{f(pos[i], 0)}" for i in idx) or "none", f"{len(idx)} of 6", "",
                   f"lead wheel at {f(x_lead, 0)} mm"))
    terms = " + ".join(f"{f(wl[i], 2)}×{f(pos[i], 0)}" for i in idx) or "0"
    st.append(step("Reaction R_B", "R_B = Σ Pᵢ·xᵢ / L   (moments about A)", f"({terms}) / {L}", f(RB, 2), "N"))
    st.append(step("Reaction R_A", "R_A = Σ Pᵢ − R_B   (vertical equilibrium)",
                   f"{f(sum(wl[i] for i in idx), 2)} − {f(RB, 2)}", f(RA, 2), "N"))
    if which in ("V", "both"):
        left = [i for i in idx if pos[i] <= x0]
        sub = f"{f(RA, 2)}" + "".join(f" − {f(wl[i], 2)}" for i in left)
        st.append(step(f"Shear V({f(x0, 0)}⁺)", "V(x) = R_A − Σ Pᵢ  for wheels with xᵢ ≤ x", sub, f(Vr, 2), "N"))
        if abs(Vr - Vl) > 1e-6:
            st.append(step(f"Shear V({f(x0, 0)}⁻)", "just left of x (a wheel sits exactly at x)", "", f(Vl, 2), "N"))
        st.append(step("|V| used", "|V| = max(|V(x⁺)|, |V(x⁻)|)", f"max({f(abs(Vr), 2)}, {f(abs(Vl), 2)})",
                       f(max(abs(Vr), abs(Vl)), 2), "N"))
    if which in ("M", "both"):
        left = [i for i in idx if pos[i] < x0]
        sub = f"{f(RA, 2)}×{f(x0, 0)}" + "".join(f" − {f(wl[i], 2)}×({f(x0, 0)} − {f(pos[i], 0)})" for i in left)
        st.append(step(f"Moment M({f(x0, 0)})", "M(x) = R_A·x − Σ Pᵢ·(x − xᵢ)  for wheels left of x", sub, f(M, 0), "N·mm"))
    return st, max(abs(Vr), abs(Vl)), max(M, 0.0)


# builds the whole breakdown at one x. every final number comes from algorithm.py's own functions,
# the tables (centroid, I) redo the same sums by hand so you can see the pieces add up
def run_explain(req):
    x0 = float(min(max(float(req.get("x", 600)), 0), alg.L))
    source = req.get("source", "env")
    load_case = req.get("load_case", "LC1")
    freight = req.get("freight_weight")
    loco_leading = bool(req.get("loco_leading", True))
    wo, wl = alg.train_loads(load_case, None if freight is None else float(freight), loco_leading)
    P = float(np.sum(wl))
    alg.P = P
    secs = []

    # 1. loads (sec. 1)
    names = ["loco", "loco", "freight 1", "freight 1", "freight 2", "freight 2"] if loco_leading else \
            ["freight 2", "freight 2", "freight 1", "freight 1", "loco", "loco"]
    secs.append({"id": "loads", "title": "1 · Train loads", "steps": [
        step("Axle loads", "train_loads(): weight of each car split over its 2 axles",
             ", ".join(f"{f(w, 2)}" for w in wl), "", "N", f"load case {load_case}; offsets from lead wheel: " + ", ".join(str(int(o)) for o in wo) + " mm"),
        step("Train weight P", "P = Σ Pᵢ", " + ".join(f(w, 2) for w in wl), f(P, 2), "N")],
        "table": {"head": ["Axle", "Car", "Offset (mm)", "Load (N)"],
                  "rows": [[str(i + 1), names[i], f(wo[i], 0), f(wl[i], 2)] for i in range(6)]}})

    # 2. demand at x
    if source == "pos":
        x_lead = float(req.get("x_lead", 0))
        st, V, M = demand_steps(x0, x_lead, wo, wl, "both")
        secs.append({"id": "demand", "title": f"2 · Shear and moment at x = {f(x0, 0)} mm (train parked)", "steps": st})
    else:
        # moving train: find which position gives the biggest |V| and M at this x, then show that position
        last = alg.L + int(max(wo))
        step_mm = max(1, int(req.get("step", 1)))
        xs = np.array([x0, x0 - 1e-9])
        bestV, bestM, leadV, leadM = -1.0, -np.inf, 0, 0
        for x_lead in range(0, last + 1, step_mm):   # same walk as algorithm.envelopes()
            pos = alg.wheel_positions(x_lead, wo)
            v = np.abs(alg.sfd(xs, pos, wl, alg.L)).max()
            m = alg.bmd(xs[:1], pos, wl, alg.L)[0]
            if v > bestV + 1e-12: bestV, leadV = v, x_lead
            if m > bestM + 1e-12: bestM, leadM = m, x_lead
        stV, V, _ = demand_steps(x0, leadV, wo, wl, "V")
        stM, _, M = demand_steps(x0, leadM, wo, wl, "M")
        head = [step("Envelope", "V_env(x) = max |V(x)|, M_env(x) = max M(x) over every lead position 0…" + str(last) + " mm",
                     f"largest |V| at x when lead = {leadV} mm; largest M when lead = {leadM} mm", "", "")]
        secs.append({"id": "demand", "title": f"2 · Shear and moment envelope at x = {f(x0, 0)} mm", "steps": head +
                     [dict(s_, label="[max V] " + s_["label"]) for s_ in stV] + [dict(s_, label="[max M] " + s_["label"]) for s_ in stM]})

    # 3. geometry at x (same interpolation as bridge_parameters)
    rows = np.array(req["rows"], dtype=float)
    g = {k: float(np.interp(x0, rows[:, 0], rows[:, i + 1])) for i, k in enumerate(["bft", "tft", "bfb", "tfb", "hw", "tw", "bg", "tg", "sw", "a"])}
    bft, tft, bfb, tfb, hw, tw, bg, tg, sw, a = (g[k] for k in ["bft", "tft", "bfb", "tfb", "hw", "tw", "bg", "tg", "sw", "a"])
    desc = {"bft": "top flange width", "tft": "top flange thickness", "bfb": "bottom flange width", "tfb": "bottom flange thickness",
            "hw": "web height (between flanges)", "tw": "web thickness", "bg": "glue tab width", "tg": "glue tab thickness",
            "sw": "web spacing, centre to centre", "a": "diaphragm spacing"}
    secs.append({"id": "geometry", "title": f"3 · Cross-section at x = {f(x0, 0)} mm",
                 "steps": [step("Interpolation", "np.interp(x, xc, column) on the simulator rows (as bridge_parameters does)", "", "", "")],
                 "table": {"head": ["Symbol", "Meaning", "Value (mm)"], "rows": [[k, desc[k], f(g[k], 3)] for k in desc]}})

    # 4-6. section properties. the totals are from sectional_properties(), the tables show the pieces
    ybar, ybot, ytop, I, Qcent, Qglue = (float(v) for v in alg.sectional_properties(*(np.float64(t) for t in (bft, tft, bfb, tfb, hw, tw, bg, tg))))
    comps = [("Bottom flange", 1, bfb, tfb, tfb / 2), ("Webs", 2, tw, hw, tfb + hw / 2),
             ("Top flange", 1, bft, tft, tfb + hw + tft / 2), ("Glue tabs", 2, bg, tg, tfb + hw - tg / 2)]
    sumA = sum(n * b * h for _, n, b, h, _ in comps)
    sumAy = sum(n * b * h * y for _, n, b, h, y in comps)
    secs.append({"id": "centroid", "title": "4 · Centroid ȳ (from the bottom)",
                 "table": {"head": ["Part", "n", "b", "h", "A = n·b·h", "y", "A·y"],
                           "rows": [[nm, str(n), f(b, 2), f(h, 2), f(n * b * h, 2), f(y, 2), f(n * b * h * y, 1)] for nm, n, b, h, y in comps],
                           "foot": ["Σ", "", "", "", f(sumA, 2), "", f(sumAy, 1)]},
                 "steps": [step("Centroid", "ȳ = Σ(A·y) / ΣA", f"{f(sumAy, 1)} / {f(sumA, 2)}", f(ybar, 3), "mm"),
                           step("y_bot", "y_bot = ȳ", "", f(ybot, 3), "mm"),
                           step("y_top", "y_top = t_fb + h_w + t_ft − ȳ", f"{f(tfb, 2)} + {f(hw, 2)} + {f(tft, 2)} − {f(ybar, 3)}", f(ytop, 3), "mm")]})
    Irows, sumI = [], 0.0
    for nm, n, b, h, y in comps:
        I0, A, d = b * h ** 3 / 12, b * h, ybar - y
        part = n * (I0 + A * d ** 2)
        sumI += part
        Irows.append([nm, str(n), f(I0, 1), f(d, 2), f(A * d ** 2, 0), f(part, 0)])
    secs.append({"id": "I", "title": "5 · Second moment of area I (parallel axis)",
                 "table": {"head": ["Part", "n", "I₀ = b·h³/12", "d = ȳ − y", "A·d²", "n·(I₀ + A·d²)"], "rows": Irows,
                           "foot": ["Σ", "", "", "", "", f(sumI, 0)]},
                 "steps": [step("I", "I = Σ n·(b·h³/12 + A·d²)", f"sum of the last column", f(I, 0), "mm⁴")]})
    Atop, Atab = bft * tft, bg * tg
    yt_c, ytab_c = tfb + hw + tft / 2, tfb + hw - tg / 2
    secs.append({"id": "Q", "title": "6 · First moments of area Q", "steps": [
        step("Q at centroid", "Q_cent = A_top·(y_top,c − ȳ) + 2·A_tab·(y_tab,c − ȳ) + t_w·(t_fb + h_w − ȳ)²",
             f"{f(Atop, 2)}×({f(yt_c, 2)} − {f(ybar, 3)}) + 2×{f(Atab, 2)}×({f(ytab_c, 2)} − {f(ybar, 3)}) + {f(tw, 2)}×({f(tfb + hw, 2)} − {f(ybar, 3)})²",
             f(Qcent, 1), "mm³", "the last term is the two webs above the centroid: 2 × t_w·h·(h/2) = t_w·h²"),
        step("Q at glue line", "Q_glue = A_top·(y_top,c − ȳ)", f"{f(Atop, 2)}×({f(yt_c, 2)} − {f(ybar, 3)})", f(Qglue, 1), "mm³")]})

    # 7. applied stresses (sec. 4)
    F64 = np.float64  # numpy floats so x/0 gives inf like the array version does, plain floats would crash
    with np.errstate(divide="ignore", invalid="ignore"):
        S_top, S_bot, T_cent, T_glue, S_web = (float(v) for v in alg.applied_stress(F64(V), F64(M), F64(ybot), F64(ytop), F64(I), F64(Qcent), F64(Qglue), F64(tw), F64(bg), F64(tft)))
    secs.append({"id": "stress", "title": "7 · Applied stresses", "steps": [
        step("σ_top (compression)", "σ_top = M·y_top / I", f"{f(M, 0)}×{f(ytop, 3)} / {f(I, 0)}", f(S_top, 4), "MPa"),
        step("σ_bot (tension)", "σ_bot = M·y_bot / I", f"{f(M, 0)}×{f(ybot, 3)} / {f(I, 0)}", f(S_bot, 4), "MPa"),
        step("σ_web (top of webs)", "σ_web = M·(y_top − t_ft) / I", f"{f(M, 0)}×({f(ytop, 3)} − {f(tft, 2)}) / {f(I, 0)}", f(S_web, 4), "MPa"),
        step("τ_cent", "τ_cent = V·Q_cent / (I·2t_w)", f"{f(V, 2)}×{f(Qcent, 1)} / ({f(I, 0)}×2×{f(tw, 2)})", f(T_cent, 4), "MPa"),
        step("τ_glue", "τ_glue = V·Q_glue / (I·2(b_g + t_w))", f"{f(V, 2)}×{f(Qglue, 1)} / ({f(I, 0)}×2×({f(bg, 2)} + {f(tw, 2)}))", f(T_glue, 4), "MPa")]})

    # 8. capacities (sec. 5)
    with np.errstate(divide="ignore", invalid="ignore"):
        caps = [float(v) for v in alg.capacities(*(np.float64(t) for t in (bft, tft, tw, hw, sw, a, ytop)))]
    k = math.pi ** 2 * alg.E_MAT / (12 * (1 - alg.NU_MAT ** 2))
    secs.append({"id": "capacity", "title": "8 · Capacities", "steps": [
        step("Material", "σ_t = 30, σ_c = 6, τ_m = 4, τ_glue = 2", "Table 2 of the handout", "", "MPa"),
        step("Plate constant k", "k = π²E / (12(1 − μ²))", f"π²×{f(alg.E_MAT, 0)} / (12×(1 − {alg.NU_MAT}²))", f(k, 2), "MPa"),
        step("σ_buck1 (flange between webs)", "σ = 4k·(t_ft / s_w)²", f"4×{f(k, 2)}×({f(tft, 2)} / {f(sw, 2)})²", f(caps[4], 4), "MPa"),
        step("σ_buck2 (flange tips)", "σ = 0.425k·(2t_ft / (b_ft − s_w))²", f"0.425×{f(k, 2)}×(2×{f(tft, 2)} / ({f(bft, 2)} − {f(sw, 2)}))²", f(caps[5], 4), "MPa"),
        step("σ_buck3 (webs)", "σ = 6k·(t_w / (y_top − t_ft))²", f"6×{f(k, 2)}×({f(tw, 2)} / ({f(ytop, 3)} − {f(tft, 2)}))²", f(caps[6], 4), "MPa"),
        step("τ_buck (shear buckling)", "τ = 5k·((t_w/h_w)² + (t_w/a)²)", f"5×{f(k, 2)}×(({f(tw, 2)}/{f(hw, 2)})² + ({f(tw, 2)}/{f(a, 1)})²)", f(caps[7], 4), "MPa")]})

    # 9. FOS (sec. 6 + 7)
    with np.errstate(divide="ignore", invalid="ignore"):
        fos = [float(v) for v in alg.factors_of_safety(*(F64(t) for t in (S_top, S_bot, T_cent, T_glue, S_web, *caps)))]
    pairs = [("tension", "σ_t / σ_bot", caps[0], S_bot), ("compression", "σ_c / σ_top", caps[1], S_top),
             ("shear", "τ_m / τ_cent", caps[2], T_cent), ("glue", "τ_glue / τ_glue,applied", caps[3], T_glue),
             ("buckling in the middle flange", "σ_buck1 / σ_top", caps[4], S_top),
             ("buckling in the side flanges", "σ_buck2 / σ_top", caps[5], S_top),
             ("buckling in the webs", "σ_buck3 / σ_web", caps[6], S_web), ("shear buckling", "τ_buck / τ_cent", caps[7], T_cent)]
    valid = [v if (math.isfinite(v) and v > 0) else math.inf for v in fos]
    mi = int(np.argmin(valid))
    rows_f = [[nm, frm, f(c, 4), f(dmd, 4), f(valid[i]) if math.isfinite(valid[i]) else "∞", f(valid[i] * P, 1) if math.isfinite(valid[i]) else "∞"]
              for i, (nm, frm, c, dmd) in enumerate(pairs)]
    secs.append({"id": "fos", "title": f"9 · Factors of safety at x = {f(x0, 0)} mm", "highlight": mi,
                 "table": {"head": ["Mode", "FOS =", "Capacity", "Demand", "FOS", "Train to fail (N)"], "rows": rows_f},
                 "steps": [step("Governing FOS here", "FOS = min over the 8 modes", f"{pairs[mi][0]}", f(valid[mi], 4) if math.isfinite(valid[mi]) else "∞", ""),
                           step("Failure load from this point", "P_fail = FOS × P", f"{f(valid[mi], 4)} × {f(P, 2)}" if math.isfinite(valid[mi]) else "no load here",
                                f(valid[mi] * P, 1) if math.isfinite(valid[mi]) else "∞", "N",
                                "The bridge's overall failure load is the smallest of these over every x (failure_load() takes min over x)."
                                + (" FOS < 1: this train breaks it." if valid[mi] < 1 else ""))]})
    return {"ok": True, "mode_kind": "explain", "x": x0, "source": source, "sections": secs}


############################## runner sec. 6 ##############################
# 6. single cross-section (the 2d section editor)

# one section only: ybar, I, Q, area and the buckling capacities, straight from algorithm.py
def run_section(req):
    r = [float(v) for v in req["row"]]  # one 11-column row
    _, bft, tft, bfb, tfb, hw, tw, bg, tg, sw, a = r
    F = np.float64
    ybar, ybot, ytop, I, Qcent, Qglue = (float(v) for v in alg.sectional_properties(*(F(t) for t in (bft, tft, bfb, tfb, hw, tw, bg, tg))))
    with np.errstate(divide="ignore", invalid="ignore"):
        caps = [float(v) for v in alg.capacities(*(F(t) for t in (bft, tft, tw, hw, sw, a, ytop)))]
    area = bfb * tfb + 2 * tw * hw + bft * tft + 2 * bg * tg
    return {"ok": True, "mode_kind": "section", "ybar": ybar, "ytop": ytop, "I": I, "Qcent": Qcent, "Qglue": Qglue,
            "area": area, "S_buck1": caps[4], "S_buck2": caps[5], "S_buck3": caps[6], "T_buck": caps[7],
            "top_heavy": bool(ytop - tft <= 0)}


############################## runner sec. 7 ##############################
# 7. handling requests

# picks the right mode. errors go back to the page as a message instead of killing the worker
def handle(req):
    try:
        if req.get("mode") == "position":
            return run_position(req)
        if req.get("mode") == "explain":
            return run_explain(req)
        if req.get("mode") == "section":
            return run_section(req)
        return run_envelope(req)
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


if __name__ == "__main__":
    if "--serve" in sys.argv:
        # server mode: keep reading lines until server.js closes us. the id goes back so it knows which answer is which
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                req = json.loads(line)
            except ValueError as e:
                req, out = {}, {"ok": False, "error": f"bad JSON: {e}"}
            else:
                out = handle(req)
            out["id"] = req.get("id")
            sys.stdout.write(json.dumps(out) + "\n")
            sys.stdout.flush()
    else:
        # one-off mode, handy for testing:  echo '{"rows": ...}' | python runner.py
        sys.stdout.write(json.dumps(handle(json.loads(sys.stdin.read()))))
