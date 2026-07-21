import { LESSON_MAP_IDS, WORLD_STRUCTURE } from '../../content/registry';

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

/**
 * The mission the player is currently inside, and the per-mission resources
 * that must not be refreshed by reloading the page.
 *
 * `resetTurnUsed` lives here because the engine keeps it in instance memory
 * only: every reload builds a new BattleEngine, so ITB's "one turn-reset per
 * mission" silently became "one per reload" — a resource obtainable on demand
 * by pressing F5. Persisting it is what makes the limit real.
 *
 * The mission restarting from its opening board on reload is deliberately NOT
 * prevented. The grid damage was already banked live, so a replay is strictly
 * worse than continuing, and the game is perfect-information and
 * deterministic — a fresh attempt cannot roll a friendlier board.
 */
export interface ActiveMission {
  mapId: string;
  /** Whether this mission's single turn-reset has already been spent. */
  resetTurnUsed: boolean;
}

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
  /** The mission in progress, or null between missions. See ActiveMission. */
  activeMission: ActiveMission | null;
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
    activeMission: null,
  };
}

/**
 * Marks a mission as entered, returning a NEW state.
 *
 * Re-entering the SAME mission (a reload, or leaving and coming back)
 * preserves its spent turn-reset — that is the whole point of persisting it.
 * Entering a different mission starts a fresh record.
 */
export function beginMission(state: CampaignState, mapId: string): CampaignState {
  const active: ActiveMission =
    state.activeMission?.mapId === mapId ? { ...state.activeMission } : { mapId, resetTurnUsed: false };
  return {
    ...state,
    clearedMapIds: [...state.clearedMapIds],
    bossCleared: [...state.bossCleared],
    activeMission: active,
  };
}

/** Records that the active mission's one turn-reset has been spent. */
export function markResetTurnUsed(state: CampaignState): CampaignState {
  if (!state.activeMission) return state;
  return {
    ...state,
    clearedMapIds: [...state.clearedMapIds],
    bossCleared: [...state.bossCleared],
    activeMission: { ...state.activeMission, resetTurnUsed: true },
  };
}

/** Whether `mapId` is the active mission and has already spent its turn-reset. */
export function resetTurnUsedFor(state: CampaignState, mapId: string): boolean {
  return state.activeMission?.mapId === mapId && state.activeMission.resetTurnUsed;
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

/**
 * Whether this launch is a genuine step of the standalone tutorial sequence.
 *
 * BOTH halves matter. `?tutorial=N` is player-editable and carries no proof
 * that N belongs to the map it arrived with, so a URL like
 * `?map=island4_m5&tutorial=0` used to make a real campaign mission behave
 * like a tutorial step: wins auto-advanced without ever settling the
 * campaign, losses replayed for free. Requiring the map to actually be a
 * lesson map is what closes that.
 */
export function isTutorialStep(mapId: string, tutorialIndex: number | undefined): boolean {
  return tutorialIndex !== undefined && LESSON_MAP_IDS.includes(mapId);
}

/**
 * Whether a mid-mission "restart level" is offered for this map.
 *
 * ITB retry rules (2026-07-21 定案): never for a campaign mission — ITB has
 * no mission restart, and offering one would refund the grid the mission has
 * already cost. Lesson and standalone maps are practice and keep it.
 */
export function allowsLevelRestart(mapId: string): boolean {
  return !isCampaignMap(mapId);
}

/**
 * Whether the player may start `mapId` right now.
 *
 * The gate for the player-editable `?map=` param. Non-campaign maps (lessons,
 * debug launches) are always allowed; campaign missions must be one the
 * unlock rules currently offer, which also blocks re-entering a cleared
 * mission and jumping ahead to a later island.
 */
export function canEnterMission(state: CampaignState, mapId: string): boolean {
  if (!isCampaignMap(mapId)) return true;
  return availableMissions(state).includes(mapId);
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
 * Writes the base's CURRENT hp straight into the campaign grid — the single
 * place grid damage is ever deducted.
 *
 * ITB retry rules (2026-07-21 定案): the grid is debited live, every turn,
 * not settled at mission end. That is what makes "walk away from a mission
 * that went badly and replay it" impossible: by the time the player could
 * leave, the damage is already in the save. It costs no extra state — no
 * in-progress flag, no mission-attempt record, nothing that could be left
 * behind if the tab closes at the wrong moment.
 *
 * Assignment, not subtraction: the mission runs with baseHpOverride = gridHp,
 * so the base IS the grid for the duration and its hp is authoritative. It is
 * assignment specifically so that resetTurn() — ITB's legal once-per-mission
 * turn rewind, which restores baseHp along with the rest of the board — puts
 * the grid back up too. Rewinding a turn must not leave the player charged
 * for damage that no longer happened.
 *
 * Reaching zero ends the campaign on the spot.
 */
export function syncGridHp(state: CampaignState, baseHp: number): CampaignState {
  const gridHp = Math.max(0, Math.min(state.gridMax, baseHp));
  return {
    ...state,
    gridHp,
    clearedMapIds: [...state.clearedMapIds],
    bossCleared: [...state.bossCleared],
    campaignOver: state.campaignOver || gridHp <= 0,
  };
}

/**
 * Settles a FINISHED mission into the campaign, returning a NEW state.
 *
 * Since the 2026-07-21 live-sync change this is no longer where grid damage
 * is deducted — syncGridHp() above already did that, turn by turn. What is
 * left here is everything that can only be known once the mission is over:
 *
 *  - the zero-damage +1 (you cannot tell a mission was flawless until it
 *    ends, so this one reward stays deferred),
 *  - recording the clear,
 *  - advancing the island when a boss falls.
 *
 * It still opens by calling syncGridHp(state, baseHpRemaining), which is
 * idempotent against the live sync — the last endTurn already wrote this
 * exact number — and keeps this function correct on its own for tests and
 * for any caller that did not sync live. There is deliberately only ONE
 * deduction path, so the two cannot drift apart.
 *
 * The zero-damage +1 is the only grid recovery in the game (no bonus
 * objectives, no currency, no shop — deliberately the minimal version), and
 * it is fenced three ways: victory only, capped at gridMax, and **first
 * clear only**. Without that last condition a cleared mission could be
 * re-entered by URL and farmed for +1 at will, which would destroy the whole
 * premise of a monotonically shrinking campaign budget.
 *
 * A defeat still costs whatever the base took. That is the point of the
 * layer: a wipe is not a free rewind, and a retry is charged every time.
 */
export function applyMissionResult(state: CampaignState, result: MissionResult): CampaignState {
  const { mapId, outcome, baseHpRemaining, baseMaxHp } = result;
  const damage = Math.max(0, baseMaxHp - baseHpRemaining);
  const alreadyCleared = state.clearedMapIds.includes(mapId);

  const next = syncGridHp(state, baseHpRemaining);
  // The mission is over either way, so its in-progress record goes — the
  // next entry starts with a fresh turn-reset, as a new mission should.
  next.activeMission = null;

  if (next.campaignOver) {
    // Grid exhausted — the campaign ends here regardless of whether this
    // particular mission was technically won. Progress freezes as-is;
    // LevelSelectScene offers a restart, which discards this state entirely.
    return next;
  }

  if (outcome !== 'victory') return next;

  if (damage === 0 && !alreadyCleared) {
    next.gridHp = Math.min(next.gridMax, next.gridHp + 1);
  }

  if (!alreadyCleared) next.clearedMapIds.push(mapId);

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
