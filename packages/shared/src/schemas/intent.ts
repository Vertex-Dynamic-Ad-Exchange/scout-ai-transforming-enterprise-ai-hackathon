import { z } from "zod";

// Per PRPs/foundation-ad-verification.md:142-143 + Veea README §
// Bidirectional metadata headers. Sent by every LLM-calling agent on
// the outbound request body under `_lobstertrap.declared_intent`.
export const LobstertrapDeclaredIntentSchema = z.object({
  declared_intent: z.string().min(1),
  agent_id: z.string().min(1),
  declared_paths: z.array(z.string()).optional(),
});
export type LobstertrapDeclaredIntent = z.infer<typeof LobstertrapDeclaredIntentSchema>;

// Surfaced by Lobster Trap's DPI proxy. `divergence` and `evidence`
// are null when declared == detected; non-null carries a one-line
// human-readable explanation the dashboard IntentDiff view renders.
// `evidence` and `divergence` are UNTRUSTED strings — they may contain
// attacker-controlled content echoed from a successfully prompt-injected
// page. Downstream renderers (e.g., the IntentDiff view) MUST escape
// before rendering.
export const LobstertrapDetectedIntentSchema = z.object({
  detected_intent: z.string().min(1),
  divergence: z.string().nullable(),
  evidence: z.string().nullable(),
});
export type LobstertrapDetectedIntent = z.infer<typeof LobstertrapDetectedIntentSchema>;
