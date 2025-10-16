// src/App.tsx
import "./App.css";
import {defaultSidebarOpen} from "./utils/layout";
import {useEffect, useMemo, useRef, useState} from "react";
import {Player} from "@remotion/player";
import type {PlayerRef} from "@remotion/player";
import "asciinema-player/dist/bundle/asciinema-player.css";
import {CompositionWeb,  isTransition} from "./CompositionWeb";
import type { TimelineItem } from "./CompositionWeb";
import type {WebCompositionProps} from "./CompositionWeb";
import {HashRouter as Router, Routes, Route, Link, Navigate, useParams} from "react-router-dom";
import {getCastDurationSeconds} from "./getCastDuration";
import {ChapterSidebar} from "./ChapterSidebar";
import { useTimelineRegistry, getTimeline } from "./timelines/runtime";

const fps = 30;
const isOverlap = (name: string) => name !== "cut" && name !== "fade";

const TOGGLE_COOLDOWN_MS = 220;
const TIMELINE_H = 72; // keep in sync with css --timeline-h
type PD = { down:boolean; moved:boolean; x:number; y:number; shouldToggle:boolean; };
type Chapter = { title: string; frame: number };
export type ClipRange = {
  kind: "card" | "cast";
  title: string;
  start: number;
  visibleStart: number;
  end: number;
};

