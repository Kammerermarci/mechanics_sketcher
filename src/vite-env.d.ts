/// <reference types="vite/client" />

declare module "virtual:planegcs-wasm" {
  /** The planegcs WebAssembly binary, base64-encoded. */
  const base64: string;
  export default base64;
}
