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
  /** This character's own mana — skills draw from it, independent of the squad's shared movement points. */
  mp: number;
  maxMp: number;
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
  | { kind: 'move'; instanceId: string; to: Vec2 }
  | { kind: 'skill'; instanceId: string; skillId: string; direction: CardinalDir };

export type ActionResult = { ok: true } | { ok: false; reason: string };

/**
 * A turn just ended in a life lost, the run running out of lives entirely, or
 * a win — the board freezes on the position that caused it until the player
 * calls confirmOutcome(), so they see exactly what happened before it resets.
 */
export type RunOutcome = 'lifeLost' | 'gameOver' | 'victory';

export interface BattleSnapshot {
  players: PlayerUnitState[];
  monsters: MonsterUnitState[];
  waveIndex: number;
  lives: number;
  turnNumber: number;
  /** Set the instant a turn resolves into a loss/win; null while play continues. See RunOutcome. */
  outcome: RunOutcome | null;
  /** Shared squad-wide movement budget — either player can spend from it, resets every turn. */
  movement: { used: number; max: number };
  /** Shared HP pool for the base ("陣") — reaching 0 costs a life and resets the wave. */
  baseHp: number;
  baseMaxHp: number;
  /** All grid tiles occupied by the base, for rendering. */
  baseTiles: Vec2[];
  /** Turns remaining before this wave is survived regardless of remaining monsters. */
  turnsLeftInWave: number;
  /** This wave's total turn budget (e.g. for a "2/4" display). */
  waveTurns: number;
}
