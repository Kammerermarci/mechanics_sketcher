import { describe, it, expect } from "vitest";
import { parseExpr, evaluate, degree, toPgf, pgfNumber, ExprError } from "../src/expr";

const at = (src: string, x: number) => evaluate(parseExpr(src), x);

describe("typed functions", () => {
  it("reads sums, products, powers and brackets in their usual order", () => {
    expect(at("2x + 1", 3)).toBe(7);
    expect(at("2 + 3 * 4", 0)).toBe(14);
    expect(at("(2 + 3) * 4", 0)).toBe(20);
    expect(at("-x^2", 3)).toBe(-9);
    expect(at("2^-x", 1)).toBe(0.5);
    expect(at("2^3^2", 0)).toBe(512);
    expect(at("10 - 4 - 3", 0)).toBe(3);
    expect(at("8 / 4 / 2", 0)).toBe(1);
    expect(at("-5x^2/2 + 10x", 2)).toBe(10);
    expect(at("- - x", 2)).toBe(2);
  });

  it("takes things written side by side as a product", () => {
    expect(at("2x", 4)).toBe(8);
    expect(at("3(x + 1)", 1)).toBe(6);
    expect(at("(x + 1)(x - 1)", 3)).toBe(8);
    expect(at("2x^2", 3)).toBe(18);
    expect(at("x sin(x)", Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(at("2pi", 0)).toBeCloseTo(2 * Math.PI);
    expect(at("x2", 5)).toBe(10);
  });

  it("knows the usual functions and constants, under more than one name", () => {
    expect(at("sin(pi/2)", 0)).toBeCloseTo(1);
    expect(at("cos(x)", Math.PI)).toBeCloseTo(-1);
    expect(at("tg(x)", Math.PI / 4)).toBeCloseTo(1);
    expect(at("arctan(1)", 0)).toBeCloseTo(Math.PI / 4);
    expect(at("exp(1)", 0)).toBeCloseTo(Math.E);
    expect(at("ln(e)", 0)).toBeCloseTo(1);
    expect(at("lg(1000)", 0)).toBeCloseTo(3);
    expect(at("log2(8)", 0)).toBeCloseTo(3);
    expect(at("sqrt(x)", 16)).toBe(4);
    expect(at("abs(x)", -3)).toBe(3);
    expect(at("max(x; 2)", 1)).toBe(2);
    expect(at("min(2, 5)", 0)).toBe(2);
    expect(at("SIN(X)", 0)).toBe(0);
    // Over time, the variable may be called t.
    expect(at("3t", 2)).toBe(6);
  });

  it("takes a comma or a point before decimals, and the signs a keyboard may bring", () => {
    expect(at("2,5x", 2)).toBe(5);
    expect(at("0.5 + .5", 0)).toBe(1);
    expect(at("1e3 + 2e-1", 0)).toBeCloseTo(1000.2);
    expect(at("2e", 0)).toBeCloseTo(2 * Math.E);
    expect(at("x² − 2·x ÷ 4", 4)).toBe(14);
    expect(at("2π", 0)).toBeCloseTo(2 * Math.PI);
    // Inside min and max a comma parts the two values.
    expect(at("max(2,5)", 0)).toBe(5);
    expect(at("max(2.5; 1,5)", 0)).toBe(2.5);
  });

  it("has no value where the function has none", () => {
    expect(at("sqrt(x)", -1)).toBeNaN();
    expect(at("1/x", 0)).toBe(Infinity);
    expect(at("ln(x)", -2)).toBeNaN();
  });

  it("says what is wrong with what it cannot read", () => {
    const why = (src: string) => { try { parseExpr(src); return ""; } catch (e) { expect(e).toBeInstanceOf(ExprError); return (e as Error).message; } };
    expect(why("")).toMatch(/Type a function/);
    expect(why("   ")).toMatch(/Type a function/);
    expect(why("2 +")).toMatch(/missing at the end/);
    expect(why("(x + 1")).toMatch(/closing bracket is missing/);
    expect(why("x + 1)")).toMatch(/closing bracket too many/);
    expect(why("foo(x)")).toMatch(/"foo" is not a name/);
    expect(why("a x")).toMatch(/"a" is not a name/);
    expect(why("sin x")).toMatch(/sin needs brackets/);
    expect(why("sin()")).toMatch(/takes one value/);
    expect(why("max(x)")).toMatch(/takes 2 values/);
    expect(why("2 $ 3")).toMatch(/"\$" is not something/);
    expect(why("2 * / 3")).toMatch(/not expected/);
    // Nothing typed is run: this is just a name it does not know.
    expect(why("alert(1)")).toMatch(/not a name/);
  });

  it("tells a straight line from a curve", () => {
    expect(degree(parseExpr("5"))).toBe(0);
    expect(degree(parseExpr("2x + 1"))).toBe(1);
    expect(degree(parseExpr("-(3 - x)/4"))).toBe(1);
    expect(degree(parseExpr("x^2 - x"))).toBe(2);
    expect(degree(parseExpr("x(x + 1)"))).toBe(2);
    expect(degree(parseExpr("2^3 x"))).toBe(1);
    expect(degree(parseExpr("sin(2) x"))).toBe(1);
    expect(degree(parseExpr("sin(x)"))).toBe(Infinity);
    expect(degree(parseExpr("1/x"))).toBe(Infinity);
    expect(degree(parseExpr("x^0.5"))).toBe(Infinity);
    expect(degree(parseExpr("2^x"))).toBe(Infinity);
  });

  it("writes the function out for pgfplots with the order spelled out in brackets", () => {
    const pgf = (src: string) => toPgf(parseExpr(src));
    expect(pgf("2x + 1")).toBe("2*x + 1");
    expect(pgf("-x^2")).toBe("-(x^2)");
    expect(pgf("-5x^2/2 + 10x")).toBe("-5*x^2/2 + 10*x");
    expect(pgf("-(x + 1)x")).toBe("(-(x + 1))*x");
    expect(pgf("-x^2 x")).toBe("(-(x^2))*x");
    expect(pgf("(x + 1)(x - 1)")).toBe("(x + 1)*(x - 1)");
    expect(pgf("1/(2x)")).toBe("1/(2*x)");
    expect(pgf("x^(1/2)")).toBe("x^(1/2)");
    expect(pgf("2^-x")).toBe("2^(-x)");
    expect(pgf("(-x)^2")).toBe("(-x)^2");
    expect(pgf("3 - (x - 1)")).toBe("3 - (x - 1)");
    expect(pgf("3 - -x")).toBe("3 - (-x)");
    expect(pgf("2*-x")).toBe("2*(-x)");
    expect(pgf("lg(x) + ln(x) + sgn(x)")).toBe("log10(x) + ln(x) + sign(x)");
    expect(pgf("2,5 sin(pi t)")).toBe("2.5*sin(pi*x)");
    expect(pgf("max(x; 0)")).toBe("max(x, 0)");
    expect(pgfNumber(1e-7)).toBe("0.0000001");
    expect(pgfNumber(0.1 + 0.2)).toBe("0.3");
    // Read back, what was written is the same function.
    for (const src of ["-x^2", "-5x^2/2 + 10x", "2^-x", "1/(2x)", "3 - (x - 1)", "x^2^0.5", "8/4/2x", "-(-x)^3"]) {
      for (const x of [-1.5, 0.5, 2]) {
        const want = at(src, x), got = evaluate(parseExpr(pgf(src)), x);
        if (Number.isNaN(want)) expect(got, src).toBeNaN();
        else expect(got, src).toBeCloseTo(want, 9);
      }
    }
  });
});
