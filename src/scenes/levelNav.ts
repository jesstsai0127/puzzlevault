/** Shared between main.ts and the scenes for the URL-query-param level-select handoff (see LevelSelectScene). */
export const MAP_QUERY_PARAM = 'map';

export function mapIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get(MAP_QUERY_PARAM);
}

/** Strips the map query param — used by BattleScene's "back to level select" button. */
export function levelSelectUrl(): string {
  const url = new URL(window.location.href);
  url.searchParams.delete(MAP_QUERY_PARAM);
  return url.toString();
}

/**
 * ITB alignment (2026-07-17): the standalone tutorial flow (LESSON_MAP_IDS —
 * see content/registry.ts) chains its 5 steps via the same full-page-nav
 * pattern as every other level switch, just carrying an extra index so
 * BattleScene knows "this is tutorial step N" and can auto-advance to N+1
 * instead of returning to level select on a win.
 */
export const TUTORIAL_QUERY_PARAM = 'tutorial';

/** Reads `?tutorial=N` from the URL — null if absent or not a valid non-negative integer. */
export function tutorialIndexFromUrl(): number | null {
  const raw = new URLSearchParams(window.location.search).get(TUTORIAL_QUERY_PARAM);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Builds the URL for tutorial step `index` of `sequence` (sets both ?map= and ?tutorial=). */
export function tutorialStepUrl(sequence: string[], index: number): string {
  const url = new URL(window.location.href);
  url.searchParams.set(MAP_QUERY_PARAM, sequence[index]);
  url.searchParams.set(TUTORIAL_QUERY_PARAM, String(index));
  return url.toString();
}
