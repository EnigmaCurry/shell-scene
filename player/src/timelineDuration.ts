// src/timelineDuration.ts
import type { TimelineItem } from "./CompositionWeb";
import { getCastDurationSeconds } from "./getCastDuration";

export async function timelineFrames(
  items: TimelineItem[],
  fps: number
): Promise<number> {
  let frames = 0;

  for (const it of items) {
    if (it.type === "transition") {
      frames += it.durationFrames ?? 0;
      continue;
    }
    if (it.type === "card") {
      frames += Math.round((it.seconds ?? 0) * fps);
      continue;
    }
    if (it.type === "cast") {
      // Use your existing helper to read .cast duration (in seconds)
      const sec = await getCastDurationSeconds(it.castPath);
      frames += Math.round(sec * fps);
      continue;
    }
    // Unknown item types contribute 0 frames
  }

  return frames;
}
