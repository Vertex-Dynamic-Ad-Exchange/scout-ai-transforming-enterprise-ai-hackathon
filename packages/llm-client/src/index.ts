import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { z } from "zod";
import { llmConfig } from "./config.js";

export class LlmChatError extends Error {
  readonly lobstertrapTraceId: string;

  constructor(message: string, lobstertrapTraceId: string, cause: unknown) {
    super(message);
    this.name = "LlmChatError";
    this.lobstertrapTraceId = lobstertrapTraceId;
    this.cause = cause;
  }
}

export const GEMINI_FLASH_MODEL = "gemini-2.5-flash"; // pinned — never use -latest

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

const LobstertrapMetaSchema = z.object({
  verdict: z.string(),
  request_id: z.string(),
});

type LobstertrapMeta = z.infer<typeof LobstertrapMetaSchema>;

export interface LobstertrapDeclaredIntent {
  declared_intent: string;
  agent_id: string;
  declared_paths?: string[];
}

export interface LlmChatArgs {
  model?: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  response_format?: { type: "json_object" };
  max_tokens?: number;
  signal?: AbortSignal;
}

export interface LlmChatResult {
  content: string;
  lobstertrapTraceId: string | null;
  verdict: string; // Lobster Trap DPI verdict: "ALLOW"|"DENY"|"LOG"|etc.
  usage: { prompt_tokens: number; completion_tokens: number } | null;
}

export interface LlmClient {
  chat(args: LlmChatArgs, intent: LobstertrapDeclaredIntent): Promise<LlmChatResult>;
  healthcheck(): Promise<{ ok: true; lobstertrapVersion: string } | { ok: false; reason: string }>;
}

function buildCapturingClient(
  apiKey: string,
  baseURL: string,
): { oai: OpenAI; getCapture: () => LobstertrapMeta | null } {
  // Reason: object wrapper avoids TypeScript narrowing issues with mutable let
  // in closures when exactOptionalPropertyTypes is enabled.
  const capture: { meta: LobstertrapMeta | null } = { meta: null };

  // Reason: OpenAI SDK's RequestInfo (DOM shim) and @types/node undici RequestInfo
  // have conflicting URLLike definitions. Using `unknown` parameters and casting
  // avoids the unsolvable contravariance conflict at the type level.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const capturingFetch = async (url: any, init?: any): Promise<Response> => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const response = await fetch(url, init);
    const clone = response.clone();
    try {
      const json = (await clone.json()) as Record<string, unknown>;
      const parsed = LobstertrapMetaSchema.safeParse(json["_lobstertrap"]);
      if (parsed.success) {
        capture.meta = parsed.data;
      }
    } catch {
      // Not JSON or no Lobster Trap metadata — normal when LT is not proxying
    }
    return response;
  };

  const oai = new OpenAI({
    apiKey,
    baseURL,
    // Reason: OpenAI SDK's Fetch type uses node-fetch Response; Node 20 built-in
    // fetch uses DOM Response. The implementations are runtime-compatible but
    // TypeScript cannot verify the nominal type difference statically.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetch: capturingFetch as any,
  });

  return { oai, getCapture: () => capture.meta };
}

export function createLlmClient(): LlmClient {
  const cfg = llmConfig();
  const baseURL = cfg.LOBSTER_TRAP_URL ? `${cfg.LOBSTER_TRAP_URL}/v1` : GEMINI_BASE_URL;

  return {
    async chat(args: LlmChatArgs, intent: LobstertrapDeclaredIntent): Promise<LlmChatResult> {
      // Reserved before the call so ambiguous-path verdicts always have an audit trace,
      // even when the request aborts or errors before Lobster Trap metadata is captured.
      const fallbackTraceId = randomUUID();
      // Per-call client to isolate capture state across concurrent requests
      const { oai, getCapture } = buildCapturingClient(cfg.GEMINI_API_KEY, baseURL);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const requestBody: any = {
        model: args.model ?? GEMINI_FLASH_MODEL,
        messages: args.messages,
        // Reason: Lobster Trap's declared-vs-detected intent inspection reads this field
        // from the request body. Standard OpenAI clients ignore it safely.
        _lobstertrap: intent,
      };
      if (args.response_format) requestBody.response_format = args.response_format;
      if (args.max_tokens) requestBody.max_tokens = args.max_tokens;

      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        const res = await oai.chat.completions.create(requestBody, {
          signal: args.signal,
        });

        const ltMeta = getCapture();

        return {
          content: res.choices[0]?.message?.content ?? "",
          lobstertrapTraceId: ltMeta?.request_id ?? fallbackTraceId,
          verdict: ltMeta?.verdict ?? "ALLOW",
          usage: res.usage
            ? {
                prompt_tokens: res.usage.prompt_tokens,
                completion_tokens: res.usage.completion_tokens,
              }
            : null,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown LLM error";
        throw new LlmChatError(message, fallbackTraceId, err);
      }
    },

    async healthcheck(): Promise<
      { ok: true; lobstertrapVersion: string } | { ok: false; reason: string }
    > {
      try {
        const oai = new OpenAI({ apiKey: cfg.GEMINI_API_KEY, baseURL });
        await oai.models.list();
        return { ok: true, lobstertrapVersion: "unknown" };
      } catch (err) {
        return {
          ok: false,
          reason: err instanceof Error ? err.message : "unknown",
        };
      }
    },
  };
}
