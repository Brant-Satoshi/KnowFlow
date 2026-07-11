/**
 * Normalize parsed document text before chunking.
 *
 * Keep this module dependency-free so indexing, demo seeding, tests, and
 * dry-runs all use identical cleaning without importing storage or env-bound
 * modules.
 */
export function cleanText(text: string): string {
  return text
    // pdf2json emits CRLF around its markers; normalize before the line rules.
    .replace(/\r\n?/g, '\n')
    // pdf2json page-break marker lines ("----------------Page (N) Break----…").
    // Match them exactly — a bare /Page \d+/ also destroys legitimate content.
    .replace(/^-+Page \(\d+\) Break-+$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
