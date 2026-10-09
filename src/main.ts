import "./style.css";
import { App } from "./app";
import { createSolver } from "./solver-web";
import { createMathJaxEngine } from "./mathjax";
import { setTexEngine } from "./tex";

try {
  setTexEngine(createMathJaxEngine());
} catch (err) {
  // Labels fall back to the built-in stand-in; everything else still works.
  console.error("MathJax could not start", err);
}

createSolver()
  .then((solver) => {
    const app = new App(solver);
    if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;
  })
  .catch((err) => {
    console.error(err);
    const stage = document.querySelector("#stage");
    if (stage) {
      stage.innerHTML =
        `<p class="fatal">The constraint solver could not start, so the sketcher cannot run. ` +
        `Reload the page; if it keeps happening, the browser may be blocking WebAssembly.</p>`;
    }
  });

// Served from a web address, the app registers a service worker so it can be
// installed and keeps working offline. Opened as a file, there is none to register.
if ("serviceWorker" in navigator && location.protocol.startsWith("http") && !import.meta.env.DEV) {
  navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("Offline support is unavailable", err));
}
