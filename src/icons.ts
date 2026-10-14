// Icons, drawn on a 20 x 20 grid. Toolbar buttons and the constraint markers
// on the canvas share them.

const dot = (x: number, y: number, r = 1.7) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;

export const ICONS: Record<string, string> = {
  spline: `<path d="M3 15C4 1 16 19 17 5"/><path d="M3 15L4 3M17 5L16 17" stroke-dasharray="2 2"/>${dot(3,15)}${dot(17,5)}`,
  "join-splines": `<path d="M2 15C2 6 7 6 10 10S18 14 18 5"/>${dot(10,10)}<path d="M6 2h8M10 0v4"/>`,
  copyobjects: `<rect x="7" y="7" width="10" height="10" rx="1"/><path d="M12 7V3H3v9h4"/>`,
  pasteobjects: `<path d="M6 4H3v13h14V4h-3"/><rect x="6" y="2" width="8" height="4" rx="1"/><path d="M6 10h8M6 13h6"/>`,
  select: `<path d="M5 3l10.5 7.2-4.6.9 2.6 5.2-2 1-2.6-5.2L5 15.6z" fill="currentColor" stroke="none"/>`,
  point: `<path d="M10 2.5v4M10 13.5v4M2.5 10h4M13.5 10h4"/>${dot(10, 10, 2)}`,
  line: `<path d="M4.5 15.5l11-11"/>${dot(4.5, 15.5)}${dot(15.5, 4.5)}`,
  // The construction toggle: a dashed line between two points.
  construction: `<path d="M6 14l8-8" stroke-dasharray="2.200 2.700"/>${dot(4.5, 15.5)}${dot(15.5, 4.5)}`,
  circle: `<circle cx="10" cy="10" r="6.8"/>${dot(10, 10, 1.3)}`,
  arc: `<path d="M4 15.5A11.5 11.5 0 0 1 15.5 4"/>${dot(4, 15.5)}${dot(15.5, 4)}${dot(15.5, 15.5, 1.3)}`,
  rectangle: `<rect x="3" y="5" width="14" height="10"/>${dot(3, 5)}${dot(17, 15)}`,
  rectcenter: `<rect x="3" y="5" width="14" height="10"/><path d="M6 10h8M10 7v6" stroke-width="1"/>${dot(17, 15)}`,
  rect3: `<path d="M2 10l11-7 5 7-11 7z"/>${dot(2, 10)}${dot(13, 3)}${dot(18, 10)}`,
  arc3: `<path d="M3 14A7.5 7.5 0 0 1 17 14"/>${dot(3, 14)}${dot(17, 14)}${dot(10, 4.5)}`,
  chevron: `<path d="M5 8l5 5 5-5"/>`,
  gradient: `<rect x="3" y="4" width="14" height="12"/><path d="M5 5v10M7 5v10M9 5v10" stroke-width="1.4"/><path d="M11 5v10" stroke-width="1"/><path d="M13 5v10" stroke-width="0.5"/>`,
  radialgradient: `<rect x="3" y="3" width="14" height="14"/><circle cx="10" cy="10" r="5" stroke-width="0.6"/><circle cx="10" cy="10" r="3" stroke-width="1.2"/>${dot(10, 10)}`,

  horizontal: `<path d="M3 10h14"/><path d="M3 7.5v5M17 7.5v5" stroke-width="1.2"/>`,
  vertical: `<path d="M10 3v14"/><path d="M7.5 3h5M7.5 17h5" stroke-width="1.2"/>`,
  parallel: `<path d="M4.5 16l6-12M9.5 16l6-12"/>`,
  perpendicular: `<path d="M3.5 16h13M10 16V4"/>`,
  equal: `<path d="M4 7.5h12M4 12.5h12"/>`,
  coincident: `<circle cx="10" cy="10" r="5.5"/>${dot(10, 10, 2.2)}`,
  pointOn: `<path d="M3.5 15.5l13-11"/>${dot(10, 10, 2.4)}`,
  midpoint: `<path d="M3 10h14"/><path d="M3 7v6M17 7v6" stroke-width="1.2"/>${dot(10, 10, 2.4)}`,
  tangent: `<circle cx="9" cy="12.5" r="5"/><path d="M2.5 7.5h15"/>`,
  fixed: `<rect x="5" y="9" width="10" height="8" rx="1.5" fill="currentColor" stroke="none"/><path d="M7 9V7a3 3 0 0 1 6 0v2"/>`,
  dimension: `<path d="M3.5 5v10M16.5 5v10" stroke-width="1.2"/><path d="M4.5 10h11"/><path d="M7 8l-2.6 2L7 12M13 8l2.6 2L13 12" stroke-width="1.2"/>`,

  pin: `<path d="M10 4l-5 8.5h10z"/><path d="M3 12.5h14"/><path d="M5.5 12.5l-2 3M9.5 12.5l-2 3M13.5 12.5l-2 3M17 13.2l-1.5 2.3" stroke-width="1.1"/>`,
  roller: `<path d="M10 3.5l-4.5 7h9z"/><circle cx="7.6" cy="12.6" r="1.5" stroke-width="1.2"/><circle cx="12.4" cy="12.6" r="1.5" stroke-width="1.2"/><path d="M3 15h14"/><path d="M6 15l-1.6 2.5M10.5 15l-1.6 2.5M15 15l-1.6 2.5" stroke-width="1.1"/>`,
  wall: `<path d="M6.5 3v14"/><path d="M6.5 5l-3 2.5M6.5 9l-3 2.5M6.5 13l-3 2.5" stroke-width="1.1"/><path d="M6.5 10h11" stroke-width="2.2"/>`,
  frame: `<path d="M5 15.5V4M5 15.5h11.5"/><path d="M3 6.2l2-2.4 2 2.4M14.3 13.5l2.4 2-2.4 2" stroke-width="1.3"/>`,

  centermark: `<circle cx="10" cy="10" r="5.2"/><path d="M10 2v5M10 13v5M2 10h5M13 10h5M8.6 10h2.8M10 8.6v2.8" stroke-width="1.2"/>`,
  balloon: `<circle cx="12.5" cy="7.5" r="5"/><path d="M8.8 11.2L3 17"/><path d="M12.5 5.4v4.4M11.3 6.4l1.2-1" stroke-width="1.3"/>`,
  fill: `<path d="M4 16V8l6-4 6 4v8z" fill="currentColor" fill-opacity="0.28"/><path d="M4 16V8l6-4 6 4v8z"/>`,
  hatch: `<path d="M3 7h14" stroke-width="2"/><path d="M6 7l-3 5M10 7l-3 5M14 7l-3 5M18 7l-3 5" stroke-width="1.2"/>`,

  arrow: `<path d="M4 16l8.6-8.6"/><path d="M16.5 3.5l-1.9 6.9-5-5z" fill="currentColor" stroke="none"/>`,
  arcarrow: `<path d="M4.5 15.5A8.5 8.5 0 0 1 13 5.2"/><path d="M17.2 5.6l-6.2 3.1.9-6.6z" fill="currentColor" stroke="none"/>`,
  datum: `${dot(7.5, 12.5, 3.2)}<path d="M12.6 8.4l2.2-5.4 2.2 5.4M13.4 6.5h2.8" stroke-width="1.3"/>`,
  heart: `<path d="M10 16.5S3.5 12.6 3.5 8.2A3.5 3.5 0 0 1 10 6.4a3.5 3.5 0 0 1 6.5 1.8c0 4.4-6.5 8.3-6.5 8.3z"/>`,
  sliders: `<path d="M3 6h7.2M14.8 6H17M3 14h2.2M9.8 14H17"/><circle cx="12.5" cy="6" r="2.1"/><circle cx="7.5" cy="14" r="2.1"/>`,
  eye: `<path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z"/><circle cx="10" cy="10" r="2.4"/>`,

  // A slot: two half-circles joined by two lines, with its two centres.
  beam: `<path d="M6 6.2h8a3.8 3.8 0 0 1 0 7.6H6a3.8 3.8 0 0 1 0-7.6z"/>${dot(6, 10, 1.1)}${dot(14, 10, 1.1)}`,
  arcbeam: `<path d="M3.5 16A12.5 12.5 0 0 1 16 3.5a2.9 2.9 0 0 1 0 5.8A6.7 6.7 0 0 0 9.3 16a2.9 2.9 0 0 1-5.8 0z"/>${dot(6.4, 16, 1.1)}${dot(16, 6.4, 1.1)}`,
  mirror: `<path d="M10 2.5v15" stroke-dasharray="2 2.2" stroke-width="1.3"/><path d="M7.4 6v8H3z"/><path d="M12.6 6v8H17z" fill="currentColor" fill-opacity="0.3"/>`,
  // The markers of the links and the buttons that make them share these.
  shift: `<rect x="2.3" y="7" width="4" height="6" rx="0.6" fill="currentColor" stroke="none"/><rect x="8.2" y="7" width="3.6" height="6" rx="0.6" stroke-width="1.3"/><rect x="13.9" y="7" width="3.6" height="6" rx="0.6" stroke-width="1.3"/>`,
  turn: `${dot(10, 10, 1.1)}${dot(16, 10, 1.9)}<circle cx="13" cy="15.2" r="1.6" stroke-width="1.2"/><circle cx="7" cy="15.2" r="1.6" stroke-width="1.2"/><circle cx="4" cy="10" r="1.6" stroke-width="1.2"/><circle cx="7" cy="4.8" r="1.6" stroke-width="1.2"/><circle cx="13" cy="4.8" r="1.6" stroke-width="1.2"/>`,
  note: `<path d="M4.5 6.5V4.5h11v2M10 4.5v11M7.8 15.5h4.4"/>`,
  help: `<circle cx="10" cy="10" r="7.3"/><path d="M7.7 8.1a2.4 2.4 0 1 1 3.5 2.1c-.8.5-1.2 1-1.2 1.9"/>${dot(10, 14.4, 0.95)}`,
  close: `<path d="M5 5l10 10M15 5L5 15"/>`,
  report: `<path d="M4.2 4h11.6a1.7 1.7 0 0 1 1.7 1.7v6.6a1.7 1.7 0 0 1-1.7 1.7H9.6L6 17v-3H4.2a1.7 1.7 0 0 1-1.7-1.7V5.7A1.7 1.7 0 0 1 4.2 4z"/><path d="M10 6.6v3"/>${dot(10, 11.6, 0.9)}`,

  // Loads: a force arriving at a beam, a row of them under their envelope, and a moment about a point.
  load: `<path d="M10 2.5v9.2"/><path d="M10 15.6l-3.2-5.4h6.4z" fill="currentColor" stroke="none"/><path d="M3 16.5h14"/>`,
  lineload: `<path d="M3 4.5h14" stroke-width="1.3"/><path d="M4.5 4.5v7M10 4.5v7M15.5 4.5v7" stroke-width="1.3"/><path d="M4.5 14.2l-1.9-3.2h3.8zM10 14.2l-1.9-3.2h3.8zM15.5 14.2l-1.9-3.2h3.8z" fill="currentColor" stroke="none"/><path d="M2.5 16.5h15"/>`,
  moment: `<path d="M15.6 12.9A6.2 6.2 0 1 1 13.2 4.7"/><path d="M16.9 6.6l-5.6.6 3.2-5z" fill="currentColor" stroke="none"/>${dot(10, 10, 1.3)}`,

  centerline: `<path d="M3 17l4.2-4.2M8.6 11.4l.8-.8M10.8 9.2L15 5M16.2 3.8l.8-.8"/>`,
  // Scissors over a line they have cut a piece out of.
  trim: `<path d="M2.5 15.5h5M12.5 15.5h5"/><circle cx="6.2" cy="4.6" r="1.9" stroke-width="1.4"/><circle cx="13.8" cy="4.6" r="1.9" stroke-width="1.4"/><path d="M7.4 6.1l5.4 7.6M12.6 6.1l-5.4 7.6" stroke-width="1.5"/>`,

  undo: `<path d="M7.5 4.5l-4 4 4 4"/><path d="M3.5 8.5h8a4.3 4.3 0 0 1 0 8.6H9"/>`,
  redo: `<path d="M12.5 4.5l4 4-4 4"/><path d="M16.5 8.5h-8a4.3 4.3 0 0 0 0 8.6H11"/>`,
  fit: `<path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/><rect x="7" y="7" width="6" height="6" stroke-width="1.2"/>`,
  trash: `<path d="M4 6h12M8 6V4h4v2M6 6l.8 11h6.4L14 6"/>`,

  // The Plot workspace: a pair of axes with a plus, a curve over axes, a range being stretched, and two sheets.
  plotnew: `<path d="M4 3.5V16h12.5" stroke-width="1.3"/><path d="M12.5 4v6M9.5 7h6"/>`,
  curve: `<path d="M3.5 3.5V16.5h13" stroke-width="1.2"/><path d="M5 13.5c2.2 0 2.6-8 5-8s2.8 6.500 6 6.500"/>`,
  // A curve that comes back on itself, over axes: one given by a parameter.
  param: `<path d="M3.500 3.500V16.500h13" stroke-width="1.200"/><ellipse cx="11" cy="9" rx="4.600" ry="3.400" transform="rotate(-24 11 9)"/>`,
  // Flip axes: a pair of axes, and a turn from the one across to the one up and back.
  flipaxes: `<path d="M3 3v14h14"/><path d="M13 15A8 8 0 0 0 5 7" stroke-width="1.4"/><path d="M11 12.9l2 2.1 2-2.1M7.1 5L5 7l2.1 2" stroke-width="1.4"/>`,
  fity: `<path d="M10 3v14M7 5.800L10 3l3 2.800M7 14.200L10 17l3-2.800"/><path d="M3.500 3h3M3.500 17h3M13.500 3h3M13.500 17h3" stroke-width="1.2"/>`,
  // A plot laid along a member: a hump over a line, with the strokes that tie it down.
  diagram: `<path d="M2.500 15h15"/><path d="M4 15c1.500-8 10.500-8 12 0"/><path d="M7 15v-4.500M10 15v-6M13 15v-4.500" stroke-width="1.1"/>`,
  copy: `<rect x="7" y="7" width="9.500" height="9.500" rx="1.500"/><path d="M4.500 13V5a1.500 1.500 0 0 1 1.500-1.500h7"/>`,

  // The Dynamics tab: a zigzag spring, a piston in its cylinder, a spiral, a damper bent round a joint,
  // and the quartered circle of a centre of mass.
  spring: `<path d="M2 10h2.500l1.300-4 2.600 8 2.600-8 2.600 8 1.300-4H18" stroke-width="1.4"/>`,
  damper: `<path d="M2 10h7.500M9.500 6.500v7M6.500 5h8v10h-8M14.500 10H18" stroke-width="1.4"/>`,
  spiral: `<path d="M9.3 11.2L9.6 11.4L10 11.5L10.4 11.4L10.9 11.1L11.2 10.6L11.3 10L11.2 9.4L10.9 8.7L10.3 8.2L9.5 8L8.6 8L7.7 8.4L7 9.1L6.5 10.1L6.5 11.2L6.8 12.3L7.5 13.3L8.6 14L9.9 14.3L11.3 14.1L12.6 13.4L13.6 12.2L14.1 10.7L14.1 9.1L13.5 7.5L12.4 6.2L10.8 5.4L8.9 5.1L7.1 5.5L5.4 6.6L4.2 8.2L3.6 10.2L3.7 12.3L4.7 14.3L6.2 15.9L8.3 16.9L10.7 17.1L13 16.5L15 15L16.5 12.9" stroke-width="1.3"/>`,
  arcdamper: `<path d="M15.2 17.2L15 15.6L14.7 14.1L14.2 12.6L13.4 11.2L12.6 9.9L11.5 8.7M13.1 7.1L9.9 10.3M11.1 13.6L10.5 12.5L9.7 11.4L8.8 10.5L7.7 9.7L6.6 9.1L9.4 3.3L11.3 4.4L13 5.7L14.5 7.2L15.8 8.9L16.9 10.8M8 6.2L6.4 5.6L4.7 5.2L3 5" stroke-width="1.3"/>${dot(3.2, 17, 1.4)}`,
  mass: `<circle cx="10" cy="10" r="6.500" stroke-width="1.3"/><path d="M10 10V3.500A6.500 6.500 0 0 1 16.500 10zM10 10v6.500A6.500 6.500 0 0 1 3.500 10z" fill="currentColor" stroke="none"/>`,
};

export function icon(name: string, size = 20): string {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
}
