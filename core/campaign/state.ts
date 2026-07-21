import { WORLD_STRUCTURE } from '../../content/registry';

/**
 * Campaign state layer — ITB alignment (2026-07-21).
 *
 * The audit found "thoughtless greedy play" clearing 20 of 21 levels. The
 * biggest structural cause: our 陣 (the ITB power grid analogue) was
 * per-level, 8 points, refilled at every level boundary — 21 levels × 8 =
 * 168 points of free forgiveness, so letting the 陣 get hit never cost
 * anything beyond the current level.
 *
 * ITB instead runs ONE grid across the whole campaign: it carries between
 * missions, never resets, and hitting zero ends the run. This module is that
 * single carried number, plus the mission-unlock rules that decide how many
 * missions a run actually spends it across.
 *
 * Pure data + pure functions on purpose: no DOM, no localStorage, no Phaser.
 * Persistence lives in ./storage.ts, so every rule below is directly callable
 * from tests.
 */

/**
 * Grid the campaign starts with.
 *
 * Deliberately NOT ITB's 5 (or 7 with the reactor upgrades) — the scales
 * differ. In ITB one grid point is one building, and a monster attack that
 * lands on a building takes exactly 1. Our hits against the 陣 are worth 1-3
 * points each, so a single bad turn can spend what would be a third of an
 * ITB grid. 8 keeps the survivable-mistake count in the same ballpark as
 * ITB's while measured in our units.
 *
 * GRID_START / GRID_MAX are the main tuning knobs for overall campaign
 * difficulty — they live here, together, so retuning is a one-file edit.
 */
export const GRID_START = 8;

/**
 * Ceiling the zero-damage reward can refill to. Above GRID_START so that a
 * clean run is rewarded with genuine headroom rather than just topping back
 * up, but only by 4 — enough that perfect play across a full island matters,
 * not so much that the grid stops being a scarce resource.
 */
export const GRID_MAX = 12;

/** Regular missions per island (m1-m4); the player picks REQUIRED_CLEARS of them. */
export const MISSIONS_PER_ISLAND = 4;

/**
 * Regular missions that must be cleared before the island boss unlocks.
 * 3-of-4 (ITB's 2-of-'however many are offered' shape): the player chooses
 * which to skip, so the grid is spent across a chosen subset rather than
 * every mission being mandatory.
 */
export const REQUIRED_CLEARS = 3;

/** Number of islands (excluding the final battle). */
export const ISLAND_COUNT = 4;

/** The final battle's mapId — unlocked once all island bosses are down. */
export const FINAL_MAP_ID = 'final_hive';

export interface CampaignState {
  schemaVersion: 1;
  /** Grid points remaining, carried across every mission. Zero ends the campaign. */
  gridHp: number;
  /** Current ceiling for gridHp — constant today, kept in state so a future upgrade system can raise it per-run. */
  gridMax: number;
  /** Which island the player is on (0-3); ISLAND_COUNT means "islands done, final battle available". */
  islandIndex: number;
  /** Every campaign mapId cleared so far, across all islands. */
  clearedMapIds: string[];
  /** Per-island boss cleared flags, indexed like islandIndex. */
  bossCleared: boolean[];
  /** True once the grid hit zero — the run is dead and must be restarted from island 1. */
  campaignOver: boolean;
}

export interface MissionResult {
  mapId: string;
  outcome: 'victory' | 'defeat';
  /** Base/陣 HP left when the mission ended, straight off the battle snapshot. */
  baseHpRemaining: number;
  /** Base/陣 HP the mission started with — equals the campaign gridHp handed to the engine as baseHpOverride. */
  baseMaxHp: number;
}

export function newCampaign(): CampaignState {
  return {
    schemaVersion: 1,
    gridHp: GRID_START,
    gridMax: GRID_MAX,
    islandIndex: 0,
    clearedMapIds: [],
    bossCleared: new Array(ISLAND_COUNT).fill(false),
    campaignOver: false,
  };
}

/** The 5 mapIds (m1-m5) belonging to island `index`, straight from WORLD_STRUCTURE. */
export function islandMapIds(index: number): string[] {
  return WORLD_STRUCTURE[index]?.levels.map((l) => l.mapId) ?? [];
}

/** The island's 4 regular missions (m1-m4). */
export function regularMapIds(index: number): string[] {
  return islandMapIds(index).slice(0, MISSIONS_PER_ISLAND);
}

/** The island's boss mission (m5). */
export function bossMapId(index: number): string | null {
  return islandMapIds(index)[MISSIONS_PER_ISLAND] ?? null;
}

