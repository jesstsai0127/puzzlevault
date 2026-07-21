import { afterEach, describe, expect, it } from 'vitest';
import {
  applyMissionResult,
  availableMissions,
  bossMapId,
  FINAL_MAP_ID,
  GRID_MAX,
  GRID_START,
  isCampaignMap,
  isCampaignWon,
  newCampaign,
  regularMapIds,
  type CampaignState,
} from '../core/campaign/state';
import { CAMPAIGN_STORAGE_KEY, clearCampaign, loadCampaign, saveCampaign } from '../core/campaign/storage';

/** Plays `mapId` losing `damage` grid, at whatever gridHp the state currently holds. */
function play(state: CampaignState, mapId: string, damage: number, outcome: 'victory' | 'defeat' = 'victory') {
  return applyMissionResult(state, {
    mapId,
    outcome,
    baseMaxHp: state.gridHp,
    baseHpRemaining: state.gridHp - damage,
  });
}

/** Clears `count` of island `island`'s regular missions, each for `damage` grid. */
function clearRegulars(state: CampaignState, island: number, count: number, damage = 1) {
  let s = state;
  for (const mapId of regularMapIds(island).slice(0, count)) s = play(s, mapId, damage);
  return s;
}

describe('newCampaign', () => {
  it('starts with a full grid, no progress, on island 0', () => {
    const s = newCampaign();
    expect(s.schemaVersion).toBe(1);
    expect(s.gridHp).toBe(GRID_START);
    expect(s.gridMax).toBe(GRID_MAX);
    expect(s.islandIndex).toBe(0);
    expect(s.clearedMapIds).toEqual([]);
    expect(s.bossCleared).toEqual([false, false, false, false]);
    expect(s.campaignOver).toBe(false);
  });
});

describe('applyMissionResult — grid arithmetic', () => {
  it('deducts the damage the base took, and carries it across missions', () => {
    let s = newCampaign();
    s = play(s, regularMapIds(0)[0], 3);
    expect(s.gridHp).toBe(GRID_START - 3);
    // The carry is the whole point: the second mission starts from the reduced grid.
    s = play(s, regularMapIds(0)[1], 2);
    expect(s.gridHp).toBe(GRID_START - 5);
  });

  it('does not mutate the state passed in', () => {
    const s = newCampaign();
    const before = JSON.parse(JSON.stringify(s));
    play(s, regularMapIds(0)[0], 4);
    expect(s).toEqual(before);
  });

  it('awards +1 for a zero-damage victory', () => {
    let s = newCampaign();
    s = play(s, regularMapIds(0)[0], 3);
    expect(s.gridHp).toBe(GRID_START - 3);
    s = play(s, regularMapIds(0)[1], 0);
    expect(s.gridHp).toBe(GRID_START - 2);
  });

  it('never lets the zero-damage bonus exceed gridMax', () => {
    let s: CampaignState = { ...newCampaign(), gridHp: GRID_MAX };
    s = play(s, regularMapIds(0)[0], 0);
    expect(s.gridHp).toBe(GRID_MAX);
  });

  it('denies the zero-damage bonus on a defeat', () => {
    const s = play(newCampaign(), regularMapIds(0)[0], 0, 'defeat');
    expect(s.gridHp).toBe(GRID_START);
    expect(s.clearedMapIds).toEqual([]);
  });

  it('charges grid damage on a defeat and does not mark the mission cleared', () => {
    const s = play(newCampaign(), regularMapIds(0)[0], 2, 'defeat');
    expect(s.gridHp).toBe(GRID_START - 2);
    expect(s.clearedMapIds).toEqual([]);
    expect(s.campaignOver).toBe(false);
  });

  it('treats a base that somehow gained HP as zero damage rather than a refund', () => {
    const s = applyMissionResult(newCampaign(), {
      mapId: regularMapIds(0)[0],
      outcome: 'victory',
      baseMaxHp: 4,
      baseHpRemaining: 6,
    });
    expect(s.gridHp).toBe(GRID_START + 1); // the zero-damage bonus, not +2 of free grid
  });
});

describe('applyMissionResult — campaign over', () => {
  it('ends the campaign when the grid reaches zero', () => {
    const s = play(newCampaign(), regularMapIds(0)[0], GRID_START);
    expect(s.gridHp).toBe(0);
    expect(s.campaignOver).toBe(true);
  });

  it('clamps overkill damage at zero and still ends the campaign', () => {
    const s = play(newCampaign(), regularMapIds(0)[0], GRID_START + 5);
    expect(s.gridHp).toBe(0);
    expect(s.campaignOver).toBe(true);
  });

  it('does not record progress from the mission that killed the grid', () => {
    const mapId = regularMapIds(0)[0];
    const s = play(newCampaign(), mapId, GRID_START);
    expect(s.clearedMapIds).not.toContain(mapId);
  });

  it('offers no missions once the campaign is over', () => {
    const s = play(newCampaign(), regularMapIds(0)[0], GRID_START);
    expect(availableMissions(s)).toEqual([]);
  });
});

