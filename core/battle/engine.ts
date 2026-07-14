import {
  MOVE_VECTORS,
  add,
  equalsVec2,
  manhattan,
  oppositeDir,
  stepDirectionToward,
} from '../geometry';
import type { CardinalDir, Vec2 } from '../geometry';
import type { AiCondition, AiRule, AiTarget, EffectPrimitive, MapDef, MonsterDef, TargetMode } from '../content/types';
import type {
  ActionResult,
  BattleSnapshot,
  ContentRegistry,
  MonsterIntent,
  MonsterUnitState,
  PlayerUnitState,
} from './types';

const STARTING_LIVES = 3;
/** Damage a player takes when shoved into a hazard tile — monsters shoved in die outright instead. */
const HAZARD_DAMAGE = 3;

type ResolvedTarget =
  | { kind: 'self' }
  | { kind: 'player'; unit: PlayerUnitState }
  | { kind: 'monster'; unit: MonsterUnitState }
  | { kind: 'base' };

interface HistoryEntry {
  players: PlayerUnitState[];
  monsters: MonsterUnitState[];
  movementUsed: number;
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
  /** Shared squad-wide movement budget — the sum of every squad member's own actionPoints. */
  private movementMax = 0;
  private movementUsed = 0;
  private waveIndex = 0;
  private lives = STARTING_LIVES;
  private turnNumber = 1;
  private victory = false;

  /** All 'B' tiles on the map — computed once, the grid never changes at runtime. */
  private baseTiles: Vec2[] = [];
  private baseMaxHp = 0;
  private baseHp = 0;
  private turnsLeftInWave = 0;

  private currentIntents: MonsterIntent[] = [];
  private history: HistoryEntry[] = [];
  /** Snapshot at the moment a fresh player turn begins — restored wholesale by resetTurn(). */
  private turnStartSnapshot: HistoryEntry | null = null;
  private monsterSpawnCounter = 0;

  constructor(map: MapDef, squadCharacterIds: string[], registry: ContentRegistry) {
    this.map = map;
    this.registry = registry;
    this.squadCharacterIds = squadCharacterIds;
    this.baseTiles = this.computeBaseTiles(map);
    this.baseMaxHp = map.baseHp;
    this.resetToWave(0, STARTING_LIVES);
  }

  private computeBaseTiles(map: MapDef): Vec2[] {
    const tiles: Vec2[] = [];
    map.grid.forEach((row, y) => {
      row.split('').forEach((ch, x) => {
        if (ch === 'B') tiles.push({ x, y });
      });
    });
    return tiles;
  }

  getSnapshot(): BattleSnapshot {
    return {
      players: this.players.map((p) => ({ ...p, position: { ...p.position } })),
      monsters: this.monsters.map((m) => ({ ...m, position: { ...m.position } })),
      waveIndex: this.waveIndex,
      lives: this.lives,
      turnNumber: this.turnNumber,
      victory: this.victory,
      movement: { used: this.movementUsed, max: this.movementMax },
      baseHp: this.baseHp,
      baseMaxHp: this.baseMaxHp,
      baseTiles: this.baseTiles.map((t) => ({ ...t })),
      turnsLeftInWave: this.turnsLeftInWave,
      waveTurns: this.map.waves[this.waveIndex].turns,
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
    if (this.movementUsed >= this.movementMax) return { ok: false, reason: 'no-movement-left' };

    const next = add(unit.position, MOVE_VECTORS[dir]);
    if (!this.isWalkable(next) || this.isOccupied(next)) return { ok: false, reason: 'blocked' };

    this.pushHistory();
    unit.position = next;
    this.movementUsed += 1;
    return { ok: true };
  }

  useSkill(unitIndex: number, skillId: string, dir: CardinalDir): ActionResult {
    const unit = this.players[unitIndex];
    if (!unit || unit.hp <= 0) return { ok: false, reason: 'invalid-unit' };
    if (!unit.skillIds.includes(skillId)) return { ok: false, reason: 'unknown-skill' };
    const skill = this.registry.skills[skillId];
    if (!skill) return { ok: false, reason: 'unknown-skill' };
    if (unit.mp < skill.mpCost) return { ok: false, reason: 'not-enough-mp' };

    this.pushHistory();
    const dirVec = MOVE_VECTORS[dir];
    for (const effect of skill.effects) {
      const target = this.resolveTarget(unit.position, dirVec, skill.range, effect.target, true);
      this.applyEffect(effect, target, unit);
    }
    unit.mp -= skill.mpCost;
    return { ok: true };
  }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.players = prev.players;
    this.monsters = prev.monsters;
    this.movementUsed = prev.movementUsed;
    return true;
  }

