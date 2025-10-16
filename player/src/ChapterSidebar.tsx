import React, {useMemo} from "react";

export type ChapterItem = {title: string; frame: number};

export const ChapterSidebar: React.FC<{
  open: boolean;
  onToggle: () => void;
  fps: number;
  chapters: ChapterItem[];     // [{title, frame}] — frames are *visible* starts
  currentFrame: number;
  onJump: (frame: number) => void;
}> = ({open, onToggle, fps, chapters, currentFrame, onJump}) => {
  const activeIdx = useMemo(() => {
    if (!chapters.length) return -1;
    let idx = -1;
    for (let i = 0; i < chapters.length; i++) {
      if (chapters[i].frame <= currentFrame) idx = i; else break;
    }
    return Math.max(0, idx);
  }, [chapters, currentFrame]);

  const toTime = (fr: number) => {
    const s = fr / fps;
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${r.toString().padStart(2,"0")}`;
  };

  return (
    <aside className={`sidebar ${open ? "open" : "closed"}`} style={{"--chapters": String(chapters.length)} as React.CSSProperties}>
      <button
        className="sb-toggle"
        aria-expanded={open}
        aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
        onClick={onToggle}
        title={open ? "Collapse" : "Expand"}
      >
        <svg className="sb-icon" viewBox="0 0 24 24" aria-hidden="true">
          {/* »» — two right chevrons */}
          <path d="M5 6 L11 12 L5 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M11 6 L17 12 L11 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      <div className="sb-header">Chapters</div>

      <nav className="sb-list" role="navigation" aria-label="Chapters">
        {chapters.map((c, i) => (
          <button
            key={`${i}-${c.frame}`}
            className={`sb-item ${i === activeIdx ? "active" : ""}`}
            onClick={() => onJump(c.frame)}
            title={`${c.title} @ ${toTime(c.frame)}`}
          >
            <span className="sb-title"><span>{c.title}</span></span>
            <span className="sb-time">{toTime(c.frame)}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
};

