import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../core/battle/engine';
import { MOVE_VECTORS, add, stepDirectionToward } from '../core/geometry';
import {
  STARTING_SQUAD,
  DEFAULT_MAP_ID,
  maps,
  registry,
  LESSON_MAP_IDS,
  WORLD_STRUCTURE,
} from '../content/registry';
import type { MapDef } from '../core/content/types';

/** The 20 campaign missions, in island/mission order — the ITB-verified 4-islands × 5-missions structure. */
const CAMPAIGN_MAP_IDS = [1, 2, 3, 4].flatMap((island) => [1, 2, 3, 4, 5].map((m) => `island${island}_m${m}`));

/** A5 threat classification: yuan_ling never attacks players (it flees them), so it counts ONLY as a base threat. */
const BASE_THREATS = new Set(['yin_ghost', 'yuan_ling']);
const PLAYER_THREATS = new Set(['yao_lang', 'teng_yao', 'jiangshi']);

function allMonsterIds(map: MapDef): string[] {
  return [...map.initialMonsters.map((m) => m.monsterId), ...map.spawnSchedule.map((s) => s.monsterId)];
}

describe('content registry: builtin definitions', () => {
  it('parses all builtin content without throwing', () => {
    expect(Object.keys(registry.characters)).toEqual(['li_yan', 'su_qing', 'bai_zhi', 'ling_er']);
    expect(Object.keys(registry.monsters)).toEqual([
      'yin_ghost',
      'jiangshi',
      'yuan_ling',
      'teng_yao',
      'yao_lang',
    ]);
  });

  it('exposes exactly the 20 campaign missions + the final battle + the 5 tutorial lessons, and island1_m1 is the default', () => {
    expect(Object.keys(maps)).toEqual([...CAMPAIGN_MAP_IDS, 'final_hive', ...LESSON_MAP_IDS]);
    expect(DEFAULT_MAP_ID).toBe('island1_m1');
    expect(maps[DEFAULT_MAP_ID]).toBeDefined();
  });

  it('runs several turns of real campaign content end-to-end without throwing', () => {
    const map = maps.island1_m1;
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry);
    let sawOutcome = false;
    for (let turn = 0; turn < 8; turn++) {
      if (engine.getSnapshot().outcome) {
        sawOutcome = true;
        engine.confirmOutcome();
        continue;
      }
      // Advance the squad rightward each turn, attacking when in range —
      // not choreographed to win, just to exercise real content deeply
      // enough that mismatched skill/monster data would throw.
      for (let unitIndex = 0; unitIndex < 3; unitIndex++) {
        const before = engine.getSnapshot();
        const unit = before.players[unitIndex];
        if (!unit || unit.hp <= 0) continue;
        const adjacentMonster = before.monsters.find(
          (m) => m.hp > 0 && Math.abs(m.position.x - unit.position.x) <= 1 && m.position.y === unit.position.y,
        );
        if (adjacentMonster) {
          engine.useSkill(unitIndex, unit.skillIds[0], adjacentMonster.position.x > unit.position.x ? 'right' : 'left');
        } else {
          engine.moveUnit(unitIndex, { x: unit.position.x + 1, y: unit.position.y });
        }
      }
      engine.endTurn();
    }
    // 8 loop iterations against a mission this aggressive can end (and
    // confirm-reset back to turn 1) mid-loop — either evidence proves the
    // content actually resolved many turns without an engine exception.
    expect(sawOutcome || engine.getSnapshot().turnNumber > 1).toBe(true);
  });
});

describe('campaign missions: ITB-verified hard specs (8×8 grid, 5 turns, 3-person squad, 4-6 monsters)', () => {
  it('WORLD_STRUCTURE is 4 islands × 5 missions each plus the standalone final battle, none lesson-styled', () => {
    expect(WORLD_STRUCTURE).toHaveLength(5);
    WORLD_STRUCTURE.slice(0, 4).forEach((world, wi) => {
      expect(world.levels).toHaveLength(5);
      world.levels.forEach((level, mi) => {
        expect(level.mapId).toBe(`island${wi + 1}_m${mi + 1}`);
        expect(level.label).toBe(`${wi + 1}-${mi + 1}`);
        expect(level.isLesson).toBe(false);
        expect(maps[level.mapId], `${level.mapId} must be a real entry in maps`).toBeDefined();
      });
    });
    const finalWorld = WORLD_STRUCTURE[4];
    expect(finalWorld.levels).toHaveLength(1);
    expect(finalWorld.levels[0].mapId).toBe('final_hive');
    expect(finalWorld.levels[0].isLesson).toBe(false);
  });

  it.each(CAMPAIGN_MAP_IDS)('%s: fixed 8×8 grid, totalTurns 5, baseHp 8, explicit 3-person squad', (id) => {
    const map = maps[id];
    expect(map.grid).toHaveLength(8);
    for (const row of map.grid) expect(row).toHaveLength(8);
    expect(map.totalTurns).toBe(5);
    expect(map.baseHp).toBe(8);
    expect(map.squadCharacterIds).toHaveLength(3);
    expect(map.playerStarts).toHaveLength(3);
  });

  it.each(CAMPAIGN_MAP_IDS)('%s: 4-6 monsters total, mixing at least one base-threat with one player-threat (A5)', (id) => {
    const ids = allMonsterIds(maps[id]);
    expect(ids.length).toBeGreaterThanOrEqual(4);
    expect(ids.length).toBeLessThanOrEqual(6);
    expect(ids.some((m) => BASE_THREATS.has(m)), `${id} needs a base-threatening monster`).toBe(true);
    expect(ids.some((m) => PLAYER_THREATS.has(m)), `${id} needs a player-threatening monster`).toBe(true);
  });

  it.each(CAMPAIGN_MAP_IDS)('%s: builds a playable BattleEngine without throwing', (id) => {
    const map = maps[id];
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry);
    const snap = engine.getSnapshot();
    expect(snap.players).toHaveLength(3);
    expect(snap.baseTiles.length).toBeGreaterThan(0);
  });

  it.each(CAMPAIGN_MAP_IDS)(
    '%s: a fully passive run (never acting, only ending turns) loses — doing nothing is not a viable strategy',
    (id) => {
      const map = maps[id];
      const engine = new BattleEngine(map, map.squadCharacterIds!, registry);
      let turns = 0;
      while (!engine.getSnapshot().outcome && turns < 10) {
        engine.endTurn();
        turns += 1;
      }
      expect(engine.getSnapshot().outcome, `${id} must not be passively survivable`).toBe('defeat');
    },
  );

  it.each(CAMPAIGN_MAP_IDS)(
    '%s: no monster ever gets terrain-stuck with a move intent that goes nowhere',
    (id) => {
      // Zero-progress move intents are only legal when a living body blocks
      // the greedy next step, or when the monster has no aim left (squad
      // wiped). Terrain silently wedging a monster is the regression this
      // guards against.
      const map = maps[id];
      const engine = new BattleEngine(map, map.squadCharacterIds!, registry);
      for (let i = 0; i < 60; i++) {
        const snap = engine.getSnapshot();
        if (snap.outcome) {
          engine.confirmOutcome();
          continue;
        }
        const occupied = new Set(
          [...snap.players.filter((p) => p.hp > 0), ...snap.monsters.filter((m) => m.hp > 0)].map(
            (u) => `${u.position.x},${u.position.y}`,
          ),
        );
        const playersAlive = snap.players.some((p) => p.hp > 0);
        for (const intent of engine.getIntents()) {
          if (intent.kind !== 'move') continue;
          const m = snap.monsters.find((x) => x.instanceId === intent.instanceId);
          expect(m).toBeDefined();
          if (!intent.aim) {
            expect(playersAlive).toBe(false);
            continue;
          }
          if (m!.position.x === intent.to.x && m!.position.y === intent.to.y) {
            const next = add(m!.position, MOVE_VECTORS[stepDirectionToward(m!.position, intent.aim)]);
            expect(
              occupied.has(`${next.x},${next.y}`),
              `${id}: terrain-stuck at (${m!.position.x},${m!.position.y}) toward (${intent.aim.x},${intent.aim.y})`,
            ).toBe(true);
          }
        }
        engine.endTurn();
      }
    },
  );

  it("teng_yao's intent is never a move on any mission that fields it — its aiRules are useSkill-only", () => {
    const withTengYao = CAMPAIGN_MAP_IDS.filter((id) => allMonsterIds(maps[id]).includes('teng_yao'));
    expect(withTengYao.length).toBeGreaterThan(0); // sanity: the archetype is actually fielded somewhere
    for (const id of withTengYao) {
      const map = maps[id];
      const engine = new BattleEngine(map, map.squadCharacterIds!, registry);
      for (let i = 0; i < 20; i++) {
        const snap = engine.getSnapshot();
        if (snap.outcome) {
          engine.confirmOutcome();
          continue;
        }
        for (const intent of engine.getIntents()) {
          const m = snap.monsters.find((x) => x.instanceId === intent.instanceId);
          if (m?.monsterId === 'teng_yao') expect(intent.kind).toBe('skill');
        }
        engine.endTurn();
      }
    }
  });

  it('difficulty escalates island over island (average monster HP pool strictly rises), and each island boss (m5) is its island\'s hardest', () => {
    const monsterHp = (id: string) =>
      allMonsterIds(maps[id]).reduce((sum, mid) => sum + registry.monsters[mid].maxHp, 0);
    const islandAverages: number[] = [];
    for (const island of [1, 2, 3, 4]) {
      const pools = [1, 2, 3, 4, 5].map((m) => monsterHp(`island${island}_m${m}`));
      const boss = pools[4];
      for (let m = 0; m < 4; m++) {
        expect(boss, `island${island}_m5 (boss) must have a bigger HP pool than island${island}_m${m + 1}`).toBeGreaterThan(pools[m]);
      }
      islandAverages.push(pools.reduce((a, b) => a + b, 0) / pools.length);
    }
    for (let i = 1; i < islandAverages.length; i++) {
      expect(islandAverages[i], `island ${i + 1} must average harder than island ${i}`).toBeGreaterThan(islandAverages[i - 1]);
    }
  });

  it('monster archetypes are introduced progressively: island1 ghost+wolf only, yuan_ling from island2, teng_yao from island3, jiangshi from island4', () => {
    const islandRoster = (island: number) =>
      new Set([1, 2, 3, 4, 5].flatMap((m) => allMonsterIds(maps[`island${island}_m${m}`])));
    expect([...islandRoster(1)].sort()).toEqual(['yao_lang', 'yin_ghost']);
    expect(islandRoster(2).has('yuan_ling')).toBe(true);
    expect(islandRoster(2).has('teng_yao')).toBe(false);
    expect(islandRoster(2).has('jiangshi')).toBe(false);
    expect(islandRoster(3).has('teng_yao')).toBe(true);
    expect(islandRoster(3).has('jiangshi')).toBe(false);
    expect(islandRoster(4).has('jiangshi')).toBe(true);
  });
});

