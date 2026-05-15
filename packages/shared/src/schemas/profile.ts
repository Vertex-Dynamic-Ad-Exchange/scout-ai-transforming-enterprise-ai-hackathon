import { z } from "zod";

export const CategorySchema = z.object({
  label: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type Category = z.infer<typeof CategorySchema>;

export const DetectedEntitySchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type DetectedEntity = z.infer<typeof DetectedEntitySchema>;

export const EvidenceRefSchema = z.object({
  kind: z.enum(["screenshot", "dom_snippet", "video_frame"]),
  uri: z.string().min(1),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const PageProfileSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  contentHash: z.string().min(1),
  categories: z.array(CategorySchema),
  detectedEntities: z.array(DetectedEntitySchema),
  evidenceRefs: z.array(EvidenceRefSchema),
  capturedAt: z.string().datetime(),
  ttl: z.number().int().positive(),
});
export type PageProfile = z.infer<typeof PageProfileSchema>;
