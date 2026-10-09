/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const WASM = fileURLToPath(
  new URL("./node_modules/@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm", import.meta.url),
);

/**
 * Serves the solver's .wasm as a base64 string, so it can live inside the JS
 * bundle and be handed to the solver directly (see src/solver-web.ts).
 */
function planegcsWasm(): Plugin {
  const id = "virtual:planegcs-wasm";
  return {
    name: "planegcs-wasm",
    enforce: "pre",
    resolveId: (source) => (source === id ? `\0${id}` : null),
    load: (resolved) =>
      resolved === `\0${id}`
        ? `export default ${JSON.stringify(readFileSync(WASM).toString("base64"))};`
        : null,
    // The solver's loader also refers to the .wasm by URL, which would make
    // Vite inline a second copy. That path is never taken, so blank it out.
    transform(code, file) {
      if (!file.endsWith("planegcs_dist/planegcs.js")) return null;
      return code.replace('(new URL("planegcs.wasm",import.meta.url)).href', '""');
    },
  };
}

// Everything, including the solver and the fonts, is inlined into one
// index.html so the build runs from a file:// URL as well as from a server.
export default defineConfig({
  base: "./",
  plugins: [planegcsWasm(), viteSingleFile()],
  // When this copy was built, shown in the app so it is easy to tell which version is open.
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  build: { target: "es2022", assetsInlineLimit: 100_000_000 },
  test: { environment: "node" },
});
