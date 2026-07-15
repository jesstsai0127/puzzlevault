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
  AttackPreview,
  BattleSnapshot,
  CombatTarget,
  ContentRegistry,
  MonsterIntent,
  MonsterUnitState,
  PlayerUnitState,
  RunOutcome,
  TurnEvent,
} from './types';

/** Damage a player takes when shoved into a hazard tile — monsters shoved in die outright instead. */
const HAZARD_DAMAGE = 3;

/** Damage dealt to a pushed unit (and whatever it collides with) when a shove can't complete its full distance. */
const PUSH_COLLISION_DAMAGE = 1;

/** Flat, unavoidable damage to any living unit still standing on a poison-mist ('*') tile at endTurn() — see applyPoisonMistDamage(). */
const POISON_MIST_DAMAGE = 1;

type ResolvedTarget =
  | { kind: 'self' }
  | { kind: 'player'; unit: PlayerUnitState }
  | { kind: 'monster'; unit: MonsterUnitState }
  | { kind: 'base' };

function sameCombatTarget(a: CombatTarget, b: CombatTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'player' && b.kind === 'player') return a.unitIndex === b.unitIndex;
  if (a.kind === 'monster' && b.kind === 'monster') return a.instanceId === b.instanceId;
  return a.kind === 'base' && b.kind === 'base';
}

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
  private turnNumber = 1;
  /** Set by endTurn() the instant a loss/win happens; the board is frozen on that turn's result until confirmOutcome() is called. */
  private pendingOutcome: RunOutcome | null = null;

  /** All 'B' tiles on the map — computed once, the grid never changes at runtime. */
  private baseTiles: Vec2[] = [];
  private baseMaxHp = 0;
  private baseHp = 0;
  private turnsLeftInWave = 0;

  private currentIntents: MonsterIntent[] = [];
  /** What the most recent moveUnit/useSkill/endTurn call actually did — see getLastEvents(). */
  private pendingEvents: TurnEvent[] = [];
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
    this.resetRun();
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
      turnNumber: this.turnNumber,
      outcome: this.pendingOutcome,
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

  /**
   * What the most recent successful moveUnit()/useSkill()/endTurn() call
   * actually did (damage dealt, pushes, shields, heals) — not a forecast
   * like getAttackPreviews(), the real thing that was applied. BattleScene
   * reads this right after each call to drive hit feedback (shake, floating
   * numbers, flash). Cleared and repopulated at the start of every one of
   * those three calls, so it always reflects only the most recent one.
   */
  getLastEvents(): TurnEvent[] {
    return this.pendingEvents.map((e) => ({ ...e }));
  }

  // ---------------------------------------------------------------------
  // Player actions
  // ---------------------------------------------------------------------

  moveUnit(unitIndex: number, dir: CardinalDir): ActionResult {
    if (this.pendingOutcome) return { ok: false, reason: 'outcome-pending' };
    const unit = this.players[unitIndex];
    if (!unit || unit.hp <= 0) return { ok: false, reason: 'invalid-unit' };
    if (unit.ap < 1) return { ok: false, reason: 'not-enough-ap' };

    const next = add(unit.position, MOVE_VECTORS[dir]);
    if (!this.isWalkable(next) || this.isOccupied(next)) return { ok: false, reason: 'blocked' };

    this.pendingEvents = [];
    this.pushHistory();

    // Opportunity attacks: a monster's telegraphed attack only names a
    // DIRECTION, resolved against the board at endTurn — so without this, a
    // hero could melee-hit a monster and then step back out of range before
    // endTurn, making its queued counter swing at empty air. Move-in (1 AP) +
    // melee (2 AP) + retreat (1 AP) fits exactly inside one turn's AP, which
    // would turn "attack and disengage" into a free, repeatable, zero-risk
    // way to grind down any melee monster — the single-dominant-strategy
    // problem all over again, just worse. A monster still adjacent right
    // before this step that WON'T be adjacent after it gets one free hit in,
    // same as a real tactics game's disengage-provokes-an-attack rule.
    const disengagedFrom = this.monsters.filter(
      (m) => m.hp > 0 && manhattan(m.position, unit.position) === 1 && manhattan(m.position, next) > 1,
    );

    unit.position = next;
    unit.ap -= 1;

    for (const m of disengagedFrom) {
      this.applyOpportunityAttack(m, unit);
    }

    return { ok: true };
  }

  /** A monster whose adjacency just got broken by a retreating hero gets one free hit — damage only, no push/shield/heal side effects. */
  private applyOpportunityAttack(monster: MonsterUnitState, target: PlayerUnitState): void {
    const def = this.registry.monsters[monster.monsterId];
    const skillId = this.monsterAttackSkillId(def);
    const skill = skillId ? this.registry.skills[skillId] : undefined;
    if (!skill) return;
    for (const effect of skill.effects) {
      if (effect.type === 'damage') this.dealDamageWithEvent(target, effect.amount);
    }
  }

  useSkill(unitIndex: number, skillId: string, dir: CardinalDir): ActionResult {
    if (this.pendingOutcome) return { ok: false, reason: 'outcome-pending' };
    const unit = this.players[unitIndex];
    if (!unit || unit.hp <= 0) return { ok: false, reason: 'invalid-unit' };
    if (!unit.skillIds.includes(skillId)) return { ok: false, reason: 'unknown-skill' };
    const skill = this.registry.skills[skillId];
    if (!skill) return { ok: false, reason: 'unknown-skill' };
    if (unit.ap < skill.mpCost) return { ok: false, reason: 'not-enough-ap' };

    this.pendingEvents = [];
    this.pushHistory();
    const dirVec = MOVE_VECTORS[dir];
    for (const effect of skill.effects) {
      const target = this.resolveTarget(unit.position, dirVec, skill.range, effect.target, true, effect.type === 'heal');
      this.applyEffect(effect, target, unit);
    }
    unit.ap -= skill.mpCost;
    return { ok: true };
  }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.players = prev.players;
    this.monsters = prev.monsters;
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
    if (this.pendingOutcome || !this.turnStartSnapshot) return;
    this.players = this.turnStartSnapshot.players.map((p) => ({ ...p, position: { ...p.position } }));
    this.monsters = this.turnStartSnapshot.monsters.map((m) => ({ ...m, position: { ...m.position } }));
    this.history = [];
    this.pendingEvents = []; // whatever this turn had done is undone — nothing left to show feedback for
  }

  /** Called at the moment a fresh player turn begins (constructor, resetRun, and every endTurn branch that starts a new turn). */
  private captureTurnStart(): void {
    this.turnStartSnapshot = {
      players: this.players.map((p) => ({ ...p, position: { ...p.position } })),
      monsters: this.monsters.map((m) => ({ ...m, position: { ...m.position } })),
    };
  }

  // ---------------------------------------------------------------------
  // Turn resolution
  // ---------------------------------------------------------------------

  endTurn(): void {
    if (this.pendingOutcome) return; // must confirmOutcome() before playing on

    this.pendingEvents = [];
    for (const intent of this.currentIntents) {
      const monster = this.monsters.find((m) => m.instanceId === intent.instanceId);
      if (!monster || monster.hp <= 0) continue; // died during the player's turn

      if (intent.kind === 'move') {
        // Re-walk toward the telegraphed aim point using the board AS IT IS
        // RIGHT NOW, not the destination computed back when the turn began —
        // a monster killed earlier in this same loop no longer blocks the
        // ones behind it. The aim itself (where it's headed) is locked in
        // from the telegraph; only how far it actually gets is live.
        monster.position = this.resolveMoveDestination(monster, intent);
      } else {
        const skill = this.registry.skills[intent.skillId];
        if (!skill) continue;
        const dirVec = MOVE_VECTORS[intent.direction];
        for (const effect of skill.effects) {
          const target = this.resolveTarget(monster.position, dirVec, skill.range, effect.target, false, effect.type === 'heal');
          this.applyEffect(effect, target, monster);
        }
      }
    }

    // Poison mist: flat, shield-bypassing damage to any living unit — player
    // or monster, deliberately both directions — still standing on a '*'
    // tile once this turn's moves/attacks have resolved. Checked here (after
    // intents move units, before the dead are swept) so a monster whose
    // telegraphed move just carried it onto the mist takes the tick the same
    // turn, same as a player who ended their turn standing on it.
    this.applyPoisonMistDamage();

    // Base HP only ever changes above (a monster's stored intent resolving),
    // never during the player's own turn — so undo/pushHistory doesn't need
    // to snapshot it; clearing history here is enough.
    this.history = [];
    this.turnNumber += 1;
    this.monsters = this.monsters.filter((m) => m.hp > 0);

    if (this.baseHp <= 0) {
      // Freeze right here on the position that killed the base — the board
      // isn't touched until the player calls confirmOutcome(), so what they
      // see is the actual losing turn, not an already-reset wave 1. Deliberately
      // NOT clearing currentIntents: the frozen screen should still show which
      // monsters' telegraphed attacks just landed, so the player can review
      // exactly what killed them instead of staring at a blank board.
      this.pendingOutcome = 'defeat';
      return;
    }

    this.turnsLeftInWave -= 1;

    const isLastWave = this.waveIndex === this.map.waves.length - 1;
    if (isLastWave && (this.monsters.length === 0 || this.turnsLeftInWave <= 0)) {
      // Victory: outlasted the final assault's clock, or cleared the board
      // after the last wave arrived. The base is alive (checked above).
      this.pendingOutcome = 'victory';
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

  /**
   * Applies whatever endTurn() froze (defeat or victory) and moves the board
   * past it — a defeat or a win both restart the level from wave 1. Player-
   * called, on their own timing, so the losing or winning position stays on
   * screen until they've actually seen it, instead of being silently swapped
   * out underneath the result banner.
   */
  confirmOutcome(): void {
    if (!this.pendingOutcome) return;
    this.resetLevel();
  }

  /** Full restart to wave 1 — the only reset this game has, whether triggered by a loss, a win, or the player bailing out manually mid-run. */
  resetLevel(): void {
    this.pendingOutcome = null;
    this.resetRun();
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
    // (only a defeat / manual reset restores it, in resetRun below).
    this.startFreshTurn();
  }

  /** Refills every living unit's own AP, recomputes intents, and captures the new turn-start snapshot for resetTurn(). */
  private startFreshTurn(): void {
    for (const p of this.players) {
      if (p.hp > 0) p.ap = p.maxAp;
    }
    this.currentIntents = this.computeIntents();
    this.captureTurnStart();
  }

  /** Reset players (full HP), base HP, and respawn wave 1's monsters (fresh HP) — the only reset state this game has. */
  private resetRun(): void {
    this.waveIndex = 0;
    this.turnNumber = 1;
    this.pendingOutcome = null;
    this.history = [];
    this.pendingEvents = [];
    this.baseHp = this.baseMaxHp;
    this.turnsLeftInWave = this.map.waves[0].turns;

    this.players = this.squadCharacterIds.map((charId, i) => {
      const def = this.registry.characters[charId];
      const start = this.map.playerStarts[i];
      return {
        characterId: charId,
        position: { ...start },
        hp: def.maxHp,
        maxHp: def.maxHp,
        shield: 0,
        ap: def.actionPoints,
        maxAp: def.actionPoints,
        skillIds: def.skillIds,
      };
    });

    this.monsters = this.spawnWave(0);
    this.currentIntents = this.computeIntents();
    this.captureTurnStart();
  }

  /**
   * `avoidMonsters` lets a reinforcement wave steer clear of survivors still
   * on the board; a fresh wave spawn (resetRun) passes none, since those
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
        this.dealDamageWithEvent(occupant, this.ambushDamageFor(def));
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
        if (!aim) return { kind: 'move', instanceId: m.instanceId, to: { ...m.position }, aim: null };
        if (rule.action.kind === 'moveAway') {
          const dir = oppositeDir(stepDirectionToward(m.position, aim));
          const to = add(m.position, MOVE_VECTORS[dir]);
          const dest = this.isWalkable(to) && !this.isOccupied(to) ? to : { ...m.position };
          return { kind: 'move', instanceId: m.instanceId, to: dest, aim, away: true };
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
        return { kind: 'move', instanceId: m.instanceId, to: this.multiStepToward(m.position, aim, def.moveRange), aim };
      }
    }
    // validateMonsterDef guarantees a trailing unconditional 'always' rule.
    throw new Error(`monster ${m.instanceId}: no aiRule matched (missing fallback?)`);
  }

  /**
   * Re-resolves a move intent's actual destination against the board AS IT
   * IS at resolution time (see endTurn()) — the telegraphed `aim`/`away` are
   * fixed, but a monster killed earlier in the same endTurn no longer blocks
   * the tile behind it, so whoever's left can now walk into the gap.
   */
  private resolveMoveDestination(m: MonsterUnitState, intent: Extract<MonsterIntent, { kind: 'move' }>): Vec2 {
    if (!intent.aim) return { ...m.position };
    if (intent.away) {
      const dir = oppositeDir(stepDirectionToward(m.position, intent.aim));
      const to = add(m.position, MOVE_VECTORS[dir]);
      return this.isWalkable(to) && !this.isOccupied(to) ? to : { ...m.position };
    }
    const def = this.registry.monsters[m.monsterId];
    return this.multiStepToward(m.position, intent.aim, def.moveRange);
  }

  /**
   * Aggregates every currently-telegraphed skill intent's damage by target,
   * resolved against the board RIGHT NOW — so a player repositioning mid-turn
   * to dodge a monster's line of fire sees the preview total update live,
   * same spirit as the intent arrows themselves (full information, no hidden math).
   */
  getAttackPreviews(): AttackPreview[] {
    const previews: AttackPreview[] = [];
    const addPreview = (target: CombatTarget, amount: number) => {
      if (amount <= 0) return;
      const existing = previews.find((p) => sameCombatTarget(p.target, target));
      if (existing) existing.damage += amount;
      else previews.push({ target, damage: amount });
    };

    // A shield fully blocks one hit rather than reducing its amount (see
    // dealDamage). To preview the REAL total — not a number that lies about
    // what a shielded hero is actually about to lose — walk each target's
    // shield charges down in the same order intents will resolve in, same as
    // endTurn() does for real: the first N hits (N = current shield) land as
    // 0, everything after that lands at full damage.
    const shieldRemaining = new Map<string, number>();
    const targetKey = (t: CombatTarget): string =>
      t.kind === 'base' ? 'base' : t.kind === 'player' ? `player:${t.unitIndex}` : `monster:${t.instanceId}`;

    for (const intent of this.currentIntents) {
      if (intent.kind !== 'skill') continue;
      const monster = this.monsters.find((m) => m.instanceId === intent.instanceId && m.hp > 0);
      if (!monster) continue;
      const skill = this.registry.skills[intent.skillId];
      if (!skill) continue;
      const dirVec = MOVE_VECTORS[intent.direction];
      for (const effect of skill.effects) {
        if (effect.type !== 'damage') continue;
        const target = this.resolveTarget(monster.position, dirVec, skill.range, effect.target, false);
        if (!target || target.kind === 'self') continue; // a monster hitting itself isn't a player-facing threat preview
        if (target.kind === 'base') {
          addPreview({ kind: 'base' }, effect.amount); // push/shield/heal are no-ops on the base — nothing to block
          continue;
        }
        const previewTarget: CombatTarget =
          target.kind === 'player'
            ? { kind: 'player', unitIndex: this.players.indexOf(target.unit) }
            : { kind: 'monster', instanceId: target.unit.instanceId };
        const key = targetKey(previewTarget);
        if (!shieldRemaining.has(key)) shieldRemaining.set(key, target.unit.shield);
        const remaining = shieldRemaining.get(key)!;
        if (remaining > 0) {
          shieldRemaining.set(key, remaining - 1); // this hit is fully blocked, consumes a charge
          continue;
        }
        addPreview(previewTarget, effect.amount);
      }
    }
    return previews;
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
      const dx = target.x - pos.x;
      const dy = target.y - pos.y;
      if (dx === 0 && dy === 0) break;

      const primaryDir = stepDirectionToward(pos, target);
      const primaryNext = add(pos, MOVE_VECTORS[primaryDir]);
      if (this.isWalkable(primaryNext) && !this.isOccupied(primaryNext)) {
        pos = primaryNext;
        continue;
      }

      // The greedy axis is blocked (wall/hazard/unit) — try the other axis
      // before giving up on this step. Without this fallback, a hazard tile
      // sitting exactly on the tied/near-tied diagonal permanently walls a
      // monster off with zero progress every turn, even though a clear path
      // exists one axis over.
      const horizontal = primaryDir === 'left' || primaryDir === 'right';
      const secondaryDir: CardinalDir | null = horizontal
        ? dy === 0
          ? null
          : dy > 0
            ? 'down'
            : 'up'
        : dx === 0
          ? null
          : dx > 0
            ? 'right'
            : 'left';
      if (secondaryDir) {
        const secondaryNext = add(pos, MOVE_VECTORS[secondaryDir]);
        if (this.isWalkable(secondaryNext) && !this.isOccupied(secondaryNext)) {
          pos = secondaryNext;
          continue;
        }
      }
      break; // both axes blocked (or no secondary axis toward the target) — genuinely stuck
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

  /**
   * `targetsAllies` flips WHICH side's units this ray can land on — false
   * (damage/push/shield's usual case) means a player's shot only ever finds
   * a monster and a monster's shot only ever finds a player, same as before;
   * true (heal) means a player's cast only ever finds a fellow player and a
   * monster's cast only ever finds a fellow monster. applyEffect()'s heal
   * case has no ally/enemy check of its own — this is the one place that
   * decides who a heal can legally land on, so a healer can never be aimed
   * at a monster (see computeTargetable() in BattleScene for the matching UI
   * restriction that keeps the player from even trying).
   */
  private resolveTarget(
    casterPos: Vec2,
    dir: Vec2,
    range: number,
    mode: TargetMode,
    casterIsPlayer: boolean,
    targetsAllies = false,
  ): ResolvedTarget | null {
    if (mode === 'self') return { kind: 'self' };

    const searchPlayers = targetsAllies ? casterIsPlayer : !casterIsPlayer;
    for (let step = 1; step <= range; step++) {
      const p = add(casterPos, { x: dir.x * step, y: dir.y * step });
      // A monster's shot reaching its own base tile hits the base; a
      // player's shot never targets the base — it just stops there instead.
      // A heal ray never targets the base either (nothing to apply there).
      if (this.isBaseTile(p)) {
        return casterIsPlayer || targetsAllies ? null : { kind: 'base' };
      }
      // A shot's line of sight is only blocked by real walls — it flies over hazard AND poison-mist tiles.
      if (this.isWall(p)) return null;
      if (searchPlayers) {
        const pl = this.players.find((x) => x.hp > 0 && equalsVec2(x.position, p));
        if (pl) return { kind: 'player', unit: pl };
      } else {
        const m = this.monsters.find((x) => x.hp > 0 && equalsVec2(x.position, p));
        if (m) return { kind: 'monster', unit: m };
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
        const before = this.baseHp;
        this.baseHp = Math.max(0, this.baseHp - effect.amount);
        this.pendingEvents.push({ kind: 'damage', target: { kind: 'base' }, amount: before - this.baseHp, blocked: false });
      }
      return;
    }
    const unit = target.kind === 'self' ? caster : target.unit;
    const combatTarget = this.combatTargetFor(unit);

    switch (effect.type) {
      case 'damage':
        this.dealDamageWithEvent(unit, effect.amount);
        break;
      case 'push': {
        const from = { ...unit.position };
        this.pushUnit(unit, caster.position, effect.amount);
        const distance = Math.abs(unit.position.x - from.x) + Math.abs(unit.position.y - from.y);
        if (distance > 0) this.pendingEvents.push({ kind: 'push', target: combatTarget, distance });
        break;
      }
      case 'shield':
        unit.shield += effect.amount;
        this.pendingEvents.push({ kind: 'shield', target: combatTarget, amount: effect.amount });
        break;
      case 'heal': {
        const before = unit.hp;
        unit.hp = Math.min(unit.maxHp, unit.hp + effect.amount);
        if (unit.hp > before) this.pendingEvents.push({ kind: 'heal', target: combatTarget, amount: unit.hp - before });
        break;
      }
    }
  }

  /** Maps a live player/monster object to the target shape TurnEvent/AttackPreview use — instanceId for monsters, array index for players. */
  private combatTargetFor(unit: PlayerUnitState | MonsterUnitState): CombatTarget {
    if ('instanceId' in unit) return { kind: 'monster', instanceId: unit.instanceId };
    return { kind: 'player', unitIndex: this.players.indexOf(unit) };
  }

  /** Shield fully blocks one hit (consumes one charge) rather than absorbing a damage amount. */
  private dealDamage(unit: { hp: number; shield: number }, amount: number): void {
    if (unit.shield > 0) {
      unit.shield -= 1;
      return;
    }
    unit.hp = Math.max(0, unit.hp - amount);
  }

  /** Same as dealDamage, but also records the real outcome (HP actually lost, whether a shield ate it) for getLastEvents(). */
  private dealDamageWithEvent(unit: PlayerUnitState | MonsterUnitState, amount: number): void {
    const hpBefore = unit.hp;
    const shieldBefore = unit.shield;
    this.dealDamage(unit, amount);
    const blocked = unit.shield < shieldBefore;
    this.pendingEvents.push({ kind: 'damage', target: this.combatTargetFor(unit), amount: hpBefore - unit.hp, blocked });
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
        return; // fell in — the push stops here regardless of remaining distance
      }
      if (!this.isWalkable(next) || this.isOccupied(next)) {
        // Cut short by a wall or another body before covering the full
        // distance — land as a collision instead of a silent, feedback-less
        // no-op (a shove that goes nowhere still used the caster's AP).
        this.dealDamageWithEvent(unit, PUSH_COLLISION_DAMAGE);
        const blocker = this.unitAt(next);
        if (blocker) this.dealDamageWithEvent(blocker, PUSH_COLLISION_DAMAGE);
        return;
      }
      unit.position = next;
    }
  }

  /**
   * Poison mist: every living unit — player AND monster, deliberately both
   * directions, unlike the abyss hazard which only kills monsters — standing
   * on a '*' tile takes a flat tick. Bypasses shield entirely (a shield
   * charge blocks a hit, not a terrain effect) and goes through the same
   * dealDamage-adjacent path as everything else so it lands in getLastEvents()
   * for the UI's floating-number feedback. A unit ticked to 0 HP here dies
   * through the ordinary path: monsters are swept by the hp>0 filter right
   * after this runs, players just sit at hp<=0 same as any other death.
   */
  private applyPoisonMistDamage(): void {
    for (const p of this.players) {
      if (p.hp > 0 && this.isPoisonMist(p.position)) this.applyUnblockableDamage(p, POISON_MIST_DAMAGE);
    }
    for (const m of this.monsters) {
      if (m.hp > 0 && this.isPoisonMist(m.position)) this.applyUnblockableDamage(m, POISON_MIST_DAMAGE);
    }
  }

  /** Like dealDamageWithEvent, but a shield charge does NOT block it — used by poison mist, which is a terrain tick, not a combat hit. */
  private applyUnblockableDamage(unit: PlayerUnitState | MonsterUnitState, amount: number): void {
    const hpBefore = unit.hp;
    unit.hp = Math.max(0, unit.hp - amount);
    this.pendingEvents.push({ kind: 'damage', target: this.combatTargetFor(unit), amount: hpBefore - unit.hp, blocked: false });
  }

  /** A monster shoved into a hazard tile doesn't survive; a player character takes a flat hit instead (shield can still block it). */
  private applyHazardDamage(unit: PlayerUnitState | MonsterUnitState): void {
    if ('instanceId' in unit) {
      const hpBefore = unit.hp;
      unit.hp = 0;
      this.pendingEvents.push({ kind: 'damage', target: this.combatTargetFor(unit), amount: hpBefore, blocked: false });
    } else {
      this.dealDamageWithEvent(unit, HAZARD_DAMAGE);
    }
  }

  // ---------------------------------------------------------------------
  // Grid helpers
  // ---------------------------------------------------------------------

  /** Normal movement: plain floor AND poison mist are walkable — hazard and base tiles block it same as a wall. */
  private isWalkable(p: Vec2): boolean {
    const row = this.map.grid[p.y];
    if (row === undefined || p.x < 0 || p.x >= row.length) return false;
    return row[p.x] === ' ' || row[p.x] === '*';
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

  private isPoisonMist(p: Vec2): boolean {
    const row = this.map.grid[p.y];
    if (row === undefined || p.x < 0 || p.x >= row.length) return false;
    return row[p.x] === '*';
  }

  private isOccupied(p: Vec2): boolean {
    return (
      this.players.some((u) => u.hp > 0 && equalsVec2(u.position, p)) ||
      this.monsters.some((u) => u.hp > 0 && equalsVec2(u.position, p))
    );
  }

  /** The live player or monster standing at `p`, if any — null for an empty or wall tile. */
  private unitAt(p: Vec2): PlayerUnitState | MonsterUnitState | null {
    return (
      this.players.find((u) => u.hp > 0 && equalsVec2(u.position, p)) ??
      this.monsters.find((u) => u.hp > 0 && equalsVec2(u.position, p)) ??
      null
    );
  }

  private pushHistory(): void {
    this.history.push({
      players: this.players.map((p) => ({ ...p, position: { ...p.position } })),
      monsters: this.monsters.map((m) => ({ ...m, position: { ...m.position } })),
    });
  }
}