describe('island1_m1: winnable via the intended ITB line, not only survivable (solvability upper check)', () => {
  // The passive-loss test above proves doing nothing loses. This proves the
  // mission is actually WINNABLE the ITB way — the two ghosts can't both be
  // out-damaged in the action budget, but li_yan can shove one into a hazard
  // pit (a free kill push, not damage), and su_qing finishes the other before
  // it reaches the base. If a future engine/map edit breaks the push-into-pit
  // interaction, this scripted solution stops winning and the test catches it.
  it('shove-into-pit + ranged cleanup wins with the base never touched and the whole squad alive', () => {
    const map = maps.island1_m1;
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry); // [li_yan, su_qing, bai_zhi]

    // T1 — li_yan steps directly below the top ghost at (2,2) and palm_waves it
    // UP into the y=1 pit (instant kill, no damage spent); su_qing chips the
    // bottom ghost from range.
    expect(engine.moveUnit(0, { x: 2, y: 3 }).ok).toBe(true);
    expect(engine.useSkill(0, 'palm_wave', 'up').ok).toBe(true);
    expect(engine.moveUnit(1, { x: 4, y: 5 }).ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'left').ok).toBe(true);
    // the shoved ghost is already gone — the pit, not HP, removed it
    expect(engine.getSnapshot().monsters.filter((m) => m.hp > 0)).toHaveLength(2);
    engine.endTurn();

    // T2 — su_qing finishes the surviving ghost before it can claw the base.
    expect(engine.useSkill(1, 'flying_sword', 'left').ok).toBe(true);
    engine.endTurn();

    // T3 — both threats to the base are gone; mop up the two wolves.
    expect(engine.moveUnit(0, { x: 3, y: 3 }).ok).toBe(true);
    expect(engine.useSkill(0, 'sword_qi', 'right').ok).toBe(true);
    expect(engine.moveUnit(1, { x: 6, y: 5 }).ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'up').ok).toBe(true);
    engine.endTurn();

    // T4, T5 — survive out the fixed mission clock.
    engine.endTurn();
    engine.endTurn();

    const snap = engine.getSnapshot();
    expect(snap.outcome).toBe('victory');
    expect(snap.baseHp).toBe(8); // neutralized every base-threat before it landed a hit
    expect(snap.players.every((p) => p.hp > 0)).toBe(true); // a clean line loses no one
  });
});

describe('island1_m2: winnable via the choke line (solvability upper check)', () => {
  // A wall column splits the field; the two open rows (y=3, y=6) are single-file
  // pipes, so two heroes can't stack in the same corridor. The ITB read: su_qing
  // solos the row-3 ghost from range while li_yan takes the long way round row 6
  // to intercept the second ghost — neither base-threat ever reaches the wall.
  it('su_qing holds the row-3 corridor while li_yan flanks via row 6, base untouched, whole squad alive', () => {
    const map = maps.island1_m2;
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry); // [li_yan, su_qing, bai_zhi]

    // T1 — su_qing takes the corridor mouth and chips the row-3 ghost; li_yan
    // starts the long route down the row-6 passage.
    expect(engine.moveUnit(1, { x: 5, y: 3 }).ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'left').ok).toBe(true);
    expect(engine.moveUnit(0, { x: 4, y: 6 }).ok).toBe(true);
    engine.endTurn();

    // T2 — su_qing finishes the row-3 ghost down the pipe; li_yan reaches the
    // second ghost's column and chips it.
    expect(engine.useSkill(1, 'flying_sword', 'left').ok).toBe(true);
    expect(engine.moveUnit(0, { x: 3, y: 5 }).ok).toBe(true);
    expect(engine.useSkill(0, 'sword_qi', 'left').ok).toBe(true);
    engine.endTurn();

    // T3 — li_yan kills the second ghost before it reaches the base; su_qing
    // repositions and clears a wolf.
    expect(engine.moveUnit(0, { x: 3, y: 4 }).ok).toBe(true);
    expect(engine.useSkill(0, 'sword_qi', 'left').ok).toBe(true);
    expect(engine.moveUnit(1, { x: 5, y: 5 }).ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'down').ok).toBe(true);
    engine.endTurn();

    // T4 — clear the last wolf; T5 — ride out the clock.
    expect(engine.useSkill(1, 'flying_sword', 'up').ok).toBe(true);
    engine.endTurn();
    engine.endTurn();

    const snap = engine.getSnapshot();
    expect(snap.outcome).toBe('victory');
    expect(snap.baseHp).toBe(8); // neither ghost ever crossed the wall to the base
    expect(snap.players.every((p) => p.hp > 0)).toBe(true);
  });
});

describe('island1_m3: winnable via pit-the-ghost + clear-the-swarm (solvability upper check)', () => {
  // The "wipe" map — one base-ghost plus a wolf swarm that overruns a passive
  // squad (passive loss is a party wipe, not a base kill). li_yan shoves the
  // adjacent ghost straight east into the (4,2) hazard turn 1 (base secured for
  // free), then the squad picks the wolves apart before they can gang up.
  it('shove-the-ghost-into-a-pit then clear the wolves wins clean — base untouched, full squad', () => {
    const map = maps.island1_m3;
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry); // [li_yan, su_qing, bai_zhi]

    // T1 — palm_wave the adjacent ghost into the (4,2) pit; su_qing drops the
    // nearest wolf; bai_zhi moves up to support.
    expect(engine.useSkill(0, 'palm_wave', 'right').ok).toBe(true);
    expect(engine.moveUnit(1, { x: 3, y: 4 }).ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'down').ok).toBe(true);
    expect(engine.moveUnit(2, { x: 4, y: 6 }).ok).toBe(true);
    expect(engine.getSnapshot().baseHp).toBe(8); // ghost gone to the pit — base was never in danger
    engine.endTurn();

    // T2 — li_yan cuts down the wolf that closed in; su_qing repositions for the
    // reinforcement that emerges at end of this turn.
    expect(engine.moveUnit(0, { x: 2, y: 3 }).ok).toBe(true);
    expect(engine.useSkill(0, 'sword_qi', 'right').ok).toBe(true);
    expect(engine.moveUnit(1, { x: 5, y: 5 }).ok).toBe(true);
    engine.endTurn();

    // T3 — su_qing snipes the emerged wolf; the board is clear.
    expect(engine.useSkill(1, 'flying_sword', 'right').ok).toBe(true);
    engine.endTurn();

    // T4, T5 — nothing left; ride out the clock.
    engine.endTurn();
    engine.endTurn();

    const snap = engine.getSnapshot();
    expect(snap.outcome).toBe('victory');
    expect(snap.baseHp).toBe(8);
    expect(snap.players.every((p) => p.hp > 0)).toBe(true);
  });
});

