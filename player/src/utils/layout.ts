export function defaultSidebarOpen(): boolean {
  if (typeof window === "undefined") return false; // SSR/fallback

  // Prefer a media query (handles zoom/rotation well)
  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(min-aspect-ratio: 16/9)").matches;
  }

  // Fallback: compute from viewport
  const w = window.visualViewport?.width ?? window.innerWidth;
  const h = window.visualViewport?.height ?? window.innerHeight;
  return w / h >= 16 / 9;
}
