import type { AppConfig, ModelRecord } from "@mlc-ai/web-llm";
import { ON_DEVICE_MODEL } from "./config";

let cached: AppConfig | null = null;

/**
 * WebLLM 0.2.86 ships a Gemma 3 1B record with `context_window_size: 4096`
 * while the model's own chat config also sets a 512-token sliding window.
 * WebLLM rejects that pair at load time. This app now uses Gemma 2 2B, whose
 * record does not have that conflict, but keep the guard so switching back
 * to the 1B model does not reintroduce a load failure.
 */
function configureRecord(record: ModelRecord): ModelRecord {
  if (record.model_id !== "gemma3-1b-it-q4f16_1-MLC") {
    return record;
  }
  return {
    ...record,
    overrides: {
      ...record.overrides,
      context_window_size: 4096,
      sliding_window_size: -1,
    },
  };
}

export async function onDeviceAppConfig(): Promise<AppConfig> {
  if (cached) {
    return cached;
  }
  const webllm = await import("@mlc-ai/web-llm");
  cached = {
    ...webllm.prebuiltAppConfig,
    cacheBackend: "cache",
    model_list: webllm.prebuiltAppConfig.model_list.map(configureRecord),
  };
  return cached;
}