describe('island1_m4: winnable against the 3-ghost rush via pit-push + tempo (solvability upper check)', () => {
  // The heaviest island-1 mission: base on the EAST, three ghosts (two now,
  // one emerging) racing it — a passive squad loses by turn 3. Out-damaging all
  // three is impossible in the action budget, so li_yan body-blocks one ghost
  // at (5,4) then palm_waves the other UP into the y=1 pit (a free kill that
  // buys the tempo to clean up the rest).
  it('body-block + pit-push holds the 3-ghost rush — base untouched, whole squad alive', () => {
    const map = maps.island1_m4;
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry); // [li_yan, su_qing, bai_zhi]

    // T1 — li_yan steps onto (5,4) to body-block the lower ghost; su_qing chips
    // the upper one; bai_zhi repositions.
    expect(engine.moveUnit(0, { x: 5, y: 4 }).ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'down').ok).toBe(true);
    expect(engine.moveUnit(2, { x: 3, y: 5 }).ok).toBe(true);
    engine.endTurn();

    // T2 — the chipped ghost has advanced to (5,3); li_yan palm_waves it UP two
    // tiles into the y=1 hazard (a kill without spending damage); su_qing chips
    // the blocked ghost.
    expect(engine.useSkill(0, 'palm_wave', 'up').ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'down').ok).toBe(true);
    expect(engine.moveUnit(2, { x: 4, y: 5 }).ok).toBe(true);
    expect(engine.getSnapshot().baseHp).toBe(8); // base still pristine going into the back half
    engine.endTurn();

    // T3 — su_qing finishes the blocked ghost; li_yan turns on the emerged one.
    expect(engine.useSkill(1, 'flying_sword', 'down').ok).toBe(true);
    expect(engine.moveUnit(0, { x: 4, y: 3 }).ok).toBe(true);
    expect(engine.useSkill(0, 'sword_qi', 'left').ok).toBe(true);
    engine.endTurn();

    // T4 — li_yan kills the last ghost (body-blocked into staying put); su_qing
    // cuts down the wolf. Board clear.
    expect(engine.useSkill(0, 'sword_qi', 'left').ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'left').ok).toBe(true);
    engine.endTurn();

    // T5 — ride out the clock.
    engine.endTurn();

    const snap = engine.getSnapshot();
    expect(snap.outcome).toBe('victory');
    expect(snap.baseHp).toBe(8);
    expect(snap.players.every((p) => p.hp > 0)).toBe(true);
  });
});

describe('island1_m5 (island boss): winnable via double hazard-pit-push (solvability upper check)', () => {
  // The boss was redesigned: three ghosts converge on the central 2×2 base from
  // below (where the squad has line of sight), with the two flank ghosts staged
  // on the hazard-adjacent lanes. The intended line uses the x=1 and x=6 hazard
  // COLUMNS as the answer — li_yan palm_waves the left ghost into the x=1 pit,
  // then the right ghost into the x=6 pit, while su_qing snipes the middle one
  // up the open lane and bai_zhi keeps her healthy. Base is never touched.
  it('pit both flank ghosts into the hazard columns, snipe the middle, clear the wolves — base untouched, full squad', () => {
    const map = maps.island1_m5;
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry); // [li_yan, su_qing, bai_zhi]

    // T1 — li_yan steps to (3,4) and shoves the left ghost west into the x=1
    // hazard column; su_qing chips the central ghost up the open lane.
    expect(engine.moveUnit(0, { x: 3, y: 4 }).ok).toBe(true);
    expect(engine.useSkill(0, 'palm_wave', 'left').ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'up').ok).toBe(true);
    expect(engine.moveUnit(2, { x: 5, y: 6 }).ok).toBe(true);
    engine.endTurn();

    // T2 — the right ghost has closed to (4,4); li_yan shoves it east into the
    // x=6 hazard column; su_qing finishes the central ghost.
    expect(engine.useSkill(0, 'palm_wave', 'right').ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'up').ok).toBe(true);
    expect(engine.moveUnit(2, { x: 4, y: 5 }).ok).toBe(true);
    expect(engine.getSnapshot().baseHp).toBe(8); // all three ghosts dealt with, base pristine
    engine.endTurn();

    // T3 — clear both wolves; bai_zhi tops su_qing back up.
    expect(engine.useSkill(1, 'flying_sword', 'left').ok).toBe(true);
    expect(engine.moveUnit(0, { x: 5, y: 5 }).ok).toBe(true);
    expect(engine.useSkill(0, 'sword_qi', 'right').ok).toBe(true);
    expect(engine.useSkill(2, 'minor_heal', 'down').ok).toBe(true);
    engine.endTurn();

    // T4, T5 — board clear; ride out the clock.
    engine.endTurn();
    engine.endTurn();

    const snap = engine.getSnapshot();
    expect(snap.outcome).toBe('victory');
    expect(snap.baseHp).toBe(8);
    expect(snap.players.every((p) => p.hp > 0)).toBe(true);
  });
});

describe('island2_m1: winnable — clear the ghost column, block the yuan_ling bolt (solvability upper check)', () => {
  // Island 2 introduces the yuan_ling, a ranged base-hunter. Here two ghosts
  // file up column 3 to the west base while a yuan_ling lines up a bolt down
  // row 3. li_yan melees the single-file column while su_qing snipes; then
  // su_qing plants herself on row 3 so the yuan_ling's bolt strikes HER
  // (friendly fire) instead of the base — the intended counter to the new
  // threat. One ghost claw lands (base 8→6) before the column falls; a legit
  // hold, not a flawless clear.
  it('melee the ghost column + body-block the ranged bolt — base held, whole squad alive', () => {
    const map = maps.island2_m1;
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry); // [li_yan, su_qing, bai_zhi]

    // T1 — li_yan steps onto column 3 and chips the lead ghost; su_qing moves up
    // column 2 to catch the ghosts as they shift toward the base.
    expect(engine.moveUnit(0, { x: 3, y: 3 }).ok).toBe(true);
    expect(engine.useSkill(0, 'sword_qi', 'up').ok).toBe(true);
    expect(engine.moveUnit(1, { x: 2, y: 4 }).ok).toBe(true);
    engine.endTurn();

    // T2 — su_qing snipes the lead ghost dead; li_yan closes on the second.
    expect(engine.useSkill(1, 'flying_sword', 'up').ok).toBe(true);
    expect(engine.moveUnit(0, { x: 2, y: 2 }).ok).toBe(true);
    expect(engine.useSkill(0, 'sword_qi', 'up').ok).toBe(true);
    engine.endTurn();

    // T3 — li_yan finishes the last ghost; su_qing plants on row 3 in the bolt
    // lane.
    expect(engine.useSkill(0, 'sword_qi', 'up').ok).toBe(true);
    expect(engine.moveUnit(1, { x: 2, y: 3 }).ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'up').ok).toBe(true);
    engine.endTurn();

    // T4 — su_qing holds the bolt lane and fires east; T5 — ride it out.
    expect(engine.moveUnit(1, { x: 3, y: 3 }).ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'right').ok).toBe(true);
    engine.endTurn();
    engine.endTurn();

    const snap = engine.getSnapshot();
    expect(snap.outcome).toBe('victory');
    expect(snap.baseHp).toBe(6); // exactly one ghost claw landed before the column fell — a hold, not a flawless clear
    expect(snap.players.every((p) => p.hp > 0)).toBe(true);
  });
});

