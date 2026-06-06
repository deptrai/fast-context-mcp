/**
 * In-memory result cache with TTL for Fast Context search results.
 *
 * Env vars:
 *   FC_CACHE_DISABLED — set to "1" to disable caching entirely
 *   FC_CACHE_TTL_MS   — cache TTL in milliseconds (default: 300000 = 5 min)
 */

import { createHash } from "node:crypto";

// ─── Config ────────────────────────────────────────────────

function _isDisabled() {
  return process.env.FC_CACHE_DISABLED === "1";
}

function _getTtlMs() {
  const raw = parseInt(process.env.FC_CACHE_TTL_MS, 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 300000;
}

// ─── Cache Store ───────────────────────────────────────────

/** @type {Map<string, { result: Object, expiresAt: number }>} */
const _store = new Map();

/**
 * Build a deterministic cache key from search parameters.
 * @param {{ query: string, model: string, maxTurns: number, maxResults: number, treeDepth: number, repoMapHash: string }} params
 * @returns {string}
 */
export function buildCacheKey({ query, model, maxTurns, maxResults, treeDepth, repoMapHash }) {
  const input = `${query}|${model}|${maxTurns}|${maxResults}|${treeDepth}|${repoMapHash}`;
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Get a cached result if it exists and is not expired.
 * @param {string} key
 * @returns {Object|null}
 */
export function getCachedResult(key) {
  if (_isDisabled()) return null;
  const entry = _store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _store.delete(key);
    return null;
  }
  return entry.result;
}

/**
 * Store a result in cache.
 * @param {string} key
 * @param {Object} result
 */
export function setCachedResult(key, result) {
  if (_isDisabled()) return;
  _store.set(key, { result, expiresAt: Date.now() + _getTtlMs() });
}

/**
 * Clear all cached entries. Useful for testing.
 */
export function clearCache() {
  _store.clear();
}