  /**
   * Reverts every action taken so far THIS turn back to the snapshot captured
   * the instant the turn began (see captureTurnStart()) — the single button/
   * key players use instead of undo()'s per-step history. Base HP never
   * changes during the player's own turn (only a resolved monster intent on
   * endTurn can touch it), so it needn't be part of the snapshot.
   */
  resetTurn(): void {
    if (!this.turnStartSnapshot) return;
    this.players = this.turnStartSnapshot.players.map((p) => ({ ...p, position: { ...p.position } }));
    this.monsters = this.turnStartSnapshot.monsters.map((m) => ({ ...m, position: { ...m.position } }));
    this.movementUsed = this.turnStartSnapshot.movementUsed;
    this.history = [];
  }

  /** Called at the moment a fresh player turn begins (constructor, resetToWave, and every endTurn branch that starts a new turn). */
  private captureTurnStart(): void {
    this.turnStartSnapshot = {
      players: this.players.map((p) => ({ ...p, position: { ...p.position } })),
      monsters: this.monsters.map((m) => ({ ...m, position: { ...m.position } })),
      movementUsed: this.movementUsed,
    };
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

    // Base HP only ever changes above (a monster's stored intent resolving),
    // never during the player's own turn — so undo/pushHistory doesn't need
    // to snapshot it; clearing history here is enough.
    this.history = [];
    this.turnNumber += 1;

    if (this.baseHp <= 0) {
      this.handleBaseDestroyed();
      return;
    }

    this.monsters = this.monsters.filter((m) => m.hp > 0);
    this.turnsLeftInWave -= 1;

    const isLastWave = this.waveIndex === this.map.waves.length - 1;
    if (isLastWave && (this.monsters.length === 0 || this.turnsLeftInWave <= 0)) {
      // Victory: outlasted the final assault's clock, or cleared the board
      // after the last wave arrived. The base is alive (checked above).
      this.victory = true;
      this.currentIntents = [];
    } else if (!isLastWave && this.turnsLeftInWave <= 0) {
      // Reinforce: the clock ran out before the last wave — survivors PERSIST
      // and the next wave's monsters are ADDED on top of them, not a fresh start.
      this.reinforce();
    } else {
      // Continue: neither reinforcement time nor a last-wave win — including
      // a non-final wave cleared early, which just gives a breather until the
      // clock reinforces. Every turn is a fresh round regardless: the squad's
      // shared movement and each living unit's own mp reset here.
      this.startFreshTurn();
    }
  }

  // ---------------------------------------------------------------------
  // Wave / run lifecycle
  // ---------------------------------------------------------------------

  /** The base ("陣") hit 0 HP — costs a life and resets the current wave with base HP full again. */
  private handleBaseDestroyed(): void {
    this.lives -= 1;
    if (this.lives > 0) {
      this.resetToWave(this.waveIndex, this.lives);
    } else {
      this.resetToWave(0, STARTING_LIVES);
    }
  }

  /** Reinforcement clock hit zero before the last wave: add the next wave's monsters on top of any survivors. */
  private reinforce(): void {
    const nextWave = this.waveIndex + 1;
    // Existing survivors (this.monsters) are passed as the avoid-list so
    // reinforcements land beside them, never on top of them.
    const reinforcements = this.spawnWave(nextWave, this.monsters);
    this.monsters = [...this.monsters, ...reinforcements];
    this.waveIndex = nextWave;
    this.turnsLeftInWave = this.map.waves[nextWave].turns;
    // Base HP is NOT reset here — it persists across waves within a run
    // (only a life loss / run reset restores it, in resetToWave below).
    this.startFreshTurn();
  }

  /** Resets the squad's shared movement and every living unit's mp, recomputes intents, and captures the new turn-start snapshot for resetTurn(). */
  private startFreshTurn(): void {
    this.movementUsed = 0;
    for (const p of this.players) {
      if (p.hp > 0) p.mp = p.maxMp;
    }
    this.currentIntents = this.computeIntents();
    this.captureTurnStart();
  }

  /** Reset players (full HP), base HP, and respawn the given wave's monsters (fresh HP). */
  private resetToWave(waveIndex: number, lives: number): void {
    this.waveIndex = waveIndex;
    this.lives = lives;
    this.victory = false;
    this.history = [];
    this.baseHp = this.baseMaxHp;
    this.turnsLeftInWave = this.map.waves[waveIndex].turns;

    this.players = this.squadCharacterIds.map((charId, i) => {
      const def = this.registry.characters[charId];
      const start = this.map.playerStarts[i];
      return {
        characterId: charId,
        position: { ...start },
        hp: def.maxHp,
        maxHp: def.maxHp,
        shield: 0,
        mp: def.maxMp,
        maxMp: def.maxMp,
        skillIds: def.skillIds,
      };
    });
    this.movementMax = this.squadCharacterIds.reduce(
      (sum, charId) => sum + this.registry.characters[charId].actionPoints,
      0,
    );
    this.movementUsed = 0;

    this.monsters = this.spawnWave(waveIndex);
    this.currentIntents = this.computeIntents();
    this.captureTurnStart();
  }

