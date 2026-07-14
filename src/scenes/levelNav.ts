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