describe('availableMissions — 5-choose-3 unlock rules', () => {
  it('starts with all four regular missions of island 1 and no boss', () => {
    const s = newCampaign();
    expect(availableMissions(s)).toEqual(regularMapIds(0));
    expect(availableMissions(s)).not.toContain(bossMapId(0));
  });

  it('drops cleared missions from the list', () => {
    const s = clearRegulars(newCampaign(), 0, 1);
    expect(availableMissions(s)).toEqual(regularMapIds(0).slice(1));
  });

  it('keeps the boss locked until three regular missions are cleared', () => {
    let s = newCampaign();
    for (let n = 1; n <= 2; n++) {
      s = clearRegulars(newCampaign(), 0, n);
      expect(availableMissions(s)).not.toContain(bossMapId(0));
    }
  });

  it('offers only the boss once three are cleared — the fourth regular is skipped for good', () => {
    const s = clearRegulars(newCampaign(), 0, 3);
    expect(availableMissions(s)).toEqual([bossMapId(0)]);
    expect(availableMissions(s)).not.toContain(regularMapIds(0)[3]);
  });

  it('advances to the next island when the boss is cleared', () => {
    let s = clearRegulars(newCampaign(), 0, 3);
    s = play(s, bossMapId(0)!, 1);
    expect(s.islandIndex).toBe(1);
    expect(s.bossCleared).toEqual([true, false, false, false]);
    expect(availableMissions(s)).toEqual(regularMapIds(1));
  });

  it('never re-offers a finished island', () => {
    let s = clearRegulars(newCampaign(), 0, 3, 0);
    s = play(s, bossMapId(0)!, 0);
    for (const mapId of regularMapIds(0)) expect(availableMissions(s)).not.toContain(mapId);
  });

  it('unlocks the final battle only after all four island bosses', () => {
    let s = newCampaign();
    for (let island = 0; island < 4; island++) {
      s = clearRegulars(s, island, 3, 0);
      expect(availableMissions(s)).not.toContain(FINAL_MAP_ID);
      s = play(s, bossMapId(island)!, 0);
    }
    expect(s.islandIndex).toBe(4);
    expect(s.bossCleared).toEqual([true, true, true, true]);
    expect(availableMissions(s)).toEqual([FINAL_MAP_ID]);
  });

  it('is a 17-mission campaign: (3 + 1) x 4 islands + the final battle', () => {
    let s = newCampaign();
    let played = 0;
    for (let island = 0; island < 4; island++) {
      for (let i = 0; i < 3; i++) {
        s = play(s, availableMissions(s)[0], 0);
        played++;
      }
      s = play(s, availableMissions(s)[0], 0);
      played++;
    }
    s = play(s, availableMissions(s)[0], 0);
    played++;
    expect(played).toBe(17);
    expect(s.clearedMapIds).toHaveLength(17);
    expect(availableMissions(s)).toEqual([]);
    expect(isCampaignWon(s)).toBe(true);
  });
});

describe('isCampaignMap', () => {
  it('accepts island missions and the final battle', () => {
    expect(isCampaignMap('island1_m1')).toBe(true);
    expect(isCampaignMap('island4_m5')).toBe(true);
    expect(isCampaignMap(FINAL_MAP_ID)).toBe(true);
  });

  it('rejects lesson and unknown maps so they never touch the grid', () => {
    expect(isCampaignMap('lesson_ap_cost')).toBe(false);
    expect(isCampaignMap('no_such_map')).toBe(false);
  });
});

// ---------------------------------------------------------------------
// Storage. vitest runs in node with no window/localStorage by default, so
// these install a minimal in-memory stand-in and remove it again — which
// also exercises the no-storage fallback path for free.
// ---------------------------------------------------------------------

function installFakeStorage(): Record<string, string> {
  const data: Record<string, string> = {};
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    removeItem: (k: string) => {
      delete data[k];
    },
  };
  return data;
}

describe('campaign storage', () => {
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('falls back to a fresh campaign with no localStorage at all (node)', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadCampaign()).toEqual(newCampaign());
    // And the writes must be silent no-ops rather than throwing.
    expect(() => saveCampaign(newCampaign())).not.toThrow();
    expect(() => clearCampaign()).not.toThrow();
  });

  it('falls back to a fresh campaign when a throwing localStorage is present', () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem() {
        throw new Error('SecurityError: privacy mode');
      },
      setItem() {
        throw new Error('QuotaExceededError');
      },
      removeItem() {
        throw new Error('nope');
      },
    };
    expect(loadCampaign()).toEqual(newCampaign());
    expect(() => saveCampaign(newCampaign())).not.toThrow();
    expect(() => clearCampaign()).not.toThrow();
  });

  it('round-trips a campaign in progress', () => {
    installFakeStorage();
    let s = clearRegulars(newCampaign(), 0, 3, 2);
    s = play(s, bossMapId(0)!, 1);
    saveCampaign(s);
    expect(loadCampaign()).toEqual(s);
  });

  it('returns a fresh campaign when nothing is saved', () => {
    installFakeStorage();
    expect(loadCampaign()).toEqual(newCampaign());
  });

  it('returns a fresh campaign when the saved blob is unparseable', () => {
    const data = installFakeStorage();
    data[CAMPAIGN_STORAGE_KEY] = '{not json';
    expect(loadCampaign()).toEqual(newCampaign());
  });

  it('returns a fresh campaign when the schemaVersion does not match', () => {
    const data = installFakeStorage();
    data[CAMPAIGN_STORAGE_KEY] = JSON.stringify({ ...newCampaign(), schemaVersion: 99, gridHp: 3 });
    expect(loadCampaign()).toEqual(newCampaign());
  });

  it('returns a fresh campaign when the blob is the right version but the wrong shape', () => {
    const data = installFakeStorage();
    data[CAMPAIGN_STORAGE_KEY] = JSON.stringify({ schemaVersion: 1, gridHp: 'eight' });
    expect(loadCampaign()).toEqual(newCampaign());
  });

  it('clearCampaign wipes the save so the next load starts over', () => {
    installFakeStorage();
    saveCampaign(play(newCampaign(), regularMapIds(0)[0], 5));
    expect(loadCampaign().gridHp).toBe(GRID_START - 5);
    clearCampaign();
    expect(loadCampaign()).toEqual(newCampaign());
  });
});
