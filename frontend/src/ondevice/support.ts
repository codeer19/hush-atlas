import { ON_DEVICE_MODEL } from "./config";

export type OnDeviceSupportStatus = "checking" | "supported" | "unsupported";

export interface OnDeviceSupport {
  status: OnDeviceSupportStatus;
  reason: string | null;
  adapterName: string | null;
}

interface GPUAdapterLike {
  info?: {
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
  };
  features?: {
    has(name: string): boolean;
  };
}

interface GPULike {
  requestAdapter(options?: {
    powerPreference?: "low-power" | "high-performance";
  }): Promise<GPUAdapterLike | null>;
}

function graphicsAdapterName(adapter: GPUAdapterLike): string | null {
  const info = adapter.info;
  if (!info) {
    return null;
  }
  const parts = [info.vendor, info.architecture, info.device, info.description]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Check whether this browser can actually run WebLLM. Having `navigator.gpu`
 * is not enough: remote desktops, virtual machines, and browsers with hardware
 * acceleration disabled often expose the API but return no adapter.
 */
export async function detectOnDeviceSupport(): Promise<OnDeviceSupport> {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return {
      status: "unsupported",
      reason: "On-device AI needs a browser window with WebGPU.",
      adapterName: null,
    };
  }

  if (!window.isSecureContext) {
    return {
      status: "unsupported",
      reason:
        "On-device AI needs a secure page. Open Hush Atlas over HTTPS or on localhost.",
      adapterName: null,
    };
  }

  const gpu = (navigator as Navigator & { gpu?: GPULike }).gpu;
  if (!gpu || typeof gpu.requestAdapter !== "function") {
    return {
      status: "unsupported",
      reason:
        "This browser does not expose WebGPU. Use a current version of Chrome or Edge with hardware acceleration enabled.",
      adapterName: null,
    };
  }

  let adapter: GPUAdapterLike | null = null;
  try {
    adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  } catch {
    return {
      status: "unsupported",
      reason:
        "WebGPU is present, but the graphics adapter could not be opened. Check that hardware acceleration is enabled.",
      adapterName: null,
    };
  }

  if (!adapter) {
    return {
      status: "unsupported",
      reason:
        "WebGPU is present, but no compatible graphics adapter was found. This can happen in a virtual machine, a remote desktop, or when hardware acceleration is turned off.",
      adapterName: null,
    };
  }

  const missingFeatures = ON_DEVICE_MODEL.requiredFeatures.filter(
    (feature) => !adapter.features?.has(feature),
  );
  if (missingFeatures.length > 0) {
    return {
      status: "unsupported",
      reason: `The graphics adapter does not support ${missingFeatures.join(
        ", ",
      )}, which this model needs. Use a newer graphics driver or keep using plain readings.`,
      adapterName: graphicsAdapterName(adapter),
    };
  }

  if (navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      const quota = estimate.quota ?? 0;
      const usage = estimate.usage ?? 0;
      if (quota > 0 && quota - usage < ON_DEVICE_MODEL.downloadBytes * 1.2) {
        return {
          status: "unsupported",
          reason: `This browser has less than ${Math.ceil(
            (ON_DEVICE_MODEL.downloadBytes * 1.2) / 1024 / 1024,
          )} MB of storage available. Free some space, or keep using plain readings.`,
          adapterName: graphicsAdapterName(adapter),
        };
      }
    } catch {
      // A storage estimate is advisory. Do not block a capable browser.
    }
  }

  return {
    status: "supported",
    reason: null,
    adapterName: graphicsAdapterName(adapter),
  };
}
