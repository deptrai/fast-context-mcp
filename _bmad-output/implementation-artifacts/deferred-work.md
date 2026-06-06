# Deferred Work

## Deferred from: code review of 2-search-enhancement (2026-06-06)

- Cache returns shared mutable object references [src/cache.mjs getCachedResult] — `getCachedResult` returns the stored object; callers shallow-spread `{...cached}`. Latent: no current code mutates `.files`/`.ranges`/`.rg_patterns` in place, but a future in-place sort/splice would poison all cache hits + the stored entry. Fix later with a structured clone on get/set.
- Large file fully read before slicing [src/snippets.mjs:29] — `readFileSync` loads the entire file then `split("\n")` before slicing the range. For very large match files this is wasteful (budget bounds output, not input). Perf-only, not correctness. Consider streaming/partial read later.
