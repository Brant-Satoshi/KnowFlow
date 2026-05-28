import type { Chunk } from '../types';

export function formatChunks(chunks: Chunk[]): string {
  return chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n');
}

export function buildQaPrompt(question: string, numberedContext: string): string {
  const isChinese = /[\u4e00-\u9fff]/.test(question);
  const fallback = isChinese
    ? '我没有在知识库中找到相关信息。'
    : "I couldn't find relevant information in the knowledge base.";
  return `You are a helpful assistant.

Answer the user's question using ONLY the provided context.

If the answer cannot be found in the context, say exactly:
"${fallback}"

Rules:
- Cite sources inline using bracket numbers like [1] or [1][2]
- Do NOT write [Source: filename], only use bracket numbers
- Do NOT use outside knowledge
- Do NOT cite content that does not support the answer

Context:
${numberedContext}

Question:
${question}`;
}

export const buildSummaryPrompt = (numberedContext: string) => `\
You are a helpful assistant.

Summarize the following context into key points.

Rules:
- Be concise
- Use bullet points
- Do NOT say "not found"
- When referencing specific content, cite by number like [1] or [1][2]
- Do NOT write [Source: filename], only use bracket numbers

Context:
${numberedContext}`;


export const buildConversationSummaryPrompt = () => `\
You are a helpful assistant.

Summarize the conversation so far based on the previous messages.

Rules:
- Be concise
- Use bullet points
- Do NOT invent details`;

export const buildTitlePrompt = (userMessage: string) => `\
You write concise chat conversation titles. Given the user's opening message below, output a title of 3-7 words that captures the main topic.

Rules:
- Output ONLY the title text. No quotes, no preamble, no trailing punctuation.
- Use the same language as the user's message (English if English, Chinese if Chinese).
- Be specific and informative, not generic.

User message:
${userMessage}

Title:`;
