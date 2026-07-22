import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  abandonActiveMission,
  allowsLevelRestart,
  applyMissionResult,
  availableMissions,
  beginMission,
  bossMapId,
  canEnterMission,
  FINAL_MAP_ID,
  GRID_MAX,
  GRID_START,
  isCampaignMap,
  isCampaignWon,
  isTutorialStep,
  markResetTurnUsed,
  newCampaign,
  regularMapIds,
  resetTurnUsedFor,
  syncGridHp,
  type CampaignState,
} from '../core/campaign/state';
import { LESSON_MAP_IDS, maps, registry, STARTING_SQUAD } from '../content/registry';
import { BattleEngine } from '../core/battle/engine';
import { CAMPAIGN_STORAGE_KEY, clearCampaign, loadCampaign, saveCampaign } from '../src/campaign/storage';

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
    expect(s.activeMission).toBeNull();
  });
});

describe('activeMission — beginMission/markResetTurnUsed/resetTurnUsedFor as pure functions', () => {
  const m0 = () => regularMapIds(0)[0];

  it('beginMission opens a fresh record with the reset unspent', () => {
    const s = beginMission(newCampaign(), m0());
    expect(s.activeMission).toEqual({ mapId: m0(), resetTurnUsed: false });
    expect(resetTurnUsedFor(s, m0())).toBe(false);
  });

  // ITB alignment (2026-07-22): BattleScene no longer actually reaches this
  // path on a reload — abandonActiveMission() forfeits the mission before
  // beginMission would ever run again for the same mapId (see the describe
  // block below). This test stays because beginMission is still a correct,
  // independently-callable pure function, not because a reload behaves this
  // way in the game anymore.
  it('re-entering the SAME mission preserves a spent reset (beginMission alone, not the actual reload path)', () => {
    let s = beginMission(newCampaign(), m0());
    s = markResetTurnUsed(s);
    expect(resetTurnUsedFor(s, m0())).toBe(true);
    s = beginMission(s, m0());
    expect(resetTurnUsedFor(s, m0())).toBe(true); // NOT reset to false
  });

  it('entering a DIFFERENT mission starts with a fresh reset', () => {
    let s = beginMission(newCampaign(), m0());
    s = markResetTurnUsed(s);
    s = beginMission(s, regularMapIds(0)[1]);
    expect(s.activeMission).toEqual({ mapId: regularMapIds(0)[1], resetTurnUsed: false });
  });

  it('resetTurnUsedFor is false for a map that is not the active mission', () => {
    const s = markResetTurnUsed(beginMission(newCampaign(), m0()));
    expect(resetTurnUsedFor(s, regularMapIds(0)[1])).toBe(false);
  });

  it('settling a mission clears the active record, so the next mission starts fresh', () => {
    let s = markResetTurnUsed(beginMission(newCampaign(), m0()));
    s = play(s, m0(), 1);
    expect(s.activeMission).toBeNull();
  });

  it('markResetTurnUsed / beginMission do not mutate their input', () => {
    const s = beginMission(newCampaign(), m0());
    const snap = JSON.parse(JSON.stringify(s));
    markResetTurnUsed(s);
    beginMission(s, regularMapIds(0)[1]);
    expect(s).toEqual(snap);
  });

  it('round-trips the active mission through storage (reload restores resetTurnUsed)', () => {
    installFakeStorage();
    let s = markResetTurnUsed(beginMission(newCampaign(), m0()));
    saveCampaign(s);
    const reloaded = loadCampaign();
    expect(reloaded.activeMission).toEqual({ mapId: m0(), resetTurnUsed: true });
    // And the restore path the scene uses reports the reset as spent.
    expect(resetTurnUsedFor(reloaded, m0())).toBe(true);
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
});

describe('abandonActiveMission — ITB has no mid-mission restart (2026-07-22)', () => {
  const m0 = () => regularMapIds(0)[0];

  it('is a no-op when nothing is active', () => {
    const s = newCampaign();
    expect(abandonActiveMission(s)).toEqual(s);
  });

  it('settles the active mission as a defeat and clears the record', () => {
    let s = beginMission(newCampaign(), m0());
    s = syncGridHp(s, GRID_START - 3); // two turns in, already down 3 live
    s = abandonActiveMission(s);
    expect(s.activeMission).toBeNull();
    expect(s.gridHp).toBe(GRID_START - 3); // exactly what was already banked
  });

  it('does not double-deduct — the live-synced damage is the only damage charged', () => {
    // If this deducted again on top of the live sync, gridHp would go
    // further below GRID_START - 3 than the mission actually cost.
    let s = beginMission(newCampaign(), m0());
    s = syncGridHp(s, GRID_START - 5);
    s = abandonActiveMission(s);
    expect(s.gridHp).toBe(GRID_START - 5);
  });

  it('never awards the zero-damage bonus, even on a mission abandoned before taking any damage', () => {
    // baseHpRemaining === baseMaxHp === gridHp here, which would read as
    // "zero damage" — but the outcome is 'defeat', and applyMissionResult's
    // bonus branch is victory-only, so no +1 must ever land here.
    let s = beginMission(newCampaign(), m0());
    s = abandonActiveMission(s);
    expect(s.gridHp).toBe(GRID_START);
    expect(s.clearedMapIds).toEqual([]);
  });

  it('does not mark the mission cleared, so it remains available for a fresh attempt', () => {
    let s = beginMission(newCampaign(), m0());
    s = syncGridHp(s, GRID_START - 2);
    s = abandonActiveMission(s);
    expect(s.clearedMapIds).not.toContain(m0());
    expect(availableMissions(s)).toContain(m0());
  });

  it('ends the campaign if the grid was already exhausted by the time it is called', () => {
    let s = beginMission(newCampaign(), m0());
    s = syncGridHp(s, 0);
    s = abandonActiveMission(s);
    expect(s.campaignOver).toBe(true);
  });

  it('does not mutate its input', () => {
    const s = syncGridHp(beginMission(newCampaign(), m0()), GRID_START - 1);
    const snap = JSON.parse(JSON.stringify(s));
    abandonActiveMission(s);
    expect(s).toEqual(snap);
  });

  it('closes the reload-to-escape-a-bad-preview exploit: reloading mid-attempt forfeits it instead of resuming', () => {
    // Simulates what BattleScene.init() now does on every load: check for a
    // matching active mission and forfeit it BEFORE beginMission ever runs
    // again for the same mapId — beginMission is never called a second time
    // on an unsettled mission anymore.
    let s = beginMission(newCampaign(), m0());
    s = markResetTurnUsed(s);
    s = syncGridHp(s, GRID_START - 2); // one bad turn already banked

    // "Reload": init() finds activeMission.mapId === m0() and forfeits it —
    // it does NOT call beginMission(s, m0()) to resume, which is exactly
    // the behavior that used to let a player retry the mission for free.
    expect(s.activeMission?.mapId).toBe(m0());
    s = abandonActiveMission(s);
    expect(s.activeMission).toBeNull();
    expect(s.gridHp).toBe(GRID_START - 2); // the bad turn stays charged

    // The mission is available again, but as a wholly fresh attempt — the
    // spent reset does NOT carry over, unlike the old resume path.
    expect(availableMissions(s)).toContain(m0());
    const fresh = beginMission(s, m0());
    expect(fresh.activeMission).toEqual({ mapId: m0(), resetTurnUsed: false });
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

  // Since the live-sync change, baseHpRemaining is authoritative: the mission
  // runs with baseHpOverride = gridHp, so the base IS the grid and settling
  // assigns rather than subtracts. A base that ended above where it started
  // therefore cannot mint grid beyond the cap.
  it('never exceeds gridMax even if the base somehow ends above its starting hp', () => {
    const s = applyMissionResult(
      { ...newCampaign(), gridHp: GRID_MAX },
      { mapId: regularMapIds(0)[0], outcome: 'victory', baseMaxHp: GRID_MAX, baseHpRemaining: GRID_MAX + 5 },
    );
    expect(s.gridHp).toBe(GRID_MAX);
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

// ---------------------------------------------------------------------
// The four bypasses found in review (2026-07-21). Each of these guards a
// way the campaign's cost could be avoided entirely, so each gets its own
// regression test.
// ---------------------------------------------------------------------

describe('isTutorialStep — ?tutorial=N cannot launder a campaign mission', () => {
  it('is true for a real lesson map carrying a tutorial index', () => {
    expect(isTutorialStep(LESSON_MAP_IDS[0], 0)).toBe(true);
    expect(isTutorialStep(LESSON_MAP_IDS[3], 3)).toBe(true);
  });

  it('is false for a campaign mission even when a tutorial index is supplied', () => {
    // The exploit URL: ?map=island4_m5&tutorial=0 — a valid non-negative
    // integer index on a map that is not part of the tutorial at all.
    expect(isTutorialStep('island4_m5', 0)).toBe(false);
    expect(isTutorialStep('island1_m1', 0)).toBe(false);
    expect(isTutorialStep(FINAL_MAP_ID, 2)).toBe(false);
  });

  it('is false for a lesson map opened outside the sequence', () => {
    expect(isTutorialStep(LESSON_MAP_IDS[0], undefined)).toBe(false);
  });
});

describe('re-clearing a mission cannot farm grid', () => {
  it('gives no zero-damage bonus for a mission already cleared', () => {
    const mapId = regularMapIds(0)[0];
    let s = play(newCampaign(), mapId, 2); // 8 -> 6, cleared
    expect(s.gridHp).toBe(GRID_START - 2);

    // Re-entered by hand-typed URL and played flawlessly: previously 6 -> 7.
    s = play(s, mapId, 0);
    expect(s.gridHp).toBe(GRID_START - 2);
  });

  it('does not duplicate the mapId when a cleared mission is replayed', () => {
    const mapId = regularMapIds(0)[0];
    let s = play(newCampaign(), mapId, 1);
    s = play(s, mapId, 0);
    expect(s.clearedMapIds.filter((id) => id === mapId)).toHaveLength(1);
  });

  it('still charges damage taken on a replay, so a repeat is never free', () => {
    const mapId = regularMapIds(0)[0];
    let s = play(newCampaign(), mapId, 1);
    s = play(s, mapId, 3);
    expect(s.gridHp).toBe(GRID_START - 4);
  });

  it('keeps the bonus for a first clear so the reward still exists', () => {
    const s = play(newCampaign(), regularMapIds(0)[0], 0);
    expect(s.gridHp).toBe(GRID_START + 1);
  });
});

describe('canEnterMission — the ?map= gate', () => {
  it('allows a mission the unlock rules currently offer', () => {
    expect(canEnterMission(newCampaign(), regularMapIds(0)[0])).toBe(true);
  });

  it('blocks jumping ahead to a later island', () => {
    // Without this, island4_m1 would land in clearedMapIds while islandIndex
    // still pointed at island 1 — progress desynced from the 3-of-4 count.
    expect(canEnterMission(newCampaign(), regularMapIds(3)[0])).toBe(false);
    expect(canEnterMission(newCampaign(), FINAL_MAP_ID)).toBe(false);
  });

  it('blocks a boss until three regular missions are cleared, then allows it', () => {
    let s = clearRegulars(newCampaign(), 0, 2);
    expect(canEnterMission(s, bossMapId(0)!)).toBe(false);
    s = clearRegulars(newCampaign(), 0, 3);
    expect(canEnterMission(s, bossMapId(0)!)).toBe(true);
  });

  it('blocks re-entering a cleared mission', () => {
    const mapId = regularMapIds(0)[0];
    const s = play(newCampaign(), mapId, 1);
    expect(canEnterMission(s, mapId)).toBe(false);
  });

  it('blocks the skipped 4th mission once the island moved on', () => {
    const s = clearRegulars(newCampaign(), 0, 3);
    expect(canEnterMission(s, regularMapIds(0)[3])).toBe(false);
  });

  it('blocks everything once the campaign is over', () => {
    const s = play(newCampaign(), regularMapIds(0)[0], GRID_START);
    expect(s.campaignOver).toBe(true);
    expect(canEnterMission(s, regularMapIds(0)[1])).toBe(false);
  });

  it('always allows non-campaign maps, which never touch the grid', () => {
    for (const id of LESSON_MAP_IDS) expect(canEnterMission(newCampaign(), id)).toBe(true);
  });
});

describe('allowsLevelRestart — ITB has no mid-mission restart', () => {
  it('denies a restart button on every campaign mission', () => {
    expect(allowsLevelRestart('island1_m1')).toBe(false);
    expect(allowsLevelRestart('island4_m5')).toBe(false);
    expect(allowsLevelRestart(FINAL_MAP_ID)).toBe(false);
  });

  it('keeps the restart button on lesson maps, which are practice', () => {
    for (const id of LESSON_MAP_IDS) expect(allowsLevelRestart(id)).toBe(true);
  });
});

describe('syncGridHp — grid damage is banked live, not at mission end', () => {
  it('writes the base hp straight into the grid', () => {
    const s = syncGridHp(newCampaign(), 5);
    expect(s.gridHp).toBe(5);
    expect(s.campaignOver).toBe(false);
  });

  it('does not mutate the state passed in', () => {
    const s = newCampaign();
    const before = JSON.parse(JSON.stringify(s));
    syncGridHp(s, 3);
    expect(s).toEqual(before);
  });

  it('ends the campaign the moment the grid is emptied mid-mission', () => {
    const s = syncGridHp(newCampaign(), 0);
    expect(s.gridHp).toBe(0);
    expect(s.campaignOver).toBe(true);
  });

  it('follows a resetTurn rewind back up — the legal ITB undo is not charged', () => {
    let s = syncGridHp(newCampaign(), 5); // took 3 this turn
    expect(s.gridHp).toBe(5);
    s = syncGridHp(s, 8); // resetTurn() restored baseHp to the turn's start
    expect(s.gridHp).toBe(GRID_START);
  });

  it('is idempotent against the settle step, so there is only one deduction', () => {
    const mapId = regularMapIds(0)[0];
    const live = syncGridHp(newCampaign(), 6); // banked live during play
    const settled = applyMissionResult(live, { mapId, outcome: 'victory', baseMaxHp: GRID_START, baseHpRemaining: 6 });
    expect(settled.gridHp).toBe(6); // not 8-2-2 = 4
  });

  it('abandoning a damaged mission does not refund it — the reload reads the debited grid', () => {
    installFakeStorage();
    // Two turns in, the base is down to 5 of the 8 the mission started with.
    saveCampaign(syncGridHp(newCampaign(), 5));
    // Player closes the tab / navigates away without confirming an outcome.
    const reloaded = loadCampaign();
    expect(reloaded.gridHp).toBe(5);
    // Re-entering the same mission is still allowed, but it now starts from 5.
    expect(canEnterMission(reloaded, regularMapIds(0)[0])).toBe(true);
    expect(reloaded.clearedMapIds).toEqual([]);
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
});

// Engine integration: proves the campaign grid actually drives the battle's
// base HP through the real BattleEngine (agent B's merged baseHpOverride),
// and that the live sync reads back the overridden value — not the map's own
// baseHp, which was the pre-merge regression (grid rebounded to 8 each level).
describe('baseHpOverride drives the battle base, and the grid never rebounds to the map default', () => {
  const m = maps['island1_m1'];

  it('the engine starts a campaign mission at the grid, not at map.baseHp', () => {
    expect(m.baseHp).toBe(8); // the map's own default, deliberately different from the grid below
    const e = new BattleEngine(m, m.squadCharacterIds ?? STARTING_SQUAD, registry, { baseHpOverride: 3 });
    expect(e.getSnapshot().baseHp).toBe(3);
    expect(e.getSnapshot().baseMaxHp).toBe(3);
  });

  it('syncing the grid from the engine keeps the reduced value — it does not jump to 8', () => {
    const grid = 3;
    const e = new BattleEngine(m, m.squadCharacterIds ?? STARTING_SQUAD, registry, { baseHpOverride: grid });
    // Simulate BattleScene's endTurn sync with whatever the engine reports.
    const synced = syncGridHp({ ...newCampaign(), gridHp: grid }, e.getSnapshot().baseHp);
    expect(synced.gridHp).toBe(grid);
    expect(synced.gridHp).not.toBe(m.baseHp);
  });

  it('an immediate resetTurn() burns the once-per-mission reset without disturbing the board', () => {
    // This is exactly how the scene restores a spent reset on reload.
    const e = new BattleEngine(m, m.squadCharacterIds ?? STARTING_SQUAD, registry, { baseHpOverride: 5 });
    expect(e.getSnapshot().resetTurnUsed).toBe(false);
    e.resetTurn();
    expect(e.getSnapshot().resetTurnUsed).toBe(true);
    expect(e.getSnapshot().baseHp).toBe(5); // board/base untouched by the burn
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

/**
 * Installs a fresh fake localStorage AND syncs storage.ts's revision guard to
 * it — mirroring a real page load, which always calls loadCampaign() once
 * before it can ever call saveCampaign(). Without this sync, storage.ts's
 * module-level revision tracker keeps whatever value the LAST test in this
 * file happened to leave it at, so a test that saves before loading (a
 * pattern the real app never does, but several tests here did, pre-dating the
 * revision guard) would have its save spuriously dropped as "stale" against
 * an empty store it never actually raced against.
 */
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
  loadCampaign();
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

  it('rejects a grid above its own cap', () => {
    const data = installFakeStorage();
    data[CAMPAIGN_STORAGE_KEY] = JSON.stringify({ ...newCampaign(), gridHp: 9999 });
    expect(loadCampaign()).toEqual(newCampaign());
  });

  it('rejects a bossCleared array that no longer matches ISLAND_COUNT', () => {
    const data = installFakeStorage();
    data[CAMPAIGN_STORAGE_KEY] = JSON.stringify({ ...newCampaign(), bossCleared: [] });
    expect(loadCampaign()).toEqual(newCampaign());
  });

  it('rejects an out-of-range islandIndex', () => {
    const data = installFakeStorage();
    data[CAMPAIGN_STORAGE_KEY] = JSON.stringify({ ...newCampaign(), islandIndex: 9 });
    expect(loadCampaign()).toEqual(newCampaign());
  });

  it('rejects non-integer / negative grid values', () => {
    const data = installFakeStorage();
    for (const gridHp of [-1, 3.5, Number.NaN]) {
      data[CAMPAIGN_STORAGE_KEY] = JSON.stringify({ ...newCampaign(), gridHp });
      expect(loadCampaign()).toEqual(newCampaign());
    }
  });

  it('clearCampaign wipes the save so the next load starts over', () => {
    installFakeStorage();
    saveCampaign(play(newCampaign(), regularMapIds(0)[0], 5));
    expect(loadCampaign().gridHp).toBe(GRID_START - 5);
    clearCampaign();
    expect(loadCampaign()).toEqual(newCampaign());
  });

  // Two full-page sessions ("tabs") open the same save. Each loads once at
  // startup and only ever writes back, so a stale tab's save must not be
  // able to clobber progress a fresher tab already recorded. Each "tab" is
  // its own isolated import of storage.ts (vi.resetModules + dynamic import)
  // sharing only the fake localStorage on globalThis — the same relationship
  // real browser tabs have to each other, and the only way to give each one
  // its own independent in-memory revision tracking the way separate pages
  // actually would.
  it('a stale tab cannot overwrite a fresher save with older data (revision guard)', async () => {
    installFakeStorage();

    vi.resetModules();
    const bootstrap = await import('../src/campaign/storage');
    bootstrap.saveCampaign(newCampaign()); // establishes rev 1 in shared storage

    vi.resetModules();
    const tabAStorage = await import('../src/campaign/storage');
    const tabA = tabAStorage.loadCampaign(); // tab A's own module sees rev 1

    vi.resetModules();
    const tabBStorage = await import('../src/campaign/storage');
    const tabB = tabBStorage.loadCampaign(); // tab B's own module also sees rev 1

    // Tab A takes damage and syncs first: gridHp 8 -> 6, rev 1 -> 2.
    const afterA = play(tabA, regularMapIds(0)[0], 2);
    tabAStorage.saveCampaign(afterA);
    expect(tabAStorage.loadCampaign().gridHp).toBe(GRID_START - 2);

    // Tab B never saw A's write (still thinks rev is 1). If it now saves its
    // own stale, undamaged in-memory state, that write must be dropped — not
    // silently heal the grid back up by overwriting A's already-recorded loss.
    tabBStorage.saveCampaign(tabB);
    expect(tabAStorage.loadCampaign().gridHp).toBe(GRID_START - 2); // still A's number, not tab B's undamaged 8

    // A single dropped save must not wedge tab B forever: once it resyncs to
    // the current revision, its NEXT save (now built on fresh data) lands.
    const tabBRefreshed = tabBStorage.loadCampaign();
    const afterB = play(tabBRefreshed, regularMapIds(1)[0], 1);
    tabBStorage.saveCampaign(afterB);
    expect(tabAStorage.loadCampaign().gridHp).toBe(GRID_START - 2 - 1);
  });
});
