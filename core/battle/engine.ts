import {
  MOVE_VECTORS,
  add,
  equalsVec2,
  manhattan,
  stepDirectionToward,
} from '../geometry';
import type { CardinalDir, Vec2 } from '../geometry';
import type { AiCondition, EffectPrimitive, MapDef, TargetMode } from '../content/types';
import type {
  ActionResult,
  BattleSnapshot,
  ContentRegistry,
  MonsterIntent,
  MonsterUnitState,
  PlayerUnitState,
} from './types';

const STARTING_LIVES = 3;

type ResolvedTarget =
  | { kind: 'self' }
  | { kind: 'player'; unit: PlayerUnitState }
  | { kind: 'monster'; unit: MonsterUnitState };

interface HistoryEntry {
  players: PlayerUnitState[];
  monsters: MonsterUnitState[];
}

/**
 * Turn-based squad-vs-waves battle state machine (Into the Breach style).
 *
 * Turn structure, enforced by this class's API surface — callers cannot skip
 * a step:
 *   1. Intents for all living monsters are computed from the state at the
 *      START of the turn (getIntents()) — this is the "telegraph" and must
 *      not change as a side effect of the player's own actions.
 *   2. Player acts: moveUnit()/useSkill() resolve immediately and can be
 *      undone (undo()) up until endTurn() is called.
 *   3. endTurn() resolves the turn's stored intents (not recomputed), clears
 *      undo history, checks wipe/wave-clear/victory, and computes the next
 *      turn's intents.
 */
export class BattleEngine {
  private map: MapDef;
  private registry: ContentRegistry;
  private squadCharacterIds: string[];

  private players: PlayerUnitState[] = [];
  private monsters: MonsterUnitState[] = [];
  private waveIndex = 0;
  private lives = STARTING_LIVES;
  private turnNumber = 1;
  private victory = false;

  private currentIntents: MonsterIntent[] = [];
  private history: HistoryEntry[] = [];
  private monsterSpawnCounter = 0;

  constructor(map: MapDef, squadCharacterIds: string[], registry: ContentRegistry) {
    this.map = map;
    this.registry = registry;
    this.squadCharacterIds = squadCharacterIds;
    this.resetToWave(0, STARTING_LIVES);
  }

  getSnapshot(): BattleSnapshot {
    return {
      players: this.players.map((p) => ({ ...p, position: { ...p.position } })),
      monsters: this.monsters.map((m) => ({ ...m, position: { ...m.position } })),
      waveIndex: this.waveIndex,
      lives: this.lives,
      turnNumber: this.turnNumber,
      victory: this.victory,
    };
  }

  getIntents(): MonsterIntent[] {
    return this.currentIntents.map((i) => ({ ...i }));
  }

  // ---------------------------------------------------------------------
  // Player actions
  // ---------------------------------------------------------------------

  moveUnit(unitIndex: number, dir: CardinalDir): ActionResult {
    const unit = this.players[unitIndex];
    if (!unit || unit.hp <= 0) return { ok: false, reason: 'invalid-unit' };
    if (unit.actionsUsed >= unit.maxActionPoints) return { ok: false, reason: 'no-actions-left' };

    const next = add(unit.position, MOVE_VECTORS[dir]);
    if (!this.isWalkable(next) || this.isOccupied(next)) return { ok: false, reason: 'blocked' };

    this.pushHistory();
    unit.position = next;
    unit.actionsUsed += 1;
    return { ok: true };
  }

