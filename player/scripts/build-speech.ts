// scripts/build-speech.ts
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execa } from "execa";
import ffmpegPath from "ffmpeg-static";
import { fileURLToPath } from "node:url";
import { KokoroTTS } from "kokoro-js";
import { parseSceneScript } from "../src/scenescript";

// ---------------- Pronunciation Dictionary ----------------
const PRONUNCIATION: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bd\.rymcg\.tech\b/gi, replacement: "dee dot rye mic gee dot tech" },
  { pattern: /\bTraefik\b/gi, replacement: "traffic" },
  { pattern: /\b443\b/gi, replacement: "four four three" },
  { pattern: /\bdestroy\b/gi, replacement: "destroy" },
];
function applyPronunciation(text: string): string {
  return PRONUNCIATION.reduce((acc, { pattern, replacement }) => acc.replace(pattern, replacement), text);
}

// ---------------- Paths / Config (ESM-safe) ----------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "src");
const PUBLIC_DIR = path.join(ROOT, "public");
const SPEECH_ROOT = path.join(PUBLIC_DIR, "speech");
const TIMELINES_DIR = path.join(ROOT, "timelines");
const PUBLIC_TIMELINES_DIR = path.join(PUBLIC_DIR, "timelines");
const REGISTRY_JSON = path.join(PUBLIC_TIMELINES_DIR, "registry.json");

// Codec selection
type SpeechFormat = "opus" | "vorbis";
const SPEECH_FORMAT: SpeechFormat = (process.env.SPEECH_FORMAT as SpeechFormat) || "opus";
function encoderFor(format: SpeechFormat) {
  if (format === "opus") {
    return { ext: "opus", args: ["-c:a", "libopus", "-b:a", "96k", "-vbr", "on"], mime: "audio/ogg; codecs=opus" };
  }
  return { ext: "ogg", args: ["-c:a", "libvorbis", "-q:a", "5"], mime: "audio/ogg; codecs=vorbis" };
}
const { ext: AUDIO_EXT, args: ENCODER_ARGS } = encoderFor(SPEECH_FORMAT);

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

// ---------------- Types ----------------
type AudioAnchor = "inBegin" | "inEnd" | "outBegin" | "outEnd" | "absolute";
type SpeechCue = { text: string; voice: string; anchor: AudioAnchor; offsetSec?: number };
type TimelineItem = any;

type TimelineJson = {
  name: string;
  items: TimelineItem[];
};

