import React from "react";
import {AbsoluteFill, Sequence, useCurrentFrame, Audio} from "remotion"; // ← Audio added
import {AsciinemaSync} from "./AsciinemaSync";
import type {Fit} from "./AsciinemaSync";
import {TitleCard} from "./TitleCard";

export type Direction = "left" | "right" | "up" | "down";
export type TransitionName = "cut" | "fade" | "crossfade" | "swipe" | "slide" | "wipe" | "blur";
export type AudioAnchor = "inBegin" | "inEnd" | "outBegin" | "outEnd" | "absolute";
export type SpeechCue = { text: string; voice: string; anchor: AudioAnchor; offsetSec?: number };

export type AudioAttachment = {
  src: string;
  anchor?: AudioAnchor;   // default: inEnd for cards, clipStart for casts
  offsetSec?: number;     // default: 0 (can be negative)
  volume?: number;        // 0..1 (default 1)
  loop?: boolean;         // default false
  fadeInSec?: number;     // optional
  fadeOutSec?: number;    // optional (applied toward end of scene slice)
  label?: string;         // for debugging
};

export type TransitionItem = {
  type: "transition";
  name: TransitionName;
  durationFrames: number;
  direction?: Direction;
  mode?: FadeMode;
};

export type FadeMode = "in" | "out" | "both";

export type CardItem = {
  type: "card";
  title: string;
  subtitle?: string;
  seconds: number;
  audio?: AudioAttachment | AudioAttachment[];
  speech?: SpeechCue[];
};

export type CastItem = {
  type: "cast";
  castPath: string;
  cols?: number;
  rows?: number;
  audio?: AudioAttachment | AudioAttachment[];
  speech?: SpeechCue[];
};

export type TimelineItem = TransitionItem | CardItem | CastItem;

export type WebCompositionProps = {
  timeline: TimelineItem[];
  clipFrames?: number[];
  isPlaying: boolean;
  // Global defaults if a cast omits cols/rows:
  defaultCols?: number;
  defaultRows?: number;
  theme?: string;
  fit?: Fit | undefined;
};


export const isTransition = (x: TimelineItem): x is TransitionItem => x.type === "transition";
export const isCard       = (x: TimelineItem): x is CardItem       => x.type === "card";
export const isCast       = (x: TimelineItem): x is CastItem       => x.type === "cast";

/**
 * Compute the global timeline frame for an anchor on clip `c`.
 * For `absolute`, returns 0 (composition origin) so callers can add offsetSec directly.
 */
export const anchorAbs = (
  c: { start: number; inDur: number; baseFrames: number; dur: number },
  where: AudioAnchor
): number => {
  switch (where) {
    // New names
    case "inBegin":
      return c.start;
    case "inEnd":
      return c.start + c.inDur;
    case "outBegin":
      return c.start + c.baseFrames;
    case "outEnd":
      return c.start + c.dur;
    case "absolute":
      return 0;
    default:
      // Sensible default: clip start
      return c.start;
  }
};

// If helpful, a tiny util:
export const secsToFrames = (sec: number | undefined, fps: number) =>
  Math.round((sec ?? 0) * fps);

/**
 * Example: compute final schedule frame for an audio/speech cue.
 * `offsetSec` is always added to the anchor frame.
 */
export const cueFrame = (
  c: { start: number; inDur: number; baseFrames: number; dur: number },
  anchor: AudioAnchor,
  offsetSec: number | undefined,
  fps: number
) => anchorAbs(c, anchor) + secsToFrames(offsetSec, fps);


