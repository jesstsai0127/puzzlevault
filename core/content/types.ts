import type { Vec2 } from '../geometry';

/**
 * - 'self': the caster only.
 * - 'firstInLine': scans the aimed direction, stops at the first target hit
 *   (existing behavior, unchanged).
 * - 'pierceLine': same directional scan and same line-of-sight rules as
 *   firstInLine (a wall blocks it, a hazard/abyss tile does not), but does
 *   NOT stop at the first hit — every target on the line within range is hit.
 * - 'aoeCross': the 4 orthogonally adjacent tiles around the caster (up/
 *   down/left/right), NOT including the caster's own tile. No aim direction
 *   needed.
 * - 'aoeRing': the 8 adjacent tiles around the caster, including diagonals.
 *   No aim direction needed.
 * - 'aoeArc3': an aimed 3-tile fan, one step ahead of the caster in the aimed
 *   direction — see resolveTargets() in engine.ts for the exact 3 cells.
 * - 'allEnemies': every living monster on the map, regardless of range or
 *   caster position.
 * - 'allUnits': every living unit on the map (players AND monsters),
 *   EXCLUDING the caster itself — see engine.ts resolveTargets() for the
 *   rationale (a self-sacrifice cast already pays its own cost; the skill
 *   itself shouldn't additionally hit its own caster).
 * - 'allAllies': every living unit on the SAME SIDE as the caster, EXCLUDING
 *   the caster itself — "same side" is caster-relative (players for a
 *   player caster, monsters for a monster caster), not hardcoded to one
 *   side, even though only player ultimates use this mode today. See
 *   engine.ts resolveTargets() for the exclusion rationale (same as
 *   'allUnits' above).
 */
export type TargetMode =
  | 'self'
  | 'firstInLine'
  | 'pierceLine'
  | 'aoeCross'
  | 'aoeRing'
  | 'aoeArc3'
  | 'allEnemies'
  | 'allUnits'
  | 'allAllies';

/**
 * The engine's fixed, closed vocabulary of effects. Skills — player or
 * monster — are always "verb + params" built from this list; content packs
 * combine them but never introduce new verbs. Keep this list small; adding
 * a verb is a deliberate engine change, not a per-skill one.
 */
export type EffectType = 'damage' | 'push' | 'shield' | 'heal' | 'taunt';

export interface EffectPrimitive {
  type: EffectType;
  /** Meaning depends on `type`: damage amount / push distance (tiles) / shield or heal amount / taunt duration in turns. Reinterpreted as a percentage when `amountIsPercent` is set (damage only — see below). */
  amount: number;
  target: TargetMode;
  /**
   * Only meaningful when `type === 'damage'`. When true, `amount` is a
   * percentage (0-100) of the target's CURRENT hp at the moment the effect
   * resolves, not a flat number — e.g. amount=50 deals 50% of whatever hp
   * the target has right now. See BattleEngine.effectAmount() for the
   * rounding rule. Not applied to push/shield/heal/taunt.
   */
  amountIsPercent?: boolean;
}

export interface SkillDef {
  formatVersion: number;
  id: string;
  nameKey: string;
  descKey: string;
  /** Tiles reachable in the aimed direction. 1 = melee/adjacent only. */
  range: number;
  effects: EffectPrimitive[];
}

export interface CharacterDef {
  formatVersion: number;
  id: string;
  nameKey: string;
  spriteRef: string;
  maxHp: number;
  /**
   * How many tiles this character may move in its per-turn move phase (BFS
   * distance, committed as one whole move). ITB-style action economy: each
   * unit gets move-then-one-action per turn — skills no longer carry a cost
   * of their own, so this is the only per-character economy number left.
   */
  moveRange: number;
  skillIds: string[];
  /**
   * The character's Ultimate — a single skillId, deliberately kept OUT of
   * skillIds (separate UI button, separate unlock/lock state; folding it in
   * would make skillIds.length-driven layout, e.g. BattleScene's bottom
   * button row, ambiguous about which slot is the special one). Required:
   * every playable character in this content pack has exactly one Ultimate,
   * so there's no meaningful "no ultimate" state to model as optional here.
   */
  ultimateSkillId: string;
}

export type AiTarget = 'nearestPlayer' | 'nearestBaseTile';

export type AiCondition =
  | { kind: 'always' }
  | { kind: 'targetInRange'; target: AiTarget; range: number };

export type AiAction =
  | { kind: 'useSkill'; skillId: string }
  | { kind: 'moveToward'; target: AiTarget }
  | { kind: 'moveAway'; target: AiTarget };

export interface AiRule {
  when: AiCondition;
  action: AiAction;
}

export interface MonsterDef {
  formatVersion: number;
  id: string;
  nameKey: string;
  spriteRef: string;
  maxHp: number;
  moveRange: number;
  skillIds: string[];
  /** Evaluated in order; first matching condition's action is this turn's intent. */
  aiRules: AiRule[];
}

export interface WaveSpawnDef {
  monsterId: string;
  spawn: Vec2;
}

