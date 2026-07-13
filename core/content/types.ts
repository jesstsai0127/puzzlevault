import type { Vec2 } from '../geometry';

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
  /** MP cost to cast — deducted from the caster's own mp, entirely separate from the squad's shared movement points. */
  mpCost: number;
}

export interface CharacterDef {
  formatVersion: number;
  id: string;
  nameKey: string;
  spriteRef: string;
  maxHp: number;
  /** This character's contribution to the squad's shared movement-point pool (summed across the squad at battle start). */
  actionPoints: number;
  /** This character's own mana pool — skills draw from it, refills every turn. */
  maxMp: number;
  skillIds: string[];
}

export type AiCondition =
  | { kind: 'always' }
  | { kind: 'targetInRange'; target: 'nearestPlayer'; range: number };

export type AiAction =
  | { kind: 'useSkill'; skillId: string }
  | { kind: 'moveToward'; target: 'nearestPlayer' }
  | { kind: 'moveAway'; target: 'nearestPlayer' };

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
}

export interface MapDef {
  formatVersion: number;
  id: string;
  nameKey: string;
  /** Sokoban-style char grid: '#' wall, ' ' floor. */
  grid: string[];
  playerStarts: Vec2[];
  waves: WaveDef[];
}
