// Functions of one variable, as they are typed: 2x + 1, sin(x), -q x^2 / 2.
// A typed function is read into a tree once; the tree is worked out for a
// value of x to draw it, and written out again in the notation pgfplots
// reads. Nothing typed is ever run as code.

export type Expr =
  | { k: "num"; v: number }
  | { k: "var" }
  | { k: "const"; name: "pi" | "e" }
  | { k: "neg"; a: Expr }
  | { k: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Expr; b: Expr }
  | { k: "call"; fn: string; args: Expr[] };

/** What is wrong with a typed function, in words for whoever typed it. */
export class ExprError extends Error {}

interface Fn {
  /** How many arguments it takes. */
  n: number;
  f: (...a: number[]) => number;
  /** Its name in pgfplots, where that differs. */
  pgf?: string;
}

const FUNCTIONS: Record<string, Fn> = {
  sin: { n: 1, f: Math.sin }, cos: { n: 1, f: Math.cos }, tan: { n: 1, f: Math.tan },
  asin: { n: 1, f: Math.asin }, acos: { n: 1, f: Math.acos }, atan: { n: 1, f: Math.atan },
  sinh: { n: 1, f: Math.sinh }, cosh: { n: 1, f: Math.cosh }, tanh: { n: 1, f: Math.tanh },
  exp: { n: 1, f: Math.exp }, ln: { n: 1, f: Math.log },
  log: { n: 1, f: Math.log10, pgf: "log10" }, log2: { n: 1, f: Math.log2 },
  sqrt: { n: 1, f: Math.sqrt }, abs: { n: 1, f: Math.abs }, sign: { n: 1, f: Math.sign },
  floor: { n: 1, f: Math.floor }, ceil: { n: 1, f: Math.ceil }, round: { n: 1, f: Math.round },
  min: { n: 2, f: Math.min }, max: { n: 2, f: Math.max },
};
/** Other names the same functions go by. */
const ALIASES: Record<string, string> = {
  arcsin: "asin", arccos: "acos", arctan: "atan", arctg: "atan", tg: "tan", sh: "sinh", ch: "cosh", th: "tanh",
  lg: "log", log10: "log", sgn: "sign",
};
/** The names the variable goes by: x, or t where the plot is over time. */
const VARIABLES = new Set(["x", "t"]);

/** The functions that can be used, for whoever wants the list. */
export const FUNCTION_NAMES = Object.keys(FUNCTIONS);

type Token =
  | { t: "num"; v: number }
  | { t: "name"; v: string }
  | { t: "op"; v: "+" | "-" | "*" | "/" | "^" | "(" | ")" | "," };

function tokens(src: string): Token[] {
  const out: Token[] = [];
  /** For each open bracket, whether it holds the arguments of a function that takes several. */
  const lists: boolean[] = [];
  // Signs a keyboard or a pasted formula may bring in place of the plain ones.
  const s = src.replace(/[−–]/g, "-").replace(/[·×∙⋅]/g, "*").replace(/[÷:]/g, "/").replace(/π/g, " pi ").replace(/²/g, "^2").replace(/³/g, "^3");
  for (let i = 0; i < s.length;) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      // A number, with a point or a comma before its decimals. Inside min(…) and max(…) a comma parts the arguments instead.
      const decimal = lists[lists.length - 1] ? "\\." : "[.,]";
      const m = new RegExp(`^(?:[0-9]+(?:${decimal}[0-9]+)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?`).exec(s.slice(i));
      if (!m) throw new ExprError(`A number cannot start with "${ch}".`);
      out.push({ t: "num", v: Number(m[0].replace(",", ".")) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < s.length && /[A-Za-z_0-9]/.test(s[j])) j++;
      // log2 and log10 keep their digits; any other name ends where digits begin, so x2 is x times 2.
      let name = s.slice(i, j).toLowerCase();
      if (!(name in FUNCTIONS) && !(name in ALIASES)) {
        j = i;
        while (j < s.length && /[A-Za-z_]/.test(s[j])) j++;
        name = s.slice(i, j).toLowerCase();
      }
      out.push({ t: "name", v: name });
      i = j;
      continue;
    }
    if ("+-*/^(),;".includes(ch)) {
      const v = (ch === ";" ? "," : ch) as Extract<Token, { t: "op" }>["v"];
      if (v === "(") {
        const before = out[out.length - 1];
        const fn = before?.t === "name" ? FUNCTIONS[ALIASES[before.v] ?? before.v] : undefined;
        // With a semicolon between the values, a comma in there is a decimal comma after all.
        let depth = 0, semicolon = false;
        for (let j = i; j < s.length && depth >= 0; j++) {
          if (s[j] === "(") depth++;
          else if (s[j] === ")" && --depth === 0) break;
          else if (s[j] === ";" && depth === 1) semicolon = true;
        }
        lists.push(!!fn && fn.n > 1 && !semicolon);
      } else if (v === ")") lists.pop();
      out.push({ t: "op", v });
      i++;
      continue;
    }
    throw new ExprError(`"${ch}" is not something a function is written with.`);
  }
  return out;
}