  useSkill(unitIndex: number, skillId: string, dir: CardinalDir): ActionResult {
    const unit = this.players[unitIndex];
    if (!unit || unit.hp <= 0) return { ok: false, reason: 'invalid-unit' };
    if (unit.actionsUsed >= unit.maxActionPoints) return { ok: false, reason: 'no-actions-left' };
    if (!unit.skillIds.includes(skillId)) return { ok: false, reason: 'unknown-skill' };
    const skill = this.registry.skills[skillId];
    if (!skill) return { ok: false, reason: 'unknown-skill' };

    this.pushHistory();
    const dirVec = MOVE_VECTORS[dir];
    for (const effect of skill.effects) {
      const target = this.resolveTarget(unit.position, dirVec, skill.range, effect.target, true);
      this.applyEffect(effect, target, unit);
    }
    unit.actionsUsed += 1;
    return { ok: true };
  }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.players = prev.players;
    this.monsters = prev.monsters;
    return true;
  }

  // ---------------------------------------------------------------------
  // Turn resolution
  // ---------------------------------------------------------------------

  endTurn(): void {
    for (const intent of this.currentIntents) {
      const monster = this.monsters.find((m) => m.instanceId === intent.instanceId);
      if (!monster || monster.hp <= 0) continue; // died during the player's turn

      if (intent.kind === 'move') {
        if (this.isWalkable(intent.to) && !this.isOccupied(intent.to)) {
          monster.position = intent.to;
        }
      } else {
        const skill = this.registry.skills[intent.skillId];
        if (!skill) continue;
        const dirVec = MOVE_VECTORS[intent.direction];
        for (const effect of skill.effects) {
          const target = this.resolveTarget(monster.position, dirVec, skill.range, effect.target, false);
          this.applyEffect(effect, target, monster);
        }
      }
    }

    this.history = [];
    this.turnNumber += 1;

    if (this.players.every((p) => p.hp <= 0)) {
      this.handleWipe();
      return;
    }

    this.monsters = this.monsters.filter((m) => m.hp > 0);
    if (this.monsters.length === 0) {
      this.advanceWave();
    } else {
      // Every turn is a fresh round: each living unit's action points reset
      // here, not only when a wave clears (advanceWave/resetToWave already
      // reset for their own cases).
      for (const p of this.players) {
        if (p.hp > 0) p.actionsUsed = 0;
      }
      this.currentIntents = this.computeIntents();
    }
  }

  // ---------------------------------------------------------------------
  // Wave / run lifecycle
  // ---------------------------------------------------------------------

  private handleWipe(): void {
    this.lives -= 1;
    if (this.lives > 0) {
      this.resetToWave(this.waveIndex, this.lives);
    } else {
      this.resetToWave(0, STARTING_LIVES);
    }
  }

  private advanceWave(): void {
    const nextWave = this.waveIndex + 1;
    if (nextWave >= this.map.waves.length) {
      this.victory = true;
      this.currentIntents = [];
      return;
    }
    this.waveIndex = nextWave;
    this.monsters = this.spawnWave(nextWave);
    for (const p of this.players) {
      p.actionsUsed = 0;
    }
    this.currentIntents = this.computeIntents();
  }

  /** Reset players (full HP) and respawn the given wave's monsters (fresh HP). */
  private resetToWave(waveIndex: number, lives: number): void {
    this.waveIndex = waveIndex;
    this.lives = lives;
    this.victory = false;
    this.history = [];

    this.players = this.squadCharacterIds.map((charId, i) => {
      const def = this.registry.characters[charId];
      const start = this.map.playerStarts[i];
      return {
        characterId: charId,
        position: { ...start },
        hp: def.maxHp,
        maxHp: def.maxHp,
        shield: 0,
        maxActionPoints: def.actionPoints,
        actionsUsed: 0,
        skillIds: def.skillIds,
      };
    });

    this.monsters = this.spawnWave(waveIndex);
    this.currentIntents = this.computeIntents();
  }

  private spawnWave(waveIndex: number): MonsterUnitState[] {
    const wave = this.map.waves[waveIndex];
    const claimed = new Set<string>();
    return wave.monsters.map((spawn) => {
      const def = this.registry.monsters[spawn.monsterId];
      const pos = this.findFreeSpawnTile(spawn.spawn, claimed);
      claimed.add(`${pos.x},${pos.y}`);
      this.monsterSpawnCounter += 1;
      return {
        instanceId: `${spawn.monsterId}#${this.monsterSpawnCounter}`,
        monsterId: spawn.monsterId,
        position: pos,
        hp: def.maxHp,
        maxHp: def.maxHp,
        shield: 0,
      };
    });
  }

  /**
   * A wave's designated spawn tile can end up occupied by a player who
   * wandered there in a previous wave. BFS outward for the nearest free
   * tile instead of spawning on top of them.
   */
  private findFreeSpawnTile(preferred: Vec2, claimed: Set<string>): Vec2 {
    const isFree = (p: Vec2) =>
      this.isWalkable(p) &&
      !claimed.has(`${p.x},${p.y}`) &&
      !this.players.some((pl) => pl.hp > 0 && equalsVec2(pl.position, p));

    if (isFree(preferred)) return { ...preferred };

    const queue: Vec2[] = [preferred];
    const seen = new Set<string>([`${preferred.x},${preferred.y}`]);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const dir of Object.keys(MOVE_VECTORS) as CardinalDir[]) {
        const next = add(cur, MOVE_VECTORS[dir]);
        const key = `${next.x},${next.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (isFree(next)) return next;
        if (this.isWalkable(next)) queue.push(next);
      }
    }
    return { ...preferred }; // no free tile found — shouldn't happen on a reasonable map
  }

  // ---------------------------------------------------------------------
  // AI intent computation
  // ---------------------------------------------------------------------

  private computeIntents(): MonsterIntent[] {
    return this.monsters
      .filter((m) => m.hp > 0)
      .map((m) => this.computeIntentFor(m));
  }

  private computeIntentFor(m: MonsterUnitState): MonsterIntent {
    const def = this.registry.monsters[m.monsterId];
    const nearest = this.nearestPlayer(m.position);

    for (const rule of def.aiRules) {
      if (this.matchesCondition(rule.when, m, nearest)) {
        if (rule.action.kind === 'useSkill') {
          const dir = nearest ? stepDirectionToward(m.position, nearest.position) : 'down';
          return { kind: 'skill', instanceId: m.instanceId, skillId: rule.action.skillId, direction: dir };
        }
        // moveToward nearestPlayer
        if (!nearest) return { kind: 'move', instanceId: m.instanceId, to: { ...m.position } };
        const dir = stepDirectionToward(m.position, nearest.position);
        const to = add(m.position, MOVE_VECTORS[dir]);
        const dest = this.isWalkable(to) && !this.isOccupied(to) ? to : { ...m.position };
        return { kind: 'move', instanceId: m.instanceId, to: dest };
      }
    }
    // validateMonsterDef guarantees a trailing unconditional 'always' rule.
    throw new Error(`monster ${m.instanceId}: no aiRule matched (missing fallback?)`);
  }

  private matchesCondition(
    cond: AiCondition,
    m: MonsterUnitState,
    nearest: PlayerUnitState | null,
  ): boolean {
    if (cond.kind === 'always') return true;
    if (cond.kind === 'targetInRange') {
      if (!nearest) return false;
      return manhattan(m.position, nearest.position) <= cond.range;
    }
    return false;
  }

  private nearestPlayer(from: Vec2): PlayerUnitState | null {
    const alive = this.players.filter((p) => p.hp > 0);
    if (alive.length === 0) return null;
    return alive.reduce((best, p) =>
      manhattan(from, p.position) < manhattan(from, best.position) ? p : best,
    );
  }

  // ---------------------------------------------------------------------
  // Effect resolution
  // ---------------------------------------------------------------------

  private resolveTarget(
    casterPos: Vec2,
    dir: Vec2,
    range: number,
    mode: TargetMode,
    casterIsPlayer: boolean,
  ): ResolvedTarget | null {
    if (mode === 'self') return { kind: 'self' };

    for (let step = 1; step <= range; step++) {
      const p = add(casterPos, { x: dir.x * step, y: dir.y * step });
      if (!this.isWalkable(p)) return null;
      if (casterIsPlayer) {
        const m = this.monsters.find((x) => x.hp > 0 && equalsVec2(x.position, p));
        if (m) return { kind: 'monster', unit: m };
      } else {
        const pl = this.players.find((x) => x.hp > 0 && equalsVec2(x.position, p));
        if (pl) return { kind: 'player', unit: pl };
      }
    }
    return null;
  }

  private applyEffect(
    effect: EffectPrimitive,
    target: ResolvedTarget | null,
    caster: PlayerUnitState | MonsterUnitState,
  ): void {
    if (!target) return;
    const unit = target.kind === 'self' ? caster : target.unit;

    switch (effect.type) {
      case 'damage':
        this.dealDamage(unit, effect.amount);
        break;
      case 'push':
        this.pushUnit(unit, caster.position, effect.amount);
        break;
      case 'shield':
        unit.shield += effect.amount;
        break;
      case 'heal':
        unit.hp = Math.min(unit.maxHp, unit.hp + effect.amount);
        break;
    }
  }

  /** Shield fully blocks one hit (consumes one charge) rather than absorbing a damage amount. */
  private dealDamage(unit: { hp: number; shield: number }, amount: number): void {
    if (unit.shield > 0) {
      unit.shield -= 1;
      return;
    }
    unit.hp = Math.max(0, unit.hp - amount);
  }

  private pushUnit(
    unit: PlayerUnitState | MonsterUnitState,
    fromPos: Vec2,
    distance: number,
  ): void {
    const dir = stepDirectionToward(fromPos, unit.position);
    const dirVec = MOVE_VECTORS[dir];
    for (let i = 0; i < distance; i++) {
      const next = add(unit.position, dirVec);
      if (!this.isWalkable(next) || this.isOccupied(next)) break;
      unit.position = next;
    }
  }

  // ---------------------------------------------------------------------
  // Grid helpers
  // ---------------------------------------------------------------------

  private isWalkable(p: Vec2): boolean {
    const row = this.map.grid[p.y];
    if (row === undefined || p.x < 0 || p.x >= row.length) return false;
    return row[p.x] === ' ';
  }

  private isOccupied(p: Vec2): boolean {
    return (
      this.players.some((u) => u.hp > 0 && equalsVec2(u.position, p)) ||
      this.monsters.some((u) => u.hp > 0 && equalsVec2(u.position, p))
    );
  }

  private pushHistory(): void {
    this.history.push({
      players: this.players.map((p) => ({ ...p, position: { ...p.position } })),
      monsters: this.monsters.map((m) => ({ ...m, position: { ...m.position } })),
    });
  }
}
