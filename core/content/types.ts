import type { CardinalDir, Vec2 } from '../geometry';

export type TargetMode = 'self' | 'firstInLine';

/**
 * The engine's fixed, closed vocabulary of effects. Skills — player or
 * monster — are always "verb + params" built from this list; content packs
 * combine them but never introduce new verbs. Keep this list small; adding
 * a verb is a deliberate engine change, not a per-skill one.
 */
export type EffectType = 'damage' | 'push' | 'shield' | 'heal';

export interface EffectPrimitive {
  type: EffectType;
  /** Meaning depends on `type`: damage amount / push distance (tiles) / shield or heal amount. */
  amount: number;
  target: TargetMode;
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
  /** Sokoban-style char grid: '#' wall, ' ' floor, '~' hazard, 'B' base (impassable, shared HP pool). */
  grid: string[];
  playerStarts: Vec2[];
  waves: WaveDef[];
  /** Shared HP pool for all of this map's 'B' base tiles combined. */
  baseHp: number;
}

/** One beat of a fully-automatic tutorial playback — see TutorialDef. */
export interface TutorialStep {
  /** i18n key for the narration line shown while this step plays. Purely a pause/explanation when `action` is absent — the player has nothing to do but wait (or skip). */
  textKey: string;
  action?:
    | { type: 'move'; unitIndex: number; dir: CardinalDir }
    | { type: 'useSkill'; unitIndex: number; skillId: string; dir: CardinalDir }
    | { type: 'endTurn' };
}

/**
 * A short, fully-automatic scripted scene that teaches one mechanic — BattleScene
 * plays its `script` step by step against a real BattleEngine (same moveUnit/
 * useSkill/endTurn calls a player's own actions go through), narrating each
 * step's textKey. The player never acts; they can only skip to LevelSelectScene.
 * Not registered in the `maps` registry — tutorials are their own top-level
 * content kind with their own map embedded, since they aren't a playable level.
 */
export interface TutorialDef {
  formatVersion: number;
  id: string;
  nameKey: string;
  map: MapDef;
  script: TutorialStep[];
}
