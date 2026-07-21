import { type CampaignState, ISLAND_COUNT, newCampaign } from './state';

/**
 * localStorage persistence for the campaign grid.
 *
 * The grid only means anything if it survives the page reloads the game uses
 * to switch levels (full-page navigation, see src/scenes/levelNav.ts) — an
 * in-memory campaign would reset on every mission.
 *
 * Version policy: the stored blob carries schemaVersion, and ANY mismatch,
 * parse failure or shape problem is treated as "no save" — a fresh campaign.
 * No migration path exists because no released version ever wrote a v0; when
 * a v2 lands, that is the moment to decide whether old runs are worth
 * migrating, and until then failing to a clean run beats resurrecting a
 * half-understood blob.
 */
export const CAMPAIGN_STORAGE_KEY = 'puzzlevault.campaign.v1';

const SCHEMA_VERSION = 1;

/**
 * localStorage if it exists and actually works, else null.
 *
 * This module is imported by tests running in plain node (no `window`), and
 * browsers throw on `localStorage` access in some privacy modes / sandboxed
 * iframes rather than returning undefined. Both cases must degrade to "no
 * persistence", never to a thrown error at import time — hence the lookup
 * being a function, not a module-level constant.
 */
function safeStorage(): Storage | null {
  try {
    if (typeof globalThis === 'undefined') return null;
    const store = (globalThis as { localStorage?: Storage }).localStorage;
    if (!store) return null;
    return store;
  } catch {
    return null;
  }
}

/**
 * Whether the parsed blob is a valid current-version CampaignState.
 *
 * Checks the range invariants the rest of the layer assumes, not just types:
 * a hand-edited `gridHp: 9999`, or a `bossCleared` array that no longer lines
 * up with ISLAND_COUNT, would otherwise load verbatim and quietly produce
 * wrong unlock behaviour. This is not anti-cheat — anyone with devtools can
 * write a perfectly *valid* blob saying whatever they like — it is so that a
 * corrupt or stale save fails cleanly into a fresh campaign instead of a
 * subtly broken one.
 */
function isValid(value: unknown): value is CampaignState {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  if (s.schemaVersion !== SCHEMA_VERSION) return false;
  if (typeof s.campaignOver !== 'boolean') return false;
  if (typeof s.gridMax !== 'number' || !Number.isInteger(s.gridMax) || s.gridMax <= 0) return false;
  if (typeof s.gridHp !== 'number' || !Number.isInteger(s.gridHp) || s.gridHp < 0 || s.gridHp > s.gridMax) return false;
  if (
    typeof s.islandIndex !== 'number' ||
    !Number.isInteger(s.islandIndex) ||
    s.islandIndex < 0 ||
    s.islandIndex > ISLAND_COUNT
  ) {
    return false;
  }
  if (!Array.isArray(s.clearedMapIds) || !s.clearedMapIds.every((id) => typeof id === 'string')) return false;
  if (
    !Array.isArray(s.bossCleared) ||
    s.bossCleared.length !== ISLAND_COUNT ||
    !s.bossCleared.every((b) => typeof b === 'boolean')
  ) {
    return false;
  }
  return true;
}

/** Reads the saved campaign, falling back to a brand-new one on absent/corrupt/wrong-version data. */
export function loadCampaign(): CampaignState {
  const store = safeStorage();
  if (!store) return newCampaign();
  try {
    const raw = store.getItem(CAMPAIGN_STORAGE_KEY);
    if (!raw) return newCampaign();
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : newCampaign();
  } catch {
    return newCampaign();
  }
}

/** Persists the campaign. A storage failure (quota, privacy mode) is non-fatal — the run just won't survive a reload. */
export function saveCampaign(state: CampaignState): void {
  const store = safeStorage();
  if (!store) return;
  try {
    store.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore — persistence is best-effort, the in-memory run continues */
  }
}

/** Wipes the save. Used by the level-select restart button after a campaign ends. */
export function clearCampaign(): void {
  const store = safeStorage();
  if (!store) return;
  try {
    store.removeItem(CAMPAIGN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
