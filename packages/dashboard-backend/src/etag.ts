import { createHash } from "node:crypto";

// sha256-hex of the serialized body; content-addressed so the 304 path
// kicks in iff the body is byte-identical. PRP D5.
export function sha256Hex(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

// Wrapped in double quotes per RFC 7232 §2.3 (strong validator).
export function etagFor(body: string): string {
  return `"${sha256Hex(body)}"`;
}
