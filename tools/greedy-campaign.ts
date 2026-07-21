/**
 * Campaign-scale difficulty measurement — the upper bound that actually
 * matters once the grid persists (spec A9).
 *
 * `tools/greedy-play.ts` measures ONE mission at a time against that map's own
 * `baseHp`, and under the old per-level rules that was the right question.
 * It no longer is: a run that "wins" every mission while leaking 2 base damage
 * each time is dead by mission 5 when the grid never refills. Per-mission
 * win/loss stopped being the definition of winning, so measuring it stopped
 * measuring difficulty.
 *
 * This tool asks the real question instead: play the 17-mission campaign
 * (A10's pick-3-of-4 per island, then the island boss, then final_hive) with a
 * single grid pool carried across every mission, and report where — if
 * anywhere — a non-thinking player runs out of grid.
 *
 * The pass bar is `design/roadmap.md:251`: 普通 = 隨便玩會輸. Greedy must die
 * somewhere in these 17 missions. If it finishes the campaign alive, the
 * campaign is still too easy.
 *
 * Grid arithmetic is duplicated here rather than imported from core/campaign so
 * this stays runnable independently of the scene layer; it mirrors
 * `applyMissionResult`/`syncGridHp` (assign-on-sync, zero-damage bonus capped,
 * a mission's base pool IS the grid on entry).
 */
import { runGreedy, type GreedyResult } from './greedy-play';
import { WORLD_STRUCTURE } from '../content/registry';

/** Mirrors core/campaign/state.ts. Kept in sync by hand — see the module doc. */
const GRID_START = 8;
const GRID_MAX = 12;
/** A10: each island offers 4 regular missions and you play 3, then its boss. */
const REGULARS_PLAYED_PER_ISLAND = 3;

interface MissionRecord {
  mapId: string;
  gridBefore: number;
  gridAfter: number;
  damage: number;
  bonus: boolean;
  outcome: GreedyResult['outcome'];
}

/**
 * The 17-mission path: per island, the first `REGULARS_PLAYED_PER_ISLAND`
 * regular missions in listed order, then that island's boss (the last entry);
 * finally the standalone final mission.
 *
 * Play-order selection is deliberate. A real player picks which 3 to take, and
 * a greedy/non-thinking one has no basis to pick well — taking them in the
 * order presented is the honest model of "not thinking". A player who picked
 * the three cheapest missions every time would do better than this, so treat
 * the result as the careless-play line, not the floor of all possible play.
 */
function campaignPath(): string[] {
  const path: string[] = [];
  for (const world of WORLD_STRUCTURE) {
    const ids = world.levels.map((l) => l.mapId);
    if (ids.length === 1) {
      path.push(ids[0]); // the standalone final mission
      continue;
    }
    const boss = ids[ids.length - 1];
    const regulars = ids.slice(0, ids.length - 1);
    path.push(...regulars.slice(0, REGULARS_PLAYED_PER_ISLAND), boss);
  }
  return path;
}

function runCampaign(verbose: boolean): { records: MissionRecord[]; survived: boolean; finalGrid: number } {
  let grid = GRID_START;
  const records: MissionRecord[] = [];

  for (const mapId of campaignPath()) {
    const gridBefore = grid;
    const result = runGreedy(mapId, verbose, grid);

    // syncGridHp is an assignment, not a subtraction: the mission's base pool
    // IS the grid, so whatever survives the mission is the grid going forward.
    const gridAfterMission = Math.max(0, result.baseHp);
    const damage = gridBefore - gridAfterMission;
    // Zero-damage bonus is settled at mission completion and only on a win.
    const bonus = damage === 0 && result.outcome === 'victory';
    grid = Math.min(GRID_MAX, gridAfterMission + (bonus ? 1 : 0));

    records.push({ mapId, gridBefore, gridAfter: grid, damage, bonus, outcome: result.outcome });
    if (grid <= 0) return { records, survived: false, finalGrid: 0 };
  }
  return { records, survived: true, finalGrid: grid };
}

function main(): void {
  const verbose = process.argv.includes('--verbose');
  const { records, survived, finalGrid } = runCampaign(verbose);

  console.log(`\n=== CAMPAIGN (greedy, persistent grid ${GRID_START}/${GRID_MAX}) ===\n`);
  console.log('| # | mission | grid in | dmg | bonus | grid out | mission |');
  console.log('|---|---------|---------|-----|-------|----------|---------|');
  records.forEach((r, i) => {
    console.log(
      `| ${String(i + 1).padStart(2)} | ${r.mapId.padEnd(12)} | ${String(r.gridBefore).padStart(7)} | ${String(r.damage).padStart(3)} | ${(r.bonus ? '+1' : '  ').padStart(5)} | ${String(r.gridAfter).padStart(8)} | ${r.outcome} |`,
    );
  });

  const played = records.length;
  const total = campaignPath().length;
  console.log('');
  if (survived) {
    console.log(
      `RESULT: greedy SURVIVED all ${total} missions with ${finalGrid}/${GRID_MAX} grid left — the campaign still fails the "隨便玩會輸" bar.`,
    );
  } else {
    console.log(
      `RESULT: greedy DIED at mission ${played}/${total} (${records[played - 1].mapId}) — grid exhausted. The "隨便玩會輸" bar is met.`,
    );
  }
}

if (process.argv[1] && /greedy-campaign\.ts$/.test(process.argv[1])) {
  main();
}
