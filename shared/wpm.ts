/** Standard: 5 characters = 1 word */
export function calcWpm(correctChars: number, elapsedMs: number): number {
  if (elapsedMs <= 0 || correctChars <= 0) return 0;
  const minutes = elapsedMs / 60_000;
  return Math.round((correctChars / 5 / minutes) * 10) / 10;
}

export function calcAccuracy(correctChars: number, totalTyped: number): number {
  if (totalTyped <= 0) return 100;
  const ratio = Math.min(1, correctChars / totalTyped);
  return Math.round(ratio * 1000) / 10;
}

export function clampProgress(correctChars: number, passageLength: number): number {
  if (passageLength <= 0) return 0;
  return Math.min(1, Math.max(0, correctChars / passageLength));
}
