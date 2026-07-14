import type { CardinalDir, Vec2 } from '../geometry';
import type { CharacterDef, MonsterDef, SkillDef } from '../content/types';

export interface ContentRegistry {
  characters: Record<string, CharacterDef>;
  skills: Record<string, SkillDef>;
  monsters: Record<string, MonsterDef>;
}

export interface PlayerUnitState {
  characterId: string;
  position: Vec2;
  hp: number;
  maxHp: number;
  shield: number;
  /** This character's own per-turn action points — moving and casting skills both draw from this one pool. */
  ap: number;
  maxAp: number;
  skillIds: string[];
}

export interface MonsterUnitState {
  instanceId: string;
  monsterId: string;
  position: Vec2;
  hp: number;
  maxHp: number;
  shield: number;
}

export type MonsterIntent =
  | { kind: 'move'; instanceId: string; to: Vec2; aim: Vec2 | null; away?: boolean }
  | { kind: 'skill'; instanceId: string; skillId: string; direction: CardinalDir };

/** A skill intent's damage, aggregated per target so a target locked by multiple monsters shows one combined preview number. */
export type AttackPreviewTarget = { kind: 'base' } | { kind: 'player'; unitIndex: number } | { kind: 'monster'; instanceId: string };
export interface AttackPreview {
  target: AttackPreviewTarget;
  damage: number;
}

export type ActionResult = { ok: true } | { ok: false; reason: string };

/**
 * A turn just ended in defeat (base HP hit 0) or a win — either way the board
 * freezes on the position that caused it until the player calls
 * confirmOutcome(), so they see exactly what happened before the level
 * restarts from wave 1.
 */
export type RunOutcome = 'defeat' | 'victory';

export interface BattleSnapshot {
  players: PlayerUnitState[];
  monsters: MonsterUnitState[];
  waveIndex: number;
  turnNumber: number;
  /** Set the instant a turn resolves into a loss/win; null while play continues. See RunOutcome. */
  outcome: RunOutcome | null;
  /** Shared HP pool for the base ("陣") — reaching 0 is defeat and restarts the level from wave 1. */
  baseHp: number;
  baseMaxHp: number;
  /** All grid tiles occupied by the base, for rendering. */
  baseTiles: Vec2[];
  /** Turns remaining before this wave is survived regardless of remaining monsters. */
  turnsLeftInWave: number;
  /** This wave's total turn budget (e.g. for a "2/4" display). */
  waveTurns: number;
}
