import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../core/battle/engine';
import { STARTING_SQUAD, courtyardMap, registry } from '../content/registry';

describe('Phase 0 content registry', () => {
  it('parses all builtin content without throwing', () => {
    expect(Object.keys(registry.characters)).toEqual(['aster', 'wren']);
    expect(Object.keys(registry.monsters)).toEqual([
      'gloom_imp',
      'husk_brute',
      'whisper_wisp',
      'thornling',
      'night_hound',
    ]);
    expect(courtyardMap.waves).toHaveLength(4);
  });

  it('builds a playable BattleEngine from real content with a valid initial intent', () => {
    const engine = new BattleEngine(courtyardMap, STARTING_SQUAD, registry);
    const snap = engine.getSnapshot();
    expect(snap.players).toHaveLength(2);
    expect(snap.monsters).toHaveLength(1);

    // Wave 1's imp spawns 5 tiles from aster — out of imp_claw's range(1),
    // so its only matching aiRule is the unconditional 'moveToward' fallback.
    expect(engine.getIntents()).toEqual([
      { kind: 'move', instanceId: expect.any(String), to: expect.any(Object) },
    ]);
  });

  it('runs several turns of real content end-to-end without throwing', () => {
    const engine = new BattleEngine(courtyardMap, STARTING_SQUAD, registry);
    for (let turn = 0; turn < 8 && !engine.getSnapshot().victory; turn++) {
      // Advance the squad toward the enemy side each turn, attacking when in range.
      for (let unitIndex = 0; unitIndex < 2; unitIndex++) {
        const before = engine.getSnapshot();
        const unit = before.players[unitIndex];
        if (unit.hp <= 0) continue;
        const nearestImp = before.monsters
          .filter((m) => m.hp > 0)
          .sort((a, b) => Math.abs(a.position.x - unit.position.x) - Math.abs(b.position.x - unit.position.x))[0];
        if (nearestImp && Math.abs(nearestImp.position.x - unit.position.x) <= 1 && nearestImp.position.y === unit.position.y) {
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
