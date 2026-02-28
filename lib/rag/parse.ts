import { PDFParse } from "pdf-parse";
import { FileDoc } from "../types";

export async function parseFile(file: FileDoc, buffer: Buffer) {
  if (file.type === "application/pdf") {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return result.text;
  }

  return buffer.toString("utf-8");
}