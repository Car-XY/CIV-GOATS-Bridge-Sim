// server.js - tiny node server, no npm packages needed
//
// does two things: hands out the files in public/, and passes /api/simulate requests to runner.py.
// we keep ONE python process (runner.py --serve) running the whole time and feed it a line of json per
// request. starting python fresh every time takes ~0.5 s (numpy + matplotlib imports), which made dragging
// the train feel awful. this way most answers come back in a few ms.

////////////////////////////// server sec. 0 //////////////////////////////
// 0. setup
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PORT = process.env.PORT || 3000; // PORT=4000 npm start if 3000 is taken
const PUBLIC = path.join(__dirname, "public");
const RUNNER = path.join(__dirname, "runner.py");
// which python to use. set PYTHON=... to force one, otherwise we try the usual names
// note: on windows it's usually "python" or "py", on mac/linux "python3"
const CANDIDATES = process.env.PYTHON ? [process.env.PYTHON] : process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
let candidate = 0; // index into CANDIDATES, moves on if one isn't installed
// content types for the files we serve
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };

////////////////////////////// server sec. 1 //////////////////////////////
// 1. the python worker

let worker = null, buf = "", nextId = 1, lastErr = "";
const pending = new Map(); // request id -> function waiting for the answer

// something broke, tell everyone still waiting
function failAll(msg) {
  for (const cb of pending.values()) cb({ ok: false, error: msg });
  pending.clear();
}

// starts runner.py --serve and listens for answers (one json per line)
function startWorker() {
  const py = spawn(CANDIDATES[candidate], [RUNNER, "--serve"], { env: { ...process.env, MPLBACKEND: "Agg" } });
  worker = py; buf = ""; lastErr = "";
  py.stdout.setEncoding("utf8");
  py.stdout.on("data", (d) => {
    buf += d; // answers can arrive in chunks, so only use complete lines
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const cb = pending.get(msg.id);
      if (cb) { pending.delete(msg.id); cb(msg); }
    }
  });
  py.stderr.on("data", (d) => (lastErr = (lastErr + d).slice(-4000))); // keep the end of any python traceback
  py.on("error", (e) => {
    if (worker === py) worker = null;
    // ENOENT = that python name doesn't exist on this machine, try the next one
    if (e.code === "ENOENT" && candidate + 1 < CANDIDATES.length) {
      candidate++;
      const queued = [...pending.entries()]; pending.clear();
      queued.forEach(([, cb]) => cb({ retry: true }));
      return;
    }
    failAll(`Could not start Python (${CANDIDATES.join(", ")}): ${e.message}. Set the PYTHON env var.`);
  });
  // if python dies, anything waiting gets the error, and the next request starts a new worker
  py.on("exit", (code) => {
    if (worker === py) worker = null;
    if (pending.size) failAll(lastErr.trim() || `Python exited with code ${code}`);
  });
  console.log(`Python worker started (${CANDIDATES[candidate]})`);
}

// sends one request to the worker, cb gets the answer
function ask(req, cb, tries = 0) {
  if (!worker) startWorker();
  const id = nextId++;
  pending.set(id, (msg) => (msg.retry && tries < CANDIDATES.length ? ask(req, cb, tries + 1) : cb(msg)));
  try {
    worker.stdin.write(JSON.stringify({ ...req, id }) + "\n");
  } catch (e) {
    pending.delete(id);
    cb({ ok: false, error: `Python worker unavailable: ${e.message}` });
  }
}

////////////////////////////// server sec. 2 //////////////////////////////
// 2. http

// json reply helper
function send(res, status, obj) {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

http.createServer((req, res) => {
  // the only api route. everything the page asks for goes through here
  if (req.method === "POST" && req.url === "/api/simulate") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed;
      try { parsed = JSON.parse(body || "{}"); } catch (e) { return send(res, 400, { ok: false, error: `Bad JSON: ${e.message}` }); }
      ask(parsed, (msg) => { delete msg.id; send(res, 200, msg); });
    });
    return;
  }
  // otherwise it's a file from public/
  const rel = req.url === "/" ? "index.html" : decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); } // no ../../ tricks
  fs.readFile(file, (e, data) => {
    if (e) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Bridge simulator UI: http://localhost:${PORT}`));

process.on("exit", () => worker && worker.kill()); // don't leave python running after ctrl+c
