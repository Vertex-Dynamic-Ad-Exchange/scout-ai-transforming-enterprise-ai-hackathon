// SECURITY: callers must NOT log canonicalDomText output — up to 256 KiB of
// arbitrary page content (PII, secrets in page bodies, advertiser prospect
// URLs). Surface it as a structured field; never concatenate into a system
// prompt inside the harness.

export const MAX_DOM_TEXT_BYTES = 256 * 1024;

export function canonicalDomText(raw: string): string {
  // 1. NFC normalize so the same visible text always hashes the same way
  //    (paired with hash.ts's NFC step).
  // 2. Collapse whitespace runs to single spaces.
  // 3. Trim.
  return raw.normalize("NFC").replace(/\s+/g, " ").trim();
}

export function truncateToBytes(s: string, maxBytes: number): string {
  if (Buffer.byteLength(s, "utf8") <= maxBytes) return s;
  // Reason: JS `slice` works in UTF-16 code units, not UTF-8 bytes. A naive
  // byte-slice can split a multibyte character and leave a lone continuation
  // byte that decodes as U+FFFD. Binary-search the largest code-unit prefix
  // whose UTF-8 byte length is ≤ maxBytes. The unicode-aware Buffer encoder
  // never splits a surrogate pair when given an entire pair, so iterating on
  // string index is safe enough at this granularity.
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (Buffer.byteLength(s.slice(0, mid), "utf8") <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo);
}