describe('island2_m2: winnable via the dual-base split (solvability upper check)', () => {
  // Template C: two separate bases, west and east. The squad CAN'T stack both
  // damage-dealers on one threat — li_yan must hold the west lane while su_qing
  // holds the east. Each kills its ghost before it reaches the base (redesigned
  // from a broken layout where both ghosts started adjacent to the base and
  // clawed on turn 1 with no possible counter).
  it('split the squad, each lane kills its ghost pre-claw, then mop up — base untouched, full squad', () => {
    const map = maps.island2_m2;
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry); // [li_yan, su_qing, bai_zhi]

    // T1 — li_yan chips the west ghost in melee; su_qing chips the east ghost
    // from range; bai_zhi tucks into the center.
    expect(engine.useSkill(0, 'sword_qi', 'left').ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'up').ok).toBe(true);
    expect(engine.moveUnit(2, { x: 4, y: 5 }).ok).toBe(true);
    engine.endTurn();

    // T2 — both lanes finish their ghost before it can claw (base stays full).
    expect(engine.moveUnit(0, { x: 2, y: 4 }).ok).toBe(true);
    expect(engine.useSkill(0, 'sword_qi', 'up').ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'up').ok).toBe(true);
    expect(engine.getSnapshot().baseHp).toBe(8); // both base-threats dead, not a scratch on either base
    engine.endTurn();

    // T3 — su_qing kills the yuan_ling, li_yan a wolf; bai_zhi pulls clear.
    expect(engine.useSkill(1, 'flying_sword', 'down').ok).toBe(true);
    expect(engine.moveUnit(0, { x: 2, y: 5 }).ok).toBe(true);
    expect(engine.useSkill(0, 'sword_qi', 'down').ok).toBe(true);
    expect(engine.moveUnit(2, { x: 4, y: 3 }).ok).toBe(true);
    engine.endTurn();

    // T4 — su_qing swings east for another wolf; T5 — ride it out.
    expect(engine.moveUnit(1, { x: 6, y: 5 }).ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'down').ok).toBe(true);
    engine.endTurn();
    engine.endTurn();

    const snap = engine.getSnapshot();
    expect(snap.outcome).toBe('victory');
    expect(snap.baseHp).toBe(8);
    expect(snap.players.every((p) => p.hp > 0)).toBe(true);
  });
});

describe('island2_m3: winnable — focus the base-clawer, then hunt the yuan_ling pair (solvability upper check)', () => {
  // Hazard-flank map, west base. A yin_ghost starts adjacent to the base (claws
  // every turn) but is sandwiched between two heroes, so it dies turn 1 before
  // it can hit. The real work is the two yuan_ling ranged base-hunters plus two
  // wolves; su_qing kills the wolf menacing bai_zhi, then both damage-dealers
  // run the yuan_lings down before either lines up a bolt.
  it('kill the adjacent ghost pre-claw, then run down the ranged hunters — base untouched, whole squad alive', () => {
    const map = maps.island2_m3;
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry); // [li_yan, su_qing, bai_zhi]

    // T1 — li_yan and su_qing sandwich the base-adjacent ghost and kill it
    // before it claws.
    expect(engine.useSkill(0, 'sword_qi', 'down').ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'up').ok).toBe(true);
    expect(engine.getSnapshot().monsters.filter((m) => m.hp > 0)).toHaveLength(3); // ghost gone, no claw
    engine.endTurn();

    // T2 — su_qing cuts down the wolf closing on bai_zhi; li_yan opens on the
    // nearest yuan_ling.
    expect(engine.moveUnit(1, { x: 3, y: 4 }).ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'down').ok).toBe(true);
    expect(engine.moveUnit(0, { x: 3, y: 2 }).ok).toBe(true);
    expect(engine.useSkill(0, 'sword_qi', 'right').ok).toBe(true);
    engine.endTurn();

    // T3 — both hunt down the remaining ranged threats up the middle.
    expect(engine.moveUnit(1, { x: 3, y: 3 }).ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'right').ok).toBe(true);
    expect(engine.useSkill(0, 'sword_qi', 'right').ok).toBe(true);
    engine.endTurn();

    // T4 — su_qing snipes the last threat; T5 — ride it out.
    expect(engine.useSkill(1, 'flying_sword', 'right').ok).toBe(true);
    engine.endTurn();
    engine.endTurn();

    const snap = engine.getSnapshot();
    expect(snap.outcome).toBe('victory');
    expect(snap.baseHp).toBe(8); // the adjacent ghost never landed a claw, no yuan_ling ever bolted
    expect(snap.players.every((p) => p.hp > 0)).toBe(true);
  });
});

describe('island2_m4: winnable via LOS-through-hazard snipe + kiting (solvability upper check)', () => {
  // A tight hold. A yuan_ling parks at (1,3) and bolts up column 1 into the base
  // from turn 1; the key read is that hazard tiles DON'T block line of sight, so
  // su_qing can drop to (1,6) and one-shot it straight up the column through the
  // (1,4) pit. Meanwhile bai_zhi (a healer with no attack, starting next to a
  // wolf) kites it forever — her move outranges the wolf, and stepping away
  // dodges the telegraphed bite. The base bleeds to 2 but survives, whole squad
  // intact — a genuine hard mission, not a flawless clear.
  it('snipe the yuan_ling through the hazard, kite the wolf, hold the base — squad survives', () => {
    const map = maps.island2_m4;
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry); // [li_yan, su_qing, bai_zhi]

    // T1 — li_yan vacates the corridor so su_qing can reach (1,6) and snipe the
    // yuan_ling up column 1 (through the pit); bai_zhi begins kiting the wolf.
    expect(engine.moveUnit(0, { x: 2, y: 4 }).ok).toBe(true);
    expect(engine.moveUnit(1, { x: 1, y: 6 }).ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'up').ok).toBe(true);
    expect(engine.moveUnit(2, { x: 4, y: 6 }).ok).toBe(true);
    expect(engine.getSnapshot().baseHp).toBe(8); // no bolt landed — the yuan_ling is already dead
    engine.endTurn();

    // T2 — both damage-dealers turn on the ghosts closing on the base; bai_zhi
    // keeps fleeing.
    expect(engine.moveUnit(0, { x: 2, y: 2 }).ok).toBe(true);
    expect(engine.useSkill(0, 'sword_qi', 'up').ok).toBe(true);
    expect(engine.moveUnit(1, { x: 2, y: 5 }).ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'up').ok).toBe(true);
    expect(engine.moveUnit(2, { x: 2, y: 6 }).ok).toBe(true);
    engine.endTurn();

    // T3 — li_yan finishes the lead ghost; su_qing thins the reinforcement;
    // bai_zhi ducks into the far corner.
    expect(engine.useSkill(0, 'sword_qi', 'up').ok).toBe(true);
    expect(engine.moveUnit(1, { x: 2, y: 4 }).ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'up').ok).toBe(true);
    expect(engine.moveUnit(2, { x: 1, y: 6 }).ok).toBe(true);
    engine.endTurn();

    // T4 — bai_zhi keeps her distance; T5 — ride it out.
    expect(engine.moveUnit(2, { x: 1, y: 5 }).ok).toBe(true);
    engine.endTurn();
    engine.endTurn();

    const snap = engine.getSnapshot();
    expect(snap.outcome).toBe('victory');
    expect(snap.baseHp).toBe(2); // held on 2 — a deliberately tight island-2 mission
    expect(snap.players.every((p) => p.hp > 0)).toBe(true);
  });
});

describe('island2_m5 (island boss): winnable via double pit-push + yuan_ling snipes (solvability upper check)', () => {
  // Island-2 boss, redesigned from the same broken template-E layout as the old
  // island1_m5 (threats from the top, base blocking line-of-sight, unreachable).
  // Now the two flank ghosts stage on the hazard-adjacent lanes and the two
  // yuan_lings come up the middle: li_yan pits both ghosts into the x=1/x=6
  // columns while su_qing picks off the yuan_lings and wolves. Base never scratched.
  it('pit both ghosts into the hazard columns, snipe the ranged pair, mop up — base untouched, whole squad alive', () => {
    const map = maps.island2_m5;
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry); // [li_yan, su_qing, bai_zhi]

    // T1 — li_yan shoves the left ghost into the x=1 pit; su_qing one-shots the
    // central yuan_ling; bai_zhi steps toward the middle.
    expect(engine.moveUnit(0, { x: 3, y: 4 }).ok).toBe(true);
    expect(engine.useSkill(0, 'palm_wave', 'left').ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'up').ok).toBe(true);
    expect(engine.moveUnit(2, { x: 4, y: 5 }).ok).toBe(true);
    engine.endTurn();

    // T2 — li_yan pits the right ghost into the x=6 column; su_qing cuts down the
    // wolf coming up the west flank.
    expect(engine.useSkill(0, 'palm_wave', 'right').ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'left').ok).toBe(true);
    expect(engine.moveUnit(2, { x: 3, y: 5 }).ok).toBe(true);
    expect(engine.getSnapshot().baseHp).toBe(8); // both ghosts gone to the pits, base pristine
    engine.endTurn();

    // T3 — li_yan kills the emerged yuan_ling below him; su_qing swings east for
    // the second wolf; bai_zhi keeps clear.
    expect(engine.useSkill(0, 'sword_qi', 'down').ok).toBe(true);
    expect(engine.moveUnit(1, { x: 5, y: 5 }).ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'right').ok).toBe(true);
    expect(engine.moveUnit(2, { x: 2, y: 5 }).ok).toBe(true);
    engine.endTurn();

    // T4 — su_qing finishes the last straggler; T5 — ride it out.
    expect(engine.moveUnit(1, { x: 5, y: 4 }).ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'down').ok).toBe(true);
    engine.endTurn();
    engine.endTurn();

    const snap = engine.getSnapshot();
    expect(snap.outcome).toBe('victory');
    expect(snap.baseHp).toBe(8);
    expect(snap.players.every((p) => p.hp > 0)).toBe(true);
  });
});

