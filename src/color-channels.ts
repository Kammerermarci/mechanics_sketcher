export type ColorMode = "rgb" | "hsl" | "hsv";
export type Channels = [number, number, number];
const MODE_KEY = "mech-sketch.colorMode";
let lastMode: ColorMode = "rgb";
const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));

export function readColorMode(): ColorMode {
  try {
    const mode = localStorage.getItem(MODE_KEY);
    if (mode === "rgb" || mode === "hsl" || mode === "hsv") lastMode = mode;
  } catch { /* Keep the session preference without storage. */ }
  return lastMode;
}
export function rememberColorMode(mode: ColorMode): void {
  lastMode = mode;
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* Session only. */ }
}
export function colorAlpha(hex: string): number {
  return /^#[\da-f]{8}$/i.test(hex) ? parseInt(hex.slice(7), 16) / 255 : 1;
}
export function withAlpha(hex: string, alpha: number): string {
  const byte = Math.round(clamp(alpha, 1) * 255);
  return hex.slice(0, 7) + (byte === 255 ? "" : byte.toString(16).padStart(2, "0"));
}
export function colorChannels(hex: string, mode: ColorMode): Channels {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as Channels;
  if (mode === "rgb") return rgb;
  const [r, g, b] = rgb.map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const h = d === 0 ? 0 : ((max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
  const l = (max + min) / 2;
  return mode === "hsv" ? [h, max === 0 ? 0 : d / max * 100, max * 100]
    : [h, d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)) * 100, l * 100];
}
export function channelsColor(values: Channels, mode: ColorMode, alpha = 1): string {
  let rgb: number[];
  if (mode === "rgb") rgb = values.map(v => clamp(v, 255));
  else {
    const h = ((values[0] % 360) + 360) % 360 / 60, s = clamp(values[1], 100) / 100, v = clamp(values[2], 100) / 100;
    const c = mode === "hsv" ? v * s : (1 - Math.abs(2 * v - 1)) * s;
    const x = c * (1 - Math.abs(h % 2 - 1)), m = mode === "hsv" ? v - c : v - c / 2;
    const parts = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
    rgb = parts.map(p => (p + m) * 255);
  }
  return withAlpha("#" + rgb.map(v => Math.round(v).toString(16).padStart(2, "0")).join(""), alpha);
}

/** Explicit SVG opacity also works in converters that only understand six-digit hex. */
export function svgColorOpacity(svg: string): string {
  return svg.replace(/(fill|stroke|stop-color)="(#[\da-f]{6})([\da-f]{2})"/gi, (_all, attr: string, rgb: string, alpha: string) =>
    `${attr}="${rgb}" ${attr === "stop-color" ? "stop" : attr}-opacity="${(parseInt(alpha, 16) / 255).toFixed(6)}"`);
}
export function tikzOpacity(color: string, kind: "draw" | "fill" | "text"): string {
  const alpha = colorAlpha(color);
  return alpha === 1 ? "" : `, ${kind} opacity=${Number(alpha.toFixed(6))}`;
}
