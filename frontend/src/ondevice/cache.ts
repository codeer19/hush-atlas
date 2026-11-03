import { ON_DEVICE_MODEL } from "./config";
import { onDeviceAppConfig } from "./appConfig";

export async function isModelCached(): Promise<boolean> {
  try {
    const webllm = await import("@mlc-ai/web-llm");
    return await webllm.hasModelInCache(
      ON_DEVICE_MODEL.id,
      await onDeviceAppConfig(),
    );
  } catch {
    return false;
  }
}

export async function removeModelCache(): Promise<void> {
  const webllm = await import("@mlc-ai/web-llm");
  await webllm.deleteModelAllInfoInCache(
    ON_DEVICE_MODEL.id,
    await onDeviceAppConfig(),
  );
}
