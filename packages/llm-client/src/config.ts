import { z } from "zod";

const LlmConfigSchema = z.object({
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
  LOBSTER_TRAP_URL: z.string().url().optional(),
});

export type LlmConfig = z.infer<typeof LlmConfigSchema>;

let _config: LlmConfig | undefined;

export function llmConfig(): LlmConfig {
  if (_config) return _config;
  const result = LlmConfigSchema.safeParse({
    GEMINI_API_KEY: process.env["GEMINI_API_KEY"],
    LOBSTER_TRAP_URL: process.env["LOBSTER_TRAP_URL"],
  });
  if (!result.success) {
    throw new Error(`[llm-client] Invalid config: ${result.error.message}`);
  }
  _config = result.data;
  return _config;
}