/** Reads a typed function. Throws an ExprError that says what is wrong with it. */
export function parseExpr(src: string): Expr {
  const toks = tokens(src);
  if (!toks.length) throw new ExprError("Type a function of x, such as 2x + 1 or sin(x).");
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v: string) => { const t = toks[i]; return t?.t === "op" && t.v === v; };
  const shown = (t: Token | undefined) => (t ? `"${t.v}"` : "the end");

  const primary = (): Expr => {
    const t = toks[i++];
    if (!t) throw new ExprError("Something is missing at the end.");
    if (t.t === "num") return { k: "num", v: t.v };
    if (t.t === "op" && t.v === "(") {
      const inner = sum();
      if (!isOp(")")) throw new ExprError("A closing bracket is missing.");
      i++;
      return inner;
    }
    if (t.t === "name") {
      const name = ALIASES[t.v] ?? t.v;
      if (VARIABLES.has(name)) return { k: "var" };
      if (name === "pi" || name === "e") return { k: "const", name };
      const fn = FUNCTIONS[name];
      if (!fn) throw new ExprError(`"${t.v}" is not a name this knows. The variable is x; numbers are typed out.`);
      if (!isOp("(")) throw new ExprError(`${t.v} needs brackets: ${t.v}(x).`);
      i++;
      const args: Expr[] = [];
      if (!isOp(")")) {
        args.push(sum());
        while (isOp(",")) { i++; args.push(sum()); }
      }
      if (!isOp(")")) throw new ExprError(`The bracket after ${t.v} is not closed.`);
      i++;
      if (args.length !== fn.n) throw new ExprError(fn.n === 1 ? `${t.v} takes one value in its brackets.` : `${t.v} takes ${fn.n} values, with a semicolon between them.`);
      return { k: "call", fn: name, args };
    }
    throw new ExprError(`${shown(t)} is not expected there.`);
  };
  // A power takes what follows it whole, sign and all: 2^-x. It binds tighter than a sign in front: -x^2 is -(x^2).
  const power = (): Expr => {
    const base = primary();
    if (!isOp("^")) return base;
    i++;
    return { k: "bin", op: "^", a: base, b: unary() };
  };
  const unary = (): Expr => {
    if (isOp("-")) { i++; return { k: "neg", a: unary() }; }
    if (isOp("+")) { i++; return unary(); }
    return power();
  };
  const product = (): Expr => {
    let left = unary();
    for (;;) {
      const t = peek();
      if (isOp("*") || isOp("/")) {
        i++;
        left = { k: "bin", op: (t as { v: "*" | "/" }).v, a: left, b: unary() };
      } else if (t && (t.t === "num" || t.t === "name" || (t.t === "op" && t.v === "("))) {
        // Written side by side: 2x, 3(x + 1), x sin(x).
        left = { k: "bin", op: "*", a: left, b: power() };
      } else return left;
    }
  };
  const sum = (): Expr => {
    let left = product();
    while (isOp("+") || isOp("-")) {
      const op = (toks[i++] as { v: "+" | "-" }).v;
      left = { k: "bin", op, a: left, b: product() };
    }
    return left;
  };

  const tree = sum();
  if (i < toks.length) throw new ExprError(isOp(")") ? "There is a closing bracket too many." : `${shown(toks[i])} is not expected there.`);
  return tree;
}

