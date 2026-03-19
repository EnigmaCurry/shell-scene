// utils/audioCache.ts
// Pre-caches audio assets so playback never hitches.
// Uses Cache API for persistent storage across page loads,
// and produces blob URLs for use by <Audio> elements.

import type { TimelineItem, AudioAttachment } from "../CompositionWeb";

const CACHE_NAME = "shell-scene-audio-v1";

/** Extract every unique audio `src` URL from a timeline. */
export function collectAudioUrls(timeline: TimelineItem[]): string[] {
  const urls = new Set<string>();
  for (const item of timeline) {
    if (item.type === "transition") continue;
    const att = item.audio;
    if (!att) continue;
    const arr: AudioAttachment[] = Array.isArray(att) ? att : [att];
    for (const a of arr) {
      if (a.src) urls.add(a.src);
    }
  }
  return [...urls];
}

export type CacheProgress = {
  total: number;
  done: number;
};

/**
 * Fetch all audio URLs into the Cache API (persistent) and return
 * a Map from original URL → blob: URL for immediate in-memory playback.
 * Already-cached files are read from cache without a network request.
 */
export async function precacheAudio(
  urls: string[],
  onProgress: (p: CacheProgress) => void,
): Promise<Map<string, string>> {
  const urlMap = new Map<string, string>();

  if (urls.length === 0) {
    onProgress({ total: 0, done: 0 });
    return urlMap;
  }

  const cache = await caches.open(CACHE_NAME);
  let done = 0;
  const total = urls.length;
  onProgress({ total, done });

  await Promise.all(
    urls.map(async (url) => {
      let resp = await cache.match(url);
      if (!resp) {
        resp = await fetch(url);
        if (resp.ok) {
          // Clone before consuming — put() consumes the body
          await cache.put(url, resp.clone());
        }
      }
      if (resp && resp.ok) {
        const blob = await resp.blob();
        urlMap.set(url, URL.createObjectURL(blob));
      }
      done++;
      onProgress({ total, done });
    }),
  );

  return urlMap;
}

/**
 * Return a new timeline with audio src URLs replaced by blob URLs.
 */
export function rewriteTimelineUrls(
  timeline: TimelineItem[],
  urlMap: Map<string, string>,
): TimelineItem[] {
  if (urlMap.size === 0) return timeline;

  return timeline.map((item) => {
    if (item.type === "transition") return item;
    const att = item.audio;
    if (!att) return item;

    const rewrite = (a: AudioAttachment): AudioAttachment => {
      const mapped = urlMap.get(a.src);
      return mapped ? { ...a, src: mapped } : a;
    };

    const newAudio = Array.isArray(att) ? att.map(rewrite) : rewrite(att);
    return { ...item, audio: newAudio };
  });
}
