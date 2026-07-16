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
  /** AP cost to cast — deducted from the caster's own per-turn action points, the same pool that pays for movement. (Field name kept from the old MP system for content compatibility.) */
  mpCost: number;
}

export interface CharacterDef {
  formatVersion: number;
  id: string;
  nameKey: string;
  spriteRef: string;
  maxHp: number;
  /** This character's own per-turn action points — moving one tile costs 1, skills cost their mpCost, all from this one pool. Refills every turn. */
  actionPoints: number;
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

export interface WaveDef {
  monsters: WaveSpawnDef[];
  /** Turn budget: this wave is survived once this many turns elapse, even with monsters still alive. */
  turns: number;
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
  waves: WaveDef[];
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
