/**
 * The single browser-local language model used by Hush Atlas.
 *
 * The identifier and sizes come from the WebLLM 0.2.86 catalogue. Keep the
 * version pinned: the model library URL and cache layout are tied to it.
 *
 * Gemma 2 2B is used instead of Gemma 3 1B because the 1B model repeatedly
 * failed the archive's grounding checks in real inference: it copied prompt
 * fragments, repeated phrases, and sometimes inverted the direction of the
 * comparison. Gemma 2 2B follows the compact evidence prompt reliably while
 * remaining a one-time, browser-local download.
 */
export const ON_DEVICE_MODEL = {
  id: "gemma-2-2b-it-q4f16_1-MLC",
  displayName: "Gemma 2 2B",
  family: "Gemma 2",
  parameterSize: "2B",
  quantization: "4-bit",
  runtime: "WebLLM 0.2.86",
  downloadBytes: 1_492_990_789,
  vramMb: 1895.3,
  contextWindow: 4096,
  requiredFeatures: ["shader-f16"],
  sourceUrl: "https://huggingface.co/mlc-ai/gemma-2-2b-it-q4f16_1-MLC",
} as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "Unknown size";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}
