import { describe, expect, it } from "vitest";
import { cleanGeneratedText, isUsableReflection } from "./text";

const READING =
  "In the recent recordings from The Sample Courtyard, the sound reader found " +
  "Bird in 0.0% of moments on average, compared with 28.2% earlier. That is a " +
  "difference of 28.2 points, with fewer finds in the recent group.\n\n" +
  "The comparison uses 2 earlier and 2 recent recordings. It describes a change " +
  "in what the sound reader found, not a proven change in the place itself. The " +
  "cause is unknown, and differences in microphone, weather, time of day, or " +
  "recording conditions may contribute.";

describe("on-device text checks", () => {
  it("accepts a complete, varied reading", () => {
    expect(isUsableReflection(READING)).toBe(true);
  });

  it("rejects a reply that repeats until the token budget runs out", () => {
    const repeated = 'The sound reader is a "" "" "" '.repeat(60);
    expect(isUsableReflection(cleanGeneratedText(repeated))).toBe(false);
  });

  it("rejects a reply that is too short to be a reflection", () => {
    expect(isUsableReflection("Bird was heard less.")).toBe(false);
  });

  it("strips markdown and quotation marks from generated text", () => {
    const cleaned = cleanGeneratedText('## Bird\n\n"The sound reader" **found** Bird.');
    expect(cleaned).toBe("Bird\n\nThe sound reader found Bird.");
  });
});
