"""Convert the supplied, local SVG support artwork to exportable vector points.

Run from the project root with Python. No third-party packages are required.
The source artwork is retained in docs/custom-supports.svg.
"""
import json
import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SVG = "{http://www.w3.org/2000/svg}"
SODI = "{http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd}"
IDENTITY = (1, 0, 0, 1, 0, 0)


def multiply(a, b):
    return (a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
            a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
            a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5])


def transform(text):
    result = IDENTITY
    for name, args in re.findall(r"(\w+)\(([^)]*)\)", text or ""):
        v = [float(x) for x in re.split(r"[,\s]+", args.strip())]
        if name == "matrix": m = tuple(v)
        elif name == "translate": m = (1, 0, 0, 1, v[0], v[1] if len(v) > 1 else 0)
        elif name == "scale": m = (v[0], 0, 0, v[-1], 0, 0)
        else: raise ValueError(f"Unsupported transform: {name}")
        result = multiply(result, m)
    return result


def at(m, x, y):
    return [m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5]]


def path_points(node):
    if node.get(SODI + "type") == "arc":
        cx, cy, rx, ry, start, end = [float(node.get(SODI + key)) for key in ("cx", "cy", "rx", "ry", "start", "end")]
        return [[cx + rx*math.cos(start+(end-start)*i/32), cy + ry*math.sin(start+(end-start)*i/32)] for i in range(33)], False
    tokens = re.findall(r"[MmLlHhVvZz]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?", node.get("d", ""))
    points, i, x, y, command, closed = [], 0, 0, 0, "", False
    while i < len(tokens):
        if tokens[i].isalpha():
            command = tokens[i]; i += 1
        if command.lower() == "z": closed = True; continue
        if command.lower() in ("m", "l"):
            a, b = float(tokens[i]), float(tokens[i+1]); i += 2
            x, y = (x+a, y+b) if command.islower() else (a, b)
            if command.lower() == "m": command = "l" if command.islower() else "L"
        elif command.lower() == "h":
            a = float(tokens[i]); i += 1; x = x+a if command.islower() else a
        elif command.lower() == "v":
            a = float(tokens[i]); i += 1; y = y+a if command.islower() else a
        else: raise ValueError(f"Unsupported path command: {command}")
        points.append([x, y])
    return points, closed


def rectangle(node):
    x, y, w, h = [float(node.get(k, "0")) for k in ("x", "y", "width", "height")]
    rx = min(float(node.get("rx", "0")), w/2)
    ry = min(float(node.get("ry", str(rx))), h/2)
    if not rx or not ry: return [[x, y], [x+w, y], [x+w, y+h], [x, y+h]]
    points = []
    for cx, cy, start in [(x+w-rx, y+ry, -math.pi/2), (x+w-rx, y+h-ry, 0), (x+rx, y+h-ry, math.pi/2), (x+rx, y+ry, math.pi)]:
        points.extend([[cx+rx*math.cos(start+i*math.pi/16), cy+ry*math.sin(start+i*math.pi/16)] for i in range(9)])
    return points


tree = ET.parse(ROOT / "docs/custom-supports.svg").getroot()
layers = {"layer1": "pin", "layer2": "roller", "layer3": "fixed"}
shapes = {kind: [] for kind in layers.values()}
anchors = {}


def visit(node, parent=IDENTITY, inherited=None, kind=None):
    matrix = multiply(parent, transform(node.get("transform")))
    style = dict(inherited or {})
    style.update(dict(item.split(":", 1) for item in node.get("style", "").split(";") if ":" in item))
    kind = layers.get(node.get("id"), kind)
    tag = node.tag.removeprefix(SVG)
    if kind and tag in ("path", "rect", "circle"):
        fill = style.get("fill", "#000000")
        stroke = style.get("stroke", "none")
        width = float(style.get("stroke-width", "1")) * math.hypot(matrix[0], matrix[1])
        if tag == "circle":
            center = at(matrix, float(node.get("cx")), float(node.get("cy")))
            shape = {"kind": "circle", "center": center, "radius": float(node.get("r"))*math.hypot(matrix[0], matrix[1])}
            if node.get("id") == "path7518-2-5-4-7": anchors["pin"] = center
            if node.get("id") == "path7518-2-5-4": anchors["roller"] = center
            # This pin's hinge was stored in the roller layer in the source SVG.
            if node.get("id") == "path7518-2-5-4-7": kind = "pin"
        else:
            points, closed = (rectangle(node), True) if tag == "rect" else path_points(node)
            points = [at(matrix, *p) for p in points]
            shape = {"kind": "path", "points": points, "closed": closed}
            if node.get("id") == "path42734-9": anchors["fixed"] = [(points[0][0]+points[-1][0])/2, points[0][1]]
            area = sum(p[0]*q[1]-q[0]*p[1] for p, q in zip(points, points[1:]+points[:1]))
            if abs(area) < 1e-7: fill = "none"
        shape.update(fill=fill, stroke=stroke, width=width)
        shapes[kind].append(shape)
    for child in node: visit(child, matrix, style, kind)


visit(tree)
# Native reference millimetres to annotation millimetres, with y pointing up.
SCALE = 0.45
for kind, entries in shapes.items():
    anchor = anchors[kind]
    def normalize(p): return [round((p[0]-anchor[0])*SCALE, 6), round((anchor[1]-p[1])*SCALE, 6)]
    for shape in entries:
        if shape["kind"] == "circle":
            shape["center"] = normalize(shape["center"])
            shape["radius"] = round(shape["radius"]*SCALE, 6)
        else: shape["points"] = [normalize(p) for p in shape["points"]]
        shape["width"] = round(shape["width"]*SCALE, 6)

header = '// Generated from docs/custom-supports.svg by scripts/import_custom_supports.py.\n'
header += 'import type { V } from "./geom";\nimport type { SupportKind } from "./model";\n'
header += 'export type SupportShape = { fill: string; stroke: string; width: number } & ({ kind: "circle"; center: V; radius: number } | { kind: "path"; points: V[]; closed: boolean });\n'
(ROOT / "src/custom-support-shapes.ts").write_text(header + 'export const CUSTOM_SUPPORT_SHAPES: Record<SupportKind, SupportShape[]> = ' + json.dumps(shapes, separators=(',', ':')) + ';\n', encoding="utf-8")
