# Demo fixture format

Recording format v1.0 for `@scout/demo`. Frozen contract: the replayer
refuses any `formatVersion` it doesn't understand.

## Shape

```json
{
  "formatVersion": "1.0",
  "name": "01-clean-allow",
  "description": "Fast cache-hit ALLOW for a brand-safe news page.",
  "seeds": {
    "profiles": ["news-site"],
    "policies": ["brand-safe-news"]
  },
  "bids": [
    {
      "delayMs": 0,
      "request": {
        "advertiserId": "adv_01H...",
        "policyId": "brand-safe-news",
        "pageUrl": "https://example.com/news/world",
        "creativeRef": "creative_abc",
        "geo": "US",
        "ts": "2026-05-17T00:00:00Z"
      }
    }
  ],
  "expectations": [
    {
      "decision": "ALLOW",
      "reasonKinds": ["profile_signal", "policy_rule"],
      "latencyMsMax": 300,
      "lobstertrapTraceIdNullable": true
    }
  ]
}
```

## Rules

- `formatVersion: "1.0"` REQUIRED. Other values rejected at load.
- `bids.length === expectations.length`. `expectations[i]` asserts
  `bids[i]` — one-to-one (D6).
- `delayMs` is measured from **scenario start**, not from the previous
  bid (D5). Non-negative integer; `0` means "fire immediately".
- `latencyMsMax` is a positive integer (ms). The replayer fails the
  bid if observed `verdict.latencyMs` exceeds it.
- `lobstertrapTraceIdNullable` is a boolean. `true` means
  `verdict.lobstertrapTraceId` MUST be `null`; `false` means it MUST be
  a non-empty string. Exact trace IDs are non-deterministic; only
  presence is asserted (D8).
- `reasonKinds` (optional) is a set of `Reason.kind` values that the
  verdict's `reasons[].kind` must equal as a set (PRP-B owns the
  runtime assertion; D9).
- `decision` (optional) is one of `ALLOW` / `DENY` / `HUMAN_REVIEW`.
  Omit it if the scenario's correctness doesn't pin a decision (e.g.,
  scenario 3 accepts either `ALLOW` or `DENY`).
- **No secrets.** No API keys, bearer tokens, or signed payloads. The
  `BidVerificationRequest` shape has no auth field by design.
- `advertiserId` lives on `bids[].request`, not at scenario root.
  Format is multi-tenant capable (D12); v1 fixtures ship single-tenant
  but the format does not bake that in.
- Every schema object is `.strict()` — an unknown key fails load
  (and CI), not the demo.

## Authoring

PRP-C, PRP-D, and PRP-E each author scenario JSON files under
`fixtures/scenarios/`. They are validated by `loadScenario` (in
`packages/demo/src/types.ts`), which deep-parses each `bids[i].request`
through `BidVerificationRequestSchema` and each `expectations[i]`'s
verdict-mapped fields through `VerificationVerdictSchema.partial()`.
A typo (e.g., `"fail_close"` for `"fail_closed"`) fails CI at load
time.
