/**
 * Browser microphone capture utilities. The archive accepts WAV/FLAC/MP3/Ogg,
 * so microphone audio is encoded to mono 16-bit WAV locally before upload.
 */

export function encodeWav(
  chunks: Float32Array[],
  sampleRate: number,
): Blob {
  const frameCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + frameCount * 2);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + frameCount * 2, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, frameCount * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let index = 0; index < chunk.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, chunk[index]));
      view.setInt16(
        offset,
        sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff),
        true,
      );
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export function peaksFromChunks(
  chunks: Float32Array[],
  count = 180,
): number[] {
  const frameCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (frameCount === 0) {
    return [];
  }
  const peaks = new Array<number>(count).fill(0);
  let cursor = 0;
  for (const chunk of chunks) {
    for (let index = 0; index < chunk.length; index += 1) {
      const position = Math.floor((cursor * count) / frameCount);
      const bucket = Math.min(count - 1, position);
      peaks[bucket] = Math.max(peaks[bucket], Math.abs(chunk[index]));
      cursor += 1;
    }
  }
  return peaks;
}

export function recordingFileName(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    "field-recording-",
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    ".wav",
  ].join("");
}
