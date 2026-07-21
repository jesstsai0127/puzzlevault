import { type CampaignState, newCampaign } from './state';

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

/** Whether the parsed blob is a structurally valid current-version CampaignState. */
function isValid(value: unknown): value is CampaignState {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    s.schemaVersion === SCHEMA_VERSION &&
    typeof s.gridHp === 'number' &&
    typeof s.gridMax === 'number' &&
    typeof s.islandIndex === 'number' &&
    typeof s.campaignOver === 'boolean' &&
    Array.isArray(s.clearedMapIds) &&
    s.clearedMapIds.every((id) => typeof id === 'string') &&
    Array.isArray(s.bossCleared) &&
    s.bossCleared.every((b) => typeof b === 'boolean')
  );
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
