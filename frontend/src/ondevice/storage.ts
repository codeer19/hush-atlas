import { isUsableReflection } from "./text";

const DOWNLOAD_FLAG = "hush-atlas:ondevice-download-started:v1";
const REFLECTION_PREFIX = "hush-atlas:ondevice-reflection:v1";

export interface StoredReflection {
  comparisonId: number;
  classIndex: number;
  label: string;
  text: string;
  modelName: string;
  createdAt: string;
}

function storage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function reflectionKey(comparisonId: number, classIndex: number): string {
  return `${REFLECTION_PREFIX}:${comparisonId}:${classIndex}`;
}

export function markDownloadStarted(): void {
  try {
    storage()?.setItem(DOWNLOAD_FLAG, new Date().toISOString());
  } catch {
    // A full or blocked storage area must not stop the download.
  }
}

export function clearDownloadFlag(): void {
  try {
    storage()?.removeItem(DOWNLOAD_FLAG);
  } catch {
    // Ignore blocked storage.
  }
}

export function wasDownloadStarted(): boolean {
  try {
    return Boolean(storage()?.getItem(DOWNLOAD_FLAG));
  } catch {
    return false;
  }
}

export function readLocalReflection(
  comparisonId: number,
  classIndex: number,
): StoredReflection | null {
  try {
    const raw = storage()?.getItem(reflectionKey(comparisonId, classIndex));
    if (!raw) {
      return null;
    }
    const value = JSON.parse(raw) as Partial<StoredReflection>;
    if (
      value.comparisonId !== comparisonId ||
      value.classIndex !== classIndex ||
      typeof value.text !== "string" ||
      !isUsableReflection(value.text)
    ) {
      return null;
    }
    return {
      comparisonId,
      classIndex,
      label: typeof value.label === "string" ? value.label : "",
      text: value.text,
      modelName:
        typeof value.modelName === "string" && value.modelName
          ? value.modelName
          : "On-device model",
      createdAt:
        typeof value.createdAt === "string" && value.createdAt
          ? value.createdAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeLocalReflection(value: StoredReflection): void {
  try {
    storage()?.setItem(
      reflectionKey(value.comparisonId, value.classIndex),
      JSON.stringify(value),
    );
  } catch {
    // The reflection remains visible for this session even if it cannot be saved.
  }
}
