import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { FileDoc } from "../types";

/**
 * Parse failures whose message is meant for the end user (actionable, free of
 * storage/provider internals). Everything else is reported generically.
 */
export class ParseUserError extends Error {}

type PDFParserCtor = typeof import("pdf2json")["default"];
type MammothModule = typeof import("mammoth");

const execFileAsync = promisify(execFile);
const LIBREOFFICE_TIMEOUT_MS = 30_000;

let pdfParserCtorPromise: Promise<PDFParserCtor> | null = null;
let mammothModulePromise: Promise<MammothModule> | null = null;

export async function parseFile(file: FileDoc, buffer: Buffer) {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();

  const isPdf = type === "application/pdf" || name.endsWith(".pdf");
  const isDoc = type === "application/msword" || name.endsWith(".doc");
  const isDocx =
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx");
  const isPlainText =
    type.startsWith("text/") || name.endsWith(".md") || name.endsWith(".txt");

  if (isPdf) {
    return parsePdfText(buffer);
  }

  if (isDocx) {
    return parseDocxText(buffer);
  }

  if (isDoc) {
    return parseDocText(buffer);
  }

  if (isPlainText) {
    return decodeTextBuffer(buffer);
  }

  throw new ParseUserError(`Unsupported file type: ${file.name}`);
}

/**
 * Text files are usually UTF-8, but Chinese corpora frequently arrive as
 * GBK/GB18030. Strict-decode UTF-8 first (`fatal` rejects invalid bytes
 * instead of silently emitting U+FFFD), then fall back to gb18030, a superset
 * of GBK. UTF-16 BOMs are honored before either.
 */
function decodeTextBuffer(buffer: Buffer): string {
  if (buffer.length >= 2) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder("utf-16le").decode(buffer);
    if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder("utf-16be").decode(buffer);
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("gb18030").decode(buffer);
  }
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

async function parseDocxText(buffer: Buffer): Promise<string> {
  const mammoth = await getMammothModule();
  const result = await mammoth.extractRawText({ buffer });

  return result.value.trim();
}

async function parseDocText(buffer: Buffer): Promise<string> {
  const workdir = await mkdtemp(join(tmpdir(), "doc-parse-"));
  const inputPath = join(workdir, "source.doc");
  const outputDir = join(workdir, "converted");
  // Per-run profile: concurrent soffice processes sharing the default user
  // profile interfere with each other. Lives under workdir → cleaned up below.
  const profileDir = join(workdir, "profile");

  await mkdir(outputDir);
  await writeFile(inputPath, buffer);

  try {
    await convertDocToDocx(inputPath, outputDir, profileDir);

    const docxPath = await findConvertedDocxPath(outputDir);
    const docxBuffer = await readFile(docxPath);

    return parseDocxText(docxBuffer);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

function getMammothModule(): Promise<MammothModule> {
  mammothModulePromise ??= import("mammoth");

  return mammothModulePromise;
}

async function convertDocToDocx(inputPath: string, outputDir: string, profileDir: string): Promise<void> {
  let sawMissingBinary = false;

  for (const binary of getLibreOfficeBinaryCandidates()) {
    try {
      await execFileAsync(
        binary,
        [
          "--headless",
          "--nologo",
          "--nodefault",
          "--nofirststartwizard",
          "--nolockcheck",
          `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
          "--convert-to",
          "docx",
          "--outdir",
          outputDir,
          inputPath,
        ],
        {
          timeout: LIBREOFFICE_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
        }
      );
      return;
    } catch (error) {
      if (isCommandNotFound(error)) {
        sawMissingBinary = true;
        continue;
      }

      throw new Error(`LibreOffice failed to convert .doc file: ${getErrorMessage(error)}`);
    }
  }

  if (sawMissingBinary) {
    throw new ParseUserError(
      "LibreOffice is required to parse .doc files. Install LibreOffice and expose `soffice`, or set `LIBREOFFICE_BIN` to the full executable path."
    );
  }

  throw new Error("LibreOffice conversion for .doc files could not be started.");
}

async function findConvertedDocxPath(outputDir: string): Promise<string> {
  const entries = await readdir(outputDir);
  const docxName = entries.find((entry) => entry.toLowerCase().endsWith(".docx"));

  if (!docxName) {
    throw new Error("LibreOffice did not produce a .docx output file.");
  }

  return join(outputDir, docxName);
}

function getLibreOfficeBinaryCandidates(): string[] {
  const configured = process.env.LIBREOFFICE_BIN?.trim();
  const candidates = [
    configured,
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "soffice",
    "/usr/bin/soffice",
    "/usr/local/bin/soffice",
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(candidates));
}

function isCommandNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
