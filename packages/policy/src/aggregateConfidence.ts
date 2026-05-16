export function noisyOr(confidences: number[]): number {
  if (confidences.length === 0) {
    return 0;
  }
  // Combine corroborating positive signals without averaging them away.
  return 1 - confidences.reduce((product, confidence) => product * (1 - confidence), 1);
}
