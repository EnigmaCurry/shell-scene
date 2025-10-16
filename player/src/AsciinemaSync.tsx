// player-app/src/AsciinemaSync.tsx
import React, {useEffect, useRef} from "react";
import {useCurrentFrame, useVideoConfig} from "remotion";
import {create as createAsciinema} from "asciinema-player";

type Theme = "asciinema" | "tango" | "solarized-dark" | "solarized-light";
export type Fit = "width" | "height" | "both" | "none";

// Normalize any return (some builds return Promises, some don't)
const asPromise = <T,>(x: any): Promise<T | void> =>
  x && typeof x.then === "function" ? x : Promise.resolve(x);

export const AsciinemaSync: React.FC<{
  src: string;
  cols?: number;
  rows?: number;
  theme?: Theme | string;
  fit?: Fit;
  showControls?: boolean;
  isPlaying: boolean;         // <-- from Remotion Player
  debug?: boolean;
  disableKeyboard?: boolean;  // disable asciinema's own hotkeys
}> = ({
  src,
  cols = 99,
  rows = 24,
  theme = "asciinema",
  fit = "width",
  showControls = false,
  isPlaying,
  debug = false,
  disableKeyboard = true,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);

  const readyRef = useRef(false);
  const lastSeekSecRef = useRef<number>(-1);

  // for jump detection & alignment
  const prevFrameRef = useRef<number | null>(null);
  const lastAlignedFrameRef = useRef<number>(-1);

  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const log = (...args: any[]) => {
    if (debug) console.log("[AsciinemaSync]", ...args);
  };

  // --- Mount / create player once (and on prop changes that require remount) ---
  useEffect(() => {
    if (!hostRef.current) return;

    log("create player", {src, cols, rows, theme, fit});
    const p = (playerRef.current = createAsciinema(src, hostRef.current, {
      cols,
      rows,
      theme,
      fit,
      preload: true,
      autoplay: false,
      controls: showControls,
      poster: "npt:0:00",
      ...(debug ? {logger: console} : {}),
    }));

    // Optional: internal event breadcrumbs
    try {
      p.addEventListener?.("play",  () => log("[event] play"));
      p.addEventListener?.("pause", () => log("[event] pause"));
      p.addEventListener?.("seek",  () => log("[event] seek"));
      p.addEventListener?.("ready", () => log("[event] ready"));
    } catch {}

    // Disable asciinema keybindings (focus/keys)
    const listeners: Array<() => void> = [];
    const el = (p?.el ?? hostRef.current) as HTMLElement | undefined;
    if (disableKeyboard && el) {
      el.setAttribute("tabindex", "-1");
      const blurFocus = (e: Event) => {
        (e.target as HTMLElement | null)?.blur?.();
        e.stopPropagation();
      };
      const preventMouseFocus = (e: MouseEvent) => e.preventDefault();
      const swallow = (e: KeyboardEvent) => {
        log("swallow key", e.key);
        e.preventDefault();
        e.stopImmediatePropagation?.();
        e.stopPropagation();
      };
      const on = <K extends keyof HTMLElementEventMap | keyof DocumentEventMap>(
        target: Element | Document,
        type: K,
        handler: any,
        capture = true
      ) => {
        target.addEventListener(type as any, handler, {capture});
        listeners.push(() => target.removeEventListener(type as any, handler, {capture}));
      };
      on(el, "keydown", swallow);
      on(el, "keypress", swallow);
      on(el, "keyup", swallow);
      on(el, "focusin", blurFocus, true);
      on(el, "mousedown", preventMouseFocus, true);
      log("keyboard disabled");
    }

    // Initial align to current frame, then pause & mark ready
    let disposed = false;
    requestAnimationFrame(() => {
      if (disposed || !playerRef.current) return;
      const t0 = frame / fps;
      asPromise(playerRef.current.seek?.(t0)).then(() => {
        if (disposed) return;
        asPromise(playerRef.current.pause?.());
        readyRef.current = true;
        lastSeekSecRef.current = t0;
        prevFrameRef.current = frame;
        lastAlignedFrameRef.current = frame;
        log("ready @", t0.toFixed(3), "sec");
      });
    });

    return () => {
      disposed = true;
      try { playerRef.current?.pause?.(); } catch {}
      try { playerRef.current?.dispose?.(); } catch {}
      listeners.forEach((off) => off());
      log("disposed");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, cols, rows, theme, fit, showControls, disableKeyboard]);

  // --- Effect 1: react to isPlaying toggles (spacebar, UI button, etc.) ---
  useEffect(() => {
    if (!readyRef.current || !playerRef.current) return;
    const t = frame / fps;

    if (isPlaying) {
      //log("toggle → PLAY (align @", t.toFixed(3), ")");
      asPromise(playerRef.current.seek?.(t))
        .then(() => asPromise(playerRef.current.play?.()))
        .then(() => {
          log("play()");
          lastSeekSecRef.current = t;
          lastAlignedFrameRef.current = frame;
          prevFrameRef.current = frame;
        });
    } else {
      log("toggle → PAUSE (align @", t.toFixed(3), ")");
      asPromise(playerRef.current.pause?.())
        .then(() => asPromise(playerRef.current.seek?.(t)))
        .then(() => {
          log("pause(); seek →", t.toFixed(3));
          lastSeekSecRef.current = t;
          lastAlignedFrameRef.current = frame;
        });
    }
    // Re-run when play/pause flips or when the toggle happens at a different frame
  }, [isPlaying, frame, fps]);

  // --- Effect 2: frame-driven sync (handle jumps + exact paused scrubs) ---
  useEffect(() => {
    if (!readyRef.current || !playerRef.current) return;

    const t = frame / fps;
    const prev = prevFrameRef.current;
    prevFrameRef.current = frame;

    if (isPlaying) {
      // Detect a jump while playing (arrow keys / clicking scrubber)
      const continuous = prev !== null && frame - prev === 1;
      const jumped = prev !== null && !continuous;
      if (jumped && lastAlignedFrameRef.current !== frame) {
        log("playing jump:", prev, "→", frame, "align @", t.toFixed(3));
        asPromise(playerRef.current.seek?.(t))
          .then(() => asPromise(playerRef.current.play?.()))
          .then(() => {
            log("realign play()");
            lastAlignedFrameRef.current = frame;
          });
      }
      // Otherwise do nothing while playing (no per-frame seeks → no flicker)
      return;
    }

    // Paused: seek to exact frame (with tiny tolerance to avoid spam)
    const tol = 1 / (fps * 2);
    if (Math.abs(t - lastSeekSecRef.current) > tol) {
      asPromise(playerRef.current.seek?.(t)).then(() => {
        lastSeekSecRef.current = t;
        lastAlignedFrameRef.current = frame;
        log("seek →", t.toFixed(3));
      });
    }
  }, [frame, fps, isPlaying]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "grid",
        placeItems: "center",
        background: "#000",
      }}
    >
      <div
        ref={hostRef}
        style={{
          width: "100%",
          height: "100%",
          maxWidth: "100%",
          maxHeight: "100%",
          background: "#000",
        }}
      />
    </div>
  );
};