/**
 * ITB-style emergence tile (A3): `telegraphTurn` is the turnNumber during
 * which the tile shows a glowing warning marker. The monster attempts to
 * spawn there at the END of that same turn (endTurn() resolution) — if a
 * living player unit occupies the tile at that moment, the spawn is
 * blocked and that unit takes 1 flat damage instead (no monster appears);
 * otherwise the monster spawns with fresh HP.
 */
export interface SpawnScheduleEntry {
  telegraphTurn: number;
  monsterId: string;
  tile: Vec2;
}

export interface MapDef {
  formatVersion: number;
  id: string;
  nameKey: string;
  /**
   * Sokoban-style char grid: '#' wall, ' ' floor, '~' hazard (impassable —
   * a push can still land a unit on it, lethal to a shoved monster), 'B'
   * base (impassable, shared HP pool), '*' poison mist (walkable like plain
   * floor — flat, unavoidable, non-lethal-on-its-own damage to whichever
   * living unit, player or monster, is still standing on it at endTurn()).
   */
  grid: string[];
  playerStarts: Vec2[];
  /** Monsters already on the field at turn 1 — no telegraph, just present. */
  initialMonsters: WaveSpawnDef[];
  /** Future emergences, each telegraphed one turn ahead (A3). May be empty for a level with no reinforcements. */
  spawnSchedule: SpawnScheduleEntry[];
  /**
   * Candidate emergence tiles for the DYNAMIC population feedback loop (see
   * BattleEngine.resolvePopulationReinforcement()) — distinct from
   * `spawnSchedule`, which is the author's hand-placed fixed script. The
   * engine walks this list in order, wrapping around, and never picks at
   * random: this game is full-information / zero-luck, so the same board must
   * always produce the same reinforcement.
   *
   * THIS MUST BE DESIGNED PER MAP, AND IT MUST BE BIG ENOUGH. The loop skips
   * candidates already telegraphed this turn or already occupied by a
   * monster, so a pool needs strictly MORE entries than PER_TURN_SPAWN_CAP
   * (2) to reliably reach the per-turn cap — 4+ is the working floor. A
   * 1-tile pool can never deliver two reinforcements in one turn, and a
   * single body parked on it seals the level's reinforcements completely.
   * This is NOT "reuse the hand-placed emergence tiles".
   *
   * OPTIONAL, and there is deliberately NO fallback: a map without an
   * explicit pool has no pool, and the loop stays inert.
   *
   * An earlier version derived the pool from the map's `spawnSchedule` tiles.
   * It was removed for two reasons. It did not work: every campaign map but
   * three derived a 1-tile pool (lesson maps derived 0), making the per-turn
   * cap structurally unreachable on 19 of 21 maps, and reinforcement
   * measurably never changed a single mission outcome at any parameter
   * setting. And it was harmful: it made scripted and dynamic emergences
   * collide on the same tile BY DEFAULT rather than by accident, and it
   * advertised a finished mechanism that no amount of content tuning could
   * actually switch on.
   */
  spawnPool?: Vec2[];
  /**
   * The living-monster count the level tries to hold. At the end of every
   * turn, if fewer than this many monsters are alive, the engine telegraphs
   * reinforcements for the NEXT turn to close the gap — so clearing the board
   * is never a stable win state, the ITB "you can't zero out the grid" rule.
   *
   * OPTIONAL, defaults to 0 — i.e. the loop is OFF unless a map opts in.
   *
   * The default is deliberately inert rather than derived from
   * `initialMonsters.length`. Deriving it would silently re-balance all 21
   * shipped missions the moment this field existed, invalidating the
   * hand-authored solvability walkthroughs in tests/content-registry.test.ts
   * that certify each one is beatable. Turning the loop on is a per-map
   * content decision (pick a target, pick a budget, re-verify the level),
   * not something the engine should do behind the author's back.
   */
  targetPopulation?: number;
  /**
   * Hard lifetime ceiling on how many monsters the population loop above may
   * telegraph over the WHOLE run — without it a level could reinforce
   * forever and stop being a solvable puzzle. `spawnSchedule` entries are the
   * author's own script and do NOT count against this budget.
   *
   * OPTIONAL, defaults to 0 (loop off) — same rationale as
   * `targetPopulation` above.
   */
  totalSpawnBudget?: number;
  /** Fixed mission length (A4): survive this many turns with the base alive to win — killing every monster is never required. */
  totalTurns: number;
  /** Shared HP pool for all of this map's 'B' base tiles combined. */
  baseHp: number;
  /**
   * The squad that plays this map, by characterId, in playerStarts order.
   * Defaults to the game's global STARTING_SQUAD (content/registry.ts) when
   * omitted — existing 2-hero maps don't need to declare this. A map whose
   * playerStarts.length differs from the default squad size (e.g. a 3-hero
   * level) MUST set this explicitly so BattleEngine's squad and the map's
   * own playerStarts line up 1:1.
   */
  squadCharacterIds?: string[];
  /**
   * Optional one-off static tip shown alongside the rules panel (see
   * RULES_PANEL_STATIC in BattleScene) — used by small "lesson" levels that
   * each spotlight one mechanic (e.g. "this level demonstrates AP is a
   * shared pool"). Purely informational, never blocks or auto-advances
   * anything; the player reads it (or ignores it) on their own time while
   * playing a real, winnable/losable level like any other map.
   */
  hintKey?: string;
}
