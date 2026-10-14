// A browser preference shared by math label previews and both exporters.
const STORAGE_KEY = "mech-sketch.preserveMathSpaces";
let preserveSpaces = true;
try { preserveSpaces = localStorage.getItem(STORAGE_KEY) !== "false"; } catch { /* Storage unavailable. */ }

export function preserveMathSpaces(): boolean { return preserveSpaces; }

export function setPreserveMathSpaces(enabled: boolean): void {
  preserveSpaces = enabled;
  try { localStorage.setItem(STORAGE_KEY, String(enabled)); } catch { /* Keep the session preference. */ }
}

/** Preserve typed gaps when enabled, while keeping command separators intact. */
export function labelTex(typed: string): string {
  const s = typed.trim().normalize("NFC");
  if (!preserveSpaces) return s;
  let out = "";
  for (let i = 0; i < s.length;) {
    if (s[i] === "\\") {
      let j = i + 1;
      if (j < s.length && /[a-zA-Z]/.test(s[j])) {
        while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;
        if (s[j] === " ") j++;
      } else j++; // Explicit control symbols such as "\ " and "\,".
      out += s.slice(i, j);
      i = j;
    } else {
      out += s[i] === " " ? "\\ " : s[i];
      i++;
    }
  }
  return out;
}
