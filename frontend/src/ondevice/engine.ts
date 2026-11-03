import type {
  ChatCompletionMessageParam,
  InitProgressReport,
  WebWorkerMLCEngine,
} from "@mlc-ai/web-llm";
import { ON_DEVICE_MODEL } from "./config";
import { onDeviceAppConfig } from "./appConfig";
import type { OnDeviceMessage } from "./prompt";

let engine: WebWorkerMLCEngine | null = null;
let worker: Worker | null = null;
let loading: Promise<WebWorkerMLCEngine> | null = null;
let loadGeneration = 0;

export function isEngineLoaded(): boolean {
  return engine !== null;
}

export async function loadEngine(
  onProgress?: (report: InitProgressReport) => void,
): Promise<WebWorkerMLCEngine> {
  if (engine) {
    return engine;
  }
  if (loading) {
    return loading;
  }

  const generation = ++loadGeneration;
  loading = (async () => {
    const webllm = await import("@mlc-ai/web-llm");
    if (generation !== loadGeneration) {
      throw new Error("The on-device AI start was cancelled.");
    }

    const nextWorker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
      name: "hush-atlas-ondevice-ai",
    });
    if (generation !== loadGeneration) {
      nextWorker.terminate();
      throw new Error("The on-device AI start was cancelled.");
    }
    worker = nextWorker;

    const appConfig = await onDeviceAppConfig();
    const created = await webllm.CreateWebWorkerMLCEngine(
      nextWorker,
      ON_DEVICE_MODEL.id,
      {
        appConfig,
        initProgressCallback: onProgress,
        logLevel: "WARN",
      },
    );

    if (generation !== loadGeneration) {
      await created.unload().catch(() => undefined);
      nextWorker.terminate();
      throw new Error("The on-device AI start was cancelled.");
    }

    engine = created;
    return created;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

export function disposeEngine(): void {
  loadGeneration += 1;
  const current = engine;
  const currentWorker = worker;
  engine = null;
  worker = null;
  loading = null;
  if (current) {
    void current.unload().catch(() => undefined);
  }
  currentWorker?.terminate();
}

export async function testEngine(target: WebWorkerMLCEngine): Promise<string> {
  const response = await target.chat.completions.create({
    messages: [
      { role: "user", content: "Reply with exactly one word: ready" },
    ],
    max_tokens: 8,
    temperature: 0,
    stream: false,
  });
  const content = response.choices[0]?.message?.content;
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) {
    throw new Error(
      "The model loaded, but the test inference returned no text. Try again or use a different browser.",
    );
  }
  return text;
}

export async function generateText(
  target: WebWorkerMLCEngine,
  messages: OnDeviceMessage[],
  options: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const response = await target.chat.completions.create({
    messages: messages as ChatCompletionMessageParam[],
    max_tokens: options.maxTokens ?? 360,
    temperature: options.temperature ?? 0.2,
    top_p: 0.9,
    stream: false,
  });
  const content = response.choices[0]?.message?.content;
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) {
    throw new Error("The on-device model returned an empty reflection.");
  }
  return text;
}

export async function resetEngineChat(): Promise<void> {
  if (!engine) {
    return;
  }
  await engine.resetChat().catch(() => undefined);
}
