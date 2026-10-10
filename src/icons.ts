// Icons, drawn on a 20 x 20 grid. Toolbar buttons and the constraint markers
// on the canvas share them.

const dot = (x: number, y: number, r = 1.7) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;

export const ICONS: Record<string, string> = {
  select: `<path d="M5 3l10.5 7.2-4.6.9 2.6 5.2-2 1-2.6-5.2L5 15.6z" fill="currentColor" stroke="none"/>`,
  point: `<path d="M10 2.5v4M10 13.5v4M2.5 10h4M13.5 10h4"/>${dot(10, 10, 2)}`,
  line: `<path d="M4.5 15.5l11-11"/>${dot(4.5, 15.5)}${dot(15.5, 4.5)}`,
  circle: `<circle cx="10" cy="10" r="6.8"/>${dot(10, 10, 1.3)}`,
  arc: `<path d="M4 15.5A11.5 11.5 0 0 1 15.5 4"/>${dot(4, 15.5)}${dot(15.5, 4)}${dot(15.5, 15.5, 1.3)}`,

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

  centerline: `<path d="M3 17l4.2-4.2M8.6 11.4l.8-.8M10.8 9.2L15 5M16.2 3.8l.8-.8"/>`,
  trim: `<path d="M3 15h5.5M11.5 15H17" stroke-dasharray="none"/><path d="M8.5 15h3" stroke-dasharray="1.2 1.6" stroke-width="1.2"/><path d="M6 4l8 9M14 4l-8 9" stroke-width="1.3"/>`,

  undo: `<path d="M7.5 4.5l-4 4 4 4"/><path d="M3.5 8.5h8a4.3 4.3 0 0 1 0 8.6H9"/>`,
  redo: `<path d="M12.5 4.5l4 4-4 4"/><path d="M16.5 8.5h-8a4.3 4.3 0 0 0 0 8.6H11"/>`,
  fit: `<path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/><rect x="7" y="7" width="6" height="6" stroke-width="1.2"/>`,
  trash: `<path d="M4 6h12M8 6V4h4v2M6 6l.8 11h6.4L14 6"/>`,
};

export function icon(name: string, size = 20): string {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
}
