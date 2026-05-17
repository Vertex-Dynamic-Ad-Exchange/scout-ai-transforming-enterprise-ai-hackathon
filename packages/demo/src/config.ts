import { z } from "zod";

const UrlSchema = z.string().url();

export function getDemoGateUrl(): string {
  return UrlSchema.parse(process.env.DEMO_GATE_URL ?? "http://localhost:3000");
}
