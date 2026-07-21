#!/usr/bin/env node

/**
 * Difficulty UPPER bound probe — "does a player who doesn't think also win?"
 *
 * The existing verification only pins the LOWER bound of difficulty:
 *   - tools/trace-passive.ts  — player does nothing at all, must LOSE
 *   - tools/run-solution.ts   — replays a hand-written solution, must WIN
 *
 * Neither answers the question the "普通 = 要思考才贏" bar actually asks:
 * if a greedy, non-thinking play pattern ALSO wins, the mission never forced
 * a decision and is too easy. This tool plays exactly that non-thinking
 * pattern and reports the outcome.
 *
 * The greedy "player" deliberately uses NONE of this game's core techniques:
 *   - no dodging       — getIntents()/getAttackPreviews() are never consulted,
 *                        so telegraphed red tiles are walked into freely
 *   - no base defense  — never body-blocks for the base, never picks a target
 *                        because of what it threatens
 *   - no terrain play  — never aims a push to shove a monster into an abyss
 *                        (push effects still land when they ride along on the
 *                        chosen damage skill, but never because it computed one)
 *   - no spawn denial  — never steps onto a pendingSpawnTiles marker
 *   - no ultimates     — resource management is a technique; only the
 *                        character's regular skillIds are considered
 *
 * What it DOES do, per unit, in squad order:
 *   1. pick the nearest living monster (manhattan; stable tie-break)
 *   2. if its first damage skill already hits a monster from where it stands,
 *      fire (movement skipped entirely)
 *   3. otherwise walk to the reachable tile that lets it hit, preferring the
 *      one closest to the target; failing that, walk to the reachable tile
 *      closest to the target and fire if that happened to open a line
 *   4. nothing to hit and nowhere useful to go → rest()
 *
 * It will not shoot a teammate: firstInLine uses sideFilter 'any' (ITB
 * friendly fire), so a line whose first occupant is a player counts as "no
 * shot". Avoiding self-harm the UI plainly shows is not a technique.
 *
 * ITB action economy is respected as the engine enforces it — move first,
 * then exactly one action, and acting ends the unit's turn. Every
 * moveUnit/useSkill/rest ActionResult is checked; a rejection is logged with
 * its reason and falls back to rest() rather than being silently dropped.
 *
 * Usage:
 *   npx tsx tools/greedy-play.ts <mapId>   — verbose turn-by-turn for one map
 *   npx tsx tools/greedy-play.ts           — every registered map + summary table
 */

import { BattleEngine } from '../core/battle/engine';
import { registry, maps, STARTING_SQUAD, WORLD_STRUCTURE, LESSON_MAP_IDS } from '../content/registry';
import type { MapDef } from '../core/content/types';
import type { BattleSnapshot } from '../core/battle/types';
import { MOVE_VECTORS, add, equalsVec2, manhattan } from '../core/geometry';
import type { CardinalDir, Vec2 } from '../core/geometry';

const DIRS = Object.keys(MOVE_VECTORS) as CardinalDir[];

export interface GreedyResult {
  mapId: string;
  outcome: 'victory' | 'defeat' | 'unresolved';
  baseHp: number;
  baseMaxHp: number;
  survivors: number;
  squadSize: number;
  turnsPlayed: number;
  totalTurns: number;
  monstersLeft: number;
}

// ---------------------------------------------------------------------------
// Board helpers — read-only mirrors of the engine's own terrain rules
// (BattleEngine.isWalkable / isWall / isBaseTile). Duplicated rather than
// exposed because the engine is out of scope for this measurement-only tool.
// ---------------------------------------------------------------------------

function tileAt(map: MapDef, p: Vec2): string | undefined {
  const row = map.grid[p.y];
  if (row === undefined || p.x < 0 || p.x >= row.length) return undefined;
  return row[p.x];
}

/** Engine rule: only open floor and poison mist are walkable — abyss/hazard is not. */
function isWalkable(map: MapDef, p: Vec2): boolean {
  const ch = tileAt(map, p);
  return ch === ' ' || ch === '*';
}

/** Engine rule: walls AND base tiles block line of sight (out of bounds too). */
function blocksLine(map: MapDef, p: Vec2): boolean {
  const ch = tileAt(map, p);
  return ch === undefined || ch === '#' || ch === 'B';
}

