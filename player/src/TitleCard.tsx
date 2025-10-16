import React from "react";
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from "remotion";

type TitleCardProps = {
  title: string;
  subtitle?: string;
  /**
   * Degrees per second for the conic gradient rotation.
   * 10–30 feels good; default 18.
   */
  spinDegPerSec?: number;
  /**
   * How far the glow moves (percent of width/height).
   */
  glowDrift?: number;
};

export const TitleCard: React.FC<TitleCardProps> = ({
  title,
  subtitle,
  spinDegPerSec = 18,
  glowDrift = 10,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // Timeline-driven time in seconds
  const t = frame / fps;

  // Rotate the conic gradient deterministically with the timeline
  const angle = (t * spinDegPerSec) % 360;

  // Gently drift a radial glow to make motion obvious
  const cx = 50 + glowDrift * Math.sin(t * 2.0); // %
  const cy = 50 + glowDrift * Math.cos(t * 1.5); // %

  return (
    <AbsoluteFill
      style={{
        background:
          // Subtle drifting glow (very low alpha)
          `radial-gradient(circle at ${cx}% ${cy}%, rgba(255,255,255,0.05), rgba(0,0,0,0) 55%),` +
          // Dark rotating conic gradient
          `conic-gradient(from ${angle}deg at 50% 50%, 
             hsl(220 30% 7%) 0%,
             hsl(260 28% 9%) 25%,
             hsl(200 28% 7%) 50%,
             hsl(260 28% 9%) 75%,
             hsl(220 30% 7%) 100%)`,
        // A little polish
        willChange: "background",
        position: "relative",
        color: "#e6e9ef",
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
      }}
    >
      {/* Vignette overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(100% 100% at 50% 50%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.45) 100%)",
        }}
      />

      {/* Copy */}
      <div
        style={{
          textAlign: "center",
          padding: "3rem",
          lineHeight: 1.1,
          textShadow: "0 2px 18px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{fontSize: "5rem", fontWeight: 800, letterSpacing: 0.5}}>
          {title}
        </div>
        {subtitle ? (
          <div
            style={{
              marginTop: "1rem",
              fontSize: "2rem",
              opacity: 0.85,
              letterSpacing: 0.4,
              fontWeight: 500,
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
