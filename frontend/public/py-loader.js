window.startPy = () => window.pyReady ??= (async () => {
  const btns = ["runBtn", "runIcon"].map((id) => document.getElementById(id));
  const label = btns[0].textContent;
  btns.forEach((b) => (b.disabled = true));
  btns[0].textContent = "Loading Python…";
  try {
    const py = await loadPyodide();
    await py.loadPackage(["numpy", "matplotlib"]);
    const [alg, run] = await Promise.all(["py/algorithm.py", "py/runner.py"].map(async (f) => {
      const r = await fetch(f);
      if (!r.ok) throw new Error(`couldn't load ${f}`);
      return r.text();
    }));
    py.FS.mkdirTree("/app/frontend");
    py.FS.writeFile("/app/algorithm.py", alg);
    py.FS.writeFile("/app/frontend/runner.py", run);
    py.runPython(`
import os, sys
os.environ["MPLBACKEND"] = "Agg"
sys.path.insert(0, "/app/frontend")
import runner
`);
    btns[0].textContent = label;
    btns.forEach((b) => (b.disabled = false));
    return py;
  } catch (e) {
    btns[0].textContent = "Python failed to load";
    throw e;
  }
})();