// src/types/shellScene.d.ts
export {};
declare global {
  interface Window {
    shellScene?: {
      registerTimeline: (name: string, timeline: any[], title?: string) => void;
      getTimeline: (name: string) => any[] | undefined;
      list: () => string[];
      title: (name: string) => string;
      _map?: Record<string, any[]>;
      _titles?: Record<string, string>;
    };
  }
}
