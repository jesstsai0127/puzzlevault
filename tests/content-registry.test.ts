import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../core/battle/engine';
import { STARTING_SQUAD, DEFAULT_MAP_ID, maps, yanwuGroundMap, registry } from '../content/registry';

describe('Phase 0 content registry', () => {
  it('parses all builtin content without throwing', () => {
    expect(Object.keys(registry.characters)).toEqual(['li_yan', 'su_qing']);
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
    expect(Object.keys(maps)).toEqual(['demo1', 'demo2']);
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
