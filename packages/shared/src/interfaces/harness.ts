import type { CaptureOptions, PageCapture } from "../schemas/capture.js";

export const HarnessError = {
  TIMEOUT: "TIMEOUT",
  NAVIGATION_FAILED: "NAVIGATION_FAILED",
  BLOCKED: "BLOCKED",
  CONSENT_WALL_UNRESOLVED: "CONSENT_WALL_UNRESOLVED",
  UPSTREAM_DOWN: "UPSTREAM_DOWN",
} as const;
export type HarnessErrorCode = (typeof HarnessError)[keyof typeof HarnessError];

export class HarnessException extends Error {
  public readonly code: HarnessErrorCode;

  constructor(code: HarnessErrorCode, message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "HarnessException";
    this.code = code;
  }
}

export interface Harness {
  capturePage(url: string, opts?: CaptureOptions): Promise<PageCapture>;
}
