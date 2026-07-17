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
  /**
   * ITB-style action economy: each unit's turn is "move (at most moveRange
   * tiles, committed as ONE whole move), then ONE action (skill or rest)" —
   * in that fixed order. `moved` locks further movement the moment a move
   * commits; `acted` locks BOTH further actions and movement (acting ends
   * the unit's turn). Either phase may be skipped. Both reset at the start
   * of every fresh player turn (startFreshTurn()).
   */
  moved: boolean;
  acted: boolean;
  /** Copied from CharacterDef.moveRange so the UI/BFS can read it off the snapshot without a registry lookup. */
  moveRange: number;
  skillIds: string[];
  /**
   * Whether this unit's Ultimate (CharacterDef.ultimateSkillId) has already
   * been cast THIS LEVEL RUN. Reset to false only by BattleEngine.resetRun()
   * (the level-reset path — constructor and confirmOutcome()/manual reset),
   * never by resetTurn() — an Ultimate spent earlier in the run stays spent
   * across turns/waves, that's the whole point of its cost. resetTurn()
   * restores it correctly for free because it restores whole-object
   * snapshots of `players` (captureTurnStart()), which already spread-copy
   * every field on this interface.
   */
  ultimateUsed: boolean;
}

export interface MonsterUnitState {
  instanceId: string;
  monsterId: string;
  position: Vec2;
  hp: number;
  maxHp: number;
  shield: number;
  /** Player index that most recently taunted this monster — set/cleared alongside tauntTurnsLeft. Absent when not taunted. */
  tauntedBy?: number;
  /** Turns of taunt override remaining, counted down once per computeIntents() call (once per fresh turn). Absent when not taunted. */
  tauntTurnsLeft?: number;
}

/**
 * One board tile a telegraphed monster attack will strike, with the damage
 * that single skill deals there. Resolved ONCE against the TURN-START board
 * (computeIntents) and then locked — the ITB telegraph contract: these are
 * the tiles the monster has committed to attacking, and they deliberately do
 * NOT re-resolve as the player repositions mid-turn (stepping OUT of a
 * telegraphed tile is exactly how you dodge). The complementary LIVE layer is
 * getAttackPreviews(): per-target "-N" totals re-resolved against the board
 * as it stands right now, so the player sees both "where the attack is aimed"
 * (fixed) and "who it would actually hit if I ended the turn here" (live).
 * `damage` sums the skill's damage effects on that tile (percent damage is
 * evaluated against the occupant's turn-start HP); 0 means a non-damage
 * threat (e.g. push-only) landing there.
 */
export interface IntentTile {
  pos: Vec2;
  damage: number;
}

export type MonsterIntent =
  | { kind: 'move'; instanceId: string; to: Vec2; aim: Vec2 | null; away?: boolean }
  | {
      kind: 'skill';
      instanceId: string;
      skillId: string;
      direction: CardinalDir;
      /**
       * 1-based resolution rank AMONG SKILL INTENTS this turn: the intent
       * with order 1 lands its attack before order 2, and so on. Backed by
       * endTurn() resolving currentIntents in stable array order (= monster
       * spawn order), so it is deterministic and safe to telegraph. Move
       * intents interleave in the same array order but carry no number —
       * monsters never block each other's attacks, so only attack-vs-attack
       * ordering (shield charges, kill order) is player-relevant.
       */
      order: number;
      /** Exact turn-start-locked attack tiles — see IntentTile for the two-layer telegraph semantics. */
      tiles: IntentTile[];
    };

/** Identifies who/what an effect landed on — shared by AttackPreview (pre-resolution) and TurnEvent (post-resolution). */
export type CombatTarget = { kind: 'base' } | { kind: 'player'; unitIndex: number } | { kind: 'monster'; instanceId: string };

/** A skill intent's damage, aggregated per target so a target locked by multiple monsters shows one combined preview number. */
export interface AttackPreview {
  target: CombatTarget;
  damage: number;
}

/**
 * Something that actually happened during useSkill()/endTurn() — the record
 * BattleScene consumes to drive hit feedback (screen shake, floating damage
 * numbers, hit flash) and, later, a combat-log panel. Distinct from
 * AttackPreview, which is a forecast computed BEFORE resolution; a TurnEvent
 * is what was actually applied.
 */
export type TurnEvent =
  | { kind: 'damage'; target: CombatTarget; amount: number; blocked: boolean }
  | { kind: 'push'; target: CombatTarget; distance: number }
  | { kind: 'shield'; target: CombatTarget; amount: number }
  | { kind: 'heal'; target: CombatTarget; amount: number }
  | { kind: 'taunt'; target: CombatTarget };

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
  /** Whether this level run's single turn-reset (ITB-style: one per battle) has been spent — cleared only by resetLevel()/resetRun(). */
  resetTurnUsed: boolean;
}
