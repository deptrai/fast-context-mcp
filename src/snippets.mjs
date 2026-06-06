/**
 * Snippet reader for Fast Context search results.
 * Reads file content for given line ranges and formats for output.
 *
 * Env vars:
 *   FC_SNIPPET_MAX_LINES — total snippet lines budget (default: 200)
 */

import { readFileSync } from "node:fs";

function _getMaxLines() {
  const raw = parseInt(process.env.FC_SNIPPET_MAX_LINES, 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 200;
}

/**
 * Read code snippets for search result files.
 * @param {Array<{ full_path: string, ranges: [number, number][] }>} files
 * @returns {Map<string, string>} Map of full_path → formatted snippet text
 */
export function readSnippets(files) {
  const maxLines = _getMaxLines();
  let totalLines = 0;
  const snippets = new Map();

  for (const file of files) {
    if (totalLines >= maxLines) break;
    let content;
    try {
      content = readFileSync(file.full_path, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    const parts = [];

    for (const [start, end] of file.ranges) {
      if (totalLines >= maxLines) break;
      const s = Math.max(0, start - 1); // 1-indexed → 0-indexed
      const e = Math.min(lines.length, end);
      const remaining = maxLines - totalLines;
      const slice = lines.slice(s, Math.min(e, s + remaining));
      totalLines += slice.length;
      parts.push(slice.map((l, i) => `${s + i + 1} | ${l}`).join("\n"));
    }

    if (parts.length) {
      snippets.set(file.full_path, parts.join("\n...\n"));
    }
  }
  return snippets;
}
