export function cleanGeneratedText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[*#>`"“”]+/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 1600)
    .trim();
}

/**
 * Small local models sometimes repeat a phrase until the token budget runs
 * out. A repeated or too-short reply is not a reflection and must not be saved.
 */
export function isUsableReflection(text: string): boolean {
  if (text.trim().length < 40) {
    return false;
  }
  const words = text.toLowerCase().match(/[a-z0-9%]+/g) ?? [];
  if (words.length < 40) {
    return false;
  }
  if (new Set(words).size / words.length < 0.35) {
    return false;
  }
  const counts = new Map<string, number>();
  for (let index = 0; index + 4 <= words.length; index += 1) {
    const gram = words.slice(index, index + 4).join(" ");
    const next = (counts.get(gram) ?? 0) + 1;
    if (next >= 4) {
      return false;
    }
    counts.set(gram, next);
  }
  return true;
}
