// view3d.js - the 3d bridge view. no libraries, just a 2d canvas pretending to be 3d
//
// axes are in mm: x goes along the span (supports at 0 and 1200), y is up (top of the supports is y = 0),
// z goes across the bridge.
// how it draws: every part is a box, each box face gets thrown out if it faces away from the camera,
// shaded by how much it faces the light, then everything is drawn back to front (painter's algorithm).
// note: painter's sorting can glitch when faces cross each other, but for thin matboard it's fine
"use strict";

const View3D = (() => {
  // where the floor is, camera field of view, and how close something can get before we stop drawing it
  const FLOOR = -260, FOV = 40 * Math.PI / 180, NEAR = 20;
  // colours (rgb) for each kind of thing
  const MAT = [236, 232, 223], GLUE = [232, 149, 47], DIA = [196, 210, 226], WHEEL = [40, 40, 44];
  const LOCO = [200, 80, 60], FREIGHT = [96, 112, 130], SUPPORT = [58, 64, 72], TRACK = [70, 76, 84];
  const LIGHT = norm([-0.35, 0.85, 0.55]); // light comes from up, a bit left and a bit in front
  // the 3D / Side / End / Top buttons. yaw = spin around, pitch = how far above, dist = zoom
  const VIEWS = {
    iso: { yaw: 0.62, pitch: 0.34, dist: 2900 },
    side: { yaw: 0, pitch: 0.03, dist: 2600 },
    end: { yaw: Math.PI / 2 + 0.35, pitch: 0.12, dist: 2300 },
    top: { yaw: 0, pitch: 1.5, dist: 2700 },
  };

  // tiny vector helpers
  function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const lerp = (a, b, t) => a + (b - a) * t;
  const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  // demand / capacity -> colour. 0 = plain matboard, 0.5 = yellow, 1 = red (fails), 2+ = deep purple (way past it)
  function heat(u) {
    const t = Math.max(0, Math.min(2, u));
    const A = MAT, B = [240, 200, 80], C = [226, 80, 60], Dk = [110, 30, 90];
    const mix = (p, q, s) => [lerp(p[0], q[0], s), lerp(p[1], q[1], s), lerp(p[2], q[2], s)];
    return t < 0.5 ? mix(A, B, t / 0.5) : t < 1 ? mix(B, C, (t - 0.5) / 0.5) : mix(C, Dk, t - 1);
  }

  // makes a viewer on a canvas. opts.insets() says how much the side panels cover, opts.onUserMove fires on drag
  function create(canvas, opts = {}) {
    const g = canvas.getContext("2d");
    const cam = { ...VIEWS.iso, target: [600, -20, 0] };
    let scene = null, W = 0, H = 0, dirty = false, anim = null;
    let eye, R, U, Fw, F, cx, cy; // camera position, its right/up/forward vectors, focal length, screen centre

    ////////////////////////////// view3d sec. 1 //////////////////////////////
    // 1. camera

    // works out where the eye is from yaw/pitch/dist, and the screen centre (middle of the free space)
    function setupCam() {
      const { yaw, pitch, dist, target } = cam;
      eye = [target[0] + dist * Math.cos(pitch) * Math.sin(yaw), target[1] + dist * Math.sin(pitch), target[2] + dist * Math.cos(pitch) * Math.cos(yaw)];
      Fw = norm(sub(target, eye));
      R = norm(cross(Fw, [0, 1, 0]));
      U = cross(R, Fw);
      F = (H / 2) / Math.tan(FOV / 2);
      const ins = opts.insets ? opts.insets() : { left: 0, right: 0 };
      cx = ins.left + (W - ins.left - ins.right) / 2;
      cy = H * 0.47;
    }
    // world point -> camera space (x right, y up, z = depth)
    const toCam = (p) => { const v = sub(p, eye); return [dot(v, R), dot(v, U), dot(v, Fw)]; };
    // camera space -> screen pixels (perspective divide)
    const proj = (c) => [cx + (c[0] / c[2]) * F, cy - (c[1] / c[2]) * F];
    // world point -> screen, or null if it's behind the camera
    const project = (p) => { const c = toCam(p); return c[2] < NEAR ? null : proj(c); };

    // jumps (or glides over ~350 ms) to one of the preset views
    function setView(name, animate = true) {
      const v = VIEWS[name]; if (!v) return;
      const D = scene ? scene.D : 76;
      const to = { ...v, target: [600, D - (scene ? scene.Hmax : 76) / 2 - 10, 0] };
      if (!animate) { Object.assign(cam, to); return request(); }
      const from = { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, target: [...cam.target] };
      let dy = to.yaw - from.yaw; // go the short way round
      while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      const t0 = performance.now();
      cancelAnimationFrame(anim);
      const step = (t) => {
        const k = Math.min(1, (t - t0) / 350), e = 1 - Math.pow(1 - k, 3);
        cam.yaw = from.yaw + dy * e; cam.pitch = lerp(from.pitch, to.pitch, e); cam.dist = lerp(from.dist, to.dist, e);
        cam.target = from.target.map((q, i) => lerp(q, to.target[i], e));
        draw(); if (k < 1) anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    }

    ////////////////////////////// view3d sec. 2 //////////////////////////////
    // 2. mouse (orbit / pan / zoom)
    let drag = null;
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    // right button, middle button or shift = pan, otherwise orbit
    canvas.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.button === 1 || e.shiftKey };
      canvas.setPointerCapture(e.pointerId); canvas.classList.add("dragging");
      cancelAnimationFrame(anim); opts.onUserMove && opts.onUserMove();
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) { // slide the target along the screen, scaled so the bridge sticks to the mouse
        const s = cam.dist / F;
        cam.target = cam.target.map((q, i) => q - R[i] * dx * s + U[i] * dy * s);
      } else {
        cam.yaw -= dx * 0.006;
        cam.pitch = Math.max(0, Math.min(1.55, cam.pitch + dy * 0.005));
        // keep the eye above the floor
        const minP = Math.asin(Math.max(-1, Math.min(1, (FLOOR + 40 - cam.target[1]) / cam.dist)));
        cam.pitch = Math.max(cam.pitch, minP);
      }
      request();
    });
    const end = (e) => { drag = null; canvas.classList.remove("dragging"); try { canvas.releasePointerCapture(e.pointerId); } catch {} };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    // scroll to zoom
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      cam.dist = Math.max(150, Math.min(8000, cam.dist * Math.exp(e.deltaY * 0.0012)));
      request();
    }, { passive: false });
    canvas.addEventListener("dblclick", () => setView("iso")); // double click = reset

    ////////////////////////////// view3d sec. 3 //////////////////////////////
    // 3. geometry (turning the simulator rows into boxes)
    // cross-section at x from the simulator rows. same linear interpolation as np.interp, clamps at the ends
    function sectionAt(x) {
      const rows = scene.rows;
      let i = 0;
      if (x <= rows[0][0]) i = -1; else if (x >= rows[rows.length - 1][0]) i = rows.length - 1;
      else while (i < rows.length - 1 && rows[i + 1][0] < x) i++;
      const a = rows[Math.max(0, Math.min(rows.length - 1, i))], b = rows[Math.max(0, Math.min(rows.length - 1, i + 1))];
      const t = i < 0 || i >= rows.length - 1 || b[0] === a[0] ? 0 : (x - a[0]) / (b[0] - a[0]);
      const v = (k) => lerp(a[k], b[k], t);
      return { bft: v(1), tft: v(2), bfb: v(3), tfb: v(4), hw: v(5), tw: v(6), bg: v(7), tg: v(8) };
    }
    // the 6 pieces of a section as [z left, z right, y bottom, y top]. D = deck level, everything hangs down from it
    function parts(s, D) {
      const yTop = D, yUnder = D - s.tft, yBotTop = D - s.tft - s.hw, yBot = yBotTop - s.tfb, h = s.bfb / 2;
      return {
        top: [-s.bft / 2, s.bft / 2, yUnder, yTop],
        webL: [-h, -h + s.tw, yBotTop, yUnder],
        webR: [h - s.tw, h, yBotTop, yUnder],
        bot: [-h, h, yBot, yBotTop],
        glueL: [-h + s.tw, -h + s.tw + s.bg, yUnder - s.tg, yUnder],
        glueR: [h - s.tw - s.bg, h - s.tw, yUnder - s.tg, yUnder],
      };
    }
    // demand/capacity at x, for colouring the beam
    function utilAt(x) {
      const u = scene.util; if (!u) return null;
      const xs = u.x, n = xs.length;
      if (x <= xs[0]) return u.u[0]; if (x >= xs[n - 1]) return u.u[n - 1];
      const step = xs[1] - xs[0], i = Math.min(n - 2, Math.floor((x - xs[0]) / step));
      return lerp(u.u[i] ?? 0, u.u[i + 1] ?? 0, (x - xs[i]) / step);
    }

    // a box whose two ends can be different sizes (the section tapers). r0 at x0, r1 at x1, each [zl, zr, yb, yt].
    // caps = draw the end faces or not (skipped between segments, you'd never see them)
    function hexa(out, x0, r0, x1, r1, color, caps = [true, true], alpha = 1) {
      const P = [
        [x0, r0[2], r0[0]], [x0, r0[2], r0[1]], [x0, r0[3], r0[1]], [x0, r0[3], r0[0]],
        [x1, r1[2], r1[0]], [x1, r1[2], r1[1]], [x1, r1[3], r1[1]], [x1, r1[3], r1[0]],
      ];
      const C = P.reduce((s, p) => [s[0] + p[0] / 8, s[1] + p[1] / 8, s[2] + p[2] / 8], [0, 0, 0]);
      const F6 = [[0, 1, 5, 4], [3, 2, 6, 7], [1, 2, 6, 5], [0, 3, 7, 4]];
      if (caps[0]) F6.push([0, 1, 2, 3]);
      if (caps[1]) F6.push([4, 5, 6, 7]);
      for (const f of F6) out.push({ pts: f.map((k) => P[k]), c: C, color, alpha });
    }
    // plain box, same size at both ends
    const box = (out, x0, x1, zl, zr, yb, yt, color, alpha) => hexa(out, x0, [zl, zr, yb, yt], x1, [zl, zr, yb, yt], color, [true, true], alpha);

    // every face in the scene: bridge, diaphragms, supports, track, train
    function buildFaces() {
      const out = [], S = scene, D = S.D;
      // chop the bridge every 20 mm (smooth colour) + at every simulator row. -30 to 1230 = the bit past the supports
      const xs = new Set([-30, 1230]);
      for (let x = 0; x <= 1200; x += 20) xs.add(x);
      S.rows.forEach((r) => xs.add(r[0]));
      const X = [...xs].sort((a, b) => a - b);
      const keys = ["top", "webL", "webR", "bot", "glueL", "glueR"];
      // x-ray: fade whichever web is closest to the camera (and the deck when looking down) so the diaphragms show
      const ghost = new Set();
      if (S.xray) {
        if (eye[2] >= 0) ghost.add("webR").add("glueR"); else ghost.add("webL").add("glueL");
        if (eye[1] > D) ghost.add("top");
      }
      for (let i = 0; i < X.length - 1; i++) {
        const a = X[i], b = X[i + 1];
        if (b - a < 0.01) continue;
        const pa = parts(sectionAt(a), D), pb = parts(sectionAt(b), D);
        const u = S.heat ? utilAt((a + b) / 2) : null;
        const shell = u == null ? MAT : heat(u);
        for (const k of keys) {
          const col = k.startsWith("glue") ? GLUE : shell;
          hexa(out, a, pa[k], b, pb[k], col, [i === 0, i === X.length - 2], ghost.has(k) ? 0.22 : 1);
        }
      }
      // diaphragms: thin plates filling the inside of the U, under the glue tabs
      for (const d of S.dias) {
        const s = sectionAt(d), p = parts(s, D);
        const zl = p.webL[1], zr = p.webR[0], yb = p.bot[3], yt = p.glueL[2];
        if (zr > zl && yt > yb) box(out, d - 1.5, d + 1.5, zl, zr, yb, yt, S.xray ? [90, 170, 255] : DIA);
      }
      // supports (50 mm wide plates on pedestals) and some track either side so the train has somewhere to sit
      for (const sx of [0, 1200]) {
        box(out, sx - 25, sx + 25, -95, 95, FLOOR, -8, SUPPORT);
        box(out, sx - 25, sx + 25, -95, 95, -8, 0, [120, 128, 138]);
      }
      if (S.train) {
        box(out, -1050, -32, -55, 55, D - 5, D, TRACK, 0.55);
        box(out, 1232, 2250, -55, 55, D - 5, D, TRACK, 0.55);
      }
      // the train: 3 cars, the loco gets a little cab on top. car k sits on wheels 2k and 2k+1
      if (S.train && S.showTrain) {
        const p = S.train.wheelPos;
        for (let k = 0; k < 3; k++) {
          const front = p[2 * k] + 52, back = p[2 * k + 1] - 52;
          const col = k === S.train.locoCar ? LOCO : FREIGHT;
          box(out, back, front, -37.5, 37.5, D + 14, D + 85, col);
          if (k === S.train.locoCar) box(out, front - 70, front - 10, -30, 30, D + 85, D + 100, col);
          for (const w of [p[2 * k], p[2 * k + 1]]) {
            box(out, w - 12, w + 12, 27.5, 37.5, D, D + 24, WHEEL);
            box(out, w - 12, w + 12, -37.5, -27.5, D, D + 24, WHEEL);
          }
        }
      }
      return out;
    }

    ////////////////////////////// view3d sec. 4 //////////////////////////////
    // 4. drawing

    // 3d line, clipped where it goes behind the camera
    function line3(a, b, color, width, dash) {
      let A = toCam(a), B = toCam(b);
      if (A[2] < NEAR && B[2] < NEAR) return;
      if (A[2] < NEAR) A = A.map((v, i) => lerp(A[i], B[i], (NEAR - A[2]) / (B[2] - A[2])));
      else if (B[2] < NEAR) B = B.map((v, i) => lerp(B[i], A[i], (NEAR - B[2]) / (A[2] - B[2])));
      const p = proj(A), q = proj(B);
      g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash || []);
      g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); g.setLineDash([]);
    }
    // force arrow from -> to (tip at "to"), with an optional label at the tail
    function arrow(from, to, color, label, labelColor) {
      const a = project(from), b = project(to);
      if (!a || !b) return;
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 4) return;
      const hl = Math.min(11, len * 0.45);
      g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0] - Math.cos(ang) * hl * 0.8, b[1] - Math.sin(ang) * hl * 0.8); g.stroke();
      g.beginPath(); g.moveTo(b[0], b[1]);
      g.lineTo(b[0] - hl * Math.cos(ang - 0.42), b[1] - hl * Math.sin(ang - 0.42));
      g.lineTo(b[0] - hl * Math.cos(ang + 0.42), b[1] - hl * Math.sin(ang + 0.42));
      g.closePath(); g.fill();
      if (label) tag(a[0], a[1] + (b[1] > a[1] ? -8 : 16), label, labelColor || color);
    }
    // dark label box with a coloured underline
    function tag(x, y, text, color, bold) {
      g.font = `${bold ? 600 : 500} 11px Segoe UI, system-ui, sans-serif`;
      const w = g.measureText(text).width + 10;
      g.fillStyle = "rgba(22,22,22,.85)"; g.fillRect(x - w / 2, y - 13, w, 17);
      g.fillStyle = color; g.fillRect(x - w / 2, y + 3, w, 1.5);
      g.fillStyle = "#fff"; g.textAlign = "center"; g.fillText(text, x, y - 1); g.textAlign = "left";
    }

    // draws one frame
    function draw() {
      dirty = false;
      const dpr = window.devicePixelRatio || 1;
      W = canvas.clientWidth; H = canvas.clientHeight;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      setupCam();
      // background
      const bg = g.createRadialGradient(cx, H * 0.45, 50, cx, H * 0.5, Math.max(W, H) * 0.8);
      bg.addColorStop(0, "#4a8fc2"); bg.addColorStop(0.55, "#2d6795"); bg.addColorStop(1, "#1d4a72");
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      // floor grid (tiles of 200 mm)
      const ext = 3200, step = 200;
      for (let x = -ext + 600; x <= ext + 600; x += step) line3([x, FLOOR, -ext], [x, FLOOR, ext], "rgba(255,255,255,.55)", 1.6);
      for (let z = -ext; z <= ext; z += step) line3([600 - ext, FLOOR, z], [600 + ext, FLOOR, z], "rgba(255,255,255,.55)", 1.6);
      if (!scene) return;
      const D = scene.D;
      // soft shadow of the deck on the floor
      const sh = [[-30, FLOOR, -60], [1230, FLOOR, -60], [1230, FLOOR, 60], [-30, FLOOR, 60]].map(project);
      if (sh.every(Boolean)) { g.fillStyle = "rgba(10,25,45,.28)"; g.beginPath(); sh.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fill(); }

      // faces: throw out back faces, shade, sort far -> near, fill
      const faces = [];
      for (const f of buildFaces()) {
        const [p0, p1, , p3] = f.pts;
        let n = norm(cross(sub(p1, p0), sub(p3, p0)));
        const fc = f.pts.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4, s[2] + p[2] / 4], [0, 0, 0]);
        if (dot(n, sub(fc, f.c)) < 0) n = n.map((v) => -v); // make the normal point out of the box
        if (dot(n, sub(eye, fc)) <= 0) continue; // facing away
        const cs = f.pts.map(toCam);
        if (cs.some((c) => c[2] < NEAR)) continue;
        const sh2 = 0.5 + 0.5 * Math.max(0, dot(n, LIGHT));
        faces.push({ s: cs.map(proj), z: cs.reduce((s, c) => s + c[2], 0) / 4, col: f.color.map((v) => v * sh2), a: f.alpha });
      }
      faces.sort((a, b) => b.z - a.z);
      g.lineJoin = "round";
      for (const f of faces) {
        g.beginPath(); f.s.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath();
        g.fillStyle = rgb(f.col, f.a); g.fill();
        if (f.a === 1) { g.strokeStyle = rgb(f.col); g.lineWidth = 0.7; g.stroke(); } // hides the hairline gaps between faces
      }

      // x-ray: outline each diaphragm and say where it is
      if (scene.xray) {
        g.strokeStyle = "#5fb0ff"; g.lineWidth = 1.6;
        for (const d of scene.dias) {
          const p = parts(sectionAt(d), D), zl = p.webL[1], zr = p.webR[0], yb = p.bot[3], yt = p.glueL[2];
          const q = [[d, yb, zl], [d, yb, zr], [d, yt, zr], [d, yt, zl]].map(project);
          if (!q.every(Boolean)) continue;
          g.beginPath(); q.forEach((pt, i) => (i ? g.lineTo(pt[0], pt[1]) : g.moveTo(pt[0], pt[1]))); g.closePath(); g.stroke();
          const lp = project([d, p.bot[2] - 18, eye[2] >= 0 ? p.bot[1] : p.bot[0]]);
          if (lp) tag(lp[0], lp[1] + 14, `◫ ${Math.round(d)} mm`, "#5fb0ff");
        }
      }

      // selected cross-section outline
      if (scene.selX != null) {
        const s = sectionAt(scene.selX), p = parts(s, D), x = scene.selX, o = 0.5;
        const rect = (r) => { const q = [[x, r[2] - o, r[0] - o], [x, r[2] - o, r[1] + o], [x, r[3] + o, r[1] + o], [x, r[3] + o, r[0] - o]].map(project); if (q.every(Boolean)) { g.beginPath(); q.forEach((pt, i) => (i ? g.lineTo(pt[0], pt[1]) : g.moveTo(pt[0], pt[1]))); g.closePath(); g.stroke(); } };
        g.strokeStyle = "#e8952f"; g.lineWidth = 2;
        [p.top, p.webL, p.webR, p.bot].forEach(rect);
      }

      // forces: wheel loads in front of the train pointing at the deck, reactions pointing up at the supports
      if (scene.train && scene.showForces && scene.train.loads) {
        const t = scene.train, maxL = Math.max(...t.loads);
        t.wheelPos.forEach((x, i) => {
          if (!t.on[i]) return;
          const zf = sectionAt(x).bft / 2 + 14, len = 50 + 90 * (t.loads[i] / maxL);
          arrow([x, D + 110 + len, zf], [x, D + 2, zf], "#ffb347", `${t.loads[i].toFixed(1)} N`);
        });
        const lenR = (r) => 40 + 110 * Math.min(1, r / Math.max(1, t.total));
        if (t.RA > 1e-9) arrow([0, -lenR(t.RA) - 20, 112], [0, -1, 112], "#7fd26b", `Rᴀ ${t.RA.toFixed(1)} N`);
        if (t.RB > 1e-9) arrow([1200, -lenR(t.RB) - 20, 112], [1200, -1, 112], "#7fd26b", `Rʙ ${t.RB.toFixed(1)} N`);
      }
      // where the moving train run says it fails
      if (scene.fail) {
        const x = scene.fail.x, top = [x, D + 20, 0], bot = [x, D - scene.Hmax - 70, 0];
        line3(top, bot, "rgba(224,103,93,.9)", 1.8, [6, 5]);
        const p = project(bot); if (p) tag(p[0], p[1] + 14, scene.fail.label, "#e0675d", true);
      }
    }

    // asks for a redraw on the next frame (lots of calls in one frame = one draw)
    function request() { if (dirty) return; dirty = true; requestAnimationFrame(draw); }
    window.addEventListener("resize", request);

    // what app.js gets to use
    return {
      setScene(s) { const first = !scene; scene = s; if (first) setView("iso", false); request(); },
      setView, request,
    };
  }
  return { create };
})();
