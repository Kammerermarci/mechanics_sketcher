import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app";
import { addLine, addPoint, emptySketch } from "../src/model";
import { svgToPdf } from "../src/pdf-export";

vi.mock("../src/pdf-export", () => ({ svgToPdf: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function app() {
  const sk = emptySketch(), a = addPoint(sk, 0, 0), b = addPoint(sk, 10, 0);
  addLine(sk, a.id, b.id);
  return Object.assign(Object.create(App.prototype), {
    sk, tab: "sketch", exportName: "figure", toast: vi.fn(),
    waitToExport: vi.fn().mockResolvedValue(true), askName: vi.fn().mockResolvedValue("my-figure"),
    download: vi.fn(), plots: { fileName: () => "my-plot", exported: vi.fn() },
  });
}

describe("PDF saving", () => {
  it("opens the file picker before conversion, then writes PDF bytes and remembers the name", async () => {
    const editor = app(), blob = new Blob(["%PDF-test"], { type: "application/pdf" });
    const write = vi.fn(), close = vi.fn(), createWritable = vi.fn().mockResolvedValue({ write, close });
    const picker = vi.fn().mockImplementation(async () => {
      expect(svgToPdf).not.toHaveBeenCalled();
      return { name: "saved.pdf", createWritable };
    });
    vi.stubGlobal("window", { showSaveFilePicker: picker });
    vi.stubGlobal("localStorage", { setItem: vi.fn() });
    vi.mocked(svgToPdf).mockResolvedValue(blob);
    await editor.exportFigure("pdf");
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({
      suggestedName: "figure.pdf", types: [{ description: "PDF figure", accept: { "application/pdf": [".pdf"] } }],
    }));
    expect(svgToPdf).toHaveBeenCalledWith(expect.stringContaining("<svg"));
    expect(write).toHaveBeenCalledWith(blob);
    expect(close).toHaveBeenCalledOnce();
    expect(editor.exportName).toBe("saved");
    expect(editor.download).not.toHaveBeenCalled();
  });

  it("cancels the picker without converting or falling back to a download", async () => {
    const editor = app();
    vi.stubGlobal("window", { showSaveFilePicker: vi.fn().mockRejectedValue({ name: "AbortError" }) });
    await editor.exportFigure("pdf");
    expect(svgToPdf).not.toHaveBeenCalled();
    expect(editor.askName).not.toHaveBeenCalled();
    expect(editor.download).not.toHaveBeenCalled();
  });

  it("downloads the active plot as a PDF when no picker is available", async () => {
    const editor = app(), blob = new Blob(["%PDF-test"]);
    editor.tab = "plot";
    editor.plots.exported.mockReturnValue('<svg width="10mm" height="5mm"/>');
    vi.stubGlobal("window", {});
    vi.mocked(svgToPdf).mockResolvedValue(blob);
    await editor.exportFigure("pdf");
    expect(editor.plots.exported).toHaveBeenCalledWith("svg");
    expect(editor.askName).toHaveBeenCalledWith(".pdf", "Export PDF figure", "my-plot");
    expect(editor.download).toHaveBeenCalledWith("my-figure.pdf", blob, "application/pdf");
  });

  it("reports conversion failures without opening a writable file or offering another save", async () => {
    const editor = app(), createWritable = vi.fn();
    vi.stubGlobal("window", { showSaveFilePicker: vi.fn().mockResolvedValue({ name: "figure.pdf", createWritable }) });
    vi.mocked(svgToPdf).mockRejectedValue(new Error("Conversion failed"));
    await editor.exportFigure("pdf");
    expect(createWritable).not.toHaveBeenCalled();
    expect(editor.askName).not.toHaveBeenCalled();
    expect(editor.toast).toHaveBeenCalledWith("Could not save PDF: Conversion failed");
  });

  it("does not offer to save an empty figure", async () => {
    const editor = app();
    editor.sk = emptySketch();
    await editor.exportFigure("pdf");
    expect(editor.toast).toHaveBeenCalledWith("There is nothing to export yet.");
    expect(svgToPdf).not.toHaveBeenCalled();
    expect(editor.waitToExport).not.toHaveBeenCalled();
  });
});