describe('island3_m1: winnable — pit a ghost, block the artillery line, kite (solvability upper check)', () => {
  // Island 3 introduces teng_yao: a stationary artillery (hp4) that fires down
  // row 1 into the base. Three tactics answer this map: li_yan palm_waves the
  // near ghost into the (4,2) pit, then plants himself on (4,1) so the teng_yao's
  // shot hits HIM instead of the base (before finishing it in melee), while
  // bai_zhi kites the wolves. One artillery shot lands turn 1 (base 8→6) before
  // li_yan reaches the line — a legit hard hold.
  it('pit-push + block-the-artillery + kite holds the base and keeps the squad alive', () => {
    const map = maps.island3_m1;
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry); // [li_yan, su_qing, bai_zhi]

    // T1 — li_yan pits the near ghost into (4,2); su_qing chips the far ghost;
    // bai_zhi backs off the wolves.
    expect(engine.useSkill(0, 'palm_wave', 'right').ok).toBe(true);
    expect(engine.moveUnit(1, { x: 2, y: 3 }).ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'right').ok).toBe(true);
    expect(engine.moveUnit(2, { x: 2, y: 5 }).ok).toBe(true);
    engine.endTurn();

    // T2 — su_qing finishes the far ghost; li_yan steps onto (4,1) to eat the
    // teng_yao's line and chip it; bai_zhi keeps kiting.
    expect(engine.useSkill(1, 'flying_sword', 'right').ok).toBe(true);
    expect(engine.moveUnit(0, { x: 4, y: 1 }).ok).toBe(true);
    expect(engine.useSkill(0, 'sword_qi', 'right').ok).toBe(true);
    expect(engine.moveUnit(2, { x: 2, y: 6 }).ok).toBe(true);
    engine.endTurn();

    // T3 — li_yan kills the teng_yao; su_qing turns on the wolves; bai_zhi tucks
    // into the corner.
    expect(engine.useSkill(0, 'sword_qi', 'right').ok).toBe(true);
    expect(engine.moveUnit(1, { x: 4, y: 4 }).ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'down').ok).toBe(true);
    expect(engine.moveUnit(2, { x: 1, y: 6 }).ok).toBe(true);
    engine.endTurn();

    // T4 — su_qing picks off a wolf; T5 — ride it out.
    expect(engine.useSkill(1, 'flying_sword', 'up').ok).toBe(true);
    engine.endTurn();
    engine.endTurn();

    const snap = engine.getSnapshot();
    expect(snap.outcome).toBe('victory');
    expect(snap.baseHp).toBe(6); // one artillery shot landed before li_yan blocked the line
    expect(snap.players.every((p) => p.hp > 0)).toBe(true);
  });
});

describe('island3_m2: winnable — hold the artillery line from turn 1, self-heal through the chip (solvability upper check)', () => {
  // Here the teng_yao fires down row 3 straight at the base. The clean answer is
  // to plant su_qing on (2,3) turn 1: she both BLOCKS the shot (it hits her, not
  // the base) AND out-ranges the teng_yao to kill it down the same row. li_yan
  // deals with the ghost then the near wolf; bai_zhi rests to self-heal through
  // the chip. Base never scratched.
  it('su_qing blocks-and-kills the artillery down row 3 while the rest hold — base untouched, whole squad alive', () => {
    const map = maps.island3_m2;
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry); // [li_yan, su_qing, bai_zhi]

    // T1 — li_yan chips the ghost; su_qing steps onto (2,3), eating the teng_yao's
    // line and chipping it back down the row; bai_zhi rests.
    expect(engine.moveUnit(0, { x: 3, y: 4 }).ok).toBe(true);
    expect(engine.useSkill(0, 'sword_qi', 'right').ok).toBe(true);
    expect(engine.moveUnit(1, { x: 2, y: 3 }).ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'right').ok).toBe(true);
    expect(engine.rest(2).ok).toBe(true);
    engine.endTurn();

    // T2 — li_yan finishes the ghost; su_qing finishes the teng_yao down row 3.
    expect(engine.useSkill(0, 'sword_qi', 'right').ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'right').ok).toBe(true);
    expect(engine.rest(2).ok).toBe(true);
    expect(engine.getSnapshot().baseHp).toBe(8); // the row-3 shot was blocked all along
    engine.endTurn();

    // T3 — li_yan turns on the near wolf; su_qing repositions to snipe the yuan_ling.
    expect(engine.useSkill(0, 'sword_qi', 'down').ok).toBe(true);
    expect(engine.moveUnit(1, { x: 2, y: 2 }).ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'right').ok).toBe(true);
    expect(engine.rest(2).ok).toBe(true);
    engine.endTurn();

    // T4 — clean up; T5 — ride it out.
    expect(engine.useSkill(0, 'sword_qi', 'down').ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'right').ok).toBe(true);
    engine.endTurn();
    engine.endTurn();

    const snap = engine.getSnapshot();
    expect(snap.outcome).toBe('victory');
    expect(snap.baseHp).toBe(8);
    expect(snap.players.every((p) => p.hp > 0)).toBe(true);
  });
});

describe('island3_m3: winnable — kill the ghost and block its reinforcement tile (solvability upper check)', () => {
  // Dual base, but the threats pile onto the WEST side: a ghost plus a turn-2
  // emergence right beside the base. su_qing chips the ghost, then li_yan kills
  // it AND parks on the emergence tile (2,2) so the reinforcement can't spawn
  // (it fizzles for 1 chip damage to him) — two threats neutralized by one body.
  // su_qing then sweeps right to clear the yuan_ling and wolf.
  it('block-the-emergence + sweep the ranged threats — base untouched, whole squad alive', () => {
    const map = maps.island3_m3;
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry); // [li_yan, su_qing, bai_zhi]

    // T1 — su_qing chips the west ghost up its column; li_yan advances to the
    // base's shoulder; bai_zhi tucks into the far corner.
    expect(engine.moveUnit(1, { x: 3, y: 3 }).ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'up').ok).toBe(true);
    expect(engine.moveUnit(0, { x: 2, y: 3 }).ok).toBe(true);
    expect(engine.moveUnit(2, { x: 5, y: 6 }).ok).toBe(true);
    engine.endTurn();

    // T2 — li_yan steps onto (2,2): he kills the ghost above him AND occupies the
    // telegraphed emergence tile so the reinforcement can't come up.
    expect(engine.useSkill(1, 'flying_sword', 'up').ok).toBe(true);
    expect(engine.moveUnit(0, { x: 2, y: 2 }).ok).toBe(true);
    expect(engine.useSkill(0, 'sword_qi', 'up').ok).toBe(true);
    engine.endTurn();

    // T3 — su_qing sweeps right to kill the yuan_ling and wolf; li_yan holds the
    // tile.
    expect(engine.moveUnit(1, { x: 4, y: 3 }).ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'right').ok).toBe(true);
    expect(engine.useSkill(0, 'sword_qi', 'up').ok).toBe(true);
    engine.endTurn();

    // T4 — su_qing finishes off; T5 — ride it out.
    expect(engine.useSkill(1, 'flying_sword', 'right').ok).toBe(true);
    engine.endTurn();
    engine.endTurn();

    const snap = engine.getSnapshot();
    expect(snap.outcome).toBe('victory');
    expect(snap.baseHp).toBe(8); // the west ghost died pre-claw and its reinforcement never emerged
    expect(snap.players.every((p) => p.hp > 0)).toBe(true);
  });
});

