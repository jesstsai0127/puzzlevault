/** Shared between main.ts and the scenes for the URL-query-param level-select handoff (see LevelSelectScene). */
export const MAP_QUERY_PARAM = 'map';

/** Same handoff pattern as MAP_QUERY_PARAM, naming a TutorialDef id instead of a MapDef id — see LevelSelectScene / BattleScene tutorial mode. */
export const TUTORIAL_QUERY_PARAM = 'tutorial';

export function mapIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get(MAP_QUERY_PARAM);
}

export function tutorialIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get(TUTORIAL_QUERY_PARAM);
}

/** Strips both the map and tutorial query params — used by BattleScene's "back to level select" button. */
export function levelSelectUrl(): string {
  const url = new URL(window.location.href);
  url.searchParams.delete(MAP_QUERY_PARAM);
  url.searchParams.delete(TUTORIAL_QUERY_PARAM);
  return url.toString();
}
