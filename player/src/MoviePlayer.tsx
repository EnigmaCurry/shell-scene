// src/MoviePlayer.tsx
import { useEffect, useState } from "react";
import { Player } from "@remotion/player";
import type { TimelineItem } from "./CompositionWeb";
import { CompositionWeb } from "./CompositionWeb";
import { timelineFrames } from "./timelineDuration";

type Props = { timeline: TimelineItem[]; title?: string };

export default function MoviePlayer({ timeline }: Props) {
  const fps = 30;
  const compW = 1920;
  const compH = 1080;

  const [dur, setDur] = useState<number | null>(null);
  const isPlaying = false; //inital value only
  // Recompute when the timeline changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const frames = await timelineFrames(timeline, fps);
      if (!cancelled) setDur(frames);
    })();
    return () => {
      cancelled = true;
    };
  }, [timeline]);

  if (dur == null) {
    return <div style={{ padding: 12 }}>Loading video…</div>;
  }

  return (
    <Player
      component={CompositionWeb}
      inputProps={{ timeline, isPlaying }}
      durationInFrames={dur}            // ← now computed from the timeline
      fps={fps}
      compositionWidth={compW}
      compositionHeight={compH}
      style={{ width: "100%", aspectRatio: `${compW}/${compH}` }}
    />
  );
}