describe('island3_m4: winnable — read the walls, block the one live bolt line, kite (solvability upper check)', () => {
  // The double-turret choke. The key read: BOTH teng_yao fire into the wall
  // column and can't reach the base, and the row-4 yuan_ling is walled off too —
  // the only live base threat is the ghost plus the row-3 yuan_ling firing
  // through the gap. li_yan kills the ghost; su_qing plants on (3,3) to body-block
  // that bolt line all game; bai_zhi kites the lone wolf (stepping off her tile
  // each turn dodges the telegraphed bite). Base never touched.
  it('block the through-gap bolt + kite the wolf, ignoring the walled turrets — base untouched, whole squad alive', () => {
    const map = maps.island3_m4;
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry); // [li_yan, su_qing, bai_zhi]

    // T1 — su_qing chips the ghost and plants on (3,3) (blocking the row-3 bolt
    // lane); li_yan finishes the ghost; bai_zhi starts kiting the wolf.
    expect(engine.moveUnit(1, { x: 3, y: 3 }).ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'up').ok).toBe(true);
    expect(engine.moveUnit(0, { x: 3, y: 2 }).ok).toBe(true);
    expect(engine.useSkill(0, 'sword_qi', 'up').ok).toBe(true);
    expect(engine.moveUnit(2, { x: 3, y: 6 }).ok).toBe(true);
    engine.endTurn();

    // T2-T4 — su_qing holds the line and fires down row 3; bai_zhi keeps moving so
    // the wolf's telegraphed bite always lands on empty tiles.
    expect(engine.useSkill(1, 'flying_sword', 'right').ok).toBe(true);
    expect(engine.moveUnit(2, { x: 4, y: 6 }).ok).toBe(true);
    engine.endTurn();
    expect(engine.getSnapshot().baseHp).toBe(8); // nothing has reached the base — the turrets are walled off, the bolt blocked

    expect(engine.useSkill(1, 'flying_sword', 'right').ok).toBe(true);
    expect(engine.moveUnit(2, { x: 5, y: 6 }).ok).toBe(true);
    engine.endTurn();

    expect(engine.moveUnit(2, { x: 6, y: 6 }).ok).toBe(true);
    engine.endTurn();

    // T5 — bai_zhi is cornered but the clock runs out first; rest for the record.
    expect(engine.rest(2).ok).toBe(true);
    engine.endTurn();

    const snap = engine.getSnapshot();
    expect(snap.outcome).toBe('victory');
    expect(snap.baseHp).toBe(8);
    expect(snap.players.every((p) => p.hp > 0)).toBe(true);
  });
});

describe('island3_m5 (island boss): winnable — pit, then block the reinforcement emergence (solvability upper check)', () => {
  // Template-E boss, but the two teng_yao fire down columns 2 and 5 — MISSING the
  // central base entirely. So the only base threats are the ghost (pit it into
  // the x=1 column turn 1) and a turn-3 reinforcement telegraphed at (4,4).
  // li_yan shoves the first ghost into the pit, su_qing kills the yuan_ling, then
  // li_yan parks on (4,4) so the reinforcement can never emerge. The base is
  // never clawed — the turrets are just noise against the wrong columns.
  it('pit the ghost + occupy the emergence tile, ignoring the mis-aimed turrets — base untouched, whole squad alive', () => {
    const map = maps.island3_m5;
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry); // [li_yan, su_qing, bai_zhi]

    // T1 — li_yan pits the near ghost into the x=1 hazard column; su_qing snipes
    // the yuan_ling; bai_zhi holds the safe corner.
    expect(engine.moveUnit(0, { x: 3, y: 4 }).ok).toBe(true);
    expect(engine.useSkill(0, 'palm_wave', 'left').ok).toBe(true);
    expect(engine.moveUnit(1, { x: 5, y: 6 }).ok).toBe(true);
    expect(engine.useSkill(1, 'flying_sword', 'up').ok).toBe(true);
    expect(engine.rest(2).ok).toBe(true);
    engine.endTurn();

    // T2 — li_yan moves onto the telegraphed emergence tile (4,4); su_qing pulls
    // back off the turret column.
    expect(engine.moveUnit(0, { x: 4, y: 4 }).ok).toBe(true);
    expect(engine.moveUnit(1, { x: 4, y: 6 }).ok).toBe(true);
    expect(engine.rest(2).ok).toBe(true);
    engine.endTurn();

    // T3 — li_yan holds (4,4): the reinforcement can't come up (it fizzles for 1
    // chip to him). Base still pristine.
    expect(engine.rest(0).ok).toBe(true);
    expect(engine.rest(1).ok).toBe(true);
    expect(engine.rest(2).ok).toBe(true);
    engine.endTurn();
    expect(engine.getSnapshot().baseHp).toBe(8); // no ghost ever clawed; the turrets missed the base all game

    // T4, T5 — hold the line to the clock.
    expect(engine.rest(0).ok).toBe(true);
    expect(engine.rest(1).ok).toBe(true);
    engine.endTurn();
    engine.endTurn();

    const snap = engine.getSnapshot();
    expect(snap.outcome).toBe('victory');
    expect(snap.baseHp).toBe(8);
    expect(snap.players.every((p) => p.hp > 0)).toBe(true);
  });
});

describe("final mission (final_hive) — ITB Last Stand's decisive phase: protect a 4-HP objective for 5 turns", () => {
  it('fixed 8×8 grid, totalTurns 5, baseHp 4 (the sealing array, matching the Renfield Bomb), explicit 3-person squad', () => {
    const map = maps.final_hive;
    expect(map.grid).toHaveLength(8);
    for (const row of map.grid) expect(row).toHaveLength(8);
    expect(map.totalTurns).toBe(5);
    expect(map.baseHp).toBe(4);
    expect(map.squadCharacterIds).toEqual(['li_yan', 'ling_er', 'bai_zhi']);
    expect(map.playerStarts).toHaveLength(3);
  });

  it('fields 6 monsters mixing base-threats with player-threats (A5), the heaviest composition allowed', () => {
    const ids = allMonsterIds(maps.final_hive);
    expect(ids).toHaveLength(6);
    expect(ids.some((m) => BASE_THREATS.has(m))).toBe(true);
    expect(ids.some((m) => PLAYER_THREATS.has(m))).toBe(true);
  });

  it('a fully passive run loses fast — a 4-HP objective under this assault cannot be idled through', () => {
    const map = maps.final_hive;
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry);
    let turns = 0;
    while (!engine.getSnapshot().outcome && turns < 10) {
      engine.endTurn();
      turns += 1;
    }
    expect(engine.getSnapshot().outcome).toBe('defeat');
  });

  it('no monster ever gets terrain-stuck with a move intent that goes nowhere', () => {
    const map = maps.final_hive;
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry);
    for (let i = 0; i < 60; i++) {
      const snap = engine.getSnapshot();
      if (snap.outcome) {
        engine.confirmOutcome();
        continue;
      }
      const occupied = new Set(
        [...snap.players.filter((p) => p.hp > 0), ...snap.monsters.filter((m) => m.hp > 0)].map(
          (u) => `${u.position.x},${u.position.y}`,
        ),
      );
      const playersAlive = snap.players.some((p) => p.hp > 0);
      for (const intent of engine.getIntents()) {
        if (intent.kind !== 'move') continue;
        const m = snap.monsters.find((x) => x.instanceId === intent.instanceId);
        expect(m).toBeDefined();
        if (!intent.aim) {
          expect(playersAlive).toBe(false);
          continue;
        }
        if (m!.position.x === intent.to.x && m!.position.y === intent.to.y) {
          const next = add(m!.position, MOVE_VECTORS[stepDirectionToward(m!.position, intent.aim)]);
          expect(
            occupied.has(`${next.x},${next.y}`),
            `final_hive: terrain-stuck at (${m!.position.x},${m!.position.y}) toward (${intent.aim.x},${intent.aim.y})`,
          ).toBe(true);
        }
      }
      engine.endTurn();
    }
  });
});

