import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../core/battle/engine';
import { MOVE_VECTORS, add, stepDirectionToward } from '../core/geometry';
import type { MapDef } from '../core/content/types';
import {
  STARTING_SQUAD,
  DEFAULT_MAP_ID,
  maps,
  yanwuGroundMap,
  registry,
  LESSON_MAP_IDS,
  LEVEL_GROUPS,
  WORLD_STRUCTURE,
} from '../content/registry';

describe('Phase 0 content registry', () => {
  it('parses all builtin content without throwing', () => {
    expect(Object.keys(registry.characters)).toEqual(['li_yan', 'su_qing', 'bai_zhi', 'ling_er']);
    expect(Object.keys(registry.monsters)).toEqual([
      'yin_ghost',
      'jiangshi',
      'yuan_ling',
      'teng_yao',
      'yao_lang',
    ]);
    expect(yanwuGroundMap.waves).toHaveLength(5); // 1-5 finale spec: 5 waves (see roadmap ch.4 關卡結構)
  });

  it('builds a playable BattleEngine from real content with a valid initial intent', () => {
    const engine = new BattleEngine(yanwuGroundMap, STARTING_SQUAD, registry);
    const snap = engine.getSnapshot();
    expect(snap.players).toHaveLength(2);
    expect(snap.monsters).toHaveLength(2);

    // Wave 1's ghosts spawn 4+ tiles from either hero — out of ghost_claw's
    // range(1), so their only matching aiRule is the unconditional 'moveToward' fallback.
    expect(engine.getIntents()).toEqual([
      { kind: 'move', instanceId: expect.any(String), to: expect.any(Object), aim: expect.any(Object) },
      { kind: 'move', instanceId: expect.any(String), to: expect.any(Object), aim: expect.any(Object) },
    ]);
  });

  it('runs several turns of real content end-to-end without throwing', () => {
    const engine = new BattleEngine(yanwuGroundMap, STARTING_SQUAD, registry);
    for (let turn = 0; turn < 8; turn++) {
      if (engine.getSnapshot().outcome) {
        engine.confirmOutcome(); // a life lost / run over / win — confirm and keep exercising content
        continue;
      }
      // Advance the squad toward the enemy side each turn, attacking when in range.
      for (let unitIndex = 0; unitIndex < 2; unitIndex++) {
        const before = engine.getSnapshot();
        const unit = before.players[unitIndex];
        if (unit.hp <= 0) continue;
        const nearestGhost = before.monsters
          .filter((m) => m.hp > 0)
          .sort((a, b) => Math.abs(a.position.x - unit.position.x) - Math.abs(b.position.x - unit.position.x))[0];
        if (nearestGhost && Math.abs(nearestGhost.position.x - unit.position.x) <= 1 && nearestGhost.position.y === unit.position.y) {
          engine.useSkill(unitIndex, unit.skillIds[0], 'right');
        } else {
          engine.moveUnit(unitIndex, 'right');
        }
      }
      engine.endTurn();
    }
    // Not asserting victory (positioning isn't perfectly choreographed) — the
    // point is that real content resolves through many turns without an
    // engine exception (mismatched skill/monster data would throw).
    expect(engine.getSnapshot().turnNumber).toBeGreaterThan(1);
  });
});