/** The value of the function at x. Not a number where it has none: the root of a negative, a division by zero. */
export function evaluate(e: Expr, x: number): number {
  switch (e.k) {
    case "num": return e.v;
    case "var": return x;
    case "const": return e.name === "pi" ? Math.PI : Math.E;
    case "neg": return -evaluate(e.a, x);
    case "call": return FUNCTIONS[e.fn].f(...e.args.map((a) => evaluate(a, x)));
    case "bin": {
      const a = evaluate(e.a, x), b = evaluate(e.b, x);
      return e.op === "+" ? a + b : e.op === "-" ? a - b : e.op === "*" ? a * b : e.op === "/" ? a / b : Math.pow(a, b);
    }
  }
}

/** The highest power of x in it, when it is a polynomial; Infinity when it is not. */
export function degree(e: Expr): number {
  switch (e.k) {
    case "num": case "const": return 0;
    case "var": return 1;
    case "neg": return degree(e.a);
    case "call": return e.args.every((a) => degree(a) === 0) ? 0 : Infinity;
    case "bin": {
      const a = degree(e.a), b = degree(e.b);
      if (e.op === "+" || e.op === "-") return Math.max(a, b);
      if (e.op === "*") return a + b;
      if (e.op === "/") return b === 0 ? a : Infinity;
      if (b !== 0) return Infinity;
      if (a === 0) return 0;
      const n = evaluate(e.b, 0);
      return Number.isInteger(n) && n >= 0 ? a * n : Infinity;
    }
  }
}

/** A number as pgfplots reads it: plain digits, no more of them than a double holds. */
export function pgfNumber(v: number): string {
  if (!Number.isFinite(v)) return "0";
  const s = String(Number(v.toPrecision(12)));
  return s.includes("e") ? Number(v.toPrecision(12)).toFixed(12).replace(/\.?0+$/, "") : s;
}

/**
 * The function in the notation of pgfplots, for \addplot {…}. Brackets are
 * written wherever the order could be read another way, since pgfplots does
 * not rank a leading minus and a power the way mathematics does.
 */
export function toPgf(e: Expr): string {
  const atom = (x: Expr): string => {
    const s = toPgf(x);
    return x.k === "var" || x.k === "const" || x.k === "call" || (x.k === "num" && x.v >= 0) ? s : `(${s})`;
  };
  switch (e.k) {
    case "num": return pgfNumber(e.v);
    case "var": return "x";
    case "const": return e.name;
    case "neg": return `-${atom(e.a)}`;
    case "call": return `${FUNCTIONS[e.fn].pgf ?? e.fn}(${e.args.map(toPgf).join(", ")})`;
    case "bin": {
      if (e.op === "^") return `${atom(e.a)}^${atom(e.b)}`;
      if (e.op === "*" || e.op === "/") {
        // A sum on either side needs its brackets, and so does anything after a division sign.
        const side = (x: Expr, right: boolean) => {
          // A minus sign in front of the first factor reads the same either way: -5*x is (-5)*x.
          const signed = x.k === "neg" || (x.k === "num" && x.v < 0);
          const loose = (signed && (right || (x.k === "neg" && x.a.k === "bin"))) || (x.k === "bin" && (x.op === "+" || x.op === "-" || (right && e.op === "/" && x.op !== "^")));
          return loose ? `(${toPgf(x)})` : toPgf(x);
        };
        return `${side(e.a, false)}${e.op}${side(e.b, true)}`;
      }
      const right = e.b.k === "neg" || (e.b.k === "num" && e.b.v < 0) || (e.op === "-" && e.b.k === "bin" && (e.b.op === "+" || e.b.op === "-")) ? `(${toPgf(e.b)})` : toPgf(e.b);
      return `${toPgf(e.a)} ${e.op} ${right}`;
    }
  }
}
