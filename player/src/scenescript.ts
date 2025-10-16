// scenescript.ts
import type { SpeechCue, CardItem, CastItem, AudioAnchor, TimelineItem } from "./CompositionWeb.tsx"

export type Timeline = {
  name: string;
  items: TimelineItem[];
};

const DEFAULT_VOICE = "af_heart";
const DEFAULT_ANCHOR = "inBegin";

export function parseSceneScript(input: string): Timeline {
  const lines = input
    .split(/\r?\n/)
    .map(l => l.replace(/\t/g, "  ")) // normalize tabs
    .map(l => l.trimEnd());

  let name = "timeline";
  const items: TimelineItem[] = [];

  // State for the current open block (card or cast)
  let current: CardItem | CastItem | null = null;

  const pushCurrent = () => {
    if (current) items.push(current);
    current = null;
  };

  const eatTimeline = (line: string) => {
    const m = /^timeline\s*:\s*(.+)\s*$/i.exec(line);
    if (m) {
      name = m[1].trim();
      return true;
    }
    return false;
  };

  const eatBlankOrComment = (line: string) =>
    line.trim() === "" || line.trim().startsWith("#");

  const eatTransition = (line: string) => {
    let m = /^(fade|crossfade)\s+(\d+)\s*$/i.exec(line);
    if (m) {
      const [, kind, frames] = m;
      pushCurrent();
      items.push({
        type: "transition",
        name: kind.toLowerCase() as "fade" | "crossfade",
        durationFrames: Number(frames),
      });
      return true;
    }
    m = /^swipe\s+(left|right|up|down)\s+(\d+)\s*$/i.exec(line);
    if (m) {
      const [, dir, frames] = m;
      pushCurrent();
      items.push({
        type: "transition",
        name: "swipe",
        direction: dir.toLowerCase() as any,
        durationFrames: Number(frames),
      });
      return true;
    }
    return false;
  };

  const eatCard = (line: string) => {
    const m =
      /^card\s+"([^"]+)"(?:\s*\|\s*"([^"]+)")?(?:\s*@\s*([\d.]+)s?)?\s*$/i.exec(
        line
      );
    if (!m) return false;
    pushCurrent();
    const [, title, subtitle, secs] = m;
    current = {
      type: "card",
      title,
      ...(subtitle ? { subtitle } : {}),
      ...({ seconds: Number(secs) }),
      speech: [],
    };
    return true;
  };

  const eatCast = (line: string) => {
    const m = /^cast\s+(\S+)\s+(\d+)x(\d+)\s*$/i.exec(line);
    if (!m) return false;
    pushCurrent();
    const [, castPath, cols, rows] = m;
    current = {
      type: "cast",
      castPath,
      cols: Number(cols),
      rows: Number(rows),
      speech: [],
    };
    return true;
  };

  const eatSay = (line: string) => {
    // Must be under a card or cast
    if (!current) return false;

    // Allow leading indentation then 'say "...'
    const m =
      /^\s{2,}say\s+"([\s\S]*?)"(?:\s*@\s*([\d.]+)s?)?(?:\s+voice=([a-z0-9_]+))?(?:\s+anchor=(inBegin|inEnd|clipStart|baseEnd|visibleEnd))?\s*$/i.exec(
        line
      );
    if (!m) return false;

    const [, text, off, voice, anchor] = m;

    const sp: SpeechCue = {
      text,
      voice: voice ?? DEFAULT_VOICE,
      anchor: (anchor as AudioAnchor | undefined) ?? DEFAULT_ANCHOR,
      ...(off ? { offsetSec: Number(off) } : {}),
    };
    (current.speech ??= []).push(sp);
    return true;
  };

  for (const raw of lines) {
    const line = raw;

    if (eatBlankOrComment(line)) continue;
    if (eatTimeline(line)) continue;
    if (eatTransition(line)) continue;
    if (eatCard(line)) continue;
    if (eatCast(line)) continue;
    if (eatSay(line)) continue;

    // If we got here, the line didn't match anything:
    throw new Error(`SceneScript syntax error: "${line}"`);
  }

  pushCurrent();
  return { name, items };
}
