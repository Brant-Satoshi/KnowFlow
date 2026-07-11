import { Chunk } from '@/lib/types';

export interface ChunkOptions {
  chunkSize?: number;    // 默认 500
  overlap?: number;      // 默认 50
  fileName?: string;     // 用作文档标题的兜底（首行不可用时）
}

const SENTENCE_BREAK_RE = /[.!?。！？;；]/;

// Section headings: Chinese-numbered (一、项目概况) or markdown ATX (## 标题).
const CN_SECTION_RE = /^[一二三四五六七八九十百千零〇两]+、/;
const MD_HEADING_RE = /^#{1,6}\s+/;

interface SectionMark {
  offset: number;
  title: string;
}

function isSectionHeading(line: string): boolean {
  return CN_SECTION_RE.test(line) || MD_HEADING_RE.test(line);
}

function stripMarkdownPrefix(line: string): string {
  return line.replace(MD_HEADING_RE, '');
}

function fileNameTitle(fileName?: string): string | null {
  if (!fileName) return null;
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  return base || null;
}

// Scan the (already cleaned) text once for the document title and section
// headings, recording each heading's character offset into `text`.
function scanStructure(
  text: string,
  fileName?: string,
): { documentTitle: string | null; sections: SectionMark[] } {
  const sections: SectionMark[] = [];
  let documentTitle: string | null = null;
  let titleDecided = false;
  let titleLineOffset = -1;

  let offset = 0;
  for (const line of text.split('\n')) {
    const lineOffset = offset;
    offset += line.length + 1; // account for the consumed '\n'
    const trimmed = line.trim();
    if (!trimmed) continue;

    // The first non-empty line decides the document title. A Chinese-numbered
    // section heading is never the title; fall back to the file name instead.
    if (!titleDecided) {
      titleDecided = true;
      if (CN_SECTION_RE.test(trimmed)) {
        documentTitle = fileNameTitle(fileName);
      } else {
        documentTitle = stripMarkdownPrefix(trimmed);
        titleLineOffset = lineOffset; // exclude the title line from sections
      }
    }

    if (isSectionHeading(trimmed) && lineOffset !== titleLineOffset) {
      sections.push({ offset: lineOffset, title: trimmed });
    }
  }

  if (documentTitle === null) documentTitle = fileNameTitle(fileName);
  return { documentTitle, sections };
}

interface Segment {
  start: number;
  end: number;
  title: string | null;
}

// Section headings are hard chunk boundaries: no chunk may straddle one, so
// every chunk's sectionTitle is exactly the section its text belongs to.
// Text before the first heading forms a title-less preamble segment.
function buildSegments(sections: SectionMark[], totalLength: number): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  let title: string | null = null;

  for (const section of sections) {
    if (section.offset > cursor) {
      segments.push({ start: cursor, end: section.offset, title });
    }
    cursor = section.offset;
    title = section.title;
  }
  if (cursor < totalLength) {
    segments.push({ start: cursor, end: totalLength, title });
  }

  return segments;
}

// Language-neutral labels keep embedding/rerank text stable across locales.
export function buildEmbeddingText(
  documentTitle: string | null,
  sectionTitle: string | null,
  text: string,
): string {
  const parts: string[] = [];
  if (documentTitle) parts.push(`title: ${documentTitle}`);
  if (sectionTitle) parts.push(`section: ${sectionTitle}`);
  parts.push(`text:\n${text}`);
  return parts.join('\n');
}

function normalizeOptions(options: ChunkOptions): { chunkSize: number; overlap: number } {
  const chunkSize = Math.max(1, Math.trunc(options.chunkSize ?? 500));
  const overlap = Math.max(0, Math.min(Math.trunc(options.overlap ?? 50), chunkSize - 1));
  return { chunkSize, overlap };
}

function countLeadingWhitespace(value: string): number {
  const match = value.match(/^\s+/);
  return match ? match[0].length : 0;
}

function countTrailingWhitespace(value: string): number {
  const match = value.match(/\s+$/);
  return match ? match[0].length : 0;
}

function findChunkEnd(text: string, start: number, targetEnd: number): number {
  if (targetEnd >= text.length) {
    return text.length;
  }

  const minEnd = start + Math.floor((targetEnd - start) * 0.6);

  for (let i = targetEnd; i > minEnd; i -= 1) {
    const ch = text[i - 1];
    if (ch === '\n' || ch === '\r' || SENTENCE_BREAK_RE.test(ch)) {
      return i;
    }
  }

  for (let i = targetEnd; i > minEnd; i -= 1) {
    if (/\s/.test(text[i - 1])) {
      return i;
    }
  }

  return targetEnd;
}

export function chunkText(
  text: string,
  fileId: string,
  options: ChunkOptions = {}
): Chunk[] {
  const { chunkSize, overlap } = normalizeOptions(options);
  const chunks: Chunk[] = [];

  if (!text) {
    return chunks;
  }

  const { documentTitle, sections } = scanStructure(text, options.fileName);

  let idx = 0;

  for (const segment of buildSegments(sections, text.length)) {
    let start = segment.start;

    while (start < segment.end) {
      const targetEnd = Math.min(start + chunkSize, segment.end);
      // Boundary snapping stays inside the segment: the window never reaches
      // past segment.end, so the back-scan cannot cross a section heading.
      const end = targetEnd >= segment.end ? segment.end : findChunkEnd(text, start, targetEnd);
      const rawChunk = text.slice(start, end);
      const leadingWs = countLeadingWhitespace(rawChunk);
      const trailingWs = countTrailingWhitespace(rawChunk);

      const trimmedStart = start + leadingWs;
      const trimmedEnd = end - trailingWs;

      if (trimmedEnd > trimmedStart) {
        const chunkBody = text.slice(trimmedStart, trimmedEnd);
        chunks.push({
          id: `${fileId}-${idx}`,
          fileId,
          idx,
          text: chunkBody,
          embeddingText: buildEmbeddingText(documentTitle, segment.title, chunkBody),
          documentTitle,
          sectionTitle: segment.title,
          meta: { start: trimmedStart, end: trimmedEnd },
        });
        idx += 1;
      }

      if (end >= segment.end) {
        break;
      }

      // The <= start clamp also keeps the overlap from reaching back across
      // the segment start (start never precedes it).
      let nextStart = end - overlap;
      if (nextStart <= start) {
        nextStart = start + 1;
      }
      start = nextStart;
    }
  }

  return chunks;
}
