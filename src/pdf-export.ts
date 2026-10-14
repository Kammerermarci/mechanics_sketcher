// Convert our own SVG exports, including outlined labels, to a vector PDF.

/** A single page at the SVG's physical size, including its existing margin. */
export async function svgToPdf(source: string): Promise<Blob> {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  const svg = parsed.documentElement;
  if (parsed.querySelector("parsererror") || svg.localName !== "svg") {
    throw new Error("The exported SVG could not be read.");
  }
  const mm = (name: string): number => {
    const value = svg.getAttribute(name) ?? "";
    if (!/^\d+(?:\.\d+)?mm$/.test(value)) throw new Error("The figure has no valid physical size.");
    return parseFloat(value);
  };
  const width = mm("width"), height = mm("height");
  // jsPDF otherwise silently clamps pages at the PDF maximum of 14,400 pt.
  if (!(width > 0 && height > 0) || Math.max(width, height) > 5080) {
    throw new Error("PDF page dimensions must be greater than zero and at most 5080 mm. Reduce the export size.");
  }
  // These browser-only libraries are needed only when a PDF is requested.
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  const pdf = new jsPDF({
    orientation: width > height ? "landscape" : "portrait",
    unit: "mm", format: [width, height], compress: true, precision: 12,
  });
  await svg2pdf(svg, pdf, { x: 0, y: 0, width, height });
  return pdf.output("blob");
}
