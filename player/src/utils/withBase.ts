// src/utils/withBase.ts
export const withBase = (p: string) =>
  (import.meta.env.BASE_URL + p.replace(/^\/+/, '')); // strips leading "/" then prefixes base
