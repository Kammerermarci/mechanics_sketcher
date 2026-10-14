import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { make_gcs_wrapper } from "@salusoft89/planegcs";
import { type Sketch, type Spline, addPoint, addLine, addCircle, addSymbol, emptySketch, entity, point, remove, serialize, deserialize, curvePoints, geometryBox, addConstraint } from "../src/model";
import { addSpline, splineCubics, joinSplines, reverseSpline, closeSpline, openSpline, splitSpline, subdivideSpline, smoothSplineNode } from "../src/splines";
import { cubicAt, cubicBounds, splitCubic, type Cubic } from "../src/bezier";
import { fillOutlines, primDistance, buildPrims } from "../src/prims";
import { toSvg, toTikz } from "../src/export";
import { defaultGradient, fillBounds } from "../src/gradient-fill";
import { copyObjects, pasteObjects, readObjectClipboard } from "../src/object-clipboard";
import { linearCopy, mirrorCopy, circularCopy } from "../src/pattern";
import { regionAt } from "../src/regions";
import { SketchSolver } from "../src/solver";
import { History } from "../src/history";
import { App } from "../src/app";
import type { V } from "../src/geom";

let solver: SketchSolver;
beforeAll(async()=>{solver=new SketchSolver(await make_gcs_wrapper());});
afterAll(()=>solver.dispose());
function curve(sk: Sketch, cubic: Cubic=[[0,0],[0,4],[4,4],[4,0]]): Spline {
  const ids=cubic.map((v)=>addPoint(sk,...v).id);
  return addSpline(sk,[{p1:ids[0],c1:ids[1],c2:ids[2],p2:ids[3]}]);
}
function filled() {
  const sk=emptySketch(),s=curve(sk);closeSpline(sk,s);
  const fill=addSymbol(sk,{type:"fill",color:"#1565c0",points:[],arcs:[],curves:[s.id],holes:[]});
  return {sk,s,fill};
}
function expectPoint(actual: V, wanted: V) {actual.forEach((v,i)=>expect(v).toBeCloseTo(wanted[i],8));}

describe("Bézier geometry",()=>{
  it("finds the true curve bounds rather than including the control polygon",()=>{
    const c:Cubic=[[0,0],[0,4],[4,4],[4,0]];
    expect(cubicBounds(c)).toEqual({x0:0,y0:0,x1:4,y1:3});
    const sk=emptySketch();curve(sk,c);expect(geometryBox(sk)).toEqual(cubicBounds(c));
  });
  it("subdivides without changing any position along the curve",()=>{
    const c:Cubic=[[0,0],[3,8],[-2,5],[4,-1]], [a,b]=splitCubic(c);
    for(let i=0;i<=20;i++){const t=i/20;expectPoint(cubicAt(t<=0.5?a:b,t<=0.5?2*t:2*t-1),cubicAt(c,t));}
  });
  it("hits a curved segment and misses empty space inside its control polygon",()=>{
    const sk=emptySketch(),s=curve(sk);
    const p=buildPrims(sk,1,{editor:false}).find((p)=>p.ref===s.id)!;
    expect(primDistance(p,[2,3])).toBeLessThan(0.01);
    expect(primDistance(p,[2,4])).toBeGreaterThan(0.9);
  });
});