/** Build layout (unchanged behavior, but we surface in/out transition durations) */
function buildLayout(timeline: TimelineItem[], clipFrames?: number[]) {
  if (!clipFrames || clipFrames.length === 0) {
    return [];
  }
  type Tr = Extract<TimelineItem, { type: "transition" }>;

  type CastData = { castPath: string; cols?: number; rows?: number; audio?: AudioAttachment | AudioAttachment[] };
  type CardData = { title: string; subtitle?: string; seconds: number; audio?: AudioAttachment | AudioAttachment[] };

  type ClipNode =
    | {
        idxInTimeline: number;
        kind: "cast";
        data: CastData;
        baseFrames: number;
        inTr?: Tr;
        outTr?: Tr;
        inDur: number;      // NEW
        outDur: number;     // NEW
        start: number;
        dur: number;
      }
    | {
        idxInTimeline: number;
        kind: "card";
        data: CardData;
        baseFrames: number;
        inTr?: Tr;
        outTr?: Tr;
        inDur: number;      // NEW
        outDur: number;     // NEW
        start: number;
        dur: number;
      };

  const clipEntries = timeline
    .map((it, i) => ({ it, i }))
    .filter((x) => x.it.type === "cast" || x.it.type === "card");

  const clips: ClipNode[] = clipEntries.map(({ it, i }, k) => ({
    idxInTimeline: i,
    kind: it.type as "cast" | "card",
    data: it as any, // CastData | CardData
    baseFrames: Math.max(1, clipFrames[k] | 0),
    start: 0,
    dur: 0,
    inDur: 0,
    outDur: 0,
  }));

  const transitions = timeline
    .map((it, i) => ({ it, i }))
    .filter((x) => x.it.type === "transition") as { it: Tr; i: number }[];

  const nearestPrevTransition = (pos: number): Tr | undefined => {
    for (let t = transitions.length - 1; t >= 0; t--) {
      const { it, i } = transitions[t];
      if (i < pos) return it;
    }
    return undefined;
  };

  const lastTransitionBetween = (iPrev: number, iNext: number): Tr | undefined => {
    for (let t = transitions.length - 1; t >= 0; t--) {
      const { it, i } = transitions[t];
      if (i > iPrev && i < iNext) return it;
      if (i <= iPrev) break;
    }
    return undefined;
  };

  const isOverlapping = (tr?: Tr) =>
    !!tr && (tr.name === "swipe" || tr.name === "crossfade");

  let current = 0;

  for (let k = 0; k < clips.length; k++) {
    const clip = clips[k];
    const nextIdxInTimeline =
      k + 1 < clips.length ? clips[k + 1].idxInTimeline : Number.POSITIVE_INFINITY;

    clip.inTr  = nearestPrevTransition(clip.idxInTimeline);
    clip.outTr = lastTransitionBetween(clip.idxInTimeline, nextIdxInTimeline);

    clip.inDur  = clip.inTr  && clip.inTr.name  !== "cut" ? clip.inTr.durationFrames  : 0;
    clip.outDur = clip.outTr && clip.outTr.name !== "cut" ? clip.outTr.durationFrames : 0;

    const outOverlap = isOverlapping(clip.outTr) ? clip.outTr!.durationFrames : 0;

    clip.start = current;
    clip.dur   = Math.max(1, clip.baseFrames + outOverlap);
    current    = clip.start + clip.baseFrames - outOverlap;
  }

  return clips;
}

/** NEW: small helper to apply fades */
const AudioWithFades: React.FC<{
  src: string;
  relFrom: number;        // start inside the clip sequence (>=0)
  relDur: number;         // how long the clip can sound within the scene window (we don't know file length)
  baseVolume: number;     // 0..1
  fadeInFrames: number;
  fadeOutFrames: number;
  loop: boolean;
}> = ({src, relFrom, relDur, baseVolume, fadeInFrames, fadeOutFrames, loop}) => {
  // We don't know audio duration ahead-of-time in web, so we:
  // - Start at relFrom (inside the scene)
  // - Apply fade-in from that point
  // - Apply fade-out toward the *end of relDur slice* (avoids clicks on scene cuts)
  return (
    <Sequence from={relFrom} durationInFrames={relDur}>
      <Audio
        src={src}
        loop={loop}
        volume={(f) => {
          // f is local frame within this Sequence (0..relDur-1)
          const fadeIn   = fadeInFrames   > 0 ? Math.min(1, f / fadeInFrames) : 1;
          const fadeOut  = fadeOutFrames  > 0 ? Math.min(1, (relDur - 1 - f) / fadeOutFrames) : 1;
          return baseVolume * Math.max(0, Math.min(1, fadeIn * fadeOut));
        }}
      />
    </Sequence>
  );
};