/** Whether `mapId` belongs to the campaign at all (as opposed to a lesson/standalone map). */
export function isCampaignMap(mapId: string): boolean {
  for (let i = 0; i < ISLAND_COUNT; i++) {
    if (islandMapIds(i).includes(mapId)) return true;
  }
  return mapId === FINAL_MAP_ID;
}

/** How many of the current island's regular missions are already cleared. */
function clearedRegularCount(state: CampaignState, island: number): number {
  return regularMapIds(island).filter((id) => state.clearedMapIds.includes(id)).length;
}

/**
 * The mapIds the player may start right now.
 *
 * The 5-choose-3 rule, in order:
 *  - campaign over -> nothing (the run is dead, only a restart is offered).
 *  - islandIndex past the last island -> only the final battle.
 *  - fewer than REQUIRED_CLEARS regular missions cleared on this island ->
 *    the island's uncleared regular missions, and NOT the boss (the boss
 *    gate is exactly this count).
 *  - REQUIRED_CLEARS reached -> only the boss. The 4th regular mission is
 *    deliberately dropped rather than left playable: skipping one is the
 *    choice the rule exists to create, and letting the player mop it up
 *    afterwards for the zero-damage grid bonus would erase that choice.
 *
 * Earlier islands are never revisitable — the campaign only moves forward.
 */
export function availableMissions(state: CampaignState): string[] {
  if (state.campaignOver) return [];
  if (state.islandIndex >= ISLAND_COUNT) {
    return state.clearedMapIds.includes(FINAL_MAP_ID) ? [] : [FINAL_MAP_ID];
  }
  const island = state.islandIndex;
  if (clearedRegularCount(state, island) >= REQUIRED_CLEARS) {
    const boss = bossMapId(island);
    return boss && !state.clearedMapIds.includes(boss) ? [boss] : [];
  }
  return regularMapIds(island).filter((id) => !state.clearedMapIds.includes(id));
}

/**
 * Folds one finished mission into the campaign, returning a NEW state.
 *
 * Grid arithmetic — the core of the whole layer:
 *
 *   damage = max(0, baseMaxHp - baseHpRemaining)
 *   gridHp = gridHp - damage   (then +1 if damage === 0 and the mission was won)
 *
 * The mission runs with baseHpOverride = gridHp, so baseHpRemaining IS the
 * surviving grid and `gridHp - damage` reduces to `baseHpRemaining`. The
 * subtraction form is kept anyway because it stays correct if a mission ever
 * runs on its own map.baseHp (a lesson map, a debug launch, a future mode
 * with a separate base) — it always transfers the DAMAGE, never the absolute
 * remainder, so a mismatched scale can't silently overwrite the campaign grid.
 *
 * The zero-damage +1 is the only grid recovery in the game (no bonus
 * objectives, no currency, no shop — deliberately the minimal version): the
 * grid is otherwise strictly monotonically decreasing, so the campaign has a
 * hard budget and a perfect mission is the only way to buy any of it back.
 * Capped at gridMax, and denied on defeat so that losing can never pay.
 *
 * A defeat still charges the damage taken. That is the point of the layer:
 * a wipe is not a free rewind, and retrying a mission costs grid every time.
 */
export function applyMissionResult(state: CampaignState, result: MissionResult): CampaignState {
  const { mapId, outcome, baseHpRemaining, baseMaxHp } = result;
  const damage = Math.max(0, baseMaxHp - baseHpRemaining);

  let gridHp = state.gridHp - damage;
  if (damage === 0 && outcome === 'victory') {
    gridHp = Math.min(state.gridMax, gridHp + 1);
  }
  gridHp = Math.max(0, gridHp);

  const next: CampaignState = {
    ...state,
    gridHp,
    clearedMapIds: [...state.clearedMapIds],
    bossCleared: [...state.bossCleared],
  };

  if (gridHp <= 0) {
    // Grid exhausted — the whole campaign ends here regardless of whether
    // this particular mission was technically won. Progress is frozen as-is;
    // LevelSelectScene offers a restart, which discards this state entirely.
    next.campaignOver = true;
    return next;
  }

  if (outcome !== 'victory') return next;

  if (!next.clearedMapIds.includes(mapId)) next.clearedMapIds.push(mapId);

  // Clearing the island boss closes the island and advances to the next one
  // (or past ISLAND_COUNT, which is what unlocks the final battle).
  const island = state.islandIndex;
  if (island < ISLAND_COUNT && mapId === bossMapId(island)) {
    next.bossCleared[island] = true;
    next.islandIndex = island + 1;
  }

  return next;
}

/** True once the final battle is cleared — the campaign was won rather than lost. */
export function isCampaignWon(state: CampaignState): boolean {
  return !state.campaignOver && state.clearedMapIds.includes(FINAL_MAP_ID);
}
