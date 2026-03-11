import { FileDoc } from "../types";

type PDFParserCtor = typeof import("pdf2json")["default"];

let pdfParserCtorPromise: Promise<PDFParserCtor> | null = null;

export async function parseFile(file: FileDoc, buffer: Buffer) {
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  if (isPdf) {
    return parsePdfText(buffer);
  }

  return buffer.toString("utf-8");
}

async function parsePdfText(buffer: Buffer): Promise<string> {
  const PDFParser = await getPdfParserCtor();

  return new Promise((resolve, reject) => {
    const parser = new PDFParser(undefined, true);

    const cleanup = () => {
      parser.removeListener("pdfParser_dataReady", onReady);
      parser.removeListener("pdfParser_dataError", onError);
      parser.destroy();
    };

    const onReady = () => {
      const text = parser.getRawTextContent();
      cleanup();
      resolve(text?.trim() || "");
    };

    const onError = (err: { parserError: Error } | Error) => {
      cleanup();
      reject(err instanceof Error ? err : err.parserError);
    };

    parser.on("pdfParser_dataReady", onReady);
    parser.on("pdfParser_dataError", onError);

    try {
      parser.parseBuffer(buffer, 0);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

function getPdfParserCtor(): Promise<PDFParserCtor> {
  process.env.PDF2JSON_DISABLE_LOGS = "1";

  pdfParserCtorPromise ??= import("pdf2json").then((mod) => mod.default);

  return pdfParserCtorPromise;
}