function occupant(snap: BattleSnapshot, p: Vec2): 'player' | 'monster' | null {
  if (snap.players.some((u) => u.hp > 0 && equalsVec2(u.position, p))) return 'player';
  if (snap.monsters.some((u) => u.hp > 0 && equalsVec2(u.position, p))) return 'monster';
  return null;
}

/**
 * Every tile this unit could legally move to — the same BFS over walkable,
 * unoccupied tiles that BattleEngine.isReachable() validates against, so a
 * destination picked from here is never rejected as 'unreachable'.
 * `from` itself is excluded: the engine does not treat standing still as a move.
 */
function reachableTiles(map: MapDef, snap: BattleSnapshot, from: Vec2, budget: number): Vec2[] {
  const out: Vec2[] = [];
  const seen = new Set<string>([`${from.x},${from.y}`]);
  let frontier: Vec2[] = [from];
  for (let step = 0; step < budget; step++) {
    const next: Vec2[] = [];
    for (const cur of frontier) {
      for (const dir of DIRS) {
        const p = add(cur, MOVE_VECTORS[dir]);
        const key = `${p.x},${p.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!isWalkable(map, p) || occupant(snap, p) !== null) continue;
        out.push(p);
        next.push(p);
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * The monster a `firstInLine` shot of the given range would strike from `pos`
 * aiming `dir`, or null. Mirrors resolveTargets(): the scan stops dead at a
 * wall/base tile, and stops at the FIRST living unit of either side — a
 * teammate in the way means no shot (the greedy bot won't friendly-fire).
 */
function firstInLineMonster(
  map: MapDef,
  snap: BattleSnapshot,
  pos: Vec2,
  dir: CardinalDir,
  range: number,
): string | null {
  const v = MOVE_VECTORS[dir];
  for (let step = 1; step <= range; step++) {
    const p = add(pos, { x: v.x * step, y: v.y * step });
    if (blocksLine(map, p)) return null;
    const who = occupant(snap, p);
    if (who === 'player') return null;
    if (who === 'monster') {
      const m = snap.monsters.find((u) => u.hp > 0 && equalsVec2(u.position, p));
      return m ? m.instanceId : null;
    }
  }
  return null;
}

interface Shot {
  dir: CardinalDir;
  instanceId: string;
}

/** Best shot from `pos`: one that hits `preferredId` if any direction offers it, else any monster. */
function findShot(
  map: MapDef,
  snap: BattleSnapshot,
  pos: Vec2,
  range: number,
  preferredId: string | null,
): Shot | null {
  let fallback: Shot | null = null;
  for (const dir of DIRS) {
    const hit = firstInLineMonster(map, snap, pos, dir, range);
    if (hit === null) continue;
    if (preferredId !== null && hit === preferredId) return { dir, instanceId: hit };
    if (fallback === null) fallback = { dir, instanceId: hit };
  }
  return fallback;
}

/**
 * The unit's attack: the FIRST skill in its regular skillIds carrying a damage
 * effect. Ultimates are excluded on purpose (see the file header). Characters
 * with no damage skill at all (bai_zhi the healer, ling_er the tank) simply
 * have no attack — the greedy pattern walks them toward the fight and rests.
 */
function damageSkillOf(skillIds: string[]): { id: string; range: number } | null {
  for (const id of skillIds) {
    const def = registry.skills[id];
    if (!def) continue;
    if (def.effects.some((e) => e.type === 'damage')) return { id, range: def.range };
  }
  return null;
}

function nearestMonster(snap: BattleSnapshot, from: Vec2): { instanceId: string; position: Vec2 } | null {
  let best: { instanceId: string; position: Vec2; d: number } | null = null;
  for (const m of snap.monsters) {
    if (m.hp <= 0) continue;
    const d = manhattan(from, m.position);
    // Strict '<' keeps the first monster in the engine's stable spawn order on
    // a tie, so a run is fully deterministic and reproducible.
    if (best === null || d < best.d) best = { instanceId: m.instanceId, position: m.position, d };
  }
  return best ? { instanceId: best.instanceId, position: best.position } : null;
}

// ---------------------------------------------------------------------------
// The greedy turn
// ---------------------------------------------------------------------------

function playUnit(engine: BattleEngine, map: MapDef, unitIndex: number, log: (s: string) => void): void {
  let snap = engine.getSnapshot();
  const unit = snap.players[unitIndex];
  if (!unit || unit.hp <= 0 || unit.acted) return;

  const label = `[${unitIndex}] ${unit.characterId}`;
  const attack = damageSkillOf(unit.skillIds);
  const target = nearestMonster(snap, unit.position);

  // Nothing alive to chase — the dumb pattern has no other idea. Rest.
  if (!target) {
    const res = engine.rest(unitIndex);
    log(`  ${label}: no monsters left → rest${res.ok ? '' : ` (REJECTED: ${res.reason})`}`);
    return;
  }

  // Step 1: already in range from where it stands? Fire without moving.
  if (attack && !unit.moved) {
    const shot = findShot(map, snap, unit.position, attack.range, target.instanceId);
    if (shot) {
      const res = engine.useSkill(unitIndex, attack.id, shot.dir);
      if (res.ok) {
        log(`  ${label}: ${attack.id} ${shot.dir} → ${shot.instanceId} (no move needed)`);
        return;
      }
      log(`  ${label}: ${attack.id} ${shot.dir} REJECTED: ${res.reason}`);
    }
  }

  // Step 2: walk. Prefer a tile that opens a shot on the nearest monster;
  // otherwise just close the distance. Never consults intents, spawn markers,
  // base tiles or hazards beyond "is this tile legally walkable".
  if (!unit.moved && !unit.acted) {
    const tiles = reachableTiles(map, snap, unit.position, unit.moveRange);
    let bestShotTile: { tile: Vec2; d: number } | null = null;
    let bestCloseTile: { tile: Vec2; d: number } | null = null;

    for (const tile of tiles) {
      const d = manhattan(tile, target.position);
      if (bestCloseTile === null || d < bestCloseTile.d) bestCloseTile = { tile, d };
      if (!attack) continue;
      // Evaluate the shot as if the unit already stood there: the tile is
      // unoccupied by construction, and firstInLineMonster only reads
      // occupancy of OTHER tiles, so the current-position snapshot is accurate.
      if (findShot(map, snap, tile, attack.range, target.instanceId) !== null) {
        if (bestShotTile === null || d < bestShotTile.d) bestShotTile = { tile, d };
      }
    }

    const dest = bestShotTile?.tile ?? bestCloseTile?.tile ?? null;
    const currentDist = manhattan(unit.position, target.position);
    // Only actually move when it buys something: a firing position, or real
    // progress toward the target. Otherwise stand still and act.
    const worthIt =
      dest !== null && (bestShotTile !== null || (bestCloseTile !== null && bestCloseTile.d < currentDist));
    if (dest && worthIt) {
      const res = engine.moveUnit(unitIndex, dest);
      if (res.ok) {
        log(`  ${label}: move → (${dest.x},${dest.y})`);
      } else {
        log(`  ${label}: move → (${dest.x},${dest.y}) REJECTED: ${res.reason}`);
      }
    }
  }

  // Step 3: act from wherever the unit ended up.
  snap = engine.getSnapshot();
  const after = snap.players[unitIndex];
  if (!after || after.hp <= 0 || after.acted) return;

  if (attack) {
    const shot = findShot(map, snap, after.position, attack.range, target.instanceId);
    if (shot) {
      const res = engine.useSkill(unitIndex, attack.id, shot.dir);
      if (res.ok) {
        log(`  ${label}: ${attack.id} ${shot.dir} → ${shot.instanceId}`);
        return;
      }
      log(`  ${label}: ${attack.id} ${shot.dir} REJECTED: ${res.reason}`);
    }
  }

  // Fallback for every path above: no shot, a rejected skill, or a character
  // with no damage skill at all.
  const res = engine.rest(unitIndex);
  log(`  ${label}: nothing to hit → rest${res.ok ? '' : ` (REJECTED: ${res.reason})`}`);
}

export function runGreedy(mapId: string, verbose: boolean): GreedyResult {
  const map = maps[mapId];
  if (!map) throw new Error(`Unknown map: ${mapId}`);
  const squad = map.squadCharacterIds ?? STARTING_SQUAD;
  const engine = new BattleEngine(map, squad, registry);
  const log = (s: string): void => {
    if (verbose) console.log(s);
  };

  if (verbose) {
    console.log(`\n${'='.repeat(64)}`);
    console.log(`GREEDY RUN: ${mapId} | squad: ${squad.join(', ')} | ${map.totalTurns} turns | base ${map.baseHp} HP`);
    console.log('='.repeat(64));
  }

  let turnsPlayed = 0;
  // Hard stop one turn past the mission clock — endTurn() decides victory the
  // moment turnNumber passes totalTurns, so this can only fire on an engine bug.
  while (engine.getSnapshot().outcome === null && turnsPlayed < map.totalTurns + 1) {
    const snap = engine.getSnapshot();
    log(`\n-- Turn ${snap.turnNumber}/${snap.totalTurns} | base ${snap.baseHp}/${snap.baseMaxHp} | monsters ${snap.monsters.filter((m) => m.hp > 0).length}`);
    for (let i = 0; i < snap.players.length; i++) {
      if (engine.getSnapshot().outcome !== null) break;
      playUnit(engine, map, i, log);
    }
    engine.endTurn();
    turnsPlayed += 1;
    const after = engine.getSnapshot();
    log(
      `  end of turn → base ${after.baseHp}/${after.baseMaxHp} | alive ${after.players.filter((p) => p.hp > 0).length}/${after.players.length} | monsters ${after.monsters.filter((m) => m.hp > 0).length}`,
    );
  }

  const final = engine.getSnapshot();
  const result: GreedyResult = {
    mapId,
    outcome: final.outcome ?? 'unresolved',
    baseHp: final.baseHp,
    baseMaxHp: final.baseMaxHp,
    survivors: final.players.filter((p) => p.hp > 0).length,
    squadSize: final.players.length,
    turnsPlayed,
    totalTurns: final.totalTurns,
    monstersLeft: final.monsters.filter((m) => m.hp > 0).length,
  };

  if (verbose) {
    console.log(`\nRESULT ${mapId}: ${result.outcome.toUpperCase()} | base ${result.baseHp}/${result.baseMaxHp} | survivors ${result.survivors}/${result.squadSize} | turns ${result.turnsPlayed}/${result.totalTurns}`);
  }
  return result;
}

/** Campaign map ids in play order, straight from WORLD_STRUCTURE (includes final_hive). */
export function campaignMapIds(): string[] {
  return WORLD_STRUCTURE.flatMap((w) => w.levels.map((l) => l.mapId));
}

function printTable(rows: GreedyResult[]): void {
  const head = ['map', 'greedy', 'base HP', 'alive', 'turns', 'monsters left'];
  const body = rows.map((r) => [
    r.mapId,
    r.outcome,
    `${r.baseHp}/${r.baseMaxHp}`,
    `${r.survivors}/${r.squadSize}`,
    `${r.turnsPlayed}/${r.totalTurns}`,
    String(r.monstersLeft),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(line(head));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const b of body) console.log(line(b));
}

function main(): void {
  const mapId = process.argv[2];

  if (mapId) {
    if (!maps[mapId]) {
      console.error(`Unknown map: ${mapId}`);
      console.error(`Known: ${Object.keys(maps).join(', ')}`);
      process.exit(1);
    }
    runGreedy(mapId, true);
    return;
  }

  const campaign = campaignMapIds().map((id) => runGreedy(id, false));
  const lessons = LESSON_MAP_IDS.map((id) => runGreedy(id, false));

  console.log('\n=== CAMPAIGN ===');
  printTable(campaign);
  console.log('\n=== LESSONS ===');
  printTable(lessons);

  const broken = campaign.filter((r) => r.outcome === 'victory');
  console.log(
    `\nGreedy (non-thinking) play WON ${broken.length}/${campaign.length} campaign missions — those missions do not meet the "要思考才贏" bar.`,
  );
  if (broken.length > 0) console.log(`Too easy: ${broken.map((r) => r.mapId).join(', ')}`);
}

// Only auto-run as a CLI; importing this module (tests, other tools) must not
// kick off 26 battles as a side effect.
if (process.argv[1] && /greedy-play\.ts$/.test(process.argv[1])) {
  main();
}