  /**
   * `avoidMonsters` lets a reinforcement wave steer clear of survivors still
   * on the board; a fresh wave spawn (resetToWave) passes none, since those
   * old monsters are being discarded, not stood beside.
   */
  private spawnWave(waveIndex: number, avoidMonsters: MonsterUnitState[] = []): MonsterUnitState[] {
    const wave = this.map.waves[waveIndex];
    const claimed = new Set<string>();
    return wave.monsters.map((spawn) => {
      const def = this.registry.monsters[spawn.monsterId];
      const occupant = this.players.find((p) => p.hp > 0 && equalsVec2(p.position, spawn.spawn));
      if (occupant) {
        // Standing on a spawn tile is a risk, not a free block: the monster
        // gets one ambush hit in as it forces its way in, then still takes
        // the nearest free tile (units never share a cell).
        this.dealDamage(occupant, this.ambushDamageFor(def));
      }
      const pos = this.findFreeSpawnTile(spawn.spawn, claimed, avoidMonsters);
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

  /** The damage a monster's ambush hit deals: its own first damage-effect amount, or 1 if it has none. */
  private ambushDamageFor(def: MonsterDef): number {
    for (const skillId of def.skillIds) {
      const skill = this.registry.skills[skillId];
      const dmg = skill?.effects.find((e) => e.type === 'damage');
      if (dmg) return dmg.amount;
    }
    return 1;
  }

  /**
   * A wave's designated spawn tile can end up occupied by a player who
   * wandered there in a previous wave. BFS outward for the nearest free
   * tile instead of spawning on top of them.
   */
  private findFreeSpawnTile(preferred: Vec2, claimed: Set<string>, avoidMonsters: MonsterUnitState[]): Vec2 {
    const isFree = (p: Vec2) =>
      this.isWalkable(p) &&
      !claimed.has(`${p.x},${p.y}`) &&
      !this.players.some((pl) => pl.hp > 0 && equalsVec2(pl.position, p)) &&
      !avoidMonsters.some((m) => m.hp > 0 && equalsVec2(m.position, p));

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

    for (const rule of def.aiRules) {
      if (this.matchesCondition(rule.when, m)) {
        if (rule.action.kind === 'useSkill') {
          const aim = this.aimPointForRule(rule, m.position);
          const dir = aim ? stepDirectionToward(m.position, aim) : 'down';
          return { kind: 'skill', instanceId: m.instanceId, skillId: rule.action.skillId, direction: dir };
        }
        const aim = this.resolveAimPoint(rule.action.target, m.position);
        if (!aim) return { kind: 'move', instanceId: m.instanceId, to: { ...m.position } };
        if (rule.action.kind === 'moveAway') {
          const dir = oppositeDir(stepDirectionToward(m.position, aim));
          const to = add(m.position, MOVE_VECTORS[dir]);
          const dest = this.isWalkable(to) && !this.isOccupied(to) ? to : { ...m.position };
          return { kind: 'move', instanceId: m.instanceId, to: dest };
        }
        // moveToward the aim point. If a hero is standing on the immediate step
        // toward the aim (blocking the lane to the base), the monster claws
        // through that hero instead of idling — body-blocking now costs the
        // blocker HP. The base stays the goal; heroes are only hit when they're
        // in the way. (See roadmap ch.4.)
        const stepDir = stepDirectionToward(m.position, aim);
        const ahead = add(m.position, MOVE_VECTORS[stepDir]);
        const blocker = this.players.find((p) => p.hp > 0 && equalsVec2(p.position, ahead));
        const attackSkillId = blocker ? this.monsterAttackSkillId(def) : undefined;
        if (attackSkillId) {
          return { kind: 'skill', instanceId: m.instanceId, skillId: attackSkillId, direction: stepDir };
        }
        return { kind: 'move', instanceId: m.instanceId, to: this.multiStepToward(m.position, aim, def.moveRange) };
      }
    }
    // validateMonsterDef guarantees a trailing unconditional 'always' rule.
    throw new Error(`monster ${m.instanceId}: no aiRule matched (missing fallback?)`);
  }

  /** The skill a monster attacks with: the skillId of its first useSkill rule, else its first skill. */
  private monsterAttackSkillId(def: MonsterDef): string | undefined {
    for (const rule of def.aiRules) {
      if (rule.action.kind === 'useSkill') return rule.action.skillId;
    }
    return def.skillIds[0];
  }

  /**
   * A useSkill action has no target of its own — it aims wherever the rule's
   * condition was checking (almost always a targetInRange check), falling
   * back to nearestPlayer if it was gated by an unconditional 'always' rule.
   */
  private aimPointForRule(rule: AiRule, from: Vec2): Vec2 | null {
    if (rule.when.kind === 'targetInRange') {
      return this.resolveAimPoint(rule.when.target, from);
    }
    return this.resolveAimPoint('nearestPlayer', from);
  }

  /** Greedily steps up to `maxSteps` tiles toward `target`, stopping early at a wall/occupied tile. */
  private multiStepToward(start: Vec2, target: Vec2, maxSteps: number): Vec2 {
    let pos = { ...start };
    for (let i = 0; i < maxSteps; i++) {
      const dir = stepDirectionToward(pos, target);
      const next = add(pos, MOVE_VECTORS[dir]);
      if (!this.isWalkable(next) || this.isOccupied(next)) break;
      pos = next;
    }
    return pos;
  }

  private matchesCondition(cond: AiCondition, m: MonsterUnitState): boolean {
    if (cond.kind === 'always') return true;
    if (cond.kind === 'targetInRange') {
      const aim = this.resolveAimPoint(cond.target, m.position);
      if (!aim) return false;
      return manhattan(m.position, aim) <= cond.range;
    }
    return false;
  }

  /** Resolves an AiTarget to the actual point a monster aims at, from its own position. */
  private resolveAimPoint(target: AiTarget, from: Vec2): Vec2 | null {
    if (target === 'nearestPlayer') {
      const p = this.nearestPlayer(from);
      return p ? p.position : null;
    }
    return this.nearestBaseTile(from);
  }

  private nearestPlayer(from: Vec2): PlayerUnitState | null {
    const alive = this.players.filter((p) => p.hp > 0);
    if (alive.length === 0) return null;
    return alive.reduce((best, p) =>
      manhattan(from, p.position) < manhattan(from, best.position) ? p : best,
    );
  }

  private nearestBaseTile(from: Vec2): Vec2 | null {
    if (this.baseTiles.length === 0) return null;
    return this.baseTiles.reduce((best, t) =>
      manhattan(from, t) < manhattan(from, best) ? t : best,
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
      // A monster's shot reaching its own base tile hits the base; a
      // player's shot never targets the base — it just stops there instead.
      if (this.isBaseTile(p)) {
        return casterIsPlayer ? null : { kind: 'base' };
      }
      // A shot's line of sight is only blocked by real walls — it flies over hazard tiles.
      if (this.isWall(p)) return null;
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
    if (target.kind === 'base') {
      // Only damage makes sense against the base — push/shield/heal are no-ops on it.
      if (effect.type === 'damage') {
        this.baseHp = Math.max(0, this.baseHp - effect.amount);
      }
      return;
    }
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
      if (this.isHazard(next) && !this.isOccupied(next)) {
        unit.position = next;
        this.applyHazardDamage(unit);
        break; // fell in — the push stops here regardless of remaining distance
      }
      if (!this.isWalkable(next) || this.isOccupied(next)) break;
      unit.position = next;
    }
  }

  /** A monster shoved into a hazard tile doesn't survive; a player character takes a flat hit instead (shield can still block it). */
  private applyHazardDamage(unit: PlayerUnitState | MonsterUnitState): void {
    if ('instanceId' in unit) {
      unit.hp = 0;
    } else {
      this.dealDamage(unit, HAZARD_DAMAGE);
    }
  }

  // ---------------------------------------------------------------------
  // Grid helpers
  // ---------------------------------------------------------------------

  /** Normal movement: only plain floor is walkable — hazard and base tiles block it same as a wall. */
  private isWalkable(p: Vec2): boolean {
    const row = this.map.grid[p.y];
    if (row === undefined || p.x < 0 || p.x >= row.length) return false;
    return row[p.x] === ' ';
  }

  /** Line-of-sight blocking: a real wall or a base tile (or out of bounds) stops a shot — hazard tiles don't. */
  private isWall(p: Vec2): boolean {
    const row = this.map.grid[p.y];
    if (row === undefined || p.x < 0 || p.x >= row.length) return true;
    return row[p.x] === '#' || row[p.x] === 'B';
  }

  private isBaseTile(p: Vec2): boolean {
    const row = this.map.grid[p.y];
    if (row === undefined || p.x < 0 || p.x >= row.length) return false;
    return row[p.x] === 'B';
  }

  private isHazard(p: Vec2): boolean {
    const row = this.map.grid[p.y];
    if (row === undefined || p.x < 0 || p.x >= row.length) return false;
    return row[p.x] === '~';
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
      movementUsed: this.movementUsed,
    });
  }
}