describe("spline editing",()=>{
  it("keeps successive anchors in one continuous spline with matching tangents",()=>{
    const sk=emptySketch();
    const app=Object.assign(Object.create(App.prototype),{sk,view:{scale:40},selection:new Set(),constructing:false,pending:null,touch:vi.fn(),finishDrawing:vi.fn()});
    app.appendSplineNode({pos:[0,0]},[1,1]);
    expect(sk.entities).toHaveLength(1);
    app.appendSplineNode({pos:[4,0]},[5,-1]);
    app.appendSplineNode({pos:[8,0]},[9,1]);
    const s=sk.entities.find((e):e is Spline=>e.type==="spline")!;
    expect(s.segments).toHaveLength(2);
    expect(s.segments[0].p2).toBe(s.segments[1].p1);
    const cubics=splineCubics(sk,s);
    expectPoint(cubics[0][2],[3,1]);expectPoint(cubics[1][1],[5,-1]);
    app.appendSplineNode({pos:[8,0],pointId:s.segments[1].p2});
    expect(s.segments).toHaveLength(2);
    expect(app.finishDrawing).toHaveBeenCalledTimes(2);
  });
  it("closes a continuous spline when the first anchor is clicked again",()=>{
    const sk=emptySketch(),app=Object.assign(Object.create(App.prototype),{sk,view:{scale:40},selection:new Set(),pending:null,touch:vi.fn(),finishDrawing:vi.fn()});
    app.appendSplineNode({pos:[0,0]},[0,2]);app.appendSplineNode({pos:[4,0]},[4,-2]);
    const s=sk.entities.find((e):e is Spline=>e.type==="spline")!;
    app.appendSplineNode({pos:[0,0],pointId:s.segments[0].p1});
    expect(s.closed).toBe(true);expect(s.segments.at(-1)!.p2).toBe(s.segments[0].p1);expect(app.pending).toBeNull();
  });
  it.each([false,true])("joins the nearest endpoints and preserves both original shapes (reverse=%s)",(reverse)=>{
    const sk=emptySketch(),a=curve(sk),b=curve(sk,[[7,0],[7,-3],[10,-3],[10,0]]);
    const original=splineCubics(sk,b)[0];if(reverse)reverseSpline(b);
    expect(joinSplines(sk,a,b)).toBe(a);expect(a.segments).toHaveLength(3);
    expect(splineCubics(sk,a)[2]).toEqual(original);
    expect(entity(sk,b.id)).toBeUndefined();expect(solver.solve(sk).ok).toBe(true);
  });
  it("ties coincident endpoints together without adding a zero-length bridge",()=>{
    const sk=emptySketch(),a=curve(sk),b=curve(sk,[[4,0],[5,1],[6,1],[7,0]]);
    joinSplines(sk,a,b);expect(a.segments).toHaveLength(2);
    expect(sk.constraints.some((c)=>c.type==="coincident")).toBe(true);
    expect(solver.solve(sk).ok).toBe(true);
  });
  it("refuses joining closed curves without changing either curve",()=>{
    const sk=emptySketch(),a=curve(sk),b=curve(sk);closeSpline(sk,a);const saved=serialize(sk);
    expect(joinSplines(sk,a,b)).toBeTypeOf("string");expect(serialize(sk)).toBe(saved);
  });
  it("opens without changing shape and splits with independent endpoints",()=>{
    const sk=emptySketch(),s=curve(sk);closeSpline(sk,s);const closed=splineCubics(sk,s);
    openSpline(sk,s);expect(splineCubics(sk,s)).toEqual(closed);expect(s.closed).toBeUndefined();
    const result=splitSpline(sk,s,s.segments[1].p1);expect(typeof result).not.toBe("string");
    const tail=result as Spline;
    expect(splineCubics(sk,s)[0]).toEqual(closed[0]);expect(splineCubics(sk,tail)[0]).toEqual(closed[1]);
    expect(s.segments[0].p2).not.toBe(tail.segments[0].p1);
  });
  it("inserts a midpoint without changing shape or retaining unused old handles",()=>{
    const sk=emptySketch(),s=curve(sk),original=splineCubics(sk,s)[0],old=s.segments[0];
    subdivideSpline(sk,s,0);expect(s.segments).toHaveLength(2);expect(entity(sk,old.c1)).toBeUndefined();
    for(let i=0;i<=20;i++){const t=i/20,c=splineCubics(sk,s);expectPoint(cubicAt(c[t<=0.5?0:1],t<=0.5?2*t:2*t-1),cubicAt(original,t));}
  });
  it("aligns the two tangent handles of an interior node",()=>{
    const sk=emptySketch(),s=curve(sk);closeSpline(sk,s);openSpline(sk,s);
    const node=s.segments[0].p2;
    expect(smoothSplineNode(sk,s,node)).toBe(true);
    const p=point(sk,node),a=point(sk,s.segments[0].c2),b=point(sk,s.segments[1].c1);
    expect((a.x-p.x)*(b.y-p.y)-(a.y-p.y)*(b.x-p.x)).toBeCloseTo(0,8);
  });
  it("carries adjacent handles when moving an anchor and all handles when moving the spline",()=>{
    const sk=emptySketch(),s=curve(sk),node=s.segments[0].p1;
    const app=Object.assign(Object.create(App.prototype),{sk,selection:new Set([node]),view:{scale:40,cx:0,cy:0,w:800,h:600}});
    const d=app.startMove(node,[400,300],false);
    expect(d.targets.map((p:{id:string})=>p.id)).toEqual(expect.arrayContaining([node,s.segments[0].c1]));expect(d.group).toBe(true);
    app.selection=new Set([s.id]);expect(app.startMove(s.id,[400,300],false).targets).toHaveLength(4);
  });
  it("uses the standard thickness slider for live spline edits, grouped changes and reset",()=>{
    const sk=emptySketch(),a=curve(sk),b=curve(sk,[[6,0],[6,4],[10,4],[10,0]]);
    const render=vi.fn(),commit=vi.fn();
    const app=Object.assign(Object.create(App.prototype),{sk,selection:new Set([a.id,b.id]),render,commit});
    app.onPanelChange({dataset:{field:"weight"},value:"1.7"},true);
    expect(a.weight).toBe(1.7);expect(b.weight).toBe(1.7);expect(render).toHaveBeenCalledOnce();expect(commit).not.toHaveBeenCalled();
    app.onPanelChange({dataset:{field:"weight"},value:"1.7"});expect(commit).toHaveBeenCalledOnce();
    app.resetWeight();expect(a.weight).toBeUndefined();expect(b.weight).toBeUndefined();
    app.selection=new Set([a.segments[0].p1]);
    app.onPanelChange({dataset:{field:"weight"},value:"0"});expect(a.weight).toBe(0);expect(b.weight).toBeUndefined();
  });
  it("smooths a clicked corner by creating nonzero tangent handles",()=>{
    const sk=emptySketch();
    const app=Object.assign(Object.create(App.prototype),{sk,view:{scale:40},selection:new Set(),pending:null,touch:vi.fn(),finishDrawing:vi.fn()});
    app.appendSplineNode({pos:[0,0]});app.appendSplineNode({pos:[3,2]});app.appendSplineNode({pos:[6,0]});
    const s=sk.entities.find((e):e is Spline=>e.type==="spline")!;
    expect(smoothSplineNode(sk,s,s.segments[0].p2)).toBe(true);
    const c=splineCubics(sk,s);expect(c[0][2][0]).toBeLessThan(3);expect(c[1][1][0]).toBeGreaterThan(3);
    expect(c[0][2][1]).toBeCloseTo(2);expect(c[1][1][1]).toBeCloseTo(2);
  });
});