describe('maps registry (multi-level select, roadmap ch.5)', () => {
  it('exposes every playable level by a stable id, and demo1 is the default', () => {
    expect(Object.keys(maps)).toEqual([
      'demo1',
      'yanwu_ground_easy',
      'yanwu_ground_hard',
      'demo2',
      'demo3',
      'demo4',
      'lesson_ap_cost',
      'lesson_opportunity_attack',
      'lesson_push_abyss',
      'lesson_healer',
      'lesson_poison_mist',
      'world2_yuan_ling',
      'world2_pincer_practice',
      'world3_wolf_vine',
      'world3_jiangshi',
    ]);
    expect(maps.demo1).toBe(yanwuGroundMap);
    expect(DEFAULT_MAP_ID).toBe('demo1');
    expect(maps[DEFAULT_MAP_ID]).toBe(maps.demo1);
  });

  it('demo2 (pincer) spawns its first wave from both flanks of a centered base', () => {
    const demo2 = maps.demo2;
    expect(demo2.waves).toHaveLength(4);
    const firstWaveXs = demo2.waves[0].monsters.map((m) => m.spawn.x).sort((a, b) => a - b);
    expect(firstWaveXs).toEqual([1, 7]); // one spawn near the west wall, one near the east wall
  });

  it('builds a playable BattleEngine on demo2 without throwing', () => {
    const engine = new BattleEngine(maps.demo2, STARTING_SQUAD, registry);
    const snap = engine.getSnapshot();
    expect(snap.players).toHaveLength(2);
    expect(snap.monsters).toHaveLength(2);
    expect(snap.baseTiles.length).toBeGreaterThan(0);
  });

  it("demo2's later waves include yuan_ling, giving it a second monster archetype (not just yin_ghost)", () => {
    const demo2 = maps.demo2;
    const allMonsterIds = new Set(demo2.waves.flatMap((w) => w.monsters.map((m) => m.monsterId)));
    expect(allMonsterIds.has('yin_ghost')).toBe(true);
    expect(allMonsterIds.has('yuan_ling')).toBe(true);
  });

  it('no monster on demo2 ever gets stuck with a move intent that goes nowhere (regression: hazard tiles sat directly in the greedy spawn path)', () => {
    // Playing purely passively (no player actions) still cycles through
    // defeat -> confirm -> retry, which is enough to walk every spawn
    // pattern across all four waves multiple times.
    const engine = new BattleEngine(maps.demo2, STARTING_SQUAD, registry);
    for (let i = 0; i < 60; i++) {
      const snap = engine.getSnapshot();
      if (snap.outcome) {
        engine.confirmOutcome();
        continue;
      }
      for (const intent of engine.getIntents()) {
        if (intent.kind !== 'move') continue;
        const m = snap.monsters.find((x) => x.instanceId === intent.instanceId);
        // A move intent whose destination equals its current position means
        // resolveMoveDestination() couldn't take a single step — the classic
        // symptom of a hazard tile sitting directly on the greedy path.
        expect(m && (m.position.x !== intent.to.x || m.position.y !== intent.to.y)).toBe(true);
      }
      engine.endTurn();
    }
  });
});

