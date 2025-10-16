// player-app/src/getCastDuration.ts
export async function getCastDurationSeconds(url: string): Promise<number> {
  const res = await fetch(url);
  const txt = await res.text();
  try {
    const v2 = JSON.parse(txt);
    if (typeof v2.duration === "number") return v2.duration;
    if (Array.isArray(v2.stdout) && v2.stdout.length) {
      const last = v2.stdout[v2.stdout.length - 1];
      if (Array.isArray(last) && typeof last[0] === "number") return last[0];
    }
  } catch {}
  const lines = txt.split(/\r?\n/).filter(Boolean);
  if (lines.length >= 2) {
    try {
      const arr = JSON.parse(lines[lines.length - 1]);
      if (Array.isArray(arr) && typeof arr[0] === "number") return arr[0];
    } catch {}
  }
  return 0;
}
