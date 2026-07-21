import {
  MOVE_VECTORS,
  add,
  equalsVec2,
  manhattan,
  oppositeDir,
  stepDirectionToward,
} from '../geometry';
import type { CardinalDir, Vec2 } from '../geometry';
import type {
  AiCondition,
  AiRule,
  AiTarget,
  EffectPrimitive,
  EffectType,
  MapDef,
  MonsterDef,
  SpawnScheduleEntry,
  TargetMode,
} from '../content/types';
import type {
  ActionResult,
  AttackPreview,
  BattleSnapshot,
  CombatTarget,
  ContentRegistry,
  IntentTile,
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

/** ITB emergence rule (A3): a player unit standing on a tile when its telegraphed spawn resolves blocks the monster entirely and takes this flat damage instead. */
const EMERGENCE_BLOCK_DAMAGE = 1;

/**
 * Ceiling on how many monsters the population feedback loop may telegraph in
 * a SINGLE turn, however far below targetPopulation the board has fallen. A
 * board wiped from 5 to 0 refills over several turns rather than dumping five
 * monsters back on at once — the player's good turn still buys real breathing
 * room, it just doesn't buy a permanently empty grid.
 */
const PER_TURN_SPAWN_CAP = 2;

/**
 * A unit can never hold more than this many shield charges at once — each
 * charge blocks one full hit (see dealDamage), so an uncapped stack would let
 * a hero pre-cast themselves into a turret that no amount of monsters can
 * ever chew through. Heavy Shield's single cast (+2) lands exactly at the
 * cap; stacking casts beyond it are wasted AP, and the shield event reports
 * only the charges actually gained.
 */
const SHIELD_STACK_CAP = 2;

type ResolvedTarget =
  | { kind: 'self' }
  | { kind: 'player'; unit: PlayerUnitState }
  | { kind: 'monster'; unit: MonsterUnitState }
  /** `at` is the base tile the effect landed on — applyEffect ignores it (base HP is one shared pool), but intent telegraphs need the exact tile to mark on the board. */
  | { kind: 'base'; at: Vec2 };

/** Which side(s) a mixed-crowd effect can land on. 'any' = ITB friendly fire (whatever unit occupies the tile); 'allies'/'enemies' = the caster's own / opposing side. */
type SideFilter = 'allies' | 'enemies' | 'any';

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
 *   2. Player acts. ITB-style per-unit economy: each unit may first MOVE
 *      (moveUnit() — one committed move of up to moveRange BFS tiles), then
 *      take ONE action (useSkill() or rest()), in that fixed order; acting
 *      locks the unit for the rest of the turn. The whole turn can be wound
 *      back once per level via resetTurn() (there is no per-step undo).
 *   3. endTurn() resolves the turn's stored intents (not recomputed),
 *      checks wipe/wave-clear/victory, and computes the next turn's intents.
 */
export class BattleEngine {
  private map: MapDef;
  private registry: ContentRegistry;
  private squadCharacterIds: string[];

  private players: PlayerUnitState[] = [];
  private monsters: MonsterUnitState[] = [];
  private turnNumber = 1;
  /** Set by endTurn() the instant a loss/win happens; the board is frozen on that turn's result until confirmOutcome() is called. */
  private pendingOutcome: RunOutcome | null = null;

  /** All 'B' tiles on the map — computed once, the grid never changes at runtime. */
  private baseTiles: Vec2[] = [];
  private baseMaxHp = 0;
  private baseHp = 0;

  private currentIntents: MonsterIntent[] = [];
  /** What the most recent moveUnit/useSkill/rest/endTurn call actually did — see getLastEvents(). */
  private pendingEvents: TurnEvent[] = [];
  /** Snapshot at the moment a fresh player turn begins — restored wholesale by resetTurn(). */
  private turnStartSnapshot: HistoryEntry | null = null;
  /** ITB rule: ONE full-turn reset per level run — set by resetTurn(), cleared only by resetRun(). */
  private resetTurnUsed = false;
  private monsterSpawnCounter = 0;

  // --- Dynamic population feedback loop (see resolvePopulationReinforcement) ---
  /** Candidate emergence tiles, walked in order with wraparound. Fixed for the engine's lifetime. */
  private spawnPool: Vec2[] = [];
  /** Monster ids the loop cycles through, in order with wraparound. Fixed for the engine's lifetime. */
  private reinforcementRoster: string[] = [];
  private targetPopulation = 0;
  private totalSpawnBudget = 0;
  /**
   * Reinforcements this loop has telegraphed, kept ENGINE-side rather than
   * appended to `this.map.spawnSchedule`: `map` is the shared object owned by
   * the content registry, so mutating it would leak this run's reinforcements
   * into every other battle on the same map (and survive resetRun()).
   */
  private dynamicSpawns: SpawnScheduleEntry[] = [];
  /** Next index into spawnPool / reinforcementRoster — the whole reason the loop is deterministic. Reset by resetRun(). */
  private spawnPoolCursor = 0;
  private rosterCursor = 0;
  /** Counts against totalSpawnBudget. Incremented when a reinforcement is TELEGRAPHED, not when it resolves. */
  private dynamicSpawnsUsed = 0;

  /**
   * `opts.baseHpOverride`, when given, replaces the map's own `baseHp` as this
   * battle's base HP pool — the campaign layer carries a base's damage across
   * missions, so the map file's number is the *default* starting pool, not an
   * invariant. It changes only what `baseMaxHp` is initialised to: resetRun()
   * still resets `baseHp` all the way back to `baseMaxHp`, so the reset
   * semantics WITHIN a single battle are completely unchanged (a mid-battle
   * loss/reset restores the HP this battle actually started with, not the
   * map's pristine value). Omitting `opts` reproduces the old behavior
   * exactly, so every existing 3-argument caller is unaffected.
   */
  constructor(
    map: MapDef,
    squadCharacterIds: string[],
    registry: ContentRegistry,
    opts?: { baseHpOverride?: number },
  ) {
    this.map = map;
    this.registry = registry;
    this.squadCharacterIds = squadCharacterIds;
    this.baseTiles = this.computeBaseTiles(map);
    this.baseMaxHp = opts?.baseHpOverride ?? map.baseHp;
    this.spawnPool = (map.spawnPool ?? this.derivedSpawnPool(map)).map((t) => ({ ...t }));
    this.reinforcementRoster = this.derivedReinforcementRoster(map);
    // Default 0 = loop inert. A map opts in by declaring these two numbers;
    // see MapDef.targetPopulation for why the default is off rather than
    // derived from initialMonsters.
    this.targetPopulation = map.targetPopulation ?? 0;
    this.totalSpawnBudget = map.totalSpawnBudget ?? 0;
    this.resetRun();
  }

  /**
   * Where reinforcements emerge when the map didn't declare a `spawnPool`:
   * the tiles the author already chose for this map's scripted emergences,
   * deduped, in declaration order. Reusing them is deliberate — those tiles
   * are already validated as walkable, already sit where the author wanted
   * pressure to come from, and are already the tiles the player has learned
   * to watch. A map with no spawnSchedule (the lesson levels) yields an empty
   * pool and therefore never reinforces.
   */
  private derivedSpawnPool(map: MapDef): Vec2[] {
    const seen = new Set<string>();
    const pool: Vec2[] = [];
    for (const entry of map.spawnSchedule) {
      const key = `${entry.tile.x},${entry.tile.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push(entry.tile);
    }
    return pool;
  }

  /**
   * Which monster types the population loop cycles through. `spawnPool` is a
   * list of TILES only (by design — the pool answers "where", not "what"), so
   * the roster is derived separately: the monsterIds the author already
   * scheduled as reinforcements for this map, falling back to the ids on the
   * opening board. Deduped and order-preserving, so the cycle is deterministic.
   */
  private derivedReinforcementRoster(map: MapDef): string[] {
    const dedupe = (ids: string[]): string[] => [...new Set(ids)];
    const scheduled = dedupe(map.spawnSchedule.map((e) => e.monsterId));
    if (scheduled.length > 0) return scheduled;
    return dedupe(map.initialMonsters.map((s) => s.monsterId));
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
      turnNumber: this.turnNumber,
      totalTurns: this.map.totalTurns,
      outcome: this.pendingOutcome,
      baseHp: this.baseHp,
      baseMaxHp: this.baseMaxHp,
      baseTiles: this.baseTiles.map((t) => ({ ...t })),
      pendingSpawnTiles: this.pendingSpawnTiles(),
      resetTurnUsed: this.resetTurnUsed,
    };
  }

  /**
   * Tiles telegraphed to spawn a monster at the end of THIS turn (A3
   * emergence markers) — for UI warning glyphs. Covers BOTH sources: the
   * author's fixed `spawnSchedule` and the dynamic population loop's
   * reinforcements. The player must be able to see every incoming monster;
   * a reinforcement that emerged without a warning glyph would be a hidden
   * roll in a zero-luck game.
   */
  private pendingSpawnTiles(): Vec2[] {
    return this.allSpawnEntries()
      .filter((entry) => entry.telegraphTurn === this.turnNumber)
      .map((entry) => ({ ...entry.tile }));
  }

  /** Every emergence entry in play: the map's authored script plus this run's dynamic reinforcements. */
  private allSpawnEntries(): SpawnScheduleEntry[] {
    return [...this.map.spawnSchedule, ...this.dynamicSpawns];
  }

  getIntents(): MonsterIntent[] {
    // Skill intents' strike tiles are LIVE (ITB semantics): direction/order
    // were locked at turn start, but the tiles are re-resolved against the
    // board AS IT STANDS on every call — a player stepping into the line of
    // fire sees the red tile snap onto them instantly, and one stepping out
    // sees it stay with the attack's shape. resetTurn() needs no special
    // handling: it restores the board, so the next call resolves right back
    // to the turn-start picture. The freshly-built arrays double as the
    // defensive copy (callers can't corrupt engine state through them).
    return this.currentIntents.map((i) => {
      if (i.kind !== 'skill') return { ...i, to: { ...i.to }, aim: i.aim ? { ...i.aim } : i.aim };
      const monster = this.monsters.find((m) => m.instanceId === i.instanceId && m.hp > 0);
      return { ...i, tiles: monster ? this.skillIntentTiles(monster, i.skillId, i.direction) : [] };
    });
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

  /**
   * Commits a unit's ENTIRE move phase in one call: `to` is the destination
   * tile, validated as reachable within the unit's moveRange by BFS over
   * walkable, unoccupied tiles (the same reachability the UI highlights).
   * ITB ordering rules: a unit that has already moved can't move again this
   * turn, and a unit that has already ACTED can't move at all — movement
   * strictly precedes the action. There are no opportunity attacks: the
   * old attack-then-retreat exploit is structurally dead now that acting
   * ends the unit's turn, and punishing repositioning would punish the
   * "read the telegraph, then walk out of it" core loop itself.
   */
  moveUnit(unitIndex: number, to: Vec2): ActionResult {
    if (this.pendingOutcome) return { ok: false, reason: 'outcome-pending' };
    const unit = this.players[unitIndex];
    if (!unit || unit.hp <= 0) return { ok: false, reason: 'invalid-unit' };
    if (unit.acted) return { ok: false, reason: 'already-acted' };
    if (unit.moved) return { ok: false, reason: 'already-moved' };
    if (!this.isReachable(unit.position, to, unit.moveRange)) return { ok: false, reason: 'unreachable' };

    this.pendingEvents = [];
    unit.position = { ...to };
    unit.moved = true;
    return { ok: true };
  }

  /**
   * True when `to` can be reached from `from` in at most `budget` orthogonal
   * steps over walkable, unoccupied tiles — the engine-side twin of the UI's
   * reachable-tile highlight (BattleScene.computeReachable). Standing still
   * is not a "move": the unit's own tile is deliberately not reachable.
   */
  private isReachable(from: Vec2, to: Vec2, budget: number): boolean {
    if (equalsVec2(from, to)) return false;
    if (!this.isWalkable(to) || this.isOccupied(to)) return false;
    const queue: Array<{ p: Vec2; d: number }> = [{ p: from, d: 0 }];
    const seen = new Set<string>([`${from.x},${from.y}`]);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur.d >= budget) continue;
      for (const dir of Object.keys(MOVE_VECTORS) as CardinalDir[]) {
        const next = add(cur.p, MOVE_VECTORS[dir]);
        const key = `${next.x},${next.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!this.isWalkable(next) || this.isOccupied(next)) continue;
        if (equalsVec2(next, to)) return true;
        queue.push({ p: next, d: cur.d + 1 });
      }
    }
    return false;
  }

  useSkill(unitIndex: number, skillId: string, dir: CardinalDir): ActionResult {
    if (this.pendingOutcome) return { ok: false, reason: 'outcome-pending' };
    const unit = this.players[unitIndex];
    if (!unit || unit.hp <= 0) return { ok: false, reason: 'invalid-unit' };
    // A character's Ultimate is deliberately NOT in skillIds (see CharacterDef.
    // ultimateSkillId doc comment) — it's cast through this same method, so it
    // needs its own membership check here rather than falling through to the
    // 'unknown-skill' rejection every other skillId gets.
    const charDef = this.registry.characters[unit.characterId];
    const isUltimate = !!charDef && charDef.ultimateSkillId === skillId;
    if (!unit.skillIds.includes(skillId) && !isUltimate) return { ok: false, reason: 'unknown-skill' };
    if (isUltimate && unit.ultimateUsed) return { ok: false, reason: 'ultimate-already-used' };
    const skill = this.registry.skills[skillId];
    if (!skill) return { ok: false, reason: 'unknown-skill' };
    // The one-action-per-turn gate: having MOVED is fine (move precedes the
    // action), having ACTED is not — a skill IS the unit's single action.
    if (unit.acted) return { ok: false, reason: 'already-acted' };

    this.pendingEvents = [];
    const dirVec = MOVE_VECTORS[dir];
    for (const effect of skill.effects) {
      // `dir` is required by this method's signature for every skill, even
      // ones whose target mode doesn't need a direction (aoeCross/aoeRing/
      // allEnemies/allUnits/allAllies) — resolveTargets() simply ignores
      // dirVec for those modes. Keeping useSkill's signature unchanged
      // (rather than making dir optional) is the smallest change that
      // supports the new modes; a caller casting a directionless skill can
      // pass any CardinalDir as a meaningless-but-format-valid placeholder.
      const targets = this.resolveTargets(unit, dirVec, skill.range, effect.target, this.sideFilterForEffect(effect.type));
      for (const target of targets) this.applyEffect(effect, target, unit);
    }
    unit.acted = true;
    if (isUltimate) unit.ultimateUsed = true;
    return { ok: true };
  }

  /**
   * The built-in "rest" action (ITB's repair): self-heal 1 (capped at maxHp),
   * available to every unit with no skill definition behind it. Same gate as
   * useSkill — it IS the unit's one action for the turn. A rest at full HP
   * still spends the action and reports a 0-amount heal event, so the UI can
   * show an honest "no effect" instead of a silently dropped click.
   */
  rest(unitIndex: number): ActionResult {
    if (this.pendingOutcome) return { ok: false, reason: 'outcome-pending' };
    const unit = this.players[unitIndex];
    if (!unit || unit.hp <= 0) return { ok: false, reason: 'invalid-unit' };
    if (unit.acted) return { ok: false, reason: 'already-acted' };

    this.pendingEvents = [];
    const before = unit.hp;
    unit.hp = Math.min(unit.maxHp, unit.hp + 1);
    this.pendingEvents.push({ kind: 'heal', target: this.combatTargetFor(unit), amount: unit.hp - before });
    unit.acted = true;
    return { ok: true };
  }

  /**
   * Reverts every action taken so far THIS turn back to the snapshot captured
   * the instant the turn began (see captureTurnStart()) — usable ONCE per
   * level run (ITB's one-reset-per-battle rule; resetLevel() is what restores
   * it). There is no per-step undo. Base HP never changes during the player's
   * own turn (only a resolved monster intent on endTurn can touch it), so it
   * needn't be part of the snapshot.
   */
  resetTurn(): void {
    if (this.pendingOutcome || !this.turnStartSnapshot || this.resetTurnUsed) return;
    this.resetTurnUsed = true;
    this.players = this.turnStartSnapshot.players.map((p) => ({ ...p, position: { ...p.position } }));
    this.monsters = this.turnStartSnapshot.monsters.map((m) => ({ ...m, position: { ...m.position } }));
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
    // Intents resolve in ARRAY ORDER — the same stable spawn order
    // computeIntents() built them in. This is a telegraphed promise: each
    // skill intent's `order` field (shown on the board as ①②③) is its rank
    // in this very loop, so reordering anything here would break the UI's
    // word to the player.
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
        // The skill resolves its targets against the board AS IT IS NOW —
        // the same live resolution getIntents()' tiles show (only direction
        // and order were locked at turn start): a hero who stepped out of a
        // red tile is safe, one who stepped INTO the line of fire gets hit,
        // and the red tiles on screen at end-turn time are exactly what
        // lands here.
        const skill = this.registry.skills[intent.skillId];
        if (!skill) continue;
        const dirVec = MOVE_VECTORS[intent.direction];
        for (const effect of skill.effects) {
          const targets = this.resolveTargets(monster, dirVec, skill.range, effect.target, this.sideFilterForEffect(effect.type));
          for (const target of targets) this.applyEffect(effect, target, monster);
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

    // Capture the turn that's ending BEFORE incrementing — spawnSchedule
    // entries telegraphed for this turn (shown to the player all turn) now
    // resolve: a living player standing on the tile blocks the spawn and
    // eats EMERGENCE_BLOCK_DAMAGE; otherwise the monster appears.
    const endingTurn = this.turnNumber;
    this.turnNumber += 1;
    this.monsters = this.monsters.filter((m) => m.hp > 0);
    this.resolveScheduledSpawns(endingTurn);
    // Population feedback runs LAST, on the settled board: after the sweep and
    // after this turn's emergences have landed, so it counts the monsters that
    // genuinely survived into the next turn and never double-counts one it
    // telegraphed a turn ago. It telegraphs for `turnNumber` (already
    // incremented above) — i.e. the turn about to start, resolving one turn
    // from now. See resolvePopulationReinforcement().
    this.resolvePopulationReinforcement();

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

    if (this.players.every((p) => p.hp <= 0)) {
      // Total party wipe is a loss in its own right, not a spectator mode:
      // without this, a dead squad could idle out the mission clock and still
      // "win" any level whose monsters only hunt players. Same freeze-then-
      // confirmOutcome() flow as the base-death branch above — the wiping
      // turn stays on screen, intents included, until the player confirms.
      this.pendingOutcome = 'defeat';
      return;
    }

    if (this.turnNumber > this.map.totalTurns) {
      // Victory (A4): survived the mission's fixed turn count with the base
      // and squad alive — killing every monster was never required, matching
      // ITB ("the grid doesn't zero out") rather than a kill-clear condition.
      this.pendingOutcome = 'victory';
      this.currentIntents = [];
    } else {
      // Continue: every turn is a fresh round regardless — each living
      // unit's moved/acted flags reset here.
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

  /** Resets every living unit's moved/acted flags, recomputes intents, and captures the new turn-start snapshot for resetTurn(). */
  private startFreshTurn(): void {
    for (const p of this.players) {
      if (p.hp > 0) {
        p.moved = false;
        p.acted = false;
      }
    }
    this.currentIntents = this.computeIntents();
    this.captureTurnStart();
  }

  /** Reset players (full HP), base HP, and respawn the map's initial monsters (fresh HP) — the only reset state this game has. */
  private resetRun(): void {
    this.turnNumber = 1;
    this.pendingOutcome = null;
    this.pendingEvents = [];
    // The per-level turn-reset budget comes back with every full level reset,
    // and ONLY with a full level reset (see resetTurn()).
    this.resetTurnUsed = false;
    this.baseHp = this.baseMaxHp;
    // The population loop's entire state is per-RUN, not per-map: a restarted
    // level must replay the identical reinforcement sequence from a clean
    // cursor, otherwise a retry would face a different board than the attempt
    // that just failed — the exact hidden variation zero-luck rules out.
    this.dynamicSpawns = [];
    this.dynamicSpawnsUsed = 0;
    this.spawnPoolCursor = 0;
    this.rosterCursor = 0;

    this.players = this.squadCharacterIds.map((charId, i) => {
      const def = this.registry.characters[charId];
      const start = this.map.playerStarts[i];
      return {
        characterId: charId,
        position: { ...start },
        hp: def.maxHp,
        maxHp: def.maxHp,
        shield: 0,
        moved: false,
        acted: false,
        moveRange: def.moveRange,
        skillIds: def.skillIds,
        // resetRun() is the ONLY reset this game has (constructor, defeat,
        // victory, and manual "reset level" all funnel through it) — this is
        // deliberately the one place that clears ultimateUsed. resetTurn()
        // restores an in-progress turn from a snapshot taken AFTER this
        // constructor already ran, so it never touches this field.
        ultimateUsed: false,
      };
    });

    this.monsters = this.spawnInitialMonsters();
    this.currentIntents = this.computeIntents();
    this.captureTurnStart();
  }

  /** Monsters present at turn 1 with no telegraph — the level's opening board state. */
  private spawnInitialMonsters(): MonsterUnitState[] {
    const claimed = new Set<string>();
    return this.map.initialMonsters.map((spawn) => {
      const def = this.registry.monsters[spawn.monsterId];
      const pos = this.findFreeSpawnTile(spawn.spawn, claimed, []);
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
   * A3: resolve every spawnSchedule entry telegraphed for `endingTurn`. ANY
   * living unit still standing on the tile — player or monster alike, exactly
   * as in ITB — blocks the spawn entirely and takes EMERGENCE_BLOCK_DAMAGE
   * instead: no ambush hit, no "monster still gets in nearby". Shoving an
   * ENEMY onto an emergence tile to plug it (and hurt it) is a core ITB
   * play, so the block deliberately isn't player-only.
   */
  private resolveScheduledSpawns(endingTurn: number): void {
    const due = this.allSpawnEntries().filter((entry) => entry.telegraphTurn === endingTurn);
    for (const entry of due) {
      const blocker =
        this.players.find((p) => p.hp > 0 && equalsVec2(p.position, entry.tile)) ??
        this.monsters.find((m) => m.hp > 0 && equalsVec2(m.position, entry.tile));
      if (blocker) {
        this.dealDamageWithEvent(blocker, EMERGENCE_BLOCK_DAMAGE);
        continue;
      }
      const def = this.registry.monsters[entry.monsterId];
      this.monsterSpawnCounter += 1;
      this.monsters.push({
        instanceId: `${entry.monsterId}#${this.monsterSpawnCounter}`,
        monsterId: entry.monsterId,
        position: { ...entry.tile },
        hp: def.maxHp,
        maxHp: def.maxHp,
        shield: 0,
      });
    }
  }

  /**
   * The ITB population feedback loop, run at the END of every turn once the
   * dead are swept and this turn's due emergences have resolved: if the board
   * has fallen below `targetPopulation`, telegraph reinforcements to close
   * the gap (at most PER_TURN_SPAWN_CAP per turn, and never more than
   * `totalSpawnBudget` over the whole run).
   *
   * Why this exists: with a fixed script alone, "kill everything" was a
   * dominant, permanently stable answer — once the grid was empty nothing
   * could ever threaten the base again, and a 5-turn mission became a
   * formality. Tying the refill rate INVERSELY to the survivor count means
   * clearing the board is the single most expensive thing a player can do
   * with a turn, and the level's pressure is a floor rather than a countdown.
   *
   * Two rules make this fair rather than merely punishing:
   *  - Reinforcements telegraph for the NEXT turn (`turnNumber`, already
   *    incremented by endTurn() before this runs), never the current one. The
   *    player always gets one full turn to see the ⚠ marker and respond —
   *    stand on the tile to deny the spawn, or clear space to fight it.
   *  - Tile and monster choice walk `spawnPool` / `reinforcementRoster` by
   *    cursor with wraparound. There is deliberately no RNG anywhere in this
   *    method: full information and zero luck are load-bearing for this game,
   *    and the same sequence of player actions must always produce the exact
   *    same reinforcements.
   *
   * The budget is spent at TELEGRAPH time, not on a successful emergence — so
   * blocking an emergence tile (the existing EMERGENCE_BLOCK_DAMAGE play) is
   * a genuine, permanent win: the monster is gone AND it never comes back out
   * of the budget.
   */
  private resolvePopulationReinforcement(): void {
    if (this.spawnPool.length === 0 || this.reinforcementRoster.length === 0) return;
    if (this.dynamicSpawnsUsed >= this.totalSpawnBudget) return;
    // `turnNumber` is already the turn we'd telegraph FOR. If that turn is
    // past the mission clock it can never resolve, so telegraphing it would
    // only paint a ⚠ marker on a board the player has already won.
    if (this.turnNumber > this.map.totalTurns) return;

    const living = this.monsters.filter((m) => m.hp > 0).length;
    const deficit = this.targetPopulation - living;
    if (deficit <= 0) return;

    const budgetLeft = this.totalSpawnBudget - this.dynamicSpawnsUsed;
    const count = Math.min(deficit, PER_TURN_SPAWN_CAP, budgetLeft);

    for (let i = 0; i < count; i++) {
      const tile = this.nextReinforcementTile();
      if (!tile) return; // every pool tile is unusable this turn — try again next turn
      const monsterId = this.reinforcementRoster[this.rosterCursor % this.reinforcementRoster.length];
      this.rosterCursor += 1;
      this.dynamicSpawns.push({ telegraphTurn: this.turnNumber, monsterId, tile: { ...tile } });
      this.dynamicSpawnsUsed += 1;
    }
  }

  /**
   * The next usable tile from `spawnPool`, advancing the cursor. Skips tiles
   * already telegraphed for the same turn (two reinforcements can't emerge on
   * one tile — the second would just be "blocked" by the first) and tiles a
   * monster is currently standing on (that spawn would be wasted on the
   * blocker rule). A player standing on a pool tile is NOT skipped: denying
   * the emergence by body-blocking it is exactly the play the block rule is
   * there to reward, and skipping it would quietly route the monster around
   * the player instead. Returns null when no pool tile qualifies.
   */
  private nextReinforcementTile(): Vec2 | null {
    for (let attempt = 0; attempt < this.spawnPool.length; attempt++) {
      const tile = this.spawnPool[this.spawnPoolCursor % this.spawnPool.length];
      this.spawnPoolCursor += 1;
      const alreadyTelegraphed = this.dynamicSpawns.some(
        (e) => e.telegraphTurn === this.turnNumber && equalsVec2(e.tile, tile),
      );
      const monsterOnTile = this.monsters.some((m) => m.hp > 0 && equalsVec2(m.position, tile));
      if (!alreadyTelegraphed && !monsterOnTile) return tile;
    }
    return null;
  }

  /**
   * A spawn tile can end up occupied by a monster already on the board.
   * BFS outward for the nearest free tile instead of stacking on top of it.
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

  /**
   * Called exactly once per fresh player turn (startFreshTurn(), reached via
   * endTurn()'s continue/reinforce branches, and resetRun()) — never mid-turn,
   * since the player's own moveUnit()/useSkill() calls don't touch intents at
   * all. That makes this the correct, single place to age down `tauntTurnsLeft`:
   * ticking it here (once per turn) rather than in computeIntentFor (which
   * this method itself may call once per monster per turn, so ticking there
   * would be turn-count-safe too, but only by coincidence of it being mapped
   * once — here is the one spot proven safe by construction).
   */
  private computeIntents(): MonsterIntent[] {
    const intents = this.monsters
      .filter((m) => m.hp > 0)
      .map((m) => this.computeIntentFor(m));

    // Resolution-order telegraph: endTurn() walks currentIntents in this
    // exact array order, and this array follows this.monsters, whose order
    // is spawn order (spawnWave appends; the hp>0 filter here matches
    // endTurn's own dead-monster skip) — deterministic by construction, so
    // the number shown to the player is a promise, not a guess. Skill
    // intents get their 1-based attack rank here; see the MonsterIntent
    // doc for why only attacks are numbered.
    let attackRank = 1;
    for (const intent of intents) {
      if (intent.kind === 'skill') intent.order = attackRank++;
    }

    for (const m of this.monsters) {
      if (m.hp <= 0 || m.tauntTurnsLeft == null) continue;
      m.tauntTurnsLeft -= 1;
      if (m.tauntTurnsLeft <= 0) {
        m.tauntedBy = undefined;
        m.tauntTurnsLeft = undefined;
      }
    }

    return intents;
  }

  /**
   * Builds a skill intent. The stored `tiles` are only the snapshot from
   * this moment (turn start — computeIntents is the only caller path);
   * getIntents() re-resolves tiles live on every call and never reads this
   * stored array back. `order` starts at 0 and is stamped with the real
   * 1-based attack rank by computeIntents() once the whole turn's intent
   * list exists.
   */
  private makeSkillIntent(m: MonsterUnitState, skillId: string, direction: CardinalDir): MonsterIntent {
    return {
      kind: 'skill',
      instanceId: m.instanceId,
      skillId,
      direction,
      order: 0,
      tiles: this.skillIntentTiles(m, skillId, direction),
    };
  }

  /**
   * The exact tiles a monster's telegraphed skill would strike if the turn
   * resolved right now — the same resolveTargets() walk endTurn() performs,
   * against the CURRENT board (see IntentTile in types.ts for the live
   * telegraph contract; getIntents() calls this on every read). Heal
   * effects are skipped: a monster topping up its allies is not a threat
   * tile the player can stand on or dodge out of. Damage on a tile sums
   * across the skill's damage effects; a tile hit only by non-damage
   * hostile effects (push/taunt/…) still telegraphs, at damage 0.
   */
  private skillIntentTiles(m: MonsterUnitState, skillId: string, direction: CardinalDir): IntentTile[] {
    const skill = this.registry.skills[skillId];
    if (!skill) return [];
    const dirVec = MOVE_VECTORS[direction];
    const tiles: IntentTile[] = [];
    const addTile = (pos: Vec2, damage: number) => {
      const existing = tiles.find((t) => equalsVec2(t.pos, pos));
      if (existing) existing.damage += damage;
      else tiles.push({ pos: { ...pos }, damage });
    };
    for (const effect of skill.effects) {
      if (effect.type === 'heal') continue;
      for (const target of this.resolveTargets(m, dirVec, skill.range, effect.target, this.sideFilterForEffect(effect.type))) {
        if (target.kind === 'self') continue;
        if (target.kind === 'base') {
          addTile(target.at, effect.type === 'damage' ? this.effectAmount(effect, this.baseHp) : 0);
        } else {
          addTile(target.unit.position, effect.type === 'damage' ? this.effectAmount(effect, target.unit.hp) : 0);
        }
      }
    }
    return tiles;
  }

  private computeIntentFor(m: MonsterUnitState): MonsterIntent {
    const def = this.registry.monsters[m.monsterId];

    // Taunt overrides normal AI entirely while active: aim locks onto the
    // taunting player's position and the monster picks attack-vs-move via
    // the same logic the moveToward path below uses, skipping this
    // monster's own aiRules for the turn. If the taunter has died, the
    // taunt is void — clear it and fall through to normal AI instead of
    // aiming at a dead player's now-meaningless last position.
    if (m.tauntedBy != null) {
      const taunter = this.players[m.tauntedBy];
      if (taunter && taunter.hp > 0) {
        const aim = taunter.position;
        const stepDir = stepDirectionToward(m.position, aim);
        const ahead = add(m.position, MOVE_VECTORS[stepDir]);
        const blocker = this.players.find((p) => p.hp > 0 && equalsVec2(p.position, ahead));
        const attackSkillId = blocker ? this.monsterAttackSkillId(def) : undefined;
        if (attackSkillId) {
          return this.makeSkillIntent(m, attackSkillId, stepDir);
        }
        return { kind: 'move', instanceId: m.instanceId, to: this.multiStepToward(m.position, aim, def.moveRange), aim };
      }
      m.tauntedBy = undefined;
      m.tauntTurnsLeft = undefined;
    }

    for (const rule of def.aiRules) {
      if (this.matchesCondition(rule.when, m)) {
        if (rule.action.kind === 'useSkill') {
          const aim = this.aimPointForRule(rule, m.position);
          const dir = aim ? stepDirectionToward(m.position, aim) : 'down';
          return this.makeSkillIntent(m, rule.action.skillId, dir);
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
          return this.makeSkillIntent(m, attackSkillId, stepDir);
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
        const targets = this.resolveTargets(monster, dirVec, skill.range, effect.target, this.sideFilterForEffect(effect.type));
        for (const target of targets) {
          if (target.kind === 'self') continue; // a monster hitting itself isn't a player-facing threat preview
          if (target.kind === 'base') {
            // push/shield/heal are no-ops on the base — nothing to block. Percent damage is
            // read off the base's own current hp, same rule as effectAmount() uses for units.
            addPreview({ kind: 'base' }, this.effectAmount(effect, this.baseHp));
            continue;
          }
          const previewTarget: CombatTarget =
            target.kind === 'player'
              ? { kind: 'player', unitIndex: this.players.indexOf(target.unit) }
              : { kind: 'monster', instanceId: target.unit.instanceId };
          const key = targetKey(previewTarget);
          if (!shieldRemaining.has(key)) shieldRemaining.set(key, target.unit.shield);
          const remaining = shieldRemaining.get(key)!;
          const amount = this.effectAmount(effect, target.unit.hp);
          if (remaining > 0) {
            shieldRemaining.set(key, remaining - 1); // this hit is fully blocked, consumes a charge
            continue;
          }
          addPreview(previewTarget, amount);
        }
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

  /** Whether `unit` is a monster — the same 'instanceId' narrowing combatTargetFor()/the taunt case already rely on. */
  private isMonster(unit: PlayerUnitState | MonsterUnitState): unit is MonsterUnitState {
    return 'instanceId' in unit;
  }

  /** A single relative-offset AOE shape: 4 orthogonal neighbors, no direction needed — see TargetMode 'aoeCross'. */
  private static readonly CROSS_OFFSETS: Vec2[] = [
    { x: 0, y: -1 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
  ];

  /** All 8 neighbors (orthogonal + diagonal), no direction needed — see TargetMode 'aoeRing'. */
  private static readonly RING_OFFSETS: Vec2[] = [
    { x: 0, y: -1 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: -1, y: 1 },
    { x: 1, y: 1 },
  ];

  /** The live unit of the requested side standing on tile `p`, if any (dead units never match). */
  private liveUnitAt(p: Vec2, wantPlayer: boolean): PlayerUnitState | MonsterUnitState | undefined {
    return wantPlayer
      ? this.players.find((x) => x.hp > 0 && equalsVec2(x.position, p))
      : this.monsters.find((x) => x.hp > 0 && equalsVec2(x.position, p));
  }

  /** Any live unit standing on tile `p`, either side — for ITB friendly fire, where an attack hits whatever occupies the tile. Players are checked first, but a tile can only hold one unit at a time so order is immaterial. */
  private liveAnyUnitAt(p: Vec2): PlayerUnitState | MonsterUnitState | undefined {
    return (
      this.players.find((x) => x.hp > 0 && equalsVec2(x.position, p)) ??
      this.monsters.find((x) => x.hp > 0 && equalsVec2(x.position, p))
    );
  }

  /**
   * Which side(s) a mixed-crowd effect can land on, derived from its type:
   * ITB damage and pushes hit ANYTHING on the tile (full friendly fire — your
   * own mech, another enemy you shoved into the line, etc.); heals and shields
   * only land on the caster's own side; taunt (our custom debuff, no ITB
   * analog) targets a foe. Whole-field modes (allEnemies/allUnits/allAllies)
   * hardcode their own side rules and never consult this.
   */
  private sideFilterForEffect(type: EffectType): SideFilter {
    switch (type) {
      case 'damage':
      case 'push':
        return 'any';
      case 'heal':
      case 'shield':
        return 'allies';
      case 'taunt':
        return 'enemies';
    }
  }

  /** Wraps a found unit as a ResolvedTarget of the matching kind. */
  private wrapTarget(unit: PlayerUnitState | MonsterUnitState): ResolvedTarget {
    return this.isMonster(unit) ? { kind: 'monster', unit } : { kind: 'player', unit };
  }

  /**
   * Resolves every tile/unit a single effect actually lands on, for every
   * TargetMode. Returns 0-to-many targets (`self`/no-hit cases in the old
   * single-target `firstInLine` now come back as a 1- or 0-length array
   * instead of a value / null — callers loop over the result either way, so
   * behavior for those two modes is unchanged).
   *
   * `sideFilter` decides WHICH side's units a directional/mixed-side ray or
   * area can land on. 'any' (ITB friendly fire — the damage/push case) finds
   * whatever unit occupies the tile, either side: a player's shot can strike a
   * fellow mech, a monster's shot can strike another monster you shoved into
   * its line. 'enemies' finds only the opposing side (our custom taunt debuff);
   * 'allies' finds only the caster's own side (heal/shield) — applyEffect()'s
   * heal case has no ally/enemy check of its own, so this is the one place that
   * decides who a heal can legally land on (see computeTargetable() in
   * BattleScene for the matching UI restriction). This only affects the "mixed
   * crowd" modes (firstInLine, pierceLine, aoeCross, aoeRing, aoeArc3) — the
   * whole-map modes below hardcode their own side rules and ignore it.
   */
  private resolveTargets(
    caster: PlayerUnitState | MonsterUnitState,
    dir: Vec2,
    range: number,
    mode: TargetMode,
    sideFilter: SideFilter = 'enemies',
  ): ResolvedTarget[] {
    if (mode === 'self') return [{ kind: 'self' }];

    const casterIsPlayer = !this.isMonster(caster);
    const casterPos = caster.position;

    // allEnemies: literally every living monster on the map, full stop — not
    // "the caster's enemies" in the abstract (there's no monster-cast use of
    // this in the current content, but the engine stays symmetric rather
    // than special-casing caster side here).
    if (mode === 'allEnemies') {
      return this.monsters.filter((m) => m.hp > 0).map((m) => ({ kind: 'monster', unit: m }) as ResolvedTarget);
    }

    // allUnits: every living unit, both sides, EXCLUDING the caster itself —
    // confirmed assumption (see TargetMode doc comment in content/types.ts):
    // a self-sacrifice cast already pays its own cost, so the skill itself
    // shouldn't additionally hit its own caster. Identity is checked by
    // object reference since `caster` is always the same array element
    // living in this.players/this.monsters.
    if (mode === 'allUnits') {
      const targets: ResolvedTarget[] = [];
      for (const p of this.players) {
        if (p.hp > 0 && p !== caster) targets.push({ kind: 'player', unit: p });
      }
      for (const m of this.monsters) {
        if (m.hp > 0 && m !== caster) targets.push({ kind: 'monster', unit: m });
      }
      return targets;
    }

    // allAllies: every living unit on the SAME SIDE as the caster, EXCLUDING
    // the caster itself — same exclusion rationale as allUnits above (a
    // self-sacrifice cast already pays its own cost). "Same side" is
    // caster-relative, not hardcoded to players: a player caster hits other
    // living players, a monster caster would hit other living monsters, even
    // though no monster content uses this mode today (only player Ultimates
    // do). Identity checked by object reference, same as allUnits.
    if (mode === 'allAllies') {
      const roster = casterIsPlayer ? this.players : this.monsters;
      const targets: ResolvedTarget[] = [];
      for (const u of roster) {
        if (u.hp > 0 && u !== caster) targets.push(this.wrapTarget(u));
      }
      return targets;
    }

    // For 'any' (friendly fire) the tile lookup ignores side entirely; for
    // 'allies'/'enemies' it resolves to the one side that filter selects.
    const findUnit = (p: Vec2): PlayerUnitState | MonsterUnitState | undefined =>
      sideFilter === 'any'
        ? this.liveAnyUnitAt(p)
        : this.liveUnitAt(p, sideFilter === 'allies' ? casterIsPlayer : !casterIsPlayer);

    // Point-blank area shapes around the caster — no line of sight check
    // (they're adjacent tiles, not a projectile), no direction needed.
    if (mode === 'aoeCross' || mode === 'aoeRing') {
      const offsets = mode === 'aoeCross' ? BattleEngine.CROSS_OFFSETS : BattleEngine.RING_OFFSETS;
      const targets: ResolvedTarget[] = [];
      for (const offset of offsets) {
        const unit = findUnit(add(casterPos, offset));
        if (unit) targets.push(this.wrapTarget(unit));
      }
      return targets;
    }

    // aoeArc3: a 3-tile fan one step ahead of the caster in the aimed
    // direction — the forward cell, plus that same forward cell shifted one
    // tile left and one tile right (perpendicular to the aim), forming a
    // short row/column of 3 cells facing the caster. E.g. aiming 'up' hits
    // (cx-1,cy-1), (cx,cy-1), (cx+1,cy-1); aiming 'right' hits (cx+1,cy-1),
    // (cx+1,cy), (cx+1,cy+1). No line-of-sight check, same as the other AOE
    // shapes — it's a melee-range fan, not a projectile.
    if (mode === 'aoeArc3') {
      const forward = add(casterPos, dir);
      const perp: Vec2 = dir.x === 0 ? { x: 1, y: 0 } : { x: 0, y: 1 };
      const cells = [forward, add(forward, perp), add(forward, { x: -perp.x, y: -perp.y })];
      const targets: ResolvedTarget[] = [];
      for (const cell of cells) {
        const unit = findUnit(cell);
        if (unit) targets.push(this.wrapTarget(unit));
      }
      return targets;
    }

    // firstInLine / pierceLine: scan the aimed direction tile by tile.
    // Line of sight is only blocked by a real wall or the base tile — both
    // fly over hazard AND poison-mist tiles. firstInLine stops (returns)
    // the instant it finds a target OR anything blocking; pierceLine keeps
    // scanning past a found target (collecting every hit within range) but
    // still stops dead at a wall/base, same as firstInLine — it pierces
    // *targets*, not terrain.
    const targets: ResolvedTarget[] = [];
    for (let step = 1; step <= range; step++) {
      const p = add(casterPos, { x: dir.x * step, y: dir.y * step });
      if (this.isBaseTile(p)) {
        // A monster's attack reaching a base tile hits the base; a player's
        // shot (or any heal, which only lands on allies) never targets the
        // base — it just stops there. Either way the base blocks further
        // travel. 'allies' is the only filter that spares the base here.
        // `at` records the exact tile struck — intent telegraphs need it to
        // mark the board; applyEffect ignores it (base HP is one shared pool).
        if (!casterIsPlayer && sideFilter !== 'allies') targets.push({ kind: 'base', at: { ...p } });
        break;
      }
      if (this.isWall(p)) break;
      const unit = findUnit(p);
      if (unit) {
        targets.push(this.wrapTarget(unit));
        if (mode === 'firstInLine') break;
      }
    }
    return targets;
  }

  /**
   * The actual damage amount for `effect` against a target currently at
   * `currentHp`. Flat damage just returns `effect.amount`; percent damage
   * (amountIsPercent) reinterprets `amount` as a 0-100 percentage of the
   * target's CURRENT hp, floored — floored all the way to a 0-damage fizzle
   * when the target is small enough. Deliberate (reversing the old minimum-1
   * rule): percent damage is a chip tool for big targets, not an execute —
   * a guaranteed 1 turned every whole-map percent Ultimate into a free
   * finisher on 1-2 HP tutorial monsters, bypassing the lesson those levels
   * teach. Only `damage` effects ever set amountIsPercent (format.ts rejects
   * it on other effect types), so this is only called from damage-effect
   * code paths.
   */
  private effectAmount(effect: EffectPrimitive, currentHp: number): number {
    if (effect.amountIsPercent) return Math.floor((currentHp * effect.amount) / 100);
    return effect.amount;
  }

  private applyEffect(
    effect: EffectPrimitive,
    target: ResolvedTarget,
    caster: PlayerUnitState | MonsterUnitState,
  ): void {
    if (target.kind === 'base') {
      // Only damage makes sense against the base — push/shield/heal are no-ops on it.
      if (effect.type === 'damage') {
        const before = this.baseHp;
        const amount = this.effectAmount(effect, this.baseHp);
        this.baseHp = Math.max(0, this.baseHp - amount);
        this.pendingEvents.push({ kind: 'damage', target: { kind: 'base' }, amount: before - this.baseHp, blocked: false });
      }
      return;
    }
    const unit = target.kind === 'self' ? caster : target.unit;
    const combatTarget = this.combatTargetFor(unit);

    switch (effect.type) {
      case 'damage':
        this.dealDamageWithEvent(unit, this.effectAmount(effect, unit.hp));
        break;
      case 'push': {
        const from = { ...unit.position };
        this.pushUnit(unit, caster.position, effect.amount);
        const distance = Math.abs(unit.position.x - from.x) + Math.abs(unit.position.y - from.y);
        if (distance > 0) this.pendingEvents.push({ kind: 'push', target: combatTarget, distance });
        break;
      }
      case 'shield': {
        const before = unit.shield;
        unit.shield = Math.min(SHIELD_STACK_CAP, unit.shield + effect.amount);
        const gained = unit.shield - before;
        // Report the charges actually gained — a cast that hits the cap
        // shows the real gain, including zero: the cast still spent the
        // player's resources, and a silent no-op reads as an unregistered
        // click (the exact failure mode the percent-damage fizzle event
        // solves for damage). The UI renders amount 0 as a "no effect" toast.
        this.pendingEvents.push({ kind: 'shield', target: combatTarget, amount: gained });
        break;
      }
      case 'heal': {
        const before = unit.hp;
        unit.hp = Math.min(unit.maxHp, unit.hp + effect.amount);
        if (unit.hp > before) this.pendingEvents.push({ kind: 'heal', target: combatTarget, amount: unit.hp - before });
        break;
      }
      case 'taunt': {
        // Taunt only makes sense against a monster — its 'enemies' sideFilter
        // (see sideFilterForEffect) resolves a player caster's target from the
        // monster side only, so `unit` here is a MonsterUnitState in every
        // real case. The 'instanceId' narrowing below is what makes
        // that concrete for TS; a caster is always a player for this effect
        // (only a hero skill uses it in this batch).
        if ('instanceId' in unit && !('instanceId' in caster)) {
          unit.tauntedBy = this.players.indexOf(caster);
          unit.tauntTurnsLeft = effect.amount;
          this.pendingEvents.push({ kind: 'taunt', target: combatTarget });
        }
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
}
