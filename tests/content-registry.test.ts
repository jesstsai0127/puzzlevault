import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../core/battle/engine';
import { MOVE_VECTORS, add, stepDirectionToward } from '../core/geometry';
import { STARTING_SQUAD, DEFAULT_MAP_ID, maps, yanwuGroundMap, registry, tutorials } from '../content/registry';

describe('Phase 0 content registry', () => {
  it('parses all builtin content without throwing', () => {
    expect(Object.keys(registry.characters)).toEqual(['li_yan', 'su_qing', 'bai_zhi']);
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
    expect(Object.keys(maps)).toEqual(['demo1', 'demo2', 'demo3', 'demo4']);
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

describe('tutorials registry (scripted teaching levels)', () => {
  it('parses all five builtin tutorials without throwing, each with a non-empty script', () => {
    expect(Object.keys(tutorials)).toEqual([
      'tut_ap_cost',
      'tut_dot_terrain',
      'tut_healer',
      'tut_opportunity_attack',
      'tut_push_into_abyss',
    ]);
    for (const tutorial of Object.values(tutorials)) {
      expect(tutorial.script.length).toBeGreaterThan(0);
      // Tutorials without their own squadCharacterIds fall back to the
      // global 2-hero STARTING_SQUAD (see MapDef.squadCharacterIds); ones
      // that declare their own (e.g. tut_healer's li_yan+bai_zhi, or
      // tut_dot_terrain's solo li_yan) must have playerStarts line up 1:1.
      const squad = tutorial.map.squadCharacterIds ?? STARTING_SQUAD;
      expect(tutorial.map.playerStarts.length).toBe(squad.length);
    }
  });

  it('builds a playable BattleEngine from each tutorial map and can replay its whole script without throwing', () => {
    for (const tutorial of Object.values(tutorials)) {
      const squad = tutorial.map.squadCharacterIds ?? STARTING_SQUAD;
      const engine = new BattleEngine(tutorial.map, squad, registry);
      for (const step of tutorial.script) {
        if (!step.action) continue;
        if (step.action.type === 'move') {
          engine.moveUnit(step.action.unitIndex, step.action.dir);
        } else if (step.action.type === 'useSkill') {
          engine.useSkill(step.action.unitIndex, step.action.skillId, step.action.dir);
        } else {
          engine.endTurn();
        }
      }
      expect(engine.getSnapshot()).toBeDefined();
    }
  });

  it('tut_push_into_abyss actually kills the ghost by pushing it into the hazard tile', () => {
    const tutorial = tutorials.tut_push_into_abyss;
    const engine = new BattleEngine(tutorial.map, STARTING_SQUAD, registry);
    expect(engine.getSnapshot().monsters).toHaveLength(1);
    const pushStep = tutorial.script.find((s) => s.action?.type === 'useSkill');
    expect(pushStep?.action).toBeDefined();
    const action = pushStep!.action!;
    if (action.type === 'useSkill') {
      engine.useSkill(action.unitIndex, action.skillId, action.dir);
    }
    expect(engine.getSnapshot().monsters.every((m) => m.hp <= 0)).toBe(true);
  });

  it('tut_opportunity_attack script actually triggers a counter-hit on Li Yan when they retreat', () => {
    const tutorial = tutorials.tut_opportunity_attack;
    const engine = new BattleEngine(tutorial.map, STARTING_SQUAD, registry);
    for (const step of tutorial.script) {
      if (!step.action) continue;
      if (step.action.type === 'move') engine.moveUnit(step.action.unitIndex, step.action.dir);
      else if (step.action.type === 'useSkill') engine.useSkill(step.action.unitIndex, step.action.skillId, step.action.dir);
      else engine.endTurn();
    }
    const liYan = engine.getSnapshot().players[0];
    // li_yan has 6 max HP; the ghost's ghost_claw deals 2 — a full-HP hero
    // ending below max after a script with no monster-initiated turn (no
    // endTurn was scripted) means the only thing that could have hit them
    // is the disengage opportunity attack in the retreat step.
    expect(liYan.hp).toBeLessThan(liYan.maxHp);
  });

  it('tut_healer script actually drops Li Yan below max HP via the jiangshi hit, then Bai Zhi\'s minor_heal actually raises it back', () => {
    const tutorial = tutorials.tut_healer;
    const squad = tutorial.map.squadCharacterIds!;
    expect(squad).toEqual(['li_yan', 'bai_zhi']);
    const engine = new BattleEngine(tutorial.map, squad, registry);
    const liYanMaxHp = engine.getSnapshot().players[0].maxHp;

    let hpAfterHit = -1;
    let sawHeal = false;
    for (const step of tutorial.script) {
      if (!step.action) continue;
      if (step.action.type === 'move') {
        engine.moveUnit(step.action.unitIndex, step.action.dir);
      } else if (step.action.type === 'useSkill') {
        engine.useSkill(step.action.unitIndex, step.action.skillId, step.action.dir);
        if (step.action.skillId === 'minor_heal' || step.action.skillId === 'major_heal') sawHeal = true;
      } else {
        engine.endTurn();
        // The only scripted endTurn is the one that lets the jiangshi hit
        // Li Yan — capture the resulting HP right after it resolves.
        hpAfterHit = engine.getSnapshot().players[0].hp;
      }
    }
    expect(hpAfterHit).toBeGreaterThanOrEqual(0);
    expect(hpAfterHit).toBeLessThan(liYanMaxHp); // jiangshi's corpse_smash actually landed
    expect(sawHeal).toBe(true);
    const liYanFinal = engine.getSnapshot().players[0];
    expect(liYanFinal.hp).toBeGreaterThan(hpAfterHit); // Bai Zhi's heal actually raised it back up
  });

  it('tut_dot_terrain script actually ticks poison-mist damage on both Li Yan and the yin_ghost after endTurn', () => {
    const tutorial = tutorials.tut_dot_terrain;
    const squad = tutorial.map.squadCharacterIds!;
    expect(squad).toEqual(['li_yan']);
    const engine = new BattleEngine(tutorial.map, squad, registry);
    const liYanMaxHp = engine.getSnapshot().players[0].maxHp;
    const ghostMaxHp = engine.getSnapshot().monsters[0].maxHp;

    for (const step of tutorial.script) {
      if (!step.action) continue;
      if (step.action.type === 'move') engine.moveUnit(step.action.unitIndex, step.action.dir);
      else if (step.action.type === 'useSkill') engine.useSkill(step.action.unitIndex, step.action.skillId, step.action.dir);
      else engine.endTurn();
    }

    const snap = engine.getSnapshot();
    // Both units were still standing on a '*' tile when the scripted
    // endTurn resolved — poison mist is flat, unblockable, and hits both
    // player and monster the same way (see POISON_MIST_DAMAGE in engine.ts).
    expect(snap.players[0].hp).toBeLessThan(liYanMaxHp);
    expect(snap.monsters[0].hp).toBeLessThan(ghostMaxHp);
    expect(snap.monsters[0].hp).toBeGreaterThan(0); // not lethal on its own
  });
});