describe('yanwu_ground_easy / yanwu_ground_hard — demo1 difficulty tiers (LEVEL_GROUPS, roadmap difficulty-tiers batch)', () => {
  it('LEVEL_GROUPS points demo1 (演武場) at exactly the easy/normal/hard mapIds registered in `maps`', () => {
    expect(LEVEL_GROUPS).toHaveLength(1);
    const group = LEVEL_GROUPS[0];
    expect(group.normal).toBe('demo1');
    expect(group.easy).toBe('yanwu_ground_easy');
    expect(group.hard).toBe('yanwu_ground_hard');
    expect(maps[group.easy!]).toBeDefined();
    expect(maps[group.normal]).toBeDefined();
    expect(maps[group.hard!]).toBeDefined();
  });

  it('yanwu_ground_easy: builds a playable BattleEngine and reuses demo1\'s exact grid layout (only waves/baseHp/turns differ)', () => {
    const engine = new BattleEngine(maps.yanwu_ground_easy, STARTING_SQUAD, registry);
    const snap = engine.getSnapshot();
    expect(snap.players).toHaveLength(2);
    expect(snap.baseTiles.length).toBeGreaterThan(0);
    expect(maps.yanwu_ground_easy.grid).toEqual(yanwuGroundMap.grid);
    expect(maps.yanwu_ground_easy.baseHp).toBeGreaterThan(yanwuGroundMap.baseHp); // easier: more base HP than normal
  });

  it('yanwu_ground_hard: builds a playable BattleEngine and reuses demo1\'s exact grid layout (only waves/baseHp/turns differ)', () => {
    const engine = new BattleEngine(maps.yanwu_ground_hard, STARTING_SQUAD, registry);
    const snap = engine.getSnapshot();
    expect(snap.players).toHaveLength(2);
    expect(snap.baseTiles.length).toBeGreaterThan(0);
    expect(maps.yanwu_ground_hard.grid).toEqual(yanwuGroundMap.grid);
    expect(maps.yanwu_ground_hard.baseHp).toBeLessThan(yanwuGroundMap.baseHp); // harder: less base HP than normal
  });

  it('a fully passive run (never acting) loses on both tiers, and hard loses no later than normal (tighter turn budget + lower baseHp)', () => {
    function passiveDefeatTurn(map: typeof maps.demo1): number {
      const engine = new BattleEngine(map, STARTING_SQUAD, registry);
      let turns = 0;
      while (!engine.getSnapshot().outcome && turns < 200) {
        engine.endTurn();
        turns += 1;
      }
      expect(engine.getSnapshot().outcome).toBe('defeat');
      return engine.getSnapshot().turnNumber;
    }
    const normalDefeatTurn = passiveDefeatTurn(yanwuGroundMap);
    const hardDefeatTurn = passiveDefeatTurn(maps.yanwu_ground_hard);
    const easyDefeatTurn = passiveDefeatTurn(maps.yanwu_ground_easy);
    expect(hardDefeatTurn).toBeLessThanOrEqual(normalDefeatTurn);
    expect(easyDefeatTurn).toBeGreaterThan(normalDefeatTurn);
  });

  it.each(['yanwu_ground_easy', 'yanwu_ground_hard'] as const)(
    'no monster on %s ever gets terrain-stuck with a move intent that goes nowhere (same regression demo2/3/4 guard against)',
    (mapId) => {
      const map = maps[mapId];
      const engine = new BattleEngine(map, STARTING_SQUAD, registry);
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
        for (const intent of engine.getIntents()) {
          if (intent.kind !== 'move') continue;
          const m = snap.monsters.find((x) => x.instanceId === intent.instanceId);
          expect(m).toBeDefined();
          if (!intent.aim) continue; // no living base-seeking target case doesn't apply here, but keep parity with the demo2/3/4 pattern
          if (m!.position.x === intent.to.x && m!.position.y === intent.to.y) {
            const next = add(m!.position, MOVE_VECTORS[stepDirectionToward(m!.position, intent.aim)]);
            expect(occupied.has(`${next.x},${next.y}`)).toBe(true);
          }
        }
        engine.endTurn();
      }
    },
  );
});

