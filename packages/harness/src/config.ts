// SECURITY: this is the ONLY file in packages/harness/src/** allowed to read
// process.env.*. The audit grep in PRP-B1 § Task 8 enforces it; the foundation
// ESLint rule (PRPs/foundation-ad-verification.md:301) catches regressions.
import { HarnessError, HarnessException } from "@scout/shared";

export interface HarnessConfig {
  readonly browserUseApiKey: string;
  readonly browserUseBaseUrl?: string;
  readonly defaultProxyCountry: string;
}

export function harnessConfig(): HarnessConfig {
  const key = process.env["BROWSER_USE_API_KEY"];
  if (!key) {
    // SECURITY: name-only hint. Do NOT echo the (missing) value, even as a
    // placeholder — a future regression that appends the raw env value to
    // this message would leak the key fragment on every miss.
    throw new HarnessException(
      HarnessError.UPSTREAM_DOWN,
      "BROWSER_USE_API_KEY is not set; @scout/harness cannot create a Cloud session",
    );
  }
  const baseUrl = process.env["BROWSER_USE_BASE_URL"];
  return {
    browserUseApiKey: key,
    ...(baseUrl ? { browserUseBaseUrl: baseUrl } : {}),
    defaultProxyCountry: "US",
  };
}
