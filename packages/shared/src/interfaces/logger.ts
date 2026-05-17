/**
 * Minimal structured logger. Adopted per PRP-C D6 (Option ii) because the
 * foundation never landed a shared logger interface; the inline 8-line shape
 * keeps `@scout/shared` runtime-free and lets every package satisfy it with
 * `console`, pino, or a test spy without pulling a transitive dep.
 *
 * Body objects are structured fields, not free-form strings. Profiler-side
 * security: do NOT log raw `PageCapture.domText` (256 KiB untrusted, feature
 * line 248). Pass `{ jobId, advertiserId, url, contentHash, modes, elapsedMs,
 * warnings }`-style summaries only.
 */
export interface Logger {
  info(fields: Record<string, unknown>): void;
  warn(fields: Record<string, unknown>): void;
  error(fields: Record<string, unknown>): void;
}
