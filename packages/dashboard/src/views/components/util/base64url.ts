/**
 * RFC 4648 §5 base64url (PRP 06 D2 + D8): `+` → `-`, `/` → `_`, drop
 * `=` padding. The dashboard's evidence proxy path lives in the URL
 * path segment — plain base64 `/` would split the segment and `=` is
 * rejected by some routers as an invalid path char.
 *
 * Browser-safe: `Buffer.from(...).toString("base64url")` only exists in
 * Node and shipping the polyfill would bloat the bundle. `TextEncoder`
 * + `btoa` is the supported pattern.
 *
 * Single source of truth: `EvidenceTile` is the only client-side
 * caller; the dashboard backend (PRP 03) decodes with the same RFC
 * §5 alphabet. Drift between the two ends is a routing bug, not a
 * silent 404.
 */
export function base64url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