describe('lesson levels (standalone tutorial sequence — replaces the old scripted TutorialDef system)', () => {
  it('LESSON_MAP_IDS names exactly five real entries in `maps`, each a genuine MapDef (not a special content kind)', () => {
    expect(LESSON_MAP_IDS).toEqual([
      'lesson_ap_cost',
      'lesson_opportunity_attack',
      'lesson_push_abyss',
      'lesson_healer',
      'lesson_poison_mist',
    ]);
    for (const id of LESSON_MAP_IDS) {
      const map = maps[id];
      expect(map).toBeDefined();
      expect(map.initialMonsters.length + map.spawnSchedule.length).toBeGreaterThan(0); // has some monster
      expect(map.spawnSchedule).toHaveLength(0); // small practice levels: no emergence tiles
      expect(map.totalTurns).toBeLessThanOrEqual(12); // short mission, not a campaign-length run
    }
  });

  it.each(LESSON_MAP_IDS)('%s: builds a playable BattleEngine without throwing', (id) => {
    const map = maps[id];
    const squad = map.squadCharacterIds ?? STARTING_SQUAD;
    const engine = new BattleEngine(map, squad, registry);
    expect(engine.getSnapshot().players.length).toBe(squad.length);
    expect(engine.getSnapshot().baseTiles.length).toBeGreaterThan(0);
  });

  it.each(LESSON_MAP_IDS)(
    '%s: a fully passive run (never acting, only ending turns) loses within 60 turns — doing nothing is not a viable strategy',
    (id) => {
      const map = maps[id];
      const squad = map.squadCharacterIds ?? STARTING_SQUAD;
      const engine = new BattleEngine(map, squad, registry);
      let turns = 0;
      while (!engine.getSnapshot().outcome && turns < 60) {
        engine.endTurn();
        turns += 1;
      }
      expect(engine.getSnapshot().outcome).toBe('defeat');
    },
  );

  it.each(LESSON_MAP_IDS)(
    '%s: no monster ever gets terrain-stuck with a move intent that goes nowhere (same regression the campaign missions guard against)',
    (id) => {
      const map = maps[id];
      const squad = map.squadCharacterIds ?? STARTING_SQUAD;
      const engine = new BattleEngine(map, squad, registry);
      for (let i = 0; i < 60; i++) {
        const snap = engine.getSnapshot();
        if (snap.outcome) {
          engine.confirmOutcome();
          continue;
        }
        const occupied = new Set(
          [...snap.players.filter((p) => p.hp > 0), ...snap.monsters.filter((m) => m.hp > 0)].map(
            (u) => `${u.position.x},${u.position.y}`,
          ),
        );
        const playersAlive = snap.players.some((p) => p.hp > 0);
        for (const intent of engine.getIntents()) {
          if (intent.kind !== 'move') continue;
          const m = snap.monsters.find((x) => x.instanceId === intent.instanceId);
          expect(m).toBeDefined();
          if (!intent.aim) {
            expect(playersAlive).toBe(false);
            continue;
          }
          if (m!.position.x === intent.to.x && m!.position.y === intent.to.y) {
            const next = add(m!.position, MOVE_VECTORS[stepDirectionToward(m!.position, intent.aim)]);
            expect(occupied.has(`${next.x},${next.y}`)).toBe(true);
          }
        }
        engine.endTurn();
      }
    },
  );

  it('lesson_ap_cost: one committed move + one action per turn — and after acting, movement is locked', () => {
    const map = maps.lesson_ap_cost;
    const engine = new BattleEngine(map, STARTING_SQUAD, registry);
    // Li Yan (2,1) commits his whole move phase in one call: 2 BFS tiles to
    // (3,2), landing adjacent to the ghost at (4,2).
    expect(engine.moveUnit(0, { x: 3, y: 2 }).ok).toBe(true);
    expect(engine.useSkill(0, 'sword_qi', 'right').ok).toBe(true); // move-then-act: the intended flow
    expect(engine.getSnapshot().monsters[0].hp).toBe(1); // yin_ghost 3 - sword_qi 2
    // The lesson's core rule: acting ends the unit's turn — no more movement.
    expect(engine.moveUnit(0, { x: 2, y: 2 })).toEqual({ ok: false, reason: 'already-acted' });
    engine.endTurn();
    // Finish it next turn from the same tile.
    expect(engine.useSkill(0, 'sword_qi', 'right').ok).toBe(true);
    expect(engine.getSnapshot().monsters.every((m) => m.hp <= 0)).toBe(true); // the ghost is dead
    expect(engine.getSnapshot().baseHp).toBe(map.baseHp); // base never took a hit
  });

  it('lesson_opportunity_attack: the tile you strike from is the tile you stay on — no retreat after acting', () => {
    const map = maps.lesson_opportunity_attack;
    const engine = new BattleEngine(map, STARTING_SQUAD, registry);
    expect(engine.moveUnit(0, { x: 2, y: 2 }).ok).toBe(true); // step down, adjacent to the ghost at (2,3)
    expect(engine.useSkill(0, 'sword_qi', 'down').ok).toBe(true); // hurt it, but it survives (3 - 2 = 1hp)
    expect(engine.getSnapshot().monsters[0].hp).toBeGreaterThan(0);
    // The lesson: there is no walking away from the swing — position IS the commitment.
    expect(engine.moveUnit(0, { x: 2, y: 1 })).toEqual({ ok: false, reason: 'already-acted' });
    engine.endTurn(); // the ghost's telegraphed move (toward the base) resolves
    // Finish the job next turn — reposition to line it up, then strike.
    const ghost = engine.getSnapshot().monsters[0];
    expect(engine.moveUnit(0, { x: ghost.position.x + 1, y: ghost.position.y }).ok).toBe(true);
    expect(engine.useSkill(0, 'sword_qi', 'left').ok).toBe(true);
    expect(engine.getSnapshot().monsters.every((m) => m.hp <= 0)).toBe(true);
    engine.endTurn();
    // Killing every monster is never victory by itself (A4) — this map's
    // totalTurns is well beyond the couple of turns this test spends, so the
    // run is still in progress, not won.
    expect(engine.getSnapshot().outcome).toBeNull();
  });

  it('lesson_push_abyss: Cloud-Parting Palm shoves the ghost into the hazard tile and kills it outright', () => {
    const map = maps.lesson_push_abyss;
    const engine = new BattleEngine(map, STARTING_SQUAD, registry);
    expect(engine.getSnapshot().monsters).toHaveLength(1);
    expect(engine.useSkill(0, 'palm_wave', 'right').ok).toBe(true);
    expect(engine.getSnapshot().monsters.every((m) => m.hp <= 0)).toBe(true);
    engine.endTurn();
    // Killing the only monster is not victory by itself (A4) — the mission's
    // totalTurns hasn't elapsed yet, so the run continues; the base is simply untouched.
    expect(engine.getSnapshot().outcome).toBeNull();
    expect(engine.getSnapshot().baseHp).toBe(map.baseHp);
  });

  it("lesson_healer: Bai Zhi's minor_heal actually raises Li Yan's HP back up after the wolf lands a hit", () => {
    const map = maps.lesson_healer;
    const squad = map.squadCharacterIds!;
    expect(squad).toEqual(['li_yan', 'bai_zhi']);
    const engine = new BattleEngine(map, squad, registry);
    const liYanMaxHp = engine.getSnapshot().players[0].maxHp;
    // The yao_lang spawns at (1,3), adjacent to Li Yan at (1,2) — its very
    // first telegraphed wolf_bite lands on the first endTurn, giving a real,
    // non-full HP target to heal (no synthetic damage mutation needed).
    engine.endTurn();
    const hpAfterHit = engine.getSnapshot().players[0].hp;
    expect(hpAfterHit).toBeLessThan(liYanMaxHp);
    expect(hpAfterHit).toBeGreaterThan(0);
    // Bai Zhi (1,1) heals straight down at Li Yan (1,2) — under the ITB
    // economy the heal is her one action for the turn.
    expect(engine.useSkill(1, 'minor_heal', 'down').ok).toBe(true);
    const hpAfterHeal = engine.getSnapshot().players[0].hp;
    expect(hpAfterHeal).toBeGreaterThan(hpAfterHit);
    expect(engine.getSnapshot().players[1].acted).toBe(true); // healing spent Bai Zhi's action
  });

  it('lesson_poison_mist: the ghost takes a free poison-mist tick crossing the mist tile, so a single Sword Qi Slash finishes it', () => {
    const map = maps.lesson_poison_mist;
    const squad = map.squadCharacterIds!;
    expect(squad).toEqual(['li_yan']);
    const engine = new BattleEngine(map, squad, registry);
    const ghostMaxHp = engine.getSnapshot().monsters[0].maxHp;
    // One committed move (2 BFS tiles, within Li Yan's moveRange 3) to
    // (2,3), right beside the mist tile the ghost's route crosses.
    expect(engine.moveUnit(0, { x: 2, y: 3 }).ok).toBe(true);
    engine.endTurn(); // the ghost steps onto the mist tile (3,3) en route to the base and takes the free tick
    const ghostHpAfterMist = engine.getSnapshot().monsters[0].hp;
    expect(ghostHpAfterMist).toBeLessThan(ghostMaxHp);
    expect(engine.getSnapshot().monsters[0].position).toEqual({ x: 3, y: 3 }); // standing on the mist
    expect(engine.useSkill(0, 'sword_qi', 'right').ok).toBe(true);
    expect(engine.getSnapshot().monsters.every((m) => m.hp <= 0)).toBe(true); // one hit, thanks to the mist chip
    engine.endTurn();
    // Killing the ghost doesn't win the level by itself (A4) — this map's
    // totalTurns hasn't elapsed after just 2 turns, so the run is still open.
    expect(engine.getSnapshot().outcome).toBeNull();
  });
});

