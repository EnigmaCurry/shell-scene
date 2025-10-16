// src/types/asciinema-player.d.ts
declare module "asciinema-player" {
  export type Fit = "width" | "height" | "both" | "none";
  export type Theme = "asciinema" | "tango" | "solarized-dark" | "solarized-light" | (string & {});

  export interface CreateOptions {
    cols?: number;
    rows?: number;
    theme?: Theme;
    fit?: Fit;
    autoplay?: boolean;
    preload?: boolean;
    poster?: string;         // e.g. "npt:0:00"
    loop?: boolean | number;
    controls?: boolean;
    speed?: number;
    idleTimeLimit?: number;
    startAt?: number | string;
    endAt?: number | string;
    title?: string;
    author?: string;
    authorURL?: string;
    // not official, but handy for your debug logs:
    logger?: Console;
  }

  export interface Player {
    el: HTMLElement;
    dispose(): void;
    getCurrentTime(): Promise<number>;
    getDuration(): Promise<number>;
    play(): Promise<void>;
    pause(): Promise<void>;
    seek(positionSeconds: number): Promise<void>;
    addEventListener(name: string, callback: (...args: any[]) => void): void;
    removeEventListener?(name: string, callback: (...args: any[]) => void): void;
  }

  export function create(src: string, element: HTMLElement, options?: CreateOptions): Player;
}

// If you sometimes import the bundled path, map it to the same types:
declare module "asciinema-player/dist/bundle/asciinema-player" {
  export * from "asciinema-player";
}