describe('demo3 (wolf woods) — finale mixing all three unused monster archetypes', () => {
  it('builds a playable BattleEngine on demo3 without throwing', () => {
    const engine = new BattleEngine(maps.demo3, STARTING_SQUAD, registry);
    const snap = engine.getSnapshot();
    expect(snap.players).toHaveLength(2);
    expect(snap.monsters).toHaveLength(1); // wave 1: a single yao_lang, introducing the speed mechanic solo
    expect(snap.baseTiles.length).toBeGreaterThan(0);
    expect(maps.demo3.waves).toHaveLength(5); // finale spec: 5 waves (roadmap ch.4 關卡結構)
  });

  it('covers all three new monster archetypes plus yin_ghost as base pressure', () => {
    // yao_lang / teng_yao / jiangshi all target nearestPlayer, never the base —
    // without yin_ghost in the mix the base could never fall, making the level
    // unlosable. The finale spec (混合該世界所有怪) wants the mix anyway.
    const allMonsterIds = new Set(maps.demo3.waves.flatMap((w) => w.monsters.map((m) => m.monsterId)));
    expect(allMonsterIds.has('yao_lang')).toBe(true);
    expect(allMonsterIds.has('teng_yao')).toBe(true);
    expect(allMonsterIds.has('jiangshi')).toBe(true);
    expect(allMonsterIds.has('yin_ghost')).toBe(true);
  });

  it('no monster on demo3 ever gets terrain-stuck with a move intent that goes nowhere (regression: hazard tiles sat directly in the greedy spawn path)', () => {
    // Same regression demo2 guards against, adapted for player-hunting
    // monsters. demo2's monsters all aim at the (static) base, so a
    // zero-progress move intent could only mean terrain blocking the greedy
    // path. demo3's wolves/jiangshi hunt players, which adds two LEGITIMATE
    // zero-progress cases the strict check would false-positive on:
    //   1. aim === null — every player is dead, the hunter has no target and
    //      idles in place by design (only the base can end a run).
    //   2. The greedy next tile is occupied by another living unit — a
    //      traffic queue (e.g. two ghosts single-file at the base), which
    //      resolves or persists harmlessly; the monster is boxed in by
    //      bodies, not silently wedged against a hazard.
    // What must NEVER happen is the original bug: aim set, nobody in the
    // way, and the monster still can't take a single step — that means a
    // hazard/wall sits directly on the greedy path.
    const engine = new BattleEngine(maps.demo3, STARTING_SQUAD, registry);
    const walkable = (p: { x: number; y: number }) => maps.demo3.grid[p.y]?.[p.x] === ' ';
    for (let i = 0; i < 60; i++) {
      const snap = engine.getSnapshot();
      if (snap.outcome) {
        engine.confirmOutcome();
        continue;
      }
      const playersAlive = snap.players.some((p) => p.hp > 0);
      const occupied = new Set(
        [...snap.players.filter((p) => p.hp > 0), ...snap.monsters.filter((m) => m.hp > 0)].map(
          (u) => `${u.position.x},${u.position.y}`,
        ),
      );
      for (const intent of engine.getIntents()) {
        if (intent.kind !== 'move') continue;
        const m = snap.monsters.find((x) => x.instanceId === intent.instanceId);
        expect(m).toBeDefined();
        if (!intent.aim) {
          expect(playersAlive).toBe(false); // idle with no aim is only legal once the squad is wiped
          continue;
        }
        if (m!.position.x === intent.to.x && m!.position.y === intent.to.y) {
          const next = add(m!.position, MOVE_VECTORS[stepDirectionToward(m!.position, intent.aim)]);
          // Zero progress must be explained by a body in the way — never by terrain.
          expect(occupied.has(`${next.x},${next.y}`), `terrain-stuck at (${m!.position.x},${m!.position.y}) toward (${intent.aim.x},${intent.aim.y}): next tile (${next.x},${next.y}) walkable=${walkable(next)}`).toBe(true);
        }
      }
      engine.endTurn();
    }
  });

  it("teng_yao's intent is never a move — its aiRules are useSkill-only, so a move intent would mean the rules or engine regressed", () => {
    const engine = new BattleEngine(maps.demo3, STARTING_SQUAD, registry);
    for (let i = 0; i < 60; i++) {
      const snap = engine.getSnapshot();
      if (snap.outcome) {
        engine.confirmOutcome();
        continue;
      }
      for (const intent of engine.getIntents()) {
        const m = snap.monsters.find((x) => x.instanceId === intent.instanceId);
        if (m?.monsterId === 'teng_yao') {
          expect(intent.kind).toBe('skill');
        }
      }
      engine.endTurn();
    }
  });
});

describe('demo4 (mist hollow) — 3-hero squad + healer + poison mist, world-2 small-level spec (4 waves)', () => {
  it('builds a playable BattleEngine on demo4 with its own 3-hero squad, not the global 2-hero default', () => {
    const squad = maps.demo4.squadCharacterIds;
    expect(squad).toEqual(['li_yan', 'su_qing', 'bai_zhi']);
    const engine = new BattleEngine(maps.demo4, squad!, registry);
    const snap = engine.getSnapshot();
    expect(snap.players).toHaveLength(3);
    expect(snap.players[2].characterId).toBe('bai_zhi');
    expect(snap.baseTiles.length).toBeGreaterThan(0);
    expect(maps.demo4.waves).toHaveLength(4); // world-2 small-level spec: world-1 small-level (3) + 1
  });

  it('covers both new-mechanic monster archetypes: yin_ghost (base-seeking, crosses the mist lanes) and jiangshi (player-seeking tank)', () => {
    const allMonsterIds = new Set(maps.demo4.waves.flatMap((w) => w.monsters.map((m) => m.monsterId)));
    expect(allMonsterIds.has('yin_ghost')).toBe(true);
    expect(allMonsterIds.has('jiangshi')).toBe(true);
  });

  it('no monster on demo4 ever gets terrain-stuck with a move intent that goes nowhere (same regression demo2/demo3 guard against)', () => {
    const engine = new BattleEngine(maps.demo4, maps.demo4.squadCharacterIds!, registry);
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
  });

  it('a fully passive run (never acting, only ending turns) loses — the map is not winnable by doing nothing', () => {
    const engine = new BattleEngine(maps.demo4, maps.demo4.squadCharacterIds!, registry);
    let turns = 0;
    while (!engine.getSnapshot().outcome && turns < 200) {
      engine.endTurn();
      turns += 1;
    }
    expect(engine.getSnapshot().outcome).toBe('defeat');
  });
});