describe("closed spline fills and integration",()=>{
  it.each([undefined,"linear","radial"] as const)("fills cubic outlines with %s gradients in SVG and TikZ",(type)=>{
    const {sk,s,fill}=filled();if(type)fill.gradient=defaultGradient(type);
    expect(regionAt(sk,[2,1])).toEqual({kind:"spline",spline:s.id,holes:[]});
    const outlines=fillOutlines(sk,fill,1);
    expect(outlines[0].kind).toBe("path");expect(fillBounds(outlines)).toEqual({x0:0,y0:0,x1:4,y1:3});
    const svg=toSvg(sk)!;expect(svg).toContain('fill-rule="evenodd"');expect(svg).toContain("C");
    const tikz=toTikz(sk)!;expect(tikz).toContain(".. controls");expect(tikz).toContain("even odd rule");
    if(type)expect(svg).toContain(type==="linear"?"<linearGradient":"<radialGradient");
    openSpline(sk,s);expect(fillOutlines(sk,fill,1)).toEqual([]);
  });
  it("keeps circles inside a spline unfilled",()=>{
    const {sk,s,fill}=filled(),center=addPoint(sk,2,1),hole=addCircle(sk,center.id,0.25);
    const region=regionAt(sk,[1,1]);expect(region).toEqual({kind:"spline",spline:s.id,holes:[hole.id]});
    fill.holes=[hole.id];expect(fillOutlines(sk,fill,1)).toHaveLength(2);
  });
  it("saves, loads, copies and pastes the curve and its fill with independent IDs",()=>{
    const {sk,s}=filled();expect(deserialize(serialize(sk))).toEqual(sk);
    const copied=readObjectClipboard(JSON.stringify(copyObjects(sk,[s.id])))!;expect(copied).not.toBeNull();
    const target=emptySketch(),made=pasteObjects(target,copied,[20,0]);
    const pasted=target.entities.find((e):e is Spline=>e.type==="spline")!;
    expect(made).toContain(pasted.id);expectPoint(splineCubics(target,pasted)[0][0],[20,0]);
    expect(target.symbols.filter((s)=>s.type==="fill")).toHaveLength(1);
    expect(solver.solve(target).ok).toBe(true);
  });
  it.each(["linear","mirror","circular"])("copies splines and attached fills in a %s pattern",(kind)=>{
    const {sk,s}=filled();
    const a=addPoint(sk,-2,-10),b=addPoint(sk,-2,10),axis=addLine(sk,a.id,b.id);
    const result=kind==="linear"?linearCopy(sk,[s.id],2,[10,0]):kind==="mirror"?mirrorCopy(sk,[s.id],axis.id):circularCopy(sk,[s.id],a.id,2,Math.PI/2);
    expect(typeof result).not.toBe("string");expect(sk.entities.filter((e)=>e.type==="spline")).toHaveLength(2);
    expect(sk.symbols.filter((s)=>s.type==="fill")).toHaveLength(2);expect(solver.solve(sk).ok).toBe(true);
  });
  it("deletes spline geometry, orphan controls and its fill together",()=>{
    const {sk,s}=filled();remove(sk,[s.id]);expect(sk.entities).toHaveLength(1);expect(sk.symbols).toHaveLength(0);
  });
  it("supports point constraints and undo/redo after curve edits",()=>{
    const sk=emptySketch(),s=curve(sk),history=new History();history.reset(sk);
    addConstraint(sk,{type:"fixed",p:s.segments[0].p1});expect(solver.solve(sk).ok).toBe(true);
    closeSpline(sk,s);history.commit(sk);expect(history.undo()!.entities.find((e)=>e.type==="spline")).not.toHaveProperty("closed");
    expect(history.redo()!.entities.find((e)=>e.type==="spline")).toHaveProperty("closed",true);
    expect(curvePoints(s)).toHaveLength(6);
  });
  it("rejects malformed saved spline references",()=>{
    const sk=emptySketch(),s=curve(sk);s.segments[0].c1="missing";expect(()=>deserialize(serialize(sk))).toThrow("invalid spline");
  });
});
