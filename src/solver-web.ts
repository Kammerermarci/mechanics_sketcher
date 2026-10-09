// Starts the planegcs WebAssembly module in the browser. The .wasm is inlined
// into the bundle as base64, so the app also runs from a file:// URL.

import { init_planegcs_module, GcsWrapper } from "@salusoft89/planegcs";
import wasmBase64 from "virtual:planegcs-wasm";
import { SketchSolver } from "./solver";

function decode(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function createSolver(): Promise<SketchSolver> {
  const bytes = decode(wasmBase64);
  // Emscripten calls this hook instead of fetching the .wasm itself.
  const config = {
    instantiateWasm(imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance) => void) {
      WebAssembly.instantiate(bytes, imports).then((r) => done(r.instance));
      return {};
    },
  };
  const mod = await (init_planegcs_module as unknown as (c: object) => ReturnType<typeof init_planegcs_module>)(config);
  return new SketchSolver(new GcsWrapper(new mod.GcsSystem(), mod));
}