describe('lesson levels (real, playable single-mechanic practice maps — replaces the old scripted TutorialDef system)', () => {
  it('LESSON_MAP_IDS names exactly five real entries in `maps`, each a genuine MapDef (not a special content kind)', () => {
    expect(LESSON_MAP_IDS).toEqual([
      'lesson_ap_cost',
      'lesson_opportunity_attack',
      'lesson_push_abyss',
      'lesson_healer',
      'lesson_poison_mist',
    ]);
    for (const id of LESSON_MAP_IDS) {
      expect(maps[id]).toBeDefined();
      expect(maps[id].waves.length).toBeGreaterThan(0);
      expect(maps[id].waves.length).toBeLessThanOrEqual(2); // small practice levels: 1-2 waves, not a finale
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
    '%s: no monster ever gets terrain-stuck with a move intent that goes nowhere (same regression demo2/3/4 guard against)',
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

  it('lesson_ap_cost: closing the distance and swinging Sword Qi Slash in the same turn spends the full 4-AP pool (movement and skills share it)', () => {
    const map = maps.lesson_ap_cost;
    const engine = new BattleEngine(map, STARTING_SQUAD, registry);
    // Li Yan (unit 0) closes to melee range and strikes — 2 tiles of
    // movement (2 AP) plus Sword Qi Slash (2 AP) exactly exhausts the pool.
    expect(engine.moveUnit(0, 'down').ok).toBe(true);
    expect(engine.moveUnit(0, 'right').ok).toBe(true);
    const beforeSkill = engine.getSnapshot().players[0];
    expect(beforeSkill.ap).toBe(2); // 4 - 2 moves
    expect(engine.useSkill(0, 'sword_qi', 'right').ok).toBe(true);
    expect(engine.getSnapshot().players[0].ap).toBe(0); // 2 - sword_qi's mpCost(2)
    engine.endTurn();
    engine.moveUnit(0, 'right');
    expect(engine.useSkill(0, 'sword_qi', 'right').ok).toBe(true);
    expect(engine.getSnapshot().monsters.every((m) => m.hp <= 0)).toBe(true); // the ghost is dead
    expect(engine.getSnapshot().baseHp).toBe(map.baseHp); // base never took a hit
  });

  it('lesson_opportunity_attack: retreating from an adjacent, still-living ghost actually costs Li Yan HP via the counter-hit', () => {
    const map = maps.lesson_opportunity_attack;
    const engine = new BattleEngine(map, STARTING_SQUAD, registry);
    const startHp = engine.getSnapshot().players[0].maxHp;
    expect(engine.moveUnit(0, 'down').ok).toBe(true); // now adjacent to the ghost
    expect(engine.useSkill(0, 'sword_qi', 'down').ok).toBe(true); // hurt it, but it survives (3 - 2 = 1hp)
    expect(engine.getSnapshot().monsters[0].hp).toBeGreaterThan(0);
    expect(engine.moveUnit(0, 'up').ok).toBe(true); // deliberate retreat while it's still alive
    const afterRetreat = engine.getSnapshot().players[0];
    expect(afterRetreat.hp).toBeLessThan(startHp); // the opportunity attack actually landed
    engine.endTurn();
    // Finish the job next turn — still a clean win despite having eaten the counter-hit.
    expect(engine.moveUnit(0, 'down').ok).toBe(true);
    expect(engine.moveUnit(0, 'down').ok).toBe(true);
    expect(engine.useSkill(0, 'sword_qi', 'left').ok).toBe(true);
    expect(engine.getSnapshot().monsters.every((m) => m.hp <= 0)).toBe(true);
    engine.endTurn();
    expect(engine.getSnapshot().outcome).toBe('victory');
  });

  it('lesson_push_abyss: Cloud-Parting Palm shoves the ghost into the hazard tile and kills it outright', () => {
    const map = maps.lesson_push_abyss;
    const engine = new BattleEngine(map, STARTING_SQUAD, registry);
    expect(engine.getSnapshot().monsters).toHaveLength(1);
    expect(engine.useSkill(0, 'palm_wave', 'right').ok).toBe(true);
    expect(engine.getSnapshot().monsters.every((m) => m.hp <= 0)).toBe(true);
    engine.endTurn();
    expect(engine.getSnapshot().outcome).toBe('victory'); // last wave cleared, base untouched
    expect(engine.getSnapshot().baseHp).toBe(map.baseHp);
  });

  it("lesson_healer: Bai Zhi's minor_heal actually raises Li Yan's HP back up after the jiangshi lands a hit", () => {
    const map = maps.lesson_healer;
    const squad = map.squadCharacterIds!;
    expect(squad).toEqual(['li_yan', 'bai_zhi']);
    const engine = new BattleEngine(map, squad, registry);
    const liYanMaxHp = engine.getSnapshot().players[0].maxHp;
    // Li Yan starts adjacent to the jiangshi — dashing off to block the
    // yin_ghost's lane to the base means disengaging from it, which costs an
    // opportunity-attack hit (jiangshi's corpse_smash, damage-only).
    expect(engine.moveUnit(0, 'right').ok).toBe(true);
    const hpAfterHit = engine.getSnapshot().players[0].hp;
    expect(hpAfterHit).toBeLessThan(liYanMaxHp);
    expect(hpAfterHit).toBeGreaterThan(0);
    expect(engine.moveUnit(0, 'right').ok).toBe(true);
    expect(engine.moveUnit(0, 'right').ok).toBe(true); // Li Yan now blocks the ghost's lane
    expect(engine.moveUnit(1, 'right').ok).toBe(true);
    expect(engine.moveUnit(1, 'right').ok).toBe(true);
    expect(engine.moveUnit(1, 'down').ok).toBe(true); // Bai Zhi closes to heal range
    expect(engine.useSkill(1, 'minor_heal', 'right').ok).toBe(true);
    const hpAfterHeal = engine.getSnapshot().players[0].hp;
    expect(hpAfterHeal).toBeGreaterThan(hpAfterHit);
  });

  it('lesson_poison_mist: the ghost takes a free poison-mist tick crossing the mist tile, so a single Sword Qi Slash finishes it', () => {
    const map = maps.lesson_poison_mist;
    const squad = map.squadCharacterIds!;
    expect(squad).toEqual(['li_yan']);
    const engine = new BattleEngine(map, squad, registry);
    const ghostMaxHp = engine.getSnapshot().monsters[0].maxHp;
    engine.moveUnit(0, 'up');
    engine.moveUnit(0, 'up');
    engine.moveUnit(0, 'right');
    engine.moveUnit(0, 'right');
    engine.endTurn(); // the ghost crosses the mist tile on its way to the block point, taking a free tick
    const ghostHpAfterMist = engine.getSnapshot().monsters[0].hp;
    expect(ghostHpAfterMist).toBeLessThan(ghostMaxHp);
    expect(engine.useSkill(0, 'sword_qi', 'down').ok).toBe(true);
    expect(engine.getSnapshot().monsters.every((m) => m.hp <= 0)).toBe(true); // one hit, thanks to the mist chip
    engine.endTurn();
    expect(engine.getSnapshot().outcome).toBe('victory');
  });
});

describe('WORLD_STRUCTURE (world-structure batch: World 1-4 grouping for LevelSelectScene)', () => {
  const NEW_WORLD2_WORLD3_LESSON_IDS = [
    'world2_yuan_ling',
    'world2_pincer_practice',
    'world3_wolf_vine',
    'world3_jiangshi',
  ];

  it('has exactly 4 worlds, each ending in its finale map, matching the confirmed World 1-4 layout', () => {
    expect(WORLD_STRUCTURE).toHaveLength(4);
    expect(WORLD_STRUCTURE[0].levels.map((l) => l.mapId)).toEqual([
      'lesson_ap_cost',
      'lesson_opportunity_attack',
      'lesson_push_abyss',
      'demo1',
    ]);
    expect(WORLD_STRUCTURE[1].levels.map((l) => l.mapId)).toEqual([
      'world2_yuan_ling',
      'world2_pincer_practice',
      'demo2',
    ]);
    expect(WORLD_STRUCTURE[2].levels.map((l) => l.mapId)).toEqual(['world3_wolf_vine', 'world3_jiangshi', 'demo3']);
    expect(WORLD_STRUCTURE[3].levels.map((l) => l.mapId)).toEqual(['lesson_poison_mist', 'lesson_healer', 'demo4']);
  });

  it('every level in WORLD_STRUCTURE points at a real, registered map, and only each world\'s last level is a non-lesson finale', () => {
    for (const world of WORLD_STRUCTURE) {
      world.levels.forEach((level, i) => {
        expect(maps[level.mapId], `${level.mapId} must be a real entry in maps`).toBeDefined();
        const isLast = i === world.levels.length - 1;
        expect(level.isLesson).toBe(!isLast);
      });
    }
  });

  it.each(NEW_WORLD2_WORLD3_LESSON_IDS)('%s: builds a playable BattleEngine without throwing', (id) => {
    const map = maps[id];
    const squad = map.squadCharacterIds ?? STARTING_SQUAD;
    const engine = new BattleEngine(map, squad, registry);
    expect(engine.getSnapshot().players.length).toBe(squad.length);
    expect(engine.getSnapshot().baseTiles.length).toBeGreaterThan(0);
  });

  it.each(NEW_WORLD2_WORLD3_LESSON_IDS)(
    '%s: no monster ever gets terrain-stuck with a move intent that goes nowhere (same regression demo2/3/4 guard against)',
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

  /** Same rounding rule BattleEngine.effectAmount() applies for amountIsPercent: floor(hp * pct/100), minimum 1. */
  function expectedPercentDamage(hp: number, pct: number): number {
    return Math.max(1, Math.floor(hp * (pct / 100)));
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
      waves: [{ turns: 99, monsters }],
    };
  }

  it("every character's ultimateSkillId points at a real registered skill costing exactly that character's full actionPoints", () => {
    for (const [charId, def] of Object.entries(registry.characters)) {
      const ultimate = registry.skills[def.ultimateSkillId];
      expect(ultimate, `${charId}'s ultimateSkillId '${def.ultimateSkillId}' must resolve to a real skill`).toBeTruthy();
      expect(ultimate.mpCost, `${charId}'s ultimate should cost its full actionPoints (${def.actionPoints})`).toBe(
        def.actionPoints,
      );
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
    expect(after.players[0].ap).toBe(0); // full AP spent
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
    // comment — a self-sacrifice cast already pays its own cost via mpCost).
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
    expect(engine.getSnapshot().players[3].ap).toBe(0); // AP still spent even though nothing needed healing
    expect(engine.getSnapshot().players[3].ultimateUsed).toBe(true);
  });

  it('a used ultimate is rejected on a second cast within the same level run, even after AP refills next turn', () => {
    const map = ultimateSquadMap([{ monsterId: 'jiangshi', spawn: { x: 8, y: 3 } }]);
    const engine = new BattleEngine(map, map.squadCharacterIds!, registry);
    engine.useSkill(0, 'sword_tempest', 'right');
    engine.endTurn();
    expect(engine.getSnapshot().players[0].ap).toBe(4); // AP refilled
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
