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
 * This tool asks the real question instead: play the campaign (A10's
 * pick-3-of-4 per island, then the island boss, then final_hive) with a single
 * grid pool carried across every mission, and report where — if anywhere — a
 * non-thinking player runs out of grid.
 *
 * The pass bar is `design/roadmap.md:251`: 普通 = 隨便玩會輸. Greedy must die
 * somewhere in the campaign. If it finishes alive, the campaign is still too
 * easy.
 *
 * Grid bookkeeping is NOT reimplemented here — it drives the real
 * `core/campaign/state.ts` state machine (newCampaign/applyMissionResult/
 * availableMissions), the exact code path BattleScene uses. Hand-duplicating
 * that arithmetic was tried first and is exactly the kind of thing that goes
 * stale silently: state.ts is pure (no DOM), so importing it costs nothing and
 * guarantees this tool can never measure against rules the game no longer has.
 */
import { runGreedy } from './greedy-play';
import {
  applyMissionResult,
  availableMissions,
  FINAL_MAP_ID,
  GRID_MAX,
  GRID_START,
  ISLAND_COUNT,
  newCampaign,
  regularMapIds,
  REQUIRED_CLEARS,
  type CampaignState,
} from '../core/campaign/state';

interface MissionRecord {
  mapId: string;
  gridBefore: number;
  gridAfter: number;
  outcome: 'victory' | 'defeat';
}

/**
 * Which of an island's 4 regular missions a non-thinking player picks first.
 * A real player chooses which `REQUIRED_CLEARS` to take; greedy has no basis
 * to pick well, so it takes them in listed order — the honest model of "not
 * thinking" about mission selection, same as it doesn't think in-mission. A
 * player who picked the cheapest missions every time would do better than
 * this, so treat the result as the careless-play line, not the floor of all
 * possible play.
 */
function pickNext(state: CampaignState): string | null {
  const offered = availableMissions(state);
  if (offered.length === 0) return null;
  const regulars = regularMapIds(state.islandIndex).filter((id) => offered.includes(id));
  return regulars[0] ?? offered[0]; // no regulars left offered -> only the boss (or final_hive) remains
}

function runCampaign(verbose: boolean): { records: MissionRecord[]; survived: boolean; finalGrid: number } {
  let state = newCampaign();
  const records: MissionRecord[] = [];

  for (let mapId = pickNext(state); mapId !== null; mapId = pickNext(state)) {
    const gridBefore = state.gridHp;
    const result = runGreedy(mapId, verbose, gridBefore);
    state = applyMissionResult(state, {
      mapId,
      outcome: result.outcome === 'victory' ? 'victory' : 'defeat',
      baseHpRemaining: Math.max(0, result.baseHp),
      baseMaxHp: gridBefore,
    });
    records.push({ mapId, gridBefore, gridAfter: state.gridHp, outcome: result.outcome === 'victory' ? 'victory' : 'defeat' });
    if (state.campaignOver) return { records, survived: false, finalGrid: 0 };
  }
  return { records, survived: true, finalGrid: state.gridHp };
}

function main(): void {
  const verbose = process.argv.includes('--verbose');
  const { records, survived, finalGrid } = runCampaign(verbose);

  console.log(`\n=== CAMPAIGN (greedy, persistent grid ${GRID_START}/${GRID_MAX}, ${REQUIRED_CLEARS}-of-4 per island × ${ISLAND_COUNT} islands + ${FINAL_MAP_ID}) ===\n`);
  console.log('| # | mission | grid in | grid out | mission |');
  console.log('|---|---------|---------|----------|---------|');
  records.forEach((r, i) => {
    console.log(
      `| ${String(i + 1).padStart(2)} | ${r.mapId.padEnd(12)} | ${String(r.gridBefore).padStart(7)} | ${String(r.gridAfter).padStart(8)} | ${r.outcome} |`,
    );
  });

  const played = records.length;
  console.log('');
  if (survived) {
    console.log(
      `RESULT: greedy SURVIVED the campaign (${played} missions played) with ${finalGrid}/${GRID_MAX} grid left — the campaign still fails the "隨便玩會輸" bar.`,
    );
  } else {
    console.log(
      `RESULT: greedy DIED at mission ${played} (${records[played - 1].mapId}) — grid exhausted. The "隨便玩會輸" bar is met.`,
    );
  }
}

if (process.argv[1] && /greedy-campaign\.ts$/.test(process.argv[1])) {
  main();
}
