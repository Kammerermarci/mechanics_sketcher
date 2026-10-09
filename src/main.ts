import "./style.css";
import { App } from "./app";
import { createSolver } from "./solver-web";

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
