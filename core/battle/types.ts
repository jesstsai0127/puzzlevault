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

export interface BattleSnapshot {
  players: PlayerUnitState[];
  monsters: MonsterUnitState[];
  waveIndex: number;
  lives: number;
  turnNumber: number;
  victory: boolean;
  /** Shared squad-wide movement budget — either player can spend from it, resets every turn. */
  movement: { used: number; max: number };
}
