import { Chunk, ChunkMeta } from '@/lib/types';

export interface ChunkOptions {
  chunkSize?: number;    // 默认 500
  overlap?: number;      // 默认 50
}

export function chunkText(
  text: string,
  fileId: string,
  options: ChunkOptions = {}
): Chunk[] {
  const { chunkSize = 500, overlap = 50 } = options;
  const chunks: Chunk[] = [];
  
  // 简单按段落或句子分割
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
  
  let currentText = '';
  let idx = 0;
  
  for (const para of paragraphs) {
    if (currentText.length + para.length > chunkSize && currentText) {
      chunks.push({
        id: `${fileId}-${idx}`,
        fileId,
        idx: idx++,
        text: currentText.trim(),
        meta: { start: 0, end: currentText.length }
      });
      // 保留 overlap 字符
      currentText = currentText.slice(-overlap) + para;
    } else {
      currentText += '\n\n' + para;
    }
  }
  
  // 处理最后一块
  if (currentText.trim()) {
    chunks.push({
      id: `${fileId}-${idx}`,
      fileId,
      idx: idx,
      text: currentText.trim(),
      meta: { start: 0, end: currentText.length }
    });
  }
  
  return chunks;
}