// ---------------- Helpers ----------------
function hashKey(text: string, voice: string) {
  return crypto.createHash("sha1").update(`${voice}::${text}`).digest("hex").slice(0, 16);
}
async function ensureDir(p: string) {
  await fs.promises.mkdir(p, { recursive: true });
}
async function wavToEncoded(wavPath: string, outPath: string) {
  const bin = process.env.FFMPEG_PATH || ffmpegPath;
  if (!bin) throw new Error("ffmpeg binary not found. Install ffmpeg or add ffmpeg-static.");
  await execa(bin, ["-y", "-i", wavPath, ...ENCODER_ARGS, outPath], { stdio: "inherit" });
}
async function generateSpeechWav(text: string, voice: string, wavPath: string) {
  if (!(globalThis as any).__kokoro) {
    (globalThis as any).__kokoro = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: "q8", device: "cpu" });
  }
  const tts: KokoroTTS = (globalThis as any).__kokoro;
  const audio = await tts.generate(text, { voice });
  await audio.save(wavPath);
}
function sanitizeBase(base: string) {
  return base.replace(/[^a-z0-9-_]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

async function processTimeline(jsonPath: string) {
  const raw = await fs.promises.readFile(jsonPath, "utf8");
  const parsed: TimelineJson = JSON.parse(raw);
  if (!parsed?.name || !parsed?.items || !Array.isArray(parsed.items)) {
    throw new Error(`Malformed timeline JSON: expected { name, items[] } in ${jsonPath}`);
  }
  const name = parsed.name;
  const SPEECH_DIR = path.join(SPEECH_ROOT, name);

  await ensureDir(SPEECH_DIR);

  const newItems: TimelineItem[] = [];

  for (const item of parsed.items) {
    if (!item || typeof item !== "object") {
      newItems.push(item);
      continue;
    }
    const speech: SpeechCue[] | undefined = item.speech;
    if (!speech?.length) {
      newItems.push(item);
      continue;
    }

    const audioArr = Array.isArray(item.audio) ? [...item.audio] : [];

    for (const cue of speech) {
      const { voice, anchor, offsetSec = 0 } = cue;
      const preppedText = applyPronunciation(cue.text);

      const key = hashKey(preppedText, voice);
      const slug = sanitizeBase(preppedText).slice(0, 48) || "tts";
      const basename = `${slug}-${voice}-${key}`;

      const wavPath = path.join(SPEECH_DIR, `${basename}.wav`);
      const outPath = path.join(SPEECH_DIR, `${basename}.${AUDIO_EXT}`);
      const pubRel = `speech/${name}/${basename}.${AUDIO_EXT}`;

      if (!fs.existsSync(outPath)) {
        if (!fs.existsSync(wavPath)) {
          console.log(
            `[speech:${name}] TTS ${voice} "${preppedText.slice(0, 42)}${preppedText.length > 42 ? "…" : ""}"`
          );
          await generateSpeechWav(preppedText, voice, wavPath);
        }
        await wavToEncoded(wavPath, outPath);
        try {
          await fs.promises.unlink(wavPath);
          console.log(`[speech:${name}] cleaned up ${path.basename(wavPath)}`);
        } catch (err) {
          console.warn(`[speech:${name}] warning: could not delete ${wavPath}:`, (err as Error).message);
        }
      }

      audioArr.push({ src: pubRel, anchor, offsetSec });
    }

    const { speech: _drop, ...rest } = item;
    newItems.push({ ...rest, audio: audioArr });
  }

  // Write JSON timeline:
  const outJson = JSON.stringify({ name, items: newItems }, null, 2);
  await fs.promises.writeFile(
    path.join(PUBLIC_TIMELINES_DIR, `${name}.json`),
    outJson,
    "utf8"
  );

  // Write a self-registering ESM that also exports name/timeline:
  const esm = `// AUTO-GENERATED for timeline "${name}" – DO NOT EDIT
export const name = ${JSON.stringify(name)};
export const timeline = ${JSON.stringify(newItems, null, 2)};
if (typeof globalThis !== "undefined") {
  const root = (globalThis.shellScene ??= {});
  if (typeof root.registerTimeline === "function") {
    root.registerTimeline(name, timeline, ${JSON.stringify(name)});
  } else {
    (root.__timelines ??= {})[name] = timeline;
    (root.__titles ??= {})[name] = ${JSON.stringify(name)};
  }
}
`;
  await fs.promises.writeFile(
    path.join(PUBLIC_TIMELINES_DIR, `${name}.speech.js`),
    esm,
    "utf8"
  );

  console.log(`[speech:${name}] wrote public/timelines/${name}.{json,speech.js}`);
  return name;
}

async function writeRegistry(names: string[]) {
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  const body = {
    names: sorted,
    modules: sorted.map((n) => `/timelines/${n}.speech.js`),
    titles: Object.fromEntries(sorted.map((n) => [n, n])),
  };
  await fs.promises.writeFile(
    REGISTRY_JSON,
    JSON.stringify(body, null, 2),
    "utf8"
  );
  console.log(`[speech] wrote ${path.relative(ROOT, REGISTRY_JSON)}`);
}


function idSafe(s: string) {
  return s.replace(/[^a-zA-Z0-9_$]/g, "_");
}

// ---------------- Main ----------------
async function main() {
  console.log("[speech] building speech assets for all timelines…");

  if (!fs.existsSync(TIMELINES_DIR)) {
    console.error(`[speech] not found: ${path.relative(ROOT, TIMELINES_DIR)}`);
    process.exit(2);
  }

  const files = (await fs.promises.readdir(TIMELINES_DIR))
    .filter((f) => f.toLowerCase().endsWith(".timeline"))
    .map((f) => path.join(TIMELINES_DIR, f));

  await ensureDir(SPEECH_ROOT);
  await ensureDir(PUBLIC_TIMELINES_DIR);

  const builtNames: string[] = [];
  const seenNames = new Set<string>();

  for (const srcPath of files) {
    try {
      const script = await fs.promises.readFile(srcPath, "utf8");
      const timeline = parseSceneScript(script);

      if (!timeline?.name) {
        throw new Error("Parsed timeline has no name");
      }
      if (seenNames.has(timeline.name)) {
        throw new Error(`Duplicate timeline name: ${timeline.name}`);
      }
      seenNames.add(timeline.name);

      // Write parsed JSON so downstream steps (and debugging) can use it
      const outJsonPath = path.join(PUBLIC_TIMELINES_DIR, `${timeline.name}.json`);
      await fs.promises.writeFile(outJsonPath, JSON.stringify(timeline, null, 2), "utf8");
      try {
        const builtName = await processTimeline(outJsonPath);
        builtNames.push(builtName);
      } finally {
        await fs.promises.unlink(outJsonPath).catch(() => {});
      }
    } catch (err) {
      console.error(
        `[speech] failed building ${path.basename(srcPath)}:`,
        (err as Error).message
      );
      process.exitCode = 1;
    }
  }

  await writeRegistry(builtNames);

  if (process.exitCode && process.exitCode !== 0) {
    throw new Error("One or more timelines failed to build.");
  }

  console.log("[speech] OK");
}

main().catch((err) => {
  console.error("[speech] build failed:", err);
  process.exit(1);
});