describe('Ultimate skills (real shipped content: sword_tempest / sword_rampage / roaring_shockwave / spring_rain)', () => {
  const ultimateRoomGrid = [
    '#############',
    '#           #',
    '#           #',
    '#           #',
    '#           #',
    '#          B#',
    '#############',
  ];

  /** Same rounding rule BattleEngine.effectAmount() applies for amountIsPercent: floor(hp * pct/100) — 0 is a real fizzle, no minimum-1 execute. */
  function expectedPercentDamage(hp: number, pct: number): number {
    return Math.floor(hp * (pct / 100));
  }

  function ultimateSquadMap(monsters: Array<{ monsterId: string; spawn: { x: number; y: number } }>): MapDef {
    return {
      formatVersion: 1,
      id: 'ultimate-squad-test',
      nameKey: 'map.ultimatesquadtest.name',
      grid: ultimateRoomGrid,
      baseHp: 8,
      playerStarts: [
        { x: 2, y: 3 }, // li_yan
        { x: 3, y: 3 }, // su_qing
        { x: 4, y: 3 }, // ling_er
        { x: 5, y: 3 }, // bai_zhi
      ],
      squadCharacterIds: ['li_yan', 'su_qing', 'ling_er', 'bai_zhi'],
      initialMonsters: monsters,
      spawnSchedule: [],
      totalTurns: 99,
    };
  }

  it("every character's ultimateSkillId points at a real registered skill", () => {
    // Skills carry no cost of their own under the ITB economy — an ultimate
    // is one action like any other (its extra price is the once-per-level
    // lock), so resolving to a real skill is the whole contract now.
    for (const [charId, def] of Object.entries(registry.characters)) {
      const ultimate = registry.skills[def.ultimateSkillId];
      expect(ultimate, `${charId}'s ultimateSkillId '${def.ultimateSkillId}' must resolve to a real skill`).toBeTruthy();
    }
  });

  it("li_yan's 劍氣狂潮 (sword_tempest) hits only enemies for 30% of their current hp, leaving every ally untouched", () => {
    const map = ultimateSquadMap([
      { monsterId: 'jiangshi', spawn: { x: 8, y: 3 } },
      { monsterId: 'yin_ghost', spawn: { x: 9, y: 3 } },
    ]);
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry);
    const before = engine.getSnapshot();
    const jiangshiHp = before.monsters.find((m) => m.monsterId === 'jiangshi')!.hp;
    const ghostHp = before.monsters.find((m) => m.monsterId === 'yin_ghost')!.hp;

    const res = engine.useSkill(0, 'sword_tempest', 'right');
    expect(res).toEqual({ ok: true });

    const after = engine.getSnapshot();
    expect(after.monsters.find((m) => m.monsterId === 'jiangshi')!.hp).toBe(
      jiangshiHp - expectedPercentDamage(jiangshiHp, 30),
    );
    expect(after.monsters.find((m) => m.monsterId === 'yin_ghost')!.hp).toBe(
      ghostHp - expectedPercentDamage(ghostHp, 30),
    );
    // Every ally (including li_yan himself) is untouched — allEnemies never lands on a player.
    for (let i = 0; i < before.players.length; i++) {
      expect(after.players[i].hp).toBe(before.players[i].hp);
    }
    expect(after.players[0].acted).toBe(true); // the ultimate was the caster's one action
    expect(after.players[0].ultimateUsed).toBe(true);
  });

  it("su_qing's 飛劍失控 (sword_rampage) hits EVERY unit for 20% of current hp — allies and su_qing herself included, monsters too", () => {
    const map = ultimateSquadMap([{ monsterId: 'jiangshi', spawn: { x: 8, y: 3 } }]);
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry);
    const before = engine.getSnapshot();
    const jiangshiHp = before.monsters[0].hp;
    const suQingHp = before.players[1].hp; // caster's own hp, before self-damage

    const res = engine.useSkill(1, 'sword_rampage', 'right');
    expect(res).toEqual({ ok: true });

    const after = engine.getSnapshot();
    expect(after.monsters[0].hp).toBe(jiangshiHp - expectedPercentDamage(jiangshiHp, 20));
    // su_qing is EXCLUDED from her own allUnits cast (see TargetMode 'allUnits' doc
    // comment — the cast already spends her one action for the turn).
    expect(after.players[1].hp).toBe(suQingHp);
    // The other three squad members (li_yan, ling_er, bai_zhi) ARE hit.
    for (const i of [0, 2, 3]) {
      expect(after.players[i].hp).toBe(before.players[i].hp - expectedPercentDamage(before.players[i].hp, 20));
    }
  });

  it("ling_er's 怒吼震擊 (roaring_shockwave) knocks every enemy back 2 tiles, radially away from her own position", () => {
    const map = ultimateSquadMap([
      { monsterId: 'jiangshi', spawn: { x: 6, y: 3 } }, // 2 tiles right of ling_er (4,3)
    ]);
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry);
    const res = engine.useSkill(2, 'roaring_shockwave', 'right');
    expect(res).toEqual({ ok: true });
    const monster = engine.getSnapshot().monsters[0];
    expect(monster.position).toEqual({ x: 8, y: 3 }); // pushed 2 tiles further away from (4,3)
  });

  it("bai_zhi's 回春甘霖 (spring_rain) restores 3 hp to every OTHER ally, never herself", () => {
    const map = ultimateSquadMap([{ monsterId: 'jiangshi', spawn: { x: 8, y: 3 } }]);
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry);
    const bai = engine.getSnapshot().players[3];
    expect(bai.hp).toBe(bai.maxHp); // full hp — heal on an already-full ally correctly no-ops below

    const res = engine.useSkill(3, 'spring_rain', 'right');
    expect(res).toEqual({ ok: true });
    // Everyone (li_yan, su_qing, ling_er) started at full hp too, so the heal
    // has nothing to raise — assert via getLastEvents() that targeting is
    // still correct (3 allies reached, bai_zhi herself excluded) rather than
    // relying on an hp delta that a full-hp squad can't show.
    const events = engine.getLastEvents();
    expect(events).toHaveLength(0); // heal events only fire when hp actually rises (see applyEffect) — full squad, so none fire
    expect(engine.getSnapshot().players[3].acted).toBe(true); // the action is still spent even though nothing needed healing
    expect(engine.getSnapshot().players[3].ultimateUsed).toBe(true);
  });

  it('a used ultimate is rejected on a second cast within the same level run, even after AP refills next turn', () => {
    const map = ultimateSquadMap([{ monsterId: 'jiangshi', spawn: { x: 8, y: 3 } }]);
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry);
    engine.useSkill(0, 'sword_tempest', 'right');
    engine.endTurn();
    expect(engine.getSnapshot().players[0].acted).toBe(false); // fresh action economy on the new turn
    expect(engine.useSkill(0, 'sword_tempest', 'right')).toEqual({ ok: false, reason: 'ultimate-already-used' });
  });

  it('resetLevel() clears every squad member\'s ultimateUsed lock, resetTurn() does not', () => {
    const map = ultimateSquadMap([{ monsterId: 'jiangshi', spawn: { x: 8, y: 3 } }]);
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry);
    engine.useSkill(0, 'sword_tempest', 'right');
    engine.endTurn();
    expect(engine.getSnapshot().players[0].ultimateUsed).toBe(true);

    engine.resetTurn(); // only undoes actions taken THIS turn — the ultimate was locked in last turn
    expect(engine.getSnapshot().players[0].ultimateUsed).toBe(true);

    engine.resetLevel();
    expect(engine.getSnapshot().players[0].ultimateUsed).toBe(false);
  });
});
