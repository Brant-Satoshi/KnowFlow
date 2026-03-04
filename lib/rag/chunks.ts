import { Chunk } from '@/lib/types';

export interface ChunkOptions {
  chunkSize?: number;    // 默认 500
  overlap?: number;      // 默认 50
}

const SENTENCE_BREAK_RE = /[.!?。！？;；]/;

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

  let idx = 0;
  let start = 0;
  const totalLength = text.length;

  while (start < totalLength) {
    const targetEnd = Math.min(start + chunkSize, totalLength);
    const end = findChunkEnd(text, start, targetEnd);
    const rawChunk = text.slice(start, end);
    const leadingWs = countLeadingWhitespace(rawChunk);
    const trailingWs = countTrailingWhitespace(rawChunk);

    const trimmedStart = start + leadingWs;
    const trimmedEnd = end - trailingWs;

    if (trimmedEnd > trimmedStart) {
      chunks.push({
        id: `${fileId}-${idx}`,
        fileId,
        idx,
        text: text.slice(trimmedStart, trimmedEnd),
        meta: { start: trimmedStart, end: trimmedEnd },
      });
      idx += 1;
    }

    if (end >= totalLength) {
      break;
    }

    let nextStart = end - overlap;
    if (nextStart <= start) {
      nextStart = start + 1;
    }
    start = nextStart;
  }

  return chunks;
}