function PlayerShell({ timeline }: { timeline: TimelineItem[] }) {
  const [clipFrames, setClipFrames] = useState<number[]>([]);
  const playerRef = useRef<PlayerRef>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const playerHostRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => defaultSidebarOpen());
  const [hasInteracted, setHasInteracted] = useState(false);
  const hasInteractedRef = useRef(false);
  const [flash, setFlash] = useState<null | "play" | "pause">(null);
  const prevPlayingRef = useRef<boolean | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const lastToggleRef = useRef(0);
  const surfRef = useRef<PD>({down:false,moved:false,x:0,y:0,shouldToggle:false});

  const setFlashFor = (playing: boolean) => {
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
    setFlash(playing ? "play" : "pause");
    flashTimerRef.current = window.setTimeout(() => {
      setFlash(null);
      flashTimerRef.current = null;
    }, 550);
  };

  const togglePlay = () => {
    const ref = playerRef.current;
    if (!ref) return;
    const playing = ref.isPlaying?.() ?? false;
    if (playing) {
      ref.pause?.();
      setFlashFor(false); // immediate feedback
    } else {
      ref.play?.();
      setFlashFor(true);
      if (!hasInteracted) setHasInteracted(true);
    }
    stageRef.current?.focus();
  };

  const safeTogglePlay = (e?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
    const now = performance.now();
    if (now - lastToggleRef.current < TOGGLE_COOLDOWN_MS) {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      return; // ignore rapid re-entrant toggles from down+up/click
    }
    lastToggleRef.current = now;
    togglePlay();
  };

  // --- Force user interaction so audio is unmuted by browser rules.
  useEffect(() => { hasInteractedRef.current = hasInteracted; }, [hasInteracted]);
  const markInteracted = () => {
    if (!hasInteractedRef.current) {
      hasInteractedRef.current = true;
      setHasInteracted(true);
    }
  };
  useEffect(() => {
    const onAny = () => markInteracted();
    const capPassive = { capture: true, passive: true } as AddEventListenerOptions;

    window.addEventListener("pointerdown", onAny, capPassive);
    window.addEventListener("touchstart", onAny, capPassive);
    window.addEventListener("wheel", onAny, capPassive);
    window.addEventListener("keydown", onAny, { capture: true }); // keydown can't be passive

    return () => {
      window.removeEventListener("pointerdown", onAny, capPassive);
      window.removeEventListener("touchstart", onAny, capPassive);
      window.removeEventListener("wheel", onAny, capPassive);
      window.removeEventListener("keydown", onAny, { capture: true } as any);
    };
  }, []);

  // ---- ClickSurface handlers
  const onSurfacePointerDown = (e: React.PointerEvent) => {
    const host = playerHostRef.current;
    if (!host) return;

    const r = host.getBoundingClientRect();
    const reservedH = TIMELINE_H;
    const yFromBottom = r.bottom - e.clientY;
    const inTimeline = yFromBottom >= 0 && yFromBottom <= reservedH;

    const p = surfRef.current;
    p.down = true;
    p.moved = false;
    p.x = e.clientX;
    p.y = e.clientY;

    const primary =
      e.button === 0 || e.pointerType === "touch" || e.pointerType === "pen";

    p.shouldToggle = primary && !inTimeline;

    if (p.shouldToggle) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const onSurfacePointerMove = (e: React.PointerEvent) => {
    const p = surfRef.current;
    if (!p.down) return;
    const dx = Math.abs(e.clientX - p.x);
    const dy = Math.abs(e.clientY - p.y);
    if (dx > 2 || dy > 2) {
      p.moved = true;         // treat as drag
      p.shouldToggle = false; // cancel toggle on move
    }
  };

  const onSurfacePointerUp = (e: React.PointerEvent) => {
    const p = surfRef.current;
    if (p.shouldToggle && e.button === 0) {
      e.preventDefault();
      e.stopPropagation();
      safeTogglePlay(e);
    }
    p.down = false;
    p.shouldToggle = false;
  };

  // 1) One-time durations (cards + casts)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const clipItems = timeline.filter((t) => t.type === "cast" || t.type === "card");
      const frames = await Promise.all(
        clipItems.map(async (it: any) =>
          it.type === "cast"
            ? Math.max(1, Math.ceil((await getCastDurationSeconds(it.castPath)) * fps))
            : Math.max(1, Math.ceil((it.seconds ?? 0) * fps))
        )
      );
      if (!cancelled) setClipFrames(frames);
    })();
    return () => { cancelled = true; };
  }, [timeline]); // ← depends on timeline now

  // 3) rAF poll: keep isPlaying + currentFrame in sync
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const ref = playerRef.current;
      const playing = ref?.isPlaying?.() ?? false;
      const frame = ref?.getCurrentFrame?.() ?? 0;

      // Detect transitions to trigger small flash
      const prev = prevPlayingRef.current;
      if (prev !== null && prev !== playing) {
        setFlashFor(playing);
        if (playing && !hasInteracted) setHasInteracted(true);
      }
      prevPlayingRef.current = playing;

      setIsPlaying((prevState) => {
        if (prevState !== playing) console.log("[RemotionPlayer]", playing ? "PLAYING" : "PAUSED");
        return playing;
      });
      setCurrentFrame((prevState) => (prevState !== frame ? frame : prevState));

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hasInteracted]);

  // 4) Build composition props + timeline math (including chapter visible starts)
  const {durationInFrames, inputProps, cardStartsVisible, cardMeta, clipRanges} = useMemo(() => {
    if (!clipFrames) {
      return {
        durationInFrames: 1,
        inputProps: null as any,
        cardStartsVisible: [] as number[],
        cardMeta: [] as {startVisible: number; title: string}[],
        clipRanges: [] as ClipRange[],
      };
    }

    // Clip entries (cards + casts) with their indices in the full timeline
    const clipEntries = timeline
      .map((it, i) => ({it, i}))
      .filter((x) => x.it.type === "cast" || x.it.type === "card");

    // Incoming transition for a clip = nearest previous transition
    const prevTransitionFor = (timelineIdx: number) => {
      for (let j = timelineIdx - 1; j >= 0; j--) {
        const t = timeline[j] as any;
        if (t?.type === "transition") return t;
      }
      return null;
    };

    // Frames of incoming transition for each clip (cut => 0)
    const inDurFrames: number[] = clipEntries.map((e) => {
      const tr = prevTransitionFor(e.i);
      return tr?.durationFrames ? Number(tr.durationFrames) : 0;
    });

    // Overlap between adjacent clips = duration of last transition between them (if overlapping)
    const overlapBetween = (iPrev: number, iNext: number) => {
      const tr = timeline
        .slice(iPrev + 1, iNext)
        .reverse()
        .find(isTransition); // TransitionItem | undefined

      if (!tr) return 0;
      return isOverlap(tr.name) ? tr.durationFrames : 0; // no casts needed
    };

    // Global start frames for each clip (respect overlaps)
    const clipStarts: number[] = [];
    for (let k = 0; k < clipEntries.length; k++) {
      if (k === 0) {
        clipStarts.push(0);
      } else {
        const prev = clipEntries[k - 1];
        const curr = clipEntries[k];
        const ov = overlapBetween(prev.i, curr.i);
        clipStarts.push(clipStarts[k - 1] + clipFrames[k - 1] - ov);
      }
    }

    const clipRanges = clipEntries.map((entry, k) => {
      const it = entry.it as any; // card or cast
      const start = clipStarts[k];
      const visibleStart = start + inDurFrames[k];      // after incoming transition
      const end = start + clipFrames[k];
      return {
        kind: it.type as "card" | "cast",
        title: it.type === "card" ? (it.title ?? "(untitled)") : (it.castPath ?? "(cast)"),
        start,
        visibleStart,
        end,
      };
    });

    // Chapters = title cards; "visible start" = clipStart + incoming transition frames
    const cardMeta = clipEntries
      .map((entry, k) =>
        entry.it.type === "card"
          ? {
              startVisible: clipStarts[k] + inDurFrames[k],
              title: (entry.it as any).title ?? "(untitled)",
            }
          : null
      )
      .filter((v): v is {startVisible: number; title: string} => v !== null);

    const cardStartsVisible = cardMeta.map((m) => m.startVisible);

    // Total duration = sum(base clip lengths) - sum(overlaps)
    const sumBase = clipFrames.reduce((a, b) => a + b, 0);
    let sumOverlap = 0;
    for (let k = 0; k < clipEntries.length - 1; k++) {
      sumOverlap += overlapBetween(clipEntries[k].i, clipEntries[k + 1].i);
    }
    const total = Math.max(1, sumBase - sumOverlap);

    const input: WebCompositionProps = {
      timeline,
      clipFrames,
      isPlaying,
      theme: "asciinema",
      fit: "both",
    };

    return {durationInFrames: total, inputProps: input, cardStartsVisible, cardMeta, clipRanges};
  }, [timeline, clipFrames, isPlaying]);

  // --- When reaching the end, rewind to start and pause instead of looping ---
  useEffect(() => {
    const ref = playerRef.current;
    if (!ref) return;

    const END_F = Math.max(0, durationInFrames - 1);
    let raf = 0;

    // Track previous state to detect "crossing" the end
    const prev = { frame: -1, playing: false };
    // Cooldown after we programmatically seek, to avoid immediate retrigger
    let lastActionTs = 0;
    const COOLDOWN_MS = 120;

    const loop = () => {
      const now = performance.now();
      const playing = ref.isPlaying?.() ?? false;
      const frame = ref.getCurrentFrame?.() ?? 0;

      const crossedEnd =
        prev.playing && playing && prev.frame < END_F && frame >= END_F;

      if (crossedEnd && now - lastActionTs > COOLDOWN_MS) {
        ref.pause?.();
        ref.seekTo?.(0);
        lastActionTs = now;
        setFlashFor(false);
        console.log("[RemotionPlayer] Reached end → rewind & pause");
      }

      prev.frame = frame;
      prev.playing = playing;
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [durationInFrames]);

  // 5) ←/→ accelerated scrubbing + hold-to-repeat
  useEffect(() => {
    const comboWindowMs = 350;
    const holdStartDelayMs = 300;
    const holdIntervalMs = 150;
    const maxStepSeconds = 5;

    let lastDir: "left" | "right" | null = null;
    let lastTs = 0;
    let streak = 0;

    const down: Record<"left" | "right", boolean> = {left: false, right: false};
    type HoldState = {timeoutId: number | null; intervalId: number | null; ticks: number};
    const hold: Record<"left" | "right", HoldState> = {
      left: {timeoutId: null, intervalId: null, ticks: 0},
      right: {timeoutId: null, intervalId: null, ticks: 0},
    };

    const cleanupHold = (dir: "left" | "right") => {
      const h = hold[dir];
      if (h.timeoutId != null) {
        clearTimeout(h.timeoutId);
        h.timeoutId = null;
      }
      if (h.intervalId != null) {
        clearInterval(h.intervalId);
        h.intervalId = null;
      }
      h.ticks = 0;
    };

    const computeStepSeconds = (s: number) => (s === 1 ? 1 : s === 2 ? 2 : maxStepSeconds);

    const doSeek = (dir: "left" | "right", stepSeconds: number) => {
      const ref = playerRef.current;
      if (!ref) return;
      const step = Math.round(stepSeconds * fps);
      const cur = ref.getCurrentFrame();
      const max = durationInFrames - 1;
      const next = dir === "left" ? Math.max(0, cur - step) : Math.min(max, cur + step);
      ref.seekTo(next);
      console.log(
        `[Keys] ${dir === "left" ? "←" : "→"} ${stepSeconds}s → frame ${next} (${(next / fps).toFixed(2)}s)`
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;

      const el = e.target as HTMLElement | null;
      if (el) {
        const tag = el.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || (el as any).isContentEditable) return;
      }

      if (e.repeat) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const dir: "left" | "right" = e.key === "ArrowLeft" ? "left" : "right";
      const other: "left" | "right" = dir === "left" ? "right" : "left";
      const now = performance.now();

      if (down[other]) {
        down[other] = false;
        cleanupHold(other);
      }

      if (dir === lastDir && now - lastTs <= comboWindowMs) {
        streak = Math.min(streak + 1, 3); // 1 → 2 → 3(=5s)
      } else {
        streak = 1;
      }
      lastDir = dir;
      lastTs = now;

      doSeek(dir, computeStepSeconds(streak));

      if (!down[dir]) {
        down[dir] = true;
        const h = hold[dir];
        cleanupHold(dir);

        h.timeoutId = window.setTimeout(() => {
          h.intervalId = window.setInterval(() => {
            h.ticks += 1;
            if (streak < 2) streak = 2;
            if (h.ticks >= 2) streak = 3;
            doSeek(dir, computeStepSeconds(streak));
          }, holdIntervalMs);
        }, holdStartDelayMs);
      }

      e.preventDefault();
      e.stopPropagation();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const dir: "left" | "right" = e.key === "ArrowLeft" ? "left" : "right";
      down[dir] = false;
      cleanupHold(dir);
    };

    window.addEventListener("keydown", onKeyDown, {capture: true});
    window.addEventListener("keyup", onKeyUp, {capture: true});
    return () => {
      window.removeEventListener("keydown", onKeyDown, {capture: true});
      window.removeEventListener("keyup", onKeyUp, {capture: true});
      cleanupHold("left");
      cleanupHold("right");
    };
  }, [fps, durationInFrames]);

  // 6) ↑/↓ chapters: previous/next visible card
  useEffect(() => {
    const starts = cardStartsVisible;
    if (!starts || starts.length === 0) return;

    const meta =
      (cardMeta ?? starts.map((s, i) => ({startVisible: s, title: `Card ${i + 1}`})));

    const lastIdx = starts.length - 1;
    const endFrame = durationInFrames - 1;
    const tolFrames = 1; // small tolerance so “past last start” can snap to last

    // Binary search: last chapter whose visible start <= frame; -1 if before first
    const findIdxAtOrBefore = (f: number) => {
      let lo = 0, hi = lastIdx, ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid] <= f) {
          ans = mid; lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return ans;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;

      // Ignore when typing in inputs/contenteditable
      const el = e.target as HTMLElement | null;
      if (el) {
        const tag = el.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || (el as any).isContentEditable) return;
      }
      if (e.repeat) {
        e.preventDefault(); e.stopPropagation();
        return;
      }

      const ref = playerRef.current;
      if (!ref) return;

      // Always pause first (if playing), then do deterministic move
      if (ref.isPlaying?.()) ref.pause?.();

      const cur = ref.getCurrentFrame();
      const anchor = findIdxAtOrBefore(cur); // -1 if before first
      const dirUp = e.key === "ArrowUp";

      let targetIdx: number;

      if (dirUp) {
        // Up: if before first -> go to first
        // If past last start -> first press goes to last start
        // Else from exact start -> previous
        if (anchor === -1) {
          targetIdx = 0;
        } else if (anchor === lastIdx && cur > starts[lastIdx] + tolFrames) {
          targetIdx = lastIdx;
        } else {
          targetIdx = Math.max(0, anchor - 1);
        }
      } else {
        // Down: next chapter; beyond last → END
        const next = anchor === -1 ? 0 : anchor + 1;
        if (next > lastIdx) {
          ref.seekTo(endFrame);
          console.log(`[Chapters] ↓ → END @ ${(endFrame / fps).toFixed(2)}s`, {cur, anchor});
          e.preventDefault(); e.stopPropagation();
          return;
        }
        targetIdx = next;
      }

      const frame = starts[targetIdx];
      ref.seekTo(frame);
      console.log(
        `[Chapters] ${dirUp ? "↑" : "↓"} → card #${targetIdx} "${meta[targetIdx]?.title}" @ ${frame} (${(frame / fps).toFixed(2)}s)`,
        {cur, anchor, targetIdx}
      );

      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener("keydown", onKeyDown, {capture: true});
    return () => window.removeEventListener("keydown", onKeyDown, {capture: true});
  }, [cardStartsVisible, cardMeta, durationInFrames, fps]);

  // 7) Chapters for sidebar
  const chapters = useMemo(
    () => (cardMeta ?? []).map((m) => ({title: m.title, frame: m.startVisible})),
    [cardMeta]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Space or "K" (YouTube-style)
      const isSpace = e.key === " " || e.code === "Space";
      const isK = e.key === "k" || e.key === "K";
      if (!isSpace && !isK) return;

      // Ignore key auto-repeat to prevent rapid flip-flop
      if (e.repeat) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      // Ignore when typing in fields / contenteditable
      const el = e.target as HTMLElement | null;
      if (el) {
        const tag = el.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || (el as any).isContentEditable) return;
      }


      const ref = playerRef.current;
      if (!ref) return;
      const playing = ref.isPlaying?.() ?? false;
      if (playing) {
        console.log("[Keys] ⏸ pause (space/K)");
      } else {
        console.log("[Keys] ▶ play (space/K)");
      }
      safeTogglePlay(undefined);
    };

    window.addEventListener("keydown", onKeyDown, {capture: true});
    return () => window.removeEventListener("keydown", onKeyDown, {capture: true});
  }, []);

  if (!clipFrames || !inputProps) return <div style={{color: "#fff"}}>Loading…</div>;

  // Player fit: whichever dimension is tighter (16:9)
  const compW = 1920;
  const compH = 1080;
  const ratioExpr = `${compW} / ${compH}`;

  return (
    <div className="app-layout"
      style={{ ["--sidebar-w" as any]: sidebarOpen ? "var(--sidebar-width-open)" : "var(--sidebar-width-closed)" }}>
      <ChapterSidebar
        open={sidebarOpen}
        onToggle={() => {
          setSidebarOpen((v) => !v);
          requestAnimationFrame(() => stageRef.current?.focus()); }
        }
        fps={fps}
        chapters={chapters}
        currentFrame={currentFrame}
        onJump={(frame) => {
          playerRef.current?.seekTo(frame);
          playerRef.current?.play();
          stageRef.current?.focus();
        }}
      />
      <div className="stage" ref={stageRef} tabIndex={-1}>
        <div ref={playerHostRef} className="player-host" style={{position:'relative'}}>
          {/* The Player is inert (pointerEvents:none); we own all UX above it */}
          <div
            className="click-surface"
            onPointerDown={onSurfacePointerDown}
            onPointerMove={onSurfacePointerMove}
            onPointerUp={onSurfacePointerUp}
            onClick={(e)=>{ e.preventDefault(); e.stopPropagation(); }}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 5,
              // Allow clicks everywhere except over our custom timeline (we’ll place it last with higher z)
              cursor: "pointer",
            }}
          />
          <Player
            autoPlay={false}
            ref={playerRef}
            component={CompositionWeb}
            inputProps={inputProps}
            durationInFrames={durationInFrames}
            fps={fps}
            compositionWidth={compW}
            compositionHeight={compH}
            style={{
              width: "calc(100dvw - var(--sidebar-w))",
              height: "calc(100dvh - var(--timeline-h))",
              aspectRatio: ratioExpr,
              display: "grid",
              placeItems: "center",
              background: "#000",
              pointerEvents: "none"
            }}
          />
          <CustomTimeline
            durationInFrames={durationInFrames}
            currentFrame={currentFrame}
            fps={fps}
            chapters={chapters}
            isPlaying={isPlaying}
            onSeek={(frame) => { playerRef.current?.seekTo(frame); }}
            onToggle={() => safeTogglePlay(undefined)}
            clipRanges={clipRanges}
          />
        </div>
        {/* Primary pre-play overlay */}
        {!hasInteracted && (
          <button
            className={`overlay-primary ${isPlaying ? "fade-out" : "show"}`}
            onPointerUp={(e) => { e.stopPropagation(); safeTogglePlay(e); }}
            aria-label="Play"
            title="Play"
          >
            <span>Click to play</span>
          </button>
        )}

        {hasInteracted && flash && (
          <div className={`overlay-flash ${flash}`} aria-hidden="true">
            {flash === "play" ? (
              <svg viewBox="0 0 64 64" className="flash-icon">
                <polygon points="24,18 24,46 46,32" />
              </svg>
            ) : (
              <svg viewBox="0 0 64 64" className="flash-icon">
                <rect x="21" y="18" width="8" height="28" rx="1" />
                <rect x="35" y="18" width="8" height="28" rx="1" />
              </svg>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

function VideoIndex() {
  const { ready, names } = useTimelineRegistry();

  if (!ready) return <div style={{padding:24}}>Loading timelines…</div>;

  if (names.length === 0) {
    return (
      <div style={{padding:24}}>
        <h1>Timelines</h1>
        <p>No timelines listed in registry.</p>
      </div>
    );
  }

  return (
    <div style={{padding: 24}}>
      <h1>Timelines</h1>
      <ul>
        {names.map((n) => (
          <li key={n}><Link to={`/video/${n}`}>{n}</Link></li>
        ))}
      </ul>
    </div>
  );
}

function VideoByName() {
  const { ready, names } = useTimelineRegistry();
  const { name } = useParams<{ name: string }>();

  if (!ready) return <div style={{padding:24}}>Loading timelines…</div>;

  const tl = name ? getTimeline(name) : undefined;

  if (!name || !tl) {
    return (
      <div style={{padding: 24}}>
        <h1>Not found</h1>
        <p>No timeline named <code>{name ?? "(none)"}</code>.</p>
        <h3>Available timelines</h3>
        <ul>
          {names.map((n) => (
            <li key={n}><Link to={`/video/${n}`}>{n}</Link></li>
          ))}
        </ul>
      </div>
    );
  }

  return <PlayerShell timeline={tl} />;
}


function CustomTimeline({
  durationInFrames,
  currentFrame,
  fps,
  chapters,
  clipRanges,
  onSeek,
  isPlaying,
  onToggle,
}: {
  durationInFrames: number;
  currentFrame: number;
  fps: number;
  chapters: Chapter[];
  clipRanges: ClipRange[];
  onSeek: (frame: number) => void;
  isPlaying: boolean;
  onToggle: () => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const frameToPct = (f: number) => (durationInFrames <= 1 ? 0 : f / (durationInFrames - 1));
  const fmtTime = (f: number) => {
    const s = Math.max(0, Math.floor(f / fps));
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return `${m}:${ss.toString().padStart(2, "0")}`;
  };

  // Find the active clip (card or cast) by frame
  const activeClipIndex = useMemo(() => {
    if (!clipRanges || clipRanges.length === 0) return -1;
    // last clip whose start <= frame
    let idx = clipRanges.length - 1;
    for (let i = 0; i < clipRanges.length; i++) {
      if (clipRanges[i].start > currentFrame) { idx = i - 1; break; }
    }
    return Math.max(-1, idx);
  }, [clipRanges, currentFrame]);

  const activeClip = activeClipIndex >= 0 ? clipRanges[activeClipIndex] : null;

  // Relative frames since the **visible start** (matches anchor: "inBegin")
  const relFrames = (() => {
    if (!activeClip) return 0;
    return Math.max(0, currentFrame - activeClip.visibleStart);
  })();

  const seekFromEvent = (clientX: number) => {
    const el = barRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = clamp(clientX - r.left, 0, r.width);
    const pct = r.width ? x / r.width : 0;
    const frame = clamp(Math.round(pct * (durationInFrames - 1)), 0, durationInFrames - 1);
    onSeek(frame);
  };

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    seekFromEvent(e.clientX);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    e.preventDefault();
    seekFromEvent(e.clientX);
  };
  const onUp = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    e.preventDefault();
    dragging.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    seekFromEvent(e.clientX);
  };


  const pct = frameToPct(currentFrame) * 100;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: "var(--timeline-h)",
        zIndex: 10,
        background:
          "linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0.35) 60%, rgba(0,0,0,0))",
        display: "grid",
        gridTemplateRows: "auto 28px",
        gap: 6,
        userSelect: "none",
      }}
    >
      {/* time readout */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          color: "#ddd",
        }}
      >
        {/* LEFT: absolute + relative */}
        <div style={{display: "flex", flexDirection: "column", lineHeight: 1.1}}>
          <span style={{fontSize: 12, fontVariantNumeric: "tabular-nums"}}>
            {fmtTime(currentFrame)}
          </span>
          <span
            title="Time since current element became visible"
            style={{fontSize: 11, opacity: 0.9, fontVariantNumeric: "tabular-nums", color: "#0f0"}}
          >
            {/* or use the chapter index you computed earlier */}
                                                                   +{fmtTime(relFrames)}
          </span>
        </div>

        {/* RIGHT: total */}
        <span style={{fontSize: 12, fontVariantNumeric: "tabular-nums"}}>
          {fmtTime(durationInFrames - 1)}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "28px 10px 1fr",
          alignItems: "center",
          height: 28,
        }}
      >
        {/* play/pause button */}
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          aria-label={isPlaying ? "Pause" : "Play"}
          title={isPlaying ? "Pause" : "Play"}
          style={{
            width: 28,
            height: 28,
            aspectRatio: "1 / 1",     // ensure square in all browsers
            padding: 0,               // kill native padding
            lineHeight: 0,            // avoid baseline wobble
            display: "inline-grid",
            placeItems: "center",
            border: "none",
            borderRadius: 6,
            background: "rgba(255,255,255,0.18)",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
            cursor: "pointer",
          }}
        >
          {isPlaying ? (
            <svg viewBox="0 0 64 64" width="26" height="26" aria-hidden="true" style={{display:"block"}}>
              <rect x="21" y="18" width="8" height="28" rx="1" fill="#fff"/>
              <rect x="35" y="18" width="8" height="28" rx="1" fill="#fff"/>
            </svg>
          ) : (
            <svg viewBox="0 0 64 64" width="26" height="26" aria-hidden="true" style={{display:"block"}}>
              <polygon points="24,18 24,46 46,32" fill="#fff" />
            </svg>
          )}
        </button>

        {/* spacer */}
        <div />

        {/* bar */}
        <div
          ref={barRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); seekFromEvent(e.clientX); }}
          style={{
            position: "relative",
            height: 8,
            borderRadius: 4,
            background: "rgba(255,255,255,0.15)",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.07)",
            cursor: "ew-resize",
            overflow: "hidden",        // ✅ clip handle when near the left edge
            alignSelf: "center",
          }}
          aria-label="Timeline scrubber"
          role="slider"
          aria-valuemin={0}
          aria-valuemax={durationInFrames - 1}
          aria-valuenow={currentFrame}
        >
          {/* progress fill */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${pct}%`,
              borderRadius: 4,
              background: "rgba(86,172,255,0.9)",
            }}
          />

          {/* playhead handle */}
          <div
            style={{
              position: "absolute",
              left: `max(0px, calc(${pct}% - 6px))`,
              top: -3,
              width: 12,
              height: 14,
              borderRadius: 3,
              background: "#fff",
              boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
            }}
          />

          {/* chapter markers */}
          {chapters?.map((c, idx) => {
            const cpct = frameToPct(c.frame) * 100;
            return (
              <div
                key={`${c.title}-${idx}`}
                title={c.title}
                style={{
                  position: "absolute",
                  left: `calc(${cpct}% - 1px)`,
                  top: 0,
                  width: 2,
                  height: "100%",
                  background: "rgba(255,255,255,0.8)",
                  opacity: 0.8,
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route index element={<Navigate to="video" replace />} />
        <Route path="video">
          <Route index element={<VideoIndex />} />
          <Route path=":name" element={<VideoByName />} />
        </Route>
        <Route path="*" element={<Navigate to="video" replace />} />
      </Routes>
    </Router>
  );
}