export const CompositionWeb: React.FC<WebCompositionProps> = ({
  timeline,
  clipFrames,
  isPlaying,
  defaultCols = 80,
  defaultRows = 20,
  theme = "asciinema",
  fit = "both",
}) => {
  const clips = buildLayout(timeline, clipFrames);

  // Normalize to array
  const asArray = (a?: AudioAttachment | AudioAttachment[]) =>
    !a ? [] : Array.isArray(a) ? a : [a];

  return (
    <AbsoluteFill style={{background: "#000", overflow: "hidden"}}>
      {clips.map((c, idx) => (
        <Sequence key={idx} from={c.start} durationInFrames={c.dur}>
          {/* --- VISUAL LAYER (unchanged) --- */}
          <TransitionLayer baseFrames={c.baseFrames} inTr={c.inTr} outTr={c.outTr}>
            {c.kind === "cast" ? (
              <AsciinemaSync
                src={(c.data as any).castPath}
                cols={(c.data as any).cols ?? defaultCols}
                rows={(c.data as any).rows ?? defaultRows}
                theme={theme}
                fit={fit}
                showControls={false}
                isPlaying={isPlaying}
                debug={false}
              />
            ) : (
              <TitleCard
                title={(c.data as any).title}
                subtitle={(c.data as any).subtitle}
                spinDegPerSec={38}
                glowDrift={20}
              />
            )}
          </TransitionLayer>

          {/* --- AUDIO LAYER (NEW) --- */}
          {asArray((c.data as any).audio).map((a, i) => {
            // Default anchor: cards → inEnd; casts → clipStart
            const defaultAnchor: AudioAnchor = c.kind === "card" ? "inEnd" : "inBegin";
            const anchor   = (a.anchor ?? defaultAnchor);
            const offsetFr = Math.round((a.offsetSec ?? 0) * 30); // we don't have fps here; defer to composition fps at runtime?
            // We *can* use 30 because your composition is fixed 30 fps in App.tsx.
            const startAbs = anchorAbs(c, anchor) + offsetFr;

            // Clip-local start; clamp to [0, c.dur)
            let relFrom = startAbs - c.start;
            if (relFrom < 0) relFrom = 0;
            if (relFrom >= c.dur) return null;

            const relDur = c.dur - relFrom; // play within the remaining visible slice
            const vol    = Math.max(0, Math.min(1, a.volume ?? 1));
            const fi     = Math.max(0, Math.round((a.fadeInSec  ?? 0) * 30));
            const fo     = Math.max(0, Math.round((a.fadeOutSec ?? 0) * 30));
            const loop   = !!a.loop;

            return (
              <AudioWithFades
                key={i}
                src={a.src}
                relFrom={relFrom}
                relDur={relDur}
                baseVolume={vol}
                fadeInFrames={fi}
                fadeOutFrames={fo}
                loop={loop}
              />
            );
          })}
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const clamp01 = (x:number)=>Math.max(0,Math.min(1,x));

const TransitionLayer: React.FC<{
  baseFrames:number;
  inTr?:Extract<TimelineItem,{type:"transition"}>;
  outTr?:Extract<TimelineItem,{type:"transition"}>;
  children:React.ReactNode;
}> = ({baseFrames,inTr,outTr,children}) => {
  const f = useCurrentFrame();
  const inDur  = inTr  && inTr.name!=="cut"  && inTr.durationFrames>0 ? inTr.durationFrames  : 0;
  const outDur = outTr && outTr.name!=="cut" && outTr.durationFrames>0 ? outTr.durationFrames : 0;

  const pin  = inDur  ? clamp01(f / inDur) : 1;
  const pout = outDur ? clamp01((f - baseFrames) / outDur) : 0;

  const sIn  = styleForTransition(inTr,  pin,  "in");
  const sOut = styleForTransition(outTr, pout, "out");

  const tx = (sIn.tx ?? 0) + (sOut.tx ?? 0);
  const ty = (sIn.ty ?? 0) + (sOut.ty ?? 0);
  const opacity = (sIn.opacity ?? 1) * (sOut.opacity ?? 1);
  const blur = (sIn.blur ?? 0) + (sOut.blur ?? 0);
  const clipPath = sOut.clipPath ?? sIn.clipPath;

  return (
    <div style={{
      width:"100%", height:"100%",
      transform:`translate(${tx}%, ${ty}%)`,
      opacity, filter: blur?`blur(${blur}px)`:undefined, clipPath,
      willChange:"transform, opacity, filter, clip-path"
    }}>
      {children}
    </div>
  );
};

function styleForTransition(
  tr: Extract<TimelineItem, { type: "transition" }> | undefined,
  p: number,
  phase: "in" | "out"
): { tx?: number; ty?: number; opacity?: number; blur?: number; clipPath?: string } {
  if (!tr || tr.durationFrames <= 0) return {};
  const name = tr.name;
  if (name === "cut") return {};

  // helpers
  const fadeAllowed = (mode: "in" | "out" | "both" | undefined, ph: "in" | "out") =>
    !mode || mode === "both" || mode === ph;

  if (name === "fade") {
    if (!fadeAllowed(tr.mode, phase)) return {};             // <-- respect mode
    const o = phase === "in" ? p : 1 - p;
    return { opacity: o };
  }

  const dir = tr.direction ?? "right";
  const mapX: Record<"left" | "right" | "up" | "down", number> = { left: -1, right: 1, up: 0, down: 0 };
  const mapY: Record<"left" | "right" | "up" | "down", number> = { left: 0, right: 0, up: -1, down: 1 };
  const signX = mapX[dir];
  const signY = mapY[dir];

  switch (name) {
    case "crossfade": {
      // crossfade usually wants both sides, but you can also respect mode if you add it there too
      const o = phase === "in" ? p : 1 - p;
      return { opacity: o };
    }
    case "swipe": {
      const d = (phase === "in" ? 1 - p : p) * 100;
      return { tx: d * signX, ty: d * signY };
    }
    case "slide": {
      const d = (phase === "in" ? 1 - p : p) * 25;
      return { tx: d * signX, ty: d * signY };
    }
    case "wipe": {
      const t = phase === "in" ? 1 - p : p;
      const pct = Math.round(t * 1000) / 10;
      if (signX !== 0) {
        const left = dir === "left";
        return { clipPath: left ? `inset(0% 0% 0% ${pct}%)` : `inset(0% ${pct}% 0% 0%)` };
      } else {
        const up = dir === "up";
        return { clipPath: up ? `inset(${pct}% 0% 0% 0%)` : `inset(0% 0% ${pct}% 0%)` };
      }
    }
    case "blur": {
      const b = (phase === "in" ? 1 - p : p) * 12;
      return { blur: b };
    }
    default:
      return {};
  }
}
