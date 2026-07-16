import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../core/battle/engine';
import type { ContentRegistry } from '../core/battle/types';
import type { CharacterDef, MapDef, MonsterDef, SkillDef } from '../core/content/types';

const strike: SkillDef = {
  formatVersion: 1,
  id: 'strike',
  nameKey: 'skill.strike.name',
  descKey: 'skill.strike.desc',
  range: 1,
  effects: [{ type: 'damage', amount: 2, target: 'firstInLine' }],
};

const pushSkill: SkillDef = {
  formatVersion: 1,
  id: 'push_skill',
  nameKey: 'skill.push_skill.name',
  descKey: 'skill.push_skill.desc',
  range: 1,
  effects: [{ type: 'push', amount: 2, target: 'firstInLine' }],
};

const rangedSkill: SkillDef = {
  formatVersion: 1,
  id: 'ranged_skill',
  nameKey: 'skill.ranged_skill.name',
  descKey: 'skill.ranged_skill.desc',
  range: 3,
  effects: [{ type: 'damage', amount: 2, target: 'firstInLine' }],
};

const shieldSkill: SkillDef = {
  formatVersion: 1,
  id: 'shield_skill',
  nameKey: 'skill.shield_skill.name',
  descKey: 'skill.shield_skill.desc',
  range: 0,
  effects: [{ type: 'shield', amount: 1, target: 'self' }],
};

const ghostClaw: SkillDef = {
  formatVersion: 1,
  id: 'ghost_claw',
  nameKey: 'skill.ghost_claw.name',
  descKey: 'skill.ghost_claw.desc',
  range: 1,
  effects: [{ type: 'damage', amount: 1, target: 'firstInLine' }],
};

const yinGhost: MonsterDef = {
  formatVersion: 1,
  id: 'yin_ghost',
  nameKey: 'monster.yin_ghost.name',
  spriteRef: 'mon_yin_ghost',
  maxHp: 2,
  moveRange: 1,
  skillIds: ['ghost_claw'],
  aiRules: [
    { when: { kind: 'targetInRange', target: 'nearestPlayer', range: 1 }, action: { kind: 'useSkill', skillId: 'ghost_claw' } },
    { when: { kind: 'always' }, action: { kind: 'moveToward', target: 'nearestPlayer' } },
  ],
};

const li_yan: CharacterDef = {
  formatVersion: 1,
  id: 'li_yan',
  nameKey: 'character.li_yan.name',
  spriteRef: 'char_li_yan',
  maxHp: 6,
  moveRange: 3,
  skillIds: ['strike', 'push_skill'],
  // Placeholder, deliberately NOT one of this character's own skillIds —
  // these test fixtures don't exercise Ultimate behavior, just satisfy the
  // now-required field. Reusing a real skillId here (e.g. 'strike') would
  // silently make useSkill() treat that normal skill as a once-per-level
  // Ultimate too, tripping the ultimateUsed lock on tests that cast it
  // twice on the same engine instance (across turns).
  ultimateSkillId: 'li_yan_ultimate_unused',
};

const su_qing: CharacterDef = {
  formatVersion: 1,
  id: 'su_qing',
  nameKey: 'character.su_qing.name',
  spriteRef: 'char_su_qing',
  maxHp: 5,
  moveRange: 3,
  skillIds: ['ranged_skill', 'shield_skill'],
  ultimateSkillId: 'su_qing_ultimate_unused',
};

const registry: ContentRegistry = {
  characters: { li_yan, su_qing },
  skills: {
    strike,
    push_skill: pushSkill,
    ranged_skill: rangedSkill,
    shield_skill: shieldSkill,
    ghost_claw: ghostClaw,
  },
  monsters: { yin_ghost: yinGhost },
};

// 8x5 room: '#' wall, ' ' floor. Row 3 is a spare floor row carrying the lone
// base tile ('B') so these existing (pre-Phase-1) fixtures stay valid under
// the new map format without disturbing any position used at y=1/y=2.
const grid = ['########', '#      #', '#      #', '#B     #', '########'];

// Large enough that no existing (non-Phase-1) test's handful of endTurn()
// calls ever runs out the clock by accident.
const AMPLE_TURNS = 99;

function twoWaveMap(): MapDef {
  return {
    formatVersion: 1,
    id: 'test-arena',
    nameKey: 'map.test.name',
    grid,
    baseHp: 8,
    playerStarts: [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
    ],
    waves: [
      { turns: AMPLE_TURNS, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 2, y: 1 } }] }, // adjacent to player 0
      { turns: AMPLE_TURNS, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 6, y: 1 } }] },
    ],
  };
}

describe('BattleEngine: setup', () => {
  it('spawns players at playerStarts with full HP and computes initial intents', () => {
    const engine = new BattleEngine(twoWaveMap(), ['li_yan', 'su_qing'], registry);
    const snap = engine.getSnapshot();
    expect(snap.players).toEqual([
      expect.objectContaining({ characterId: 'li_yan', position: { x: 1, y: 1 }, hp: 6 }),
      expect.objectContaining({ characterId: 'su_qing', position: { x: 1, y: 2 }, hp: 5 }),
    ]);
    expect(snap.monsters).toHaveLength(1);
    expect(snap.waveIndex).toBe(0);
  });

  it('an adjacent monster telegraphs a skill intent, not a move', () => {
    const engine = new BattleEngine(twoWaveMap(), ['li_yan', 'su_qing'], registry);
    const intents = engine.getIntents();
    expect(intents).toEqual([
      { kind: 'skill', instanceId: expect.any(String), skillId: 'ghost_claw', direction: 'left' },
    ]);
  });
});

describe('BattleEngine: player actions', () => {
  // Squad members spread apart and the monster far away, so plain movement
  // isn't incidentally blocked by a teammate or enemy.
  function roomyMap(): MapDef {
    return {
      ...twoWaveMap(),
      playerStarts: [
        { x: 1, y: 1 },
        { x: 6, y: 2 },
      ],
      waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 6, y: 1 } }] }],
    };
  }

  it('commits a whole move to a destination tile and rejects a wall tile as unreachable', () => {
    const engine = new BattleEngine(roomyMap(), ['li_yan', 'su_qing'], registry);
    expect(engine.moveUnit(0, { x: 1, y: 0 })).toEqual({ ok: false, reason: 'unreachable' }); // y=0 is wall
    expect(engine.moveUnit(0, { x: 1, y: 2 })).toEqual({ ok: true });
    expect(engine.getSnapshot().players[0].position).toEqual({ x: 1, y: 2 });
  });

  it('rejects a destination beyond moveRange even with a clear path', () => {
    const engine = new BattleEngine(roomyMap(), ['li_yan', 'su_qing'], registry);
    // li_yan's moveRange is 3 — (5,1) is 4 BFS steps from (1,1).
    expect(engine.moveUnit(0, { x: 5, y: 1 })).toEqual({ ok: false, reason: 'unreachable' });
    expect(engine.moveUnit(0, { x: 4, y: 1 })).toEqual({ ok: true }); // exactly 3 steps
  });

  it('an occupied destination is unreachable — and bodies block the PATH too, not just the landing tile', () => {
    const engine = new BattleEngine(twoWaveMap(), ['li_yan', 'su_qing'], registry);
    // li_yan (1,1) is boxed in: ghost at (2,1), su_qing at (1,2), walls above/left.
    expect(engine.moveUnit(0, { x: 1, y: 2 })).toEqual({ ok: false, reason: 'unreachable' }); // ally's tile
    expect(engine.moveUnit(0, { x: 2, y: 1 })).toEqual({ ok: false, reason: 'unreachable' }); // monster's tile
    expect(engine.moveUnit(0, { x: 2, y: 2 })).toEqual({ ok: false, reason: 'unreachable' }); // open tile, but every route to it passes through a body
    // su_qing herself is NOT boxed in — BFS routes her around the crowd.
    expect(engine.moveUnit(1, { x: 2, y: 2 })).toEqual({ ok: true });
  });

  it('strike deals damage to a monster in the aimed direction', () => {
    const engine = new BattleEngine(twoWaveMap(), ['li_yan', 'su_qing'], registry);
    const res = engine.useSkill(0, 'strike', 'right'); // monster at (2,1), li_yan at (1,1)
    expect(res).toEqual({ ok: true });
    expect(engine.getSnapshot().monsters[0].hp).toBe(0);
  });

  it('each unit may move once, then take one action — moving after having moved is rejected', () => {
    const engine = new BattleEngine(roomyMap(), ['li_yan', 'su_qing'], registry);
    expect(engine.moveUnit(0, { x: 3, y: 1 })).toEqual({ ok: true });
    expect(engine.getSnapshot().players[0].moved).toBe(true);
    expect(engine.moveUnit(0, { x: 4, y: 1 })).toEqual({ ok: false, reason: 'already-moved' }); // no splitting a move
    // The other unit's own economy is untouched by unit 0's spent move.
    expect(engine.moveUnit(1, { x: 5, y: 2 })).toEqual({ ok: true });
  });

  it('a unit that moved can still act (move precedes the action), and acting then locks BOTH', () => {
    const map = twoWaveMap();
    map.waves[0].monsters[0].spawn = { x: 4, y: 2 };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    expect(engine.moveUnit(0, { x: 3, y: 2 })).toEqual({ ok: true }); // walk adjacent to the ghost at (4,2)
    expect(engine.useSkill(0, 'strike', 'right')).toEqual({ ok: true }); // move-then-act is the intended flow
    expect(engine.getSnapshot().players[0].acted).toBe(true);
    expect(engine.moveUnit(0, { x: 2, y: 2 })).toEqual({ ok: false, reason: 'already-acted' }); // no retreat after acting
    expect(engine.useSkill(0, 'strike', 'right')).toEqual({ ok: false, reason: 'already-acted' }); // one action only
  });

  it('acting WITHOUT moving first also locks movement — the move phase is forfeited, not banked', () => {
    const map = twoWaveMap();
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    expect(engine.useSkill(0, 'strike', 'right')).toEqual({ ok: true }); // ghost at (2,1) is adjacent from the start
    expect(engine.getSnapshot().players[0].moved).toBe(false); // never moved...
    expect(engine.moveUnit(1, { x: 2, y: 2 })).toEqual({ ok: true }); // (other unit unaffected)
    expect(engine.moveUnit(0, { x: 1, y: 2 })).toEqual({ ok: false, reason: 'already-acted' }); // ...but may not move anymore
  });

  it("resets every unit's moved/acted at the start of every turn, not only when a wave clears", () => {
    // Monster starts 5 tiles from li_yan, so one move won't clear the wave.
    const engine = new BattleEngine(roomyMap(), ['li_yan', 'su_qing'], registry);
    engine.moveUnit(0, { x: 2, y: 2 });
    engine.rest(0);
    expect(engine.getSnapshot().players[0].moved).toBe(true);
    expect(engine.getSnapshot().players[0].acted).toBe(true);

    engine.endTurn();

    expect(engine.getSnapshot().monsters.length).toBeGreaterThan(0); // sanity: wave still active
    const fresh = engine.getSnapshot().players[0];
    expect(fresh.moved).toBe(false); // fresh economy for the new turn
    expect(fresh.acted).toBe(false);
  });

  it('rest self-heals 1, is capped at maxHp, and spends the unit\'s one action', () => {
    const engine = new BattleEngine(twoWaveMap(), ['li_yan', 'su_qing'], registry);
    engine.endTurn(); // the adjacent ghost claws li_yan: 6 -> 5
    expect(engine.getSnapshot().players[0].hp).toBe(5);

    expect(engine.rest(0)).toEqual({ ok: true });
    expect(engine.getSnapshot().players[0].hp).toBe(6); // +1
    expect(engine.getSnapshot().players[0].acted).toBe(true);
    expect(engine.getLastEvents()).toEqual([
      { kind: 'heal', target: { kind: 'player', unitIndex: 0 }, amount: 1 },
    ]);
    expect(engine.rest(0)).toEqual({ ok: false, reason: 'already-acted' }); // rest IS the action — once per turn
    expect(engine.useSkill(0, 'strike', 'right')).toEqual({ ok: false, reason: 'already-acted' });
  });

  it('rest at full HP still spends the action and reports an honest 0-amount heal event', () => {
    const engine = new BattleEngine(roomyMap(), ['li_yan', 'su_qing'], registry);
    expect(engine.getSnapshot().players[0].hp).toBe(6); // full
    expect(engine.rest(0)).toEqual({ ok: true });
    expect(engine.getSnapshot().players[0].hp).toBe(6); // capped at maxHp
    expect(engine.getSnapshot().players[0].acted).toBe(true);
    expect(engine.getLastEvents()).toEqual([
      { kind: 'heal', target: { kind: 'player', unitIndex: 0 }, amount: 0 },
    ]);
  });

  it('push moves the target away from the caster, stopping at a wall', () => {
    const map = twoWaveMap();
    map.waves[0].monsters[0].spawn = { x: 5, y: 1 }; // one tile from the right wall (x=6 is the last floor col)
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    // one committed move: li_yan 3 tiles right (his full moveRange), landing adjacent to the monster at (4,1)
    engine.moveUnit(0, { x: 4, y: 1 });
    expect(engine.getSnapshot().players[0].position).toEqual({ x: 4, y: 1 });

    const res = engine.useSkill(0, 'push_skill', 'right');
    expect(res).toEqual({ ok: true });
    // pushed 2 tiles from (5,1) but the wall at x=7 stops it after 1 tile -> (6,1)
    expect(engine.getSnapshot().monsters[0].position).toEqual({ x: 6, y: 1 });
  });

  it('shield blocks the next hit instead of losing HP', () => {
    // su_qing adjacent to the monster (so it's the one attacked); li_yan stays out of range.
    const map: MapDef = {
      ...twoWaveMap(),
      playerStarts: [
        { x: 1, y: 2 },
        { x: 1, y: 1 },
      ],
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    engine.useSkill(1, 'shield_skill', 'down'); // su_qing (unit 1) shields itself
    expect(engine.getSnapshot().players[1].shield).toBe(1);

    engine.endTurn(); // adjacent ghost's stored intent attacks su_qing

    const suQing2 = engine.getSnapshot().players[1];
    expect(suQing2.shield).toBe(0); // charge consumed
    expect(suQing2.hp).toBe(5); // fully blocked, no HP lost
  });

  it('resetTurn reverts every action taken this turn back to the turn-start snapshot in one call (no per-step undo exists)', () => {
    const engine = new BattleEngine(roomyMap(), ['li_yan', 'su_qing'], registry);
    const before = engine.getSnapshot();
    engine.moveUnit(0, { x: 3, y: 1 });
    engine.useSkill(1, 'shield_skill', 'down'); // su_qing shields herself, spending her action

    engine.resetTurn();

    const after = engine.getSnapshot();
    expect(after.players[0].position).toEqual(before.players[0].position);
    expect(after.players[0].moved).toBe(false); // the move is refunded along with the position
    expect(after.players[1].acted).toBe(false);
    expect(after.players[1].shield).toBe(0);
    expect(after.resetTurnUsed).toBe(true); // ...but the level's single reset is now spent
  });

  it('resetTurn only reaches back to the start of the CURRENT turn, not earlier turns', () => {
    const engine = new BattleEngine(roomyMap(), ['li_yan', 'su_qing'], registry);
    engine.moveUnit(0, { x: 2, y: 1 });
    engine.endTurn(); // this turn's moves are now locked in as the new turn-start baseline
    const afterEndTurn = engine.getSnapshot().players[0].position;

    engine.moveUnit(0, { x: 3, y: 1 });
    engine.resetTurn();

    expect(engine.getSnapshot().players[0].position).toEqual(afterEndTurn); // not all the way back to game start
  });

  it('resetTurn is limited to ONCE per level run — the second call this level is a rejected no-op', () => {
    const engine = new BattleEngine(roomyMap(), ['li_yan', 'su_qing'], registry);
    expect(engine.getSnapshot().resetTurnUsed).toBe(false);
    engine.moveUnit(0, { x: 2, y: 1 });
    engine.resetTurn(); // spend the level's one reset
    expect(engine.getSnapshot().resetTurnUsed).toBe(true);
    expect(engine.getSnapshot().players[0].position).toEqual({ x: 1, y: 1 }); // reverted

    engine.endTurn(); // a fresh turn does NOT refresh the reset budget
    engine.moveUnit(0, { x: 2, y: 1 });
    engine.resetTurn(); // second attempt — must do nothing
    expect(engine.getSnapshot().players[0].position).toEqual({ x: 2, y: 1 }); // the move STANDS
    expect(engine.getSnapshot().players[0].moved).toBe(true);
    expect(engine.getSnapshot().resetTurnUsed).toBe(true);
  });

  it('resetLevel() restores the spent turn-reset budget (it belongs to the level run, not the turn)', () => {
    const engine = new BattleEngine(roomyMap(), ['li_yan', 'su_qing'], registry);
    engine.moveUnit(0, { x: 2, y: 1 });
    engine.resetTurn();
    expect(engine.getSnapshot().resetTurnUsed).toBe(true);

    engine.resetLevel();
    expect(engine.getSnapshot().resetTurnUsed).toBe(false);

    // And the refreshed budget actually works again on the fresh run.
    engine.moveUnit(0, { x: 2, y: 1 });
    engine.resetTurn();
    expect(engine.getSnapshot().players[0].position).toEqual({ x: 1, y: 1 });
  });
});

describe('BattleEngine: turn resolution', () => {
  it('resolves a stored skill intent as damage to the player on endTurn', () => {
    const engine = new BattleEngine(twoWaveMap(), ['li_yan', 'su_qing'], registry);
    engine.endTurn(); // adjacent ghost attacks li_yan for 1
    expect(engine.getSnapshot().players[0].hp).toBe(5);
  });

  it('a monster killed during the player turn does not act on endTurn', () => {
    const engine = new BattleEngine(twoWaveMap(), ['li_yan', 'su_qing'], registry);
    engine.useSkill(0, 'strike', 'right'); // kills the ghost (2 dmg, maxHp 2)
    engine.endTurn();
    expect(engine.getSnapshot().players[0].hp).toBe(6); // took no damage
  });
});

describe('BattleEngine: wave clear and victory (reinforcement clock)', () => {
  it('clearing a non-final wave early does NOT advance — it waits for the clock, but still resets per-turn budgets', () => {
    const engine = new BattleEngine(twoWaveMap(), ['li_yan', 'su_qing'], registry); // wave 0 has AMPLE_TURNS left
    engine.useSkill(0, 'strike', 'right'); // kills wave-0's only monster, well before the clock
    engine.endTurn();
    const snap = engine.getSnapshot();
    expect(snap.waveIndex).toBe(0); // did NOT advance — the clock hasn't elapsed
    expect(snap.monsters).toHaveLength(0); // board is clear, but that's just a breather
    expect(snap.players[0].acted).toBe(false); // still a fresh round every turn
    expect(snap.outcome).toBeNull();
  });

  it('reinforcing adds the next wave on top of survivors — count grows, survivors are not cleared', () => {
    const map: MapDef = {
      ...twoWaveMap(),
      waves: [
        { turns: 1, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 6, y: 1 } }] }, // far away, won't be killed or reach anything in 1 turn
        { turns: AMPLE_TURNS, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 6, y: 2 } }] },
      ],
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    const survivorId = engine.getSnapshot().monsters[0].instanceId;
    engine.endTurn(); // wave-0's 1-turn clock elapses -> reinforce into wave 1
    const snap = engine.getSnapshot();
    expect(snap.waveIndex).toBe(1);
    expect(snap.monsters).toHaveLength(2); // wave-0 survivor + wave-1 reinforcement, not just 1
    expect(snap.monsters.some((m) => m.instanceId === survivorId)).toBe(true); // the original survivor is still there
  });

  it('reinforcing relocates a spawn away from an occupied tile and ambushes the player standing on it', () => {
    const map: MapDef = {
      ...twoWaveMap(),
      waves: [
        { ...twoWaveMap().waves[0], turns: 1 }, // clock elapses after a single endTurn
        { turns: AMPLE_TURNS, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 1, y: 1 } }] }, // li_yan's own tile
      ],
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    engine.useSkill(0, 'strike', 'right'); // kills wave-0's monster (no survivors going into the reinforcement)
    engine.endTurn(); // clock elapses -> reinforce into wave 1
    const snap = engine.getSnapshot();
    expect(snap.waveIndex).toBe(1);
    expect(snap.monsters).toHaveLength(1);
    expect(snap.monsters[0].position).not.toEqual({ x: 1, y: 1 }); // not on top of li_yan
    const p = snap.monsters[0].position;
    expect(grid[p.y][p.x]).toBe(' '); // still a valid floor tile
    expect(snap.players[0].hp).toBe(5); // ghost_claw's 1 damage as an ambush hit before relocating
  });

  it('clearing the only (last) wave immediately sets a pending victory outcome, frozen until confirmed', () => {
    const map = twoWaveMap();
    map.waves = [map.waves[0]]; // only one wave, so it's also the last wave
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    engine.useSkill(0, 'strike', 'right');
    engine.endTurn();
    expect(engine.getSnapshot().outcome).toBe('victory');
    expect(engine.getIntents()).toEqual([]);
    // Frozen: further play is locked out until confirmOutcome().
    engine.endTurn(); // no-op — pendingOutcome guards it
    expect(engine.getSnapshot().outcome).toBe('victory'); // unchanged by the no-op endTurn
    expect(engine.moveUnit(0, { x: 2, y: 1 })).toEqual({ ok: false, reason: 'outcome-pending' });

    engine.confirmOutcome();
    const snap = engine.getSnapshot();
    expect(snap.outcome).toBeNull(); // confirming resets for another run (Phase 1 has only one map)
    expect(snap.waveIndex).toBe(0);
  });

  it("outlasting the last wave's clock with the base alive sets a pending victory, even with monsters still on the board", () => {
    const map: MapDef = {
      ...twoWaveMap(),
      // 5 tiles from the players, moveRange 1 — cannot possibly arrive within 2 turns.
      waves: [{ turns: 2, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 6, y: 1 } }] }],
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    engine.endTurn(); // turn 1 of 2
    expect(engine.getSnapshot().outcome).toBeNull();
    engine.endTurn(); // turn 2 of 2: clock elapses, monster still alive, base intact -> victory
    const snap = engine.getSnapshot();
    expect(snap.outcome).toBe('victory');
    expect(snap.monsters.length).toBeGreaterThan(0); // you did NOT have to kill it — and the frozen board still shows it
  });
});

describe('BattleEngine: base destruction and defeat', () => {
  // Phase 1's lose condition is base HP, not player HP — a monster that
  // targets nearestBaseTile instead of nearestPlayer, so hitting 0 base HP
  // (not a player wipe) is what should now set the defeat outcome.
  const baseSeekingGhost: MonsterDef = {
    ...yinGhost,
    id: 'base_ghost',
    aiRules: [
      { when: { kind: 'targetInRange', target: 'nearestBaseTile', range: 1 }, action: { kind: 'useSkill', skillId: 'ghost_claw' } },
      { when: { kind: 'always' }, action: { kind: 'moveToward', target: 'nearestBaseTile' } },
    ],
  };
  const baseRegistry: ContentRegistry = {
    ...registry,
    monsters: { ...registry.monsters, base_ghost: baseSeekingGhost },
  };

  function baseAssaultMap(): MapDef {
    return {
      formatVersion: 1,
      id: 'test-base-assault',
      nameKey: 'map.testbase.name',
      grid: ['########', '#B     #', '#B     #', '########'],
      baseHp: 2,
      playerStarts: [
        { x: 4, y: 1 }, // out of the way — irrelevant to this scenario
        { x: 4, y: 2 },
      ],
      waves: [
        {
          turns: AMPLE_TURNS,
          monsters: [
            { monsterId: 'base_ghost', spawn: { x: 2, y: 1 } }, // adjacent to base tile (1,1)
            { monsterId: 'base_ghost', spawn: { x: 2, y: 2 } }, // adjacent to base tile (1,2)
          ],
        },
      ],
    };
  }

  it('base HP reaching 0 freezes the board on a pending defeat outcome — board untouched until confirmed', () => {
    const engine = new BattleEngine(baseAssaultMap(), ['li_yan', 'su_qing'], baseRegistry);
    engine.endTurn(); // both ghosts hit the base for 1 each: baseHp 2 -> 0
    const frozen = engine.getSnapshot();
    expect(frozen.outcome).toBe('defeat');
    expect(frozen.baseHp).toBe(0); // the actual losing position, not silently reset to full
    expect(frozen.monsters).toHaveLength(2); // the same two ghosts that landed the killing blow, not a respawn

    engine.confirmOutcome();
    const snap = engine.getSnapshot();
    expect(snap.outcome).toBeNull();
    expect(snap.waveIndex).toBe(0);
    expect(snap.baseHp).toBe(2); // reset to full (baseMaxHp)
    expect(snap.monsters).toHaveLength(2); // wave respawned
  });

  it('a frozen defeat keeps the intents that just resolved, so the UI can still show what killed the base', () => {
    const engine = new BattleEngine(baseAssaultMap(), ['li_yan', 'su_qing'], baseRegistry);
    engine.endTurn();
    expect(engine.getSnapshot().outcome).toBe('defeat');
    expect(engine.getIntents()).toHaveLength(2); // NOT cleared, unlike the victory branch
    expect(engine.getIntents().every((i) => i.kind === 'skill')).toBe(true); // both ghosts attacked
  });

  it('resetLevel() is a manual full restart, available at any time mid-run — including with a defeat still pending', () => {
    const engine = new BattleEngine(baseAssaultMap(), ['li_yan', 'su_qing'], baseRegistry);
    engine.endTurn(); // baseHp 2 -> 0, pendingOutcome set
    expect(engine.getSnapshot().outcome).toBe('defeat');

    engine.resetLevel(); // bail out without confirming the loss first
    const snap = engine.getSnapshot();
    expect(snap.outcome).toBeNull();
    expect(snap.waveIndex).toBe(0);
    expect(snap.baseHp).toBe(2);
  });

  it('a defeat confirmed on turn 7+ resets turnNumber back to 1, not just the board', () => {
    const engine = new BattleEngine(baseAssaultMap(), ['li_yan', 'su_qing'], baseRegistry);
    engine.endTurn(); // turn 1 -> defeat immediately (2 ghosts x 1 dmg = baseHp 2 -> 0)
    engine.confirmOutcome();
    engine.endTurn(); // turn 2 -> defeat again
    engine.confirmOutcome();
    expect(engine.getSnapshot().turnNumber).toBe(1); // not 3 — a fresh run starts the count over
  });
});

describe('BattleEngine: new AI behaviors', () => {
  it('a moveAway rule steps the monster away when the player is adjacent', () => {
    const skittish: MonsterDef = {
      formatVersion: 1,
      id: 'wisp',
      nameKey: 'monster.wisp.name',
      spriteRef: 'mon_wisp',
      maxHp: 1,
      moveRange: 1,
      skillIds: ['ghost_claw'],
      aiRules: [
        { when: { kind: 'targetInRange', target: 'nearestPlayer', range: 1 }, action: { kind: 'moveAway', target: 'nearestPlayer' } },
        { when: { kind: 'always' }, action: { kind: 'moveToward', target: 'nearestPlayer' } },
      ],
    };
    const localRegistry: ContentRegistry = { ...registry, monsters: { ...registry.monsters, wisp: skittish } };
    const map: MapDef = {
      ...twoWaveMap(),
      waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'wisp', spawn: { x: 2, y: 1 } }] }], // adjacent to li_yan at (1,1)
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], localRegistry);
    expect(engine.getIntents()).toEqual([
      { kind: 'move', instanceId: expect.any(String), to: { x: 3, y: 1 }, aim: { x: 1, y: 1 }, away: true }, // steps further away, not toward
    ]);
  });

  it('a monster with moveRange > 1 advances multiple tiles toward the player in one turn', () => {
    const hound: MonsterDef = {
      formatVersion: 1,
      id: 'hound',
      nameKey: 'monster.hound.name',
      spriteRef: 'mon_hound',
      maxHp: 2,
      moveRange: 2,
      skillIds: ['ghost_claw'],
      aiRules: [
        { when: { kind: 'targetInRange', target: 'nearestPlayer', range: 1 }, action: { kind: 'useSkill', skillId: 'ghost_claw' } },
        { when: { kind: 'always' }, action: { kind: 'moveToward', target: 'nearestPlayer' } },
      ],
    };
    const localRegistry: ContentRegistry = { ...registry, monsters: { ...registry.monsters, hound } };
    const map: MapDef = {
      ...twoWaveMap(),
      playerStarts: [{ x: 1, y: 1 }, { x: 1, y: 2 }],
      waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'hound', spawn: { x: 6, y: 1 } }] }], // 5 tiles from li_yan
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], localRegistry);
    engine.endTurn(); // hound moves toward li_yan
    expect(engine.getSnapshot().monsters[0].position).toEqual({ x: 4, y: 1 }); // 2 tiles this turn, not 1
  });

  it('a base-seeking monster attacks a hero blocking its path, not the base', () => {
    const baseSeeker: MonsterDef = {
      ...yinGhost,
      id: 'base_seeker',
      aiRules: [
        { when: { kind: 'targetInRange', target: 'nearestBaseTile', range: 1 }, action: { kind: 'useSkill', skillId: 'ghost_claw' } },
        { when: { kind: 'always' }, action: { kind: 'moveToward', target: 'nearestBaseTile' } },
      ],
    };
    const localRegistry: ContentRegistry = { ...registry, monsters: { ...registry.monsters, base_seeker: baseSeeker } };
    // base at (1,2); li_yan blocks at (3,2), directly between the ghost (4,2) and the base.
    const map: MapDef = {
      formatVersion: 1,
      id: 'blocker-test',
      nameKey: 'map.blocker.name',
      grid: ['########', '#      #', '#B     #', '#      #', '########'],
      baseHp: 8,
      playerStarts: [{ x: 3, y: 2 }, { x: 6, y: 3 }],
      waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'base_seeker', spawn: { x: 4, y: 2 } }] }],
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], localRegistry);
    // The ghost isn't adjacent to the base (a hero is in the way), so it claws the blocker.
    expect(engine.getIntents()).toEqual([
      { kind: 'skill', instanceId: expect.any(String), skillId: 'ghost_claw', direction: 'left' },
    ]);
    engine.endTurn();
    const snap = engine.getSnapshot();
    expect(snap.players[0].hp).toBe(5); // li_yan ate 1 claw for blocking the lane
    expect(snap.baseHp).toBe(8); // base untouched — the hero absorbed the hit
  });
});

describe('BattleEngine: hazard terrain', () => {
  // hazard '~' at (4,2); base tile ('B') at (1,3) — an unused spare row, kept
  // out of the way of every position these tests actually exercise (y=1,y=2).
  const hazardGrid = ['########', '#      #', '#   ~  #', '#B     #', '########'];

  it('pushing a monster into a hazard tile kills it instantly', () => {
    const map: MapDef = {
      formatVersion: 1,
      id: 'hazard-push',
      nameKey: 'map.hazard.name',
      grid: hazardGrid,
      baseHp: 8,
      playerStarts: [{ x: 1, y: 2 }, { x: 1, y: 1 }],
      waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 3, y: 2 } }] }],
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    engine.moveUnit(0, { x: 2, y: 2 }); // li_yan (1,2) -> (2,2), adjacent to the ghost at (3,2)
    const res = engine.useSkill(0, 'push_skill', 'right'); // pushes the ghost 2: (3,2) -> (4,2) hazard
    expect(res).toEqual({ ok: true });
    expect(engine.getSnapshot().monsters[0].hp).toBe(0);
  });

  it('a monster pushing a player into a hazard tile deals flat damage instead of killing them', () => {
    const shove: SkillDef = {
      formatVersion: 1,
      id: 'shove',
      nameKey: 'skill.shove.name',
      descKey: 'skill.shove.desc',
      range: 1,
      effects: [{ type: 'push', amount: 2, target: 'firstInLine' }],
    };
    const brute: MonsterDef = {
      formatVersion: 1,
      id: 'brute',
      nameKey: 'monster.brute.name',
      spriteRef: 'mon_brute',
      maxHp: 5,
      moveRange: 1,
      skillIds: ['shove'],
      aiRules: [
        { when: { kind: 'targetInRange', target: 'nearestPlayer', range: 1 }, action: { kind: 'useSkill', skillId: 'shove' } },
        { when: { kind: 'always' }, action: { kind: 'moveToward', target: 'nearestPlayer' } },
      ],
    };
    const localRegistry: ContentRegistry = {
      ...registry,
      skills: { ...registry.skills, shove },
      monsters: { ...registry.monsters, brute },
    };
    const map: MapDef = {
      formatVersion: 1,
      id: 'hazard-shove',
      nameKey: 'map.hazard2.name',
      grid: hazardGrid,
      baseHp: 8,
      playerStarts: [{ x: 3, y: 2 }, { x: 1, y: 1 }], // li_yan adjacent to the brute, hazard just past li_yan
      waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'brute', spawn: { x: 2, y: 2 } }] }],
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], localRegistry);
    engine.endTurn(); // brute shoves li_yan from (3,2) into the hazard at (4,2)
    const snap = engine.getSnapshot();
    expect(snap.players[0].position).toEqual({ x: 4, y: 2 });
    expect(snap.players[0].hp).toBe(3); // 6 maxHp - 3 hazard damage, not a kill
  });

  it("a skill's line of sight flies over a hazard tile instead of stopping at it", () => {
    const map: MapDef = {
      formatVersion: 1,
      id: 'hazard-sightline',
      nameKey: 'map.hazard3.name',
      grid: hazardGrid,
      baseHp: 8,
      playerStarts: [{ x: 1, y: 1 }, { x: 2, y: 2 }], // su_qing at (2,2), hazard at (4,2) between it and the monster
      waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 5, y: 2 } }] }],
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    const res = engine.useSkill(1, 'ranged_skill', 'right'); // range 3: (3,2) floor, (4,2) hazard, (5,2) monster
    expect(res).toEqual({ ok: true });
    expect(engine.getSnapshot().monsters[0].hp).toBe(0); // maxHp 2 - 2 damage landed, the ray wasn't blocked by the hazard
  });

  it('a monster reroutes onto the other axis instead of permanently wedging against a hazard tile on a tied diagonal', () => {
    // Regression: multiStepToward() picked one axis (ties go horizontal) and
    // gave up for the whole turn if that single step was blocked, even when
    // a step on the other axis was clear. A monster whose distance to its
    // target ties (or nearly ties) on both axes, with a hazard sitting on
    // the tie-break axis, got permanently walled off with zero progress
    // every turn — found via manual playtesting, not by the automated
    // "no monster ever gets stuck" regression (that check only exercises the
    // default player-start positions, which never happened to create a tie).
    const map: MapDef = {
      formatVersion: 1,
      id: 'hazard-reroute',
      nameKey: 'map.hazard4.name',
      grid: hazardGrid,
      baseHp: 8,
      playerStarts: [{ x: 4, y: 1 }, { x: 6, y: 3 }], // li_yan at (4,1) is nearest; su_qing far away, out of contention
      waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 3, y: 2 } }] }],
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    // From (3,2) to (4,1): dx=1, dy=-1 — a tie. The tie-break picks
    // horizontal ('right'), landing on the hazard at (4,2) — blocked. Without
    // the fallback the ghost never moves; with it, it steps 'up' to (3,1).
    engine.endTurn();
    expect(engine.getSnapshot().monsters[0].position).toEqual({ x: 3, y: 1 });
  });
});

describe('BattleEngine: poison mist terrain', () => {
  // poison mist '*' at (4,2); base tile ('B') at (1,3) — mirrors the hazard
  // fixture's layout so these tests exercise the same shape of map.
  const mistGrid = ['########', '#      #', '#   *  #', '#B     #', '########'];

  it('a player standing on poison mist takes flat damage on endTurn, recorded in getLastEvents', () => {
    const map: MapDef = {
      formatVersion: 1,
      id: 'mist-player',
      nameKey: 'map.mistplayer.name',
      grid: mistGrid,
      baseHp: 8,
      // li_yan starts right next to the mist tile and steps onto it.
      playerStarts: [{ x: 3, y: 2 }, { x: 1, y: 1 }],
      waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 6, y: 2 } }] }],
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    engine.moveUnit(0, { x: 4, y: 2 }); // (3,2) -> (4,2), onto the mist
    expect(engine.getSnapshot().players[0].position).toEqual({ x: 4, y: 2 });
    const hpBefore = engine.getSnapshot().players[0].hp;

    engine.endTurn();

    expect(engine.getSnapshot().players[0].hp).toBe(hpBefore - 1);
    expect(engine.getLastEvents()).toContainEqual({
      kind: 'damage',
      target: { kind: 'player', unitIndex: 0 },
      amount: 1,
      blocked: false,
    });
  });

  it('a monster standing on poison mist also takes flat damage on endTurn (bidirectional — not just a player hazard)', () => {
    // This suite's local yinGhost fixture (top of file) hunts nearestPlayer,
    // not the base. li_yan sits directly adjacent (range 1) to the mist tile
    // the ghost spawns on, so targetInRange is already satisfied at spawn —
    // its intent is useSkill (stationary), not moveToward. That matters
    // here: a moveToward intent would walk it OFF the mist tile before the
    // end-of-turn poison tick checks its position.
    const map: MapDef = {
      formatVersion: 1,
      id: 'mist-monster',
      nameKey: 'map.mistmonster.name',
      grid: ['#######', '#     #', '#    *#', '#B    #', '#######'],
      baseHp: 8,
      playerStarts: [{ x: 4, y: 2 }, { x: 1, y: 3 }], // li_yan adjacent to the mist tile; su_qing out of the way
      waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 5, y: 2 } }] }], // spawns directly on the mist tile
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    const targetId = engine.getSnapshot().monsters[0].instanceId;
    const hpBefore = engine.getSnapshot().monsters[0].hp;
    expect(engine.getSnapshot().monsters[0].position).toEqual({ x: 5, y: 2 }); // still on the mist tile
    expect(engine.getIntents()).toEqual([
      { kind: 'skill', instanceId: targetId, skillId: 'ghost_claw', direction: 'left' },
    ]); // stationary (attacks li_yan), confirming it won't step off the mist this turn

    engine.endTurn();

    const monster = engine.getSnapshot().monsters.find((m) => m.instanceId === targetId);
    expect(monster?.hp).toBe(hpBefore - 1);
    expect(engine.getLastEvents()).toContainEqual({
      kind: 'damage',
      target: { kind: 'monster', instanceId: targetId },
      amount: 1,
      blocked: false,
    });
  });

  it('poison mist damage bypasses shield — the charge is not consumed and full damage still lands', () => {
    const map: MapDef = {
      formatVersion: 1,
      id: 'mist-shield',
      nameKey: 'map.mistshield.name',
      grid: mistGrid,
      baseHp: 8,
      playerStarts: [{ x: 1, y: 1 }, { x: 3, y: 2 }], // su_qing (unit 1) starts adjacent to the mist tile
      waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 6, y: 2 } }] }], // far away, won't attack this turn
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    // Move BEFORE casting — the ITB economy's fixed order (acting would lock movement).
    engine.moveUnit(1, { x: 4, y: 2 }); // su_qing (3,2) -> (4,2), onto the mist
    engine.useSkill(1, 'shield_skill', 'down'); // then shields herself — 1 charge
    expect(engine.getSnapshot().players[1].shield).toBe(1);
    const hpBefore = engine.getSnapshot().players[1].hp;

    engine.endTurn();

    const suQing = engine.getSnapshot().players[1];
    expect(suQing.shield).toBe(1); // charge untouched — mist isn't a combat hit
    expect(suQing.hp).toBe(hpBefore - 1); // full damage still landed
  });

  it("a skill's line of sight flies over a poison-mist tile instead of stopping at it", () => {
    const map: MapDef = {
      formatVersion: 1,
      id: 'mist-sightline',
      nameKey: 'map.mistsightline.name',
      grid: mistGrid,
      baseHp: 8,
      playerStarts: [{ x: 1, y: 1 }, { x: 2, y: 2 }], // su_qing at (2,2), mist at (4,2) between it and the monster
      waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 5, y: 2 } }] }],
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    const res = engine.useSkill(1, 'ranged_skill', 'right'); // range 3: (3,2) floor, (4,2) mist, (5,2) monster
    expect(res).toEqual({ ok: true });
    expect(engine.getSnapshot().monsters[0].hp).toBe(0); // maxHp 2 - 2 damage landed, the ray wasn't blocked by the mist
  });
});

describe('BattleEngine: heal targeting (bai_zhi-style skills — allies only, never a monster)', () => {
  const minorHeal: SkillDef = {
    formatVersion: 1,
    id: 'minor_heal',
    nameKey: 'skill.minor_heal.name',
    descKey: 'skill.minor_heal.desc',
    range: 3,
    effects: [{ type: 'heal', amount: 2, target: 'firstInLine' }],
  };
  const baiZhi: CharacterDef = {
    formatVersion: 1,
    id: 'bai_zhi',
    nameKey: 'character.bai_zhi.name',
    spriteRef: 'char_bai_zhi',
    maxHp: 5,
    moveRange: 3,
    skillIds: ['minor_heal'],
    ultimateSkillId: 'bai_zhi_ultimate_unused', // placeholder, see li_yan fixture's comment above for why
  };
  const healRegistry: ContentRegistry = {
    characters: { ...registry.characters, bai_zhi: baiZhi },
    skills: { ...registry.skills, minor_heal: minorHeal },
    monsters: registry.monsters,
  };

  it('heal cast by a player only lands on a fellow player, never the monster in the same line', () => {
    // Line of fire from bai_zhi (1,1) rightward: a monster at (2,1) sits
    // WITHIN range, but li_yan (the only ally) is at (6,1) — past this
    // skill's range 3. If heal ignored ally/enemy, the ray would land on the
    // in-range monster; the correct behavior is to find nothing at all.
    const map: MapDef = {
      formatVersion: 1,
      id: 'heal-target',
      nameKey: 'map.healtarget.name',
      grid: ['#########', '#       #', '#########'],
      baseHp: 8,
      playerStarts: [{ x: 1, y: 1 }, { x: 6, y: 1 }], // bai_zhi at (1,1); li_yan far at (6,1), out of range 3
      waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 2, y: 1 } }] }], // monster IS within range 3, ally is not
    };
    const engine = new BattleEngine(map, ['bai_zhi', 'li_yan'], healRegistry);
    const monsterHpBefore = engine.getSnapshot().monsters[0].hp;
    const res = engine.useSkill(0, 'minor_heal', 'right');
    expect(res).toEqual({ ok: true }); // the action itself succeeds (AP spent) even if the ray finds nobody
    expect(engine.getSnapshot().monsters[0].hp).toBe(monsterHpBefore); // the monster in the line took NO heal-as-damage and gained no HP either
    expect(engine.getLastEvents()).toEqual([]); // no target resolved -> no event
  });

  it('heal cast by a player finds and heals a fellow player standing past a monster in the same line, jumping over it', () => {
    const map: MapDef = {
      formatVersion: 1,
      id: 'heal-past-monster',
      nameKey: 'map.healpastmonster.name',
      grid: ['########', '#      #', '#      #', '#B     #', '########'],
      baseHp: 8,
      // bai_zhi (1,1) -> yin_ghost at (3,1) -> li_yan (ally) at (4,1): all
      // within heal's range 3, and deliberately NOT equidistant from the
      // ghost (li_yan is 1 tile away, bai_zhi is 2) so this suite's local
      // yinGhost fixture (hunts nearestPlayer, ties broken toward whichever
      // player sorts first) unambiguously targets li_yan, not bai_zhi. It's
      // already in range at turn start, so the FIRST endTurn lands its
      // ghost_claw hit on li_yan before bai_zhi ever acts — giving a real,
      // non-full HP target to heal, not a synthetic mutation.
      playerStarts: [{ x: 1, y: 1 }, { x: 4, y: 1 }],
      waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 3, y: 1 } }] }],
    };
    const engine = new BattleEngine(map, ['bai_zhi', 'li_yan'], healRegistry);
    // Two turns of ghost_claw (1 dmg each) so li_yan is down exactly 2 HP —
    // enough for the heal's full nominal amount to land without clipping
    // against maxHp, which would understate the healed amount below.
    engine.endTurn();
    engine.endTurn();
    const hurtHp = engine.getSnapshot().players[1].hp;
    expect(hurtHp).toBeLessThan(engine.getSnapshot().players[1].maxHp);
    const monsterId = engine.getSnapshot().monsters[0].instanceId;

    const res = engine.useSkill(0, 'minor_heal', 'right'); // bai_zhi heals through the jiangshi standing in the line
    expect(res).toEqual({ ok: true });
    expect(engine.getLastEvents()).toEqual([
      { kind: 'heal', target: { kind: 'player', unitIndex: 1 }, amount: 2 },
    ]);
    expect(engine.getSnapshot().players[1].hp).toBe(hurtHp + 2);
    // The monster standing directly in the ray's path took no heal-as-damage and gained no HP.
    const monster = engine.getSnapshot().monsters.find((m) => m.instanceId === monsterId);
    expect(monster?.hp).toBe(engine.getSnapshot().monsters.find((m) => m.instanceId === monsterId)!.maxHp);
  });
});

describe('BattleEngine: Phase 1 base defense', () => {
  // A monster that targets the base instead of the nearest player — mirrors
  // content/monsters/yin_ghost.json's real Phase 1 aiRules.
  const baseSeekingGhost: MonsterDef = {
    ...yinGhost,
    id: 'base_ghost',
    aiRules: [
      { when: { kind: 'targetInRange', target: 'nearestBaseTile', range: 1 }, action: { kind: 'useSkill', skillId: 'ghost_claw' } },
      { when: { kind: 'always' }, action: { kind: 'moveToward', target: 'nearestBaseTile' } },
    ],
  };
  const baseRegistry: ContentRegistry = {
    ...registry,
    monsters: { ...registry.monsters, base_ghost: baseSeekingGhost },
  };

  it('a monster adjacent to the base damages it for its skill amount on endTurn', () => {
    const map: MapDef = {
      formatVersion: 1,
      id: 'test-base-hit',
      nameKey: 'map.testbasehit.name',
      grid: ['########', '#B     #', '#      #', '########'],
      baseHp: 8,
      playerStarts: [
        { x: 4, y: 1 },
        { x: 4, y: 2 },
      ],
      waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'base_ghost', spawn: { x: 2, y: 1 } }] }], // already adjacent to base tile (1,1)
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], baseRegistry);
    engine.endTurn(); // ghost_claw deals 1 to the base
    expect(engine.getSnapshot().baseHp).toBe(7);
  });

  it('the clock running out reinforces (adds wave 1 on top of the still-alive wave-0 survivor)', () => {
    const map: MapDef = {
      formatVersion: 1,
      id: 'test-clock',
      nameKey: 'map.testclock.name',
      grid: ['########', '#B     #', '#      #', '########'],
      baseHp: 8,
      playerStarts: [
        { x: 2, y: 2 }, // row 2, out of the ghost's straight-line path along row 1
        { x: 3, y: 2 },
      ],
      waves: [
        // 5 tiles from the base, moveRange 1 — cannot possibly arrive within 2 turns.
        { turns: 2, monsters: [{ monsterId: 'base_ghost', spawn: { x: 6, y: 1 } }] },
        { turns: AMPLE_TURNS, monsters: [{ monsterId: 'base_ghost', spawn: { x: 5, y: 2 } }] },
      ],
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], baseRegistry);
    engine.endTurn(); // turn 1 of 2: just closing the distance
    expect(engine.getSnapshot().waveIndex).toBe(0);
    engine.endTurn(); // turn 2 of 2: clock runs out — reinforce, not a clean advance
    const snap = engine.getSnapshot();
    expect(snap.waveIndex).toBe(1);
    expect(snap.monsters).toHaveLength(2); // wave-0's still-alive ghost PLUS wave-1's reinforcement
    expect(snap.baseHp).toBe(8); // it never got close enough to land a hit
  });

  it('clearing all monsters before the turn budget does NOT advance a non-final wave — it waits for the clock', () => {
    const map: MapDef = {
      formatVersion: 1,
      id: 'test-early-clear',
      nameKey: 'map.testearlyclear.name',
      grid: ['########', '#B     #', '#      #', '########'],
      baseHp: 8,
      playerStarts: [
        { x: 2, y: 1 }, // adjacent to the wave-0 spawn
        { x: 4, y: 2 },
      ],
      waves: [
        { turns: 3, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 3, y: 1 } }] },
        { turns: AMPLE_TURNS, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 6, y: 1 } }] },
      ],
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    expect(engine.getSnapshot().turnsLeftInWave).toBe(3);
    engine.useSkill(0, 'strike', 'right'); // kills the only monster well before the budget runs out
    engine.endTurn(); // turnsLeftInWave: 3 -> 2, board is clear, but this is not the last wave
    expect(engine.getSnapshot().waveIndex).toBe(0); // did NOT advance just because it's clear
    expect(engine.getSnapshot().monsters).toHaveLength(0);

    engine.endTurn(); // 2 -> 1
    engine.endTurn(); // 1 -> 0: clock finally elapses -> reinforce
    expect(engine.getSnapshot().waveIndex).toBe(1); // advanced by the clock, not by the earlier clear
  });

  it("a monster's path to the base is blocked by a hero standing in the only lane", () => {
    const map: MapDef = {
      formatVersion: 1,
      id: 'test-lane-block',
      nameKey: 'map.testlaneblock.name',
      grid: ['######', '#B   #', '#    #', '######'],
      baseHp: 8,
      playerStarts: [
        { x: 2, y: 1 }, // blocks the only lane between the ghost and the base
        { x: 2, y: 2 }, // out of the way
      ],
      waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'base_ghost', spawn: { x: 4, y: 1 } }] }],
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], baseRegistry);
    engine.endTurn(); // ghost steps (4,1) -> (3,1), still short of the hero
    engine.endTurn(); // ghost tries (3,1) -> (2,1) but the hero is standing there — blocked
    const snap = engine.getSnapshot();
    expect(snap.monsters[0].position).toEqual({ x: 3, y: 1 }); // did not pass through the hero's tile
    expect(snap.baseHp).toBe(8); // never got close enough to attack
  });
});

describe('BattleEngine: getAttackPreviews', () => {
  function twoGhostsOnSuQingMap(): MapDef {
    return {
      formatVersion: 1,
      id: 'test-preview',
      nameKey: 'map.testpreview.name',
      grid,
      baseHp: 8,
      playerStarts: [
        { x: 1, y: 2 }, // li_yan, far from both ghosts — su_qing is the nearest player
        { x: 4, y: 1 }, // su_qing, flanked by a ghost on each side
      ],
      waves: [
        {
          turns: AMPLE_TURNS,
          monsters: [
            { monsterId: 'yin_ghost', spawn: { x: 3, y: 1 } },
            { monsterId: 'yin_ghost', spawn: { x: 5, y: 1 } },
          ],
        },
      ],
    };
  }

  it('aggregates multiple monsters telegraphing the same target into one combined total', () => {
    const engine = new BattleEngine(twoGhostsOnSuQingMap(), ['li_yan', 'su_qing'], registry);
    // both ghosts are adjacent to su_qing (unit 1) and neither is adjacent to li_yan
    const previews = engine.getAttackPreviews();
    expect(previews).toEqual([{ target: { kind: 'player', unitIndex: 1 }, damage: 2 }]); // 1 dmg x 2 ghosts
  });

  it("a shielded target's preview reflects the REAL damage after the shield blocks one hit, not the naive sum", () => {
    const engine = new BattleEngine(twoGhostsOnSuQingMap(), ['li_yan', 'su_qing'], registry);
    engine.useSkill(1, 'shield_skill', 'down'); // su_qing shields herself — 1 charge, blocks exactly one hit
    const previews = engine.getAttackPreviews();
    // First hit in intent order is fully blocked (shield consumes its charge, 0 dmg);
    // the second lands at full damage — so the combined preview is 1, not 2 or 0.
    expect(previews).toEqual([{ target: { kind: 'player', unitIndex: 1 }, damage: 1 }]);
  });

  it('a fully-shielded target (enough charges to eat every hit) is omitted from the preview entirely', () => {
    // su_qing (unit 1) faces only one ghost this time, so one shield charge blocks it completely.
    const map: MapDef = {
      ...twoGhostsOnSuQingMap(),
      waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 3, y: 1 } }] }],
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    engine.useSkill(1, 'shield_skill', 'down');
    expect(engine.getAttackPreviews()).toEqual([]); // 0 real damage — nothing worth showing
  });
});

describe('BattleEngine: getLastEvents', () => {
  it('a plain move produces no events', () => {
    const engine = new BattleEngine(roomyMapModule(), ['li_yan', 'su_qing'], registry);
    engine.moveUnit(0, { x: 1, y: 2 });
    expect(engine.getLastEvents()).toEqual([]);
  });

  it("useSkill records the real damage dealt, keyed to the target it actually hit", () => {
    const engine = new BattleEngine(twoWaveMap(), ['li_yan', 'su_qing'], registry);
    const targetId = engine.getSnapshot().monsters[0].instanceId;
    engine.useSkill(0, 'strike', 'right'); // adjacent ghost, kills it (2 dmg, maxHp 2)
    expect(engine.getLastEvents()).toEqual([
      { kind: 'damage', target: { kind: 'monster', instanceId: targetId }, amount: 2, blocked: false },
    ]);
  });

  it('a shield-blocked hit records amount 0 and blocked: true, not the nominal skill damage', () => {
    const map: MapDef = {
      ...twoWaveMap(),
      playerStarts: [
        { x: 1, y: 2 }, // li_yan out of range
        { x: 1, y: 1 }, // su_qing (unit 1) adjacent to the ghost at (2,1)
      ],
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    engine.useSkill(1, 'shield_skill', 'down'); // su_qing shields herself
    engine.endTurn(); // the telegraphed ghost_claw resolves against the shield
    expect(engine.getLastEvents()).toEqual([
      { kind: 'damage', target: { kind: 'player', unitIndex: 1 }, amount: 0, blocked: true },
    ]);
  });

  it("pushing a target into a wall records only the distance actually covered, not the skill's nominal amount, and lands a collision hit", () => {
    const map = twoWaveMap();
    map.waves[0].monsters[0].spawn = { x: 5, y: 1 }; // one tile from the x=6 floor edge (x=7 is wall)
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    engine.moveUnit(0, { x: 4, y: 1 }); // li_yan (1,1) -> (4,1), adjacent to the ghost at (5,1)
    const targetId = engine.getSnapshot().monsters[0].instanceId;
    engine.useSkill(0, 'push_skill', 'right'); // push_skill's amount is 2, but the wall at x=7 stops it after 1
    expect(engine.getLastEvents()).toEqual([
      // Cut short of the full 2-tile shove — the wall collision itself lands
      // a hit instead of the remaining distance silently going nowhere.
      { kind: 'damage', target: { kind: 'monster', instanceId: targetId }, amount: 1, blocked: false },
      { kind: 'push', target: { kind: 'monster', instanceId: targetId }, distance: 1 },
    ]);
    expect(engine.getSnapshot().monsters[0].hp).toBe(1); // yinGhost maxHp 2 - 1 collision damage
  });

  it('pushing a target into another unit deals collision damage to both, with zero push distance', () => {
    const map = twoWaveMap();
    map.waves[0].monsters[0].spawn = { x: 5, y: 1 };
    map.waves[0].monsters.push({ monsterId: 'yin_ghost', spawn: { x: 6, y: 1 } }); // blocks the push target's only escape tile
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    engine.moveUnit(0, { x: 4, y: 1 }); // li_yan (1,1) -> (4,1), adjacent to the ghost at (5,1)
    const [pushedId, blockerId] = engine.getSnapshot().monsters.map((m) => m.instanceId);
    engine.useSkill(0, 'push_skill', 'right'); // (5,1) can't move to (6,1) — occupied
    expect(engine.getLastEvents()).toEqual([
      { kind: 'damage', target: { kind: 'monster', instanceId: pushedId }, amount: 1, blocked: false },
      { kind: 'damage', target: { kind: 'monster', instanceId: blockerId }, amount: 1, blocked: false },
      // No 'push' event at all — zero distance covered.
    ]);
    const snap = engine.getSnapshot();
    expect(snap.monsters[0].hp).toBe(1);
    expect(snap.monsters[1].hp).toBe(1);
  });

  it('casting a shield records a shield event', () => {
    const engine = new BattleEngine(twoWaveMap(), ['li_yan', 'su_qing'], registry);
    engine.useSkill(1, 'shield_skill', 'down');
    expect(engine.getLastEvents()).toEqual([{ kind: 'shield', target: { kind: 'player', unitIndex: 1 }, amount: 1 }]);
  });

  it('a monster attacking the base during endTurn records a base damage event', () => {
    const baseSeekingGhost: MonsterDef = {
      ...yinGhost,
      id: 'base_ghost',
      aiRules: [
        { when: { kind: 'targetInRange', target: 'nearestBaseTile', range: 1 }, action: { kind: 'useSkill', skillId: 'ghost_claw' } },
        { when: { kind: 'always' }, action: { kind: 'moveToward', target: 'nearestBaseTile' } },
      ],
    };
    const baseRegistry: ContentRegistry = { ...registry, monsters: { ...registry.monsters, base_ghost: baseSeekingGhost } };
    const map: MapDef = {
      formatVersion: 1,
      id: 'test-base-event',
      nameKey: 'map.testbaseevent.name',
      grid: ['########', '#B     #', '#B     #', '########'],
      baseHp: 8,
      playerStarts: [{ x: 4, y: 1 }, { x: 4, y: 2 }],
      waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'base_ghost', spawn: { x: 2, y: 1 } }] }],
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], baseRegistry);
    engine.endTurn(); // the ghost is adjacent to the base tile (1,1) and attacks it
    expect(engine.getLastEvents()).toEqual([{ kind: 'damage', target: { kind: 'base' }, amount: 1, blocked: false }]);
  });

  it('getLastEvents only reflects the MOST RECENT call, not everything accumulated this turn', () => {
    const engine = new BattleEngine(twoWaveMap(), ['li_yan', 'su_qing'], registry);
    engine.useSkill(0, 'strike', 'right'); // kills the ghost — one damage event
    expect(engine.getLastEvents()).toHaveLength(1);
    engine.moveUnit(1, { x: 2, y: 2 }); // a no-op-for-events action right after
    expect(engine.getLastEvents()).toEqual([]); // the earlier damage event is gone, not accumulated
  });

  function roomyMapModule(): MapDef {
    return {
      ...twoWaveMap(),
      playerStarts: [
        { x: 1, y: 1 },
        { x: 6, y: 2 },
      ],
      waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 6, y: 1 } }] }],
    };
  }
});

describe('BattleEngine: no opportunity attacks (A7 — removed with the ITB action economy)', () => {
  // The old attack-then-retreat exploit this mechanic existed to close is
  // now structurally impossible (acting ends the unit's turn), and punishing
  // disengagement would punish the "read the telegraph, walk out of it"
  // core loop itself. This regression guard proves a move that breaks
  // adjacency with a living monster is FREE.
  const tankyGhost: MonsterDef = { ...yinGhost, id: 'tanky_ghost', maxHp: 10 };
  const localRegistry: ContentRegistry = { ...registry, monsters: { ...registry.monsters, tanky_ghost: tankyGhost } };

  it('moving out of adjacency with a living monster costs nothing — no free counter-hit', () => {
    const map: MapDef = {
      formatVersion: 1,
      id: 'test-no-opportunity',
      nameKey: 'map.testnoopportunity.name',
      grid: ['##########', '#        #', '#        #', '#B       #', '##########'],
      baseHp: 8,
      playerStarts: [
        { x: 3, y: 1 }, // adjacent to the ghost at (2,1) from the very first turn
        { x: 3, y: 3 },
      ],
      waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'tanky_ghost', spawn: { x: 2, y: 1 } }] }],
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], localRegistry);
    const res = engine.moveUnit(0, { x: 6, y: 1 }); // (3,1) -> (6,1): breaks adjacency with the living ghost
    expect(res).toEqual({ ok: true });
    expect(engine.getSnapshot().players[0].hp).toBe(6); // full HP — the disengage was free
    expect(engine.getLastEvents()).toEqual([]); // and no damage event fired
  });
});

describe('BattleEngine: taunt (ling_er-style aggro tank)', () => {
  const heavyShieldSkill: SkillDef = {
    formatVersion: 1,
    id: 'heavy_shield',
    nameKey: 'skill.heavy_shield.name',
    descKey: 'skill.heavy_shield.desc',
    range: 0,
    effects: [{ type: 'shield', amount: 2, target: 'self' }],
  };
  const tauntSkill: SkillDef = {
    formatVersion: 1,
    id: 'taunt',
    nameKey: 'skill.taunt.name',
    descKey: 'skill.taunt.desc',
    range: 3,
    effects: [{ type: 'taunt', amount: 2, target: 'firstInLine' }],
  };
  const lingEr: CharacterDef = {
    formatVersion: 1,
    id: 'ling_er',
    nameKey: 'character.ling_er.name',
    spriteRef: 'char_ling_er',
    maxHp: 9,
    moveRange: 2,
    skillIds: ['heavy_shield', 'taunt'],
    ultimateSkillId: 'ling_er_ultimate_unused', // placeholder, see li_yan fixture's comment above for why
  };
  // A pure base-seeker, like content/monsters/yin_ghost.json's real Phase 1
  // aiRules — never attacks a player, only ever aims at nearestBaseTile. The
  // most meaningful taunt case: proving it can be yanked off the base and
  // onto a hero, not just redirected between two things it already hunted.
  const baseSeekingGhost: MonsterDef = {
    ...yinGhost,
    id: 'base_ghost',
    aiRules: [
      { when: { kind: 'targetInRange', target: 'nearestBaseTile', range: 1 }, action: { kind: 'useSkill', skillId: 'ghost_claw' } },
      { when: { kind: 'always' }, action: { kind: 'moveToward', target: 'nearestBaseTile' } },
    ],
  };
  const lethalClaw: SkillDef = {
    formatVersion: 1,
    id: 'lethal_claw',
    nameKey: 'skill.lethal_claw.name',
    descKey: 'skill.lethal_claw.desc',
    range: 1,
    effects: [{ type: 'damage', amount: 99, target: 'firstInLine' }],
  };
  // Always attacks whoever's adjacent — used only to kill the taunt caster
  // on cue, to test the caster-died cleanup path.
  const assassin: MonsterDef = {
    formatVersion: 1,
    id: 'assassin',
    nameKey: 'monster.assassin.name',
    spriteRef: 'mon_assassin',
    maxHp: 5,
    moveRange: 1,
    skillIds: ['lethal_claw'],
    aiRules: [{ when: { kind: 'always' }, action: { kind: 'useSkill', skillId: 'lethal_claw' } }],
  };

  const tauntRegistry: ContentRegistry = {
    characters: { ...registry.characters, ling_er: lingEr },
    skills: { ...registry.skills, heavy_shield: heavyShieldSkill, taunt: tauntSkill, lethal_claw: lethalClaw },
    monsters: { ...registry.monsters, base_ghost: baseSeekingGhost, assassin },
  };

  // 10x6 room, base tile in the bottom-left, ling_er in the top-right corner,
  // base_ghost spawned in the bottom-right — far from both the base and
  // ling_er, so its very first intent (before any taunt) is a plain
  // moveToward-base fallback. Deliberately keeps ling_er off the x=7 column
  // the ghost walks up so a taunted move's "ahead" tile never coincides with
  // ling_er's own tile — isolates "is the aim the taunter or the base" from
  // the unrelated blocker-attack mechanic (moveToward's own body-block rule).
  function tauntArena(): MapDef {
    return {
      formatVersion: 1,
      id: 'taunt-arena',
      nameKey: 'map.tauntarena.name',
      grid: ['##########', '#        #', '#        #', '#        #', '#B       #', '##########'],
      baseHp: 8,
      playerStarts: [{ x: 8, y: 1 }],
      waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'base_ghost', spawn: { x: 8, y: 4 } }] }],
    };
  }

  it('taunting a pure base-seeking monster (nearestBaseTile AI, never targets a player) redirects its very next intent onto the caster', () => {
    const engine = new BattleEngine(tauntArena(), ['ling_er'], tauntRegistry);

    // Sanity: before any taunt, this monster's fallback rule aims at the
    // base, not a player — confirms this really is the "打陣" archetype.
    expect(engine.getIntents()).toEqual([
      { kind: 'move', instanceId: expect.any(String), to: expect.any(Object), aim: { x: 1, y: 4 } },
    ]);

    const res = engine.useSkill(0, 'taunt', 'down'); // ling_er (8,1) -> base_ghost (8,4), straight down, range 3
    expect(res).toEqual({ ok: true });
    expect(engine.getLastEvents()).toEqual([{ kind: 'taunt', target: { kind: 'monster', instanceId: expect.any(String) } }]);

    const tauntedInstanceId = engine.getSnapshot().monsters[0].instanceId;
    const tauntedNow = engine.getSnapshot().monsters.find((m) => m.instanceId === tauntedInstanceId);
    expect(tauntedNow?.tauntedBy).toBe(0);
    expect(tauntedNow?.tauntTurnsLeft).toBe(2);

    // This turn's already-telegraphed intent (locked in before the cast)
    // still resolves untouched — no mid-turn randomness/retargeting.
    engine.endTurn();

    // The NEXT intent, computed fresh for the new turn, is the first one the
    // taunt actually gets to influence — and it aims at ling_er, not the base.
    const intents = engine.getIntents();
    expect(intents).toHaveLength(1);
    expect(intents[0].kind).toBe('move');
    if (intents[0].kind === 'move') {
      expect(intents[0].aim).toEqual({ x: 8, y: 1 }); // ling_er's position, not the base
    }
  });

  it('taunt lasts exactly its amount in turns, then automatically expires and the monster reverts to its normal AI', () => {
    const engine = new BattleEngine(tauntArena(), ['ling_er'], tauntRegistry);
    engine.useSkill(0, 'taunt', 'down'); // amount: 2 -> tauntTurnsLeft starts at 2

    engine.endTurn(); // resolves the pre-taunt intent; computes turn 2's intent (1st taunted computation)
    expect(engine.getIntents()[0].kind).toBe('move');
    let intent = engine.getIntents()[0];
    if (intent.kind === 'move') expect(intent.aim).toEqual({ x: 8, y: 1 }); // still taunted
    expect(engine.getSnapshot().monsters[0].tauntTurnsLeft).toBe(1);

    engine.endTurn(); // resolves turn 2's intent; computes turn 3's intent (2nd taunted computation — still within the 2-turn duration)
    intent = engine.getIntents()[0];
    expect(intent.kind === 'move' || intent.kind === 'skill').toBe(true);
    if (intent.kind === 'move') expect(intent.aim).toEqual({ x: 8, y: 1 });
    expect(engine.getSnapshot().monsters[0].tauntedBy).toBeUndefined(); // expired exactly after the 2nd taunted computation
    expect(engine.getSnapshot().monsters[0].tauntTurnsLeft).toBeUndefined();

    engine.endTurn(); // resolves turn 3's (still-taunted) intent; computes turn 4's intent — taunt is gone, normal AI applies
    intent = engine.getIntents()[0];
    if (intent.kind === 'move') {
      // Reverted to hunting the base again, not still locked onto ling_er.
      expect(intent.aim).not.toEqual({ x: 8, y: 1 });
    }
  });

  it("the taunt caster dying clears the monster's taunt state — it falls back to normal AI instead of aiming at a dead player's stale position", () => {
    const squishyLingEr: CharacterDef = { ...lingEr, maxHp: 1 };
    const deathRegistry: ContentRegistry = {
      ...tauntRegistry,
      characters: { ...tauntRegistry.characters, ling_er: squishyLingEr },
    };
    const map: MapDef = {
      ...tauntArena(),
      // A second hero (li_yan, far from the assassin) keeps the squad alive
      // when ling_er dies — otherwise her death is a total party wipe, which
      // now freezes a defeat outcome BEFORE the next computeIntents() runs,
      // and the fall-back-to-normal-AI behavior under test never happens.
      playerStarts: [
        { x: 8, y: 1 },
        { x: 1, y: 1 },
      ],
      waves: [
        {
          turns: AMPLE_TURNS,
          monsters: [
            { monsterId: 'base_ghost', spawn: { x: 8, y: 4 } },
            { monsterId: 'assassin', spawn: { x: 7, y: 1 } }, // adjacent to ling_er at (8,1) from the very first turn
          ],
        },
      ],
    };
    const engine = new BattleEngine(map, ['ling_er', 'li_yan'], deathRegistry);
    engine.useSkill(0, 'taunt', 'down'); // taunts base_ghost before ending the turn

    const baseGhostId = engine.getSnapshot().monsters.find((m) => m.monsterId === 'base_ghost')!.instanceId;
    expect(engine.getSnapshot().monsters.find((m) => m.instanceId === baseGhostId)?.tauntedBy).toBe(0);

    engine.endTurn(); // the assassin's always-on lethal_claw kills ling_er (1 HP) this same turn
    expect(engine.getSnapshot().players[0].hp).toBe(0);

    // computeIntents(), run fresh for the new turn as part of that same
    // endTurn() call, must have noticed the taunter is dead and cleared the
    // taunt instead of leaving it dangling or throwing.
    const baseGhost = engine.getSnapshot().monsters.find((m) => m.instanceId === baseGhostId);
    expect(baseGhost?.tauntedBy).toBeUndefined();
    expect(baseGhost?.tauntTurnsLeft).toBeUndefined();

    const intent = engine.getIntents().find((i) => i.instanceId === baseGhostId)!;
    // Back to normal AI: aiming at the base, not at ling_er's last (now dead) position.
    if (intent.kind === 'move') expect(intent.aim).toEqual({ x: 1, y: 4 });
  });

  it('heavy_shield grants 2 shield charges that fully block the next 2 hits, same block-a-hit-not-a-point mechanic as qi_shield', () => {
    const map: MapDef = {
      formatVersion: 1,
      id: 'heavy-shield-test',
      nameKey: 'map.heavyshieldtest.name',
      grid: ['##########', '#        #', '#        #', '##########'],
      baseHp: 8,
      playerStarts: [{ x: 3, y: 1 }],
      waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'assassin', spawn: { x: 2, y: 1 } }] }], // adjacent, always attacks
    };
    const engine = new BattleEngine(map, ['ling_er'], tauntRegistry);
    engine.useSkill(0, 'heavy_shield', 'left'); // self-target — direction is irrelevant but required by the call shape
    expect(engine.getSnapshot().players[0].shield).toBe(2);

    engine.endTurn(); // 1st lethal_claw hit — fully blocked
    expect(engine.getSnapshot().players[0].shield).toBe(1);
    expect(engine.getSnapshot().players[0].hp).toBe(9);

    engine.endTurn(); // 2nd lethal_claw hit — fully blocked, charge exhausted
    expect(engine.getSnapshot().players[0].shield).toBe(0);
    expect(engine.getSnapshot().players[0].hp).toBe(9);

    engine.endTurn(); // 3rd hit — no charges left, lands for real (99 dmg, way past 9 HP)
    expect(engine.getSnapshot().players[0].hp).toBe(0);
  });

  it('resetTurn undoes a taunt cast earlier in the same turn, reverting the monster to its pre-cast (untaunted) state', () => {
    const engine = new BattleEngine(tauntArena(), ['ling_er'], tauntRegistry);
    engine.useSkill(0, 'taunt', 'down');
    expect(engine.getSnapshot().monsters[0].tauntedBy).toBe(0);

    engine.resetTurn();

    const reverted = engine.getSnapshot().monsters[0];
    expect(reverted.tauntedBy).toBeUndefined();
    expect(reverted.tauntTurnsLeft).toBeUndefined();
    // The pre-cast intent (base-seeking) is untouched too, since resetTurn
    // doesn't recompute intents — it restores state from before the cast,
    // and currentIntents was never touched by useSkill() in the first place.
    expect(engine.getIntents()).toEqual([
      { kind: 'move', instanceId: expect.any(String), to: expect.any(Object), aim: { x: 1, y: 4 } },
    ]);
  });
});

describe('BattleEngine: unified targeting modes (pierceLine / aoeCross / aoeRing / aoeArc3 / allEnemies / allUnits / percent damage)', () => {
  // A big open room so every AOE shape has room to breathe, plus a lone base
  // tile off in the corner (format requires at least one) that none of these
  // tests interact with.
  const openRoomGrid = [
    '#############',
    '#           #',
    '#           #',
    '#           #',
    '#           #',
    '#           #',
    '#           #',
    '#          B#',
    '#############',
  ];
  // Same room, but with one wall tile at (6,4) to test pierceLine's
  // beam-stops-at-a-wall behavior.
  const wallRoomGrid = [
    '#############',
    '#           #',
    '#           #',
    '#           #',
    '#     #     #',
    '#           #',
    '#           #',
    '#          B#',
    '#############',
  ];

  const pierceBolt: SkillDef = {
    formatVersion: 1,
    id: 'pierce_bolt',
    nameKey: 'skill.pierce_bolt.name',
    descKey: 'skill.pierce_bolt.desc',
    range: 5,
    effects: [{ type: 'damage', amount: 2, target: 'pierceLine' }],
  };
  const crossBurst: SkillDef = {
    formatVersion: 1,
    id: 'cross_burst',
    nameKey: 'skill.cross_burst.name',
    descKey: 'skill.cross_burst.desc',
    range: 1,
    effects: [{ type: 'damage', amount: 1, target: 'aoeCross' }],
  };
  const ringBurst: SkillDef = {
    formatVersion: 1,
    id: 'ring_burst',
    nameKey: 'skill.ring_burst.name',
    descKey: 'skill.ring_burst.desc',
    range: 1,
    effects: [{ type: 'damage', amount: 1, target: 'aoeRing' }],
  };
  const arc3Strike: SkillDef = {
    formatVersion: 1,
    id: 'arc3_strike',
    nameKey: 'skill.arc3_strike.name',
    descKey: 'skill.arc3_strike.desc',
    range: 1,
    effects: [{ type: 'damage', amount: 1, target: 'aoeArc3' }],
  };
  const callAllEnemies: SkillDef = {
    formatVersion: 1,
    id: 'call_all_enemies',
    nameKey: 'skill.call_all_enemies.name',
    descKey: 'skill.call_all_enemies.desc',
    range: 1,
    effects: [{ type: 'damage', amount: 1, target: 'allEnemies' }],
  };
  const callAllUnits: SkillDef = {
    formatVersion: 1,
    id: 'call_all_units',
    nameKey: 'skill.call_all_units.name',
    descKey: 'skill.call_all_units.desc',
    range: 1,
    effects: [{ type: 'damage', amount: 1, target: 'allUnits' }],
  };
  const percentBolt: SkillDef = {
    formatVersion: 1,
    id: 'percent_bolt',
    nameKey: 'skill.percent_bolt.name',
    descKey: 'skill.percent_bolt.desc',
    range: 5,
    effects: [{ type: 'damage', amount: 50, target: 'pierceLine', amountIsPercent: true }],
  };
  const percentBoltMin: SkillDef = {
    formatVersion: 1,
    id: 'percent_bolt_min',
    nameKey: 'skill.percent_bolt_min.name',
    descKey: 'skill.percent_bolt_min.desc',
    range: 3,
    effects: [{ type: 'damage', amount: 10, target: 'firstInLine', amountIsPercent: true }],
  };

  const shapeCaster: CharacterDef = {
    formatVersion: 1,
    id: 'shape_caster',
    nameKey: 'character.shape_caster.name',
    spriteRef: 'char_shape_caster',
    maxHp: 20,
    moveRange: 5,
    skillIds: [
      'pierce_bolt',
      'cross_burst',
      'ring_burst',
      'arc3_strike',
      'call_all_enemies',
      'call_all_units',
      'percent_bolt',
      'percent_bolt_min',
    ],
    ultimateSkillId: 'shape_caster_ultimate_unused', // placeholder, see li_yan fixture's comment above for why
  };

  const hp10Ghost: MonsterDef = { ...yinGhost, id: 'hp10_ghost', maxHp: 10 };
  const hp4Ghost: MonsterDef = { ...yinGhost, id: 'hp4_ghost', maxHp: 4 };
  const hp1Ghost: MonsterDef = { ...yinGhost, id: 'hp1_ghost', maxHp: 1 };

  const shapeRegistry: ContentRegistry = {
    characters: { ...registry.characters, shape_caster: shapeCaster },
    skills: {
      ...registry.skills,
      pierce_bolt: pierceBolt,
      cross_burst: crossBurst,
      ring_burst: ringBurst,
      arc3_strike: arc3Strike,
      call_all_enemies: callAllEnemies,
      call_all_units: callAllUnits,
      percent_bolt: percentBolt,
      percent_bolt_min: percentBoltMin,
    },
    monsters: { ...registry.monsters, hp10_ghost: hp10Ghost, hp4_ghost: hp4Ghost, hp1_ghost: hp1Ghost },
  };

  /** Finds a live unit (player or monster) at (x,y) in the current snapshot — none of these tests move anything before asserting, so spawn position == current position. */
  function unitHpAt(engine: BattleEngine, x: number, y: number): number | undefined {
    const snap = engine.getSnapshot();
    return (
      snap.players.find((p) => p.position.x === x && p.position.y === y)?.hp ??
      snap.monsters.find((m) => m.position.x === x && m.position.y === y)?.hp
    );
  }

  describe('pierceLine', () => {
    it('hits every target on the line within range and a wall stops the beam from piercing further', () => {
      const map: MapDef = {
        formatVersion: 1,
        id: 'pierce-wall',
        nameKey: 'map.piercewall.name',
        grid: wallRoomGrid,
        baseHp: 8,
        playerStarts: [{ x: 2, y: 4 }],
        waves: [
          {
            turns: AMPLE_TURNS,
            monsters: [
              { monsterId: 'yin_ghost', spawn: { x: 3, y: 4 } }, // step 1, before the wall at x=6
              { monsterId: 'yin_ghost', spawn: { x: 4, y: 4 } }, // step 2, before the wall
              { monsterId: 'yin_ghost', spawn: { x: 7, y: 4 } }, // step 5, past the wall — beam never reaches it
            ],
          },
        ],
      };
      const engine = new BattleEngine(map, ['shape_caster'], shapeRegistry);
      const res = engine.useSkill(0, 'pierce_bolt', 'right');
      expect(res).toEqual({ ok: true });
      expect(unitHpAt(engine, 3, 4)).toBe(0); // yin_ghost maxHp 2, took 2 dmg
      expect(unitHpAt(engine, 4, 4)).toBe(0);
      expect(unitHpAt(engine, 7, 4)).toBe(2); // untouched — the wall at (6,4) blocked the beam
    });

    it('does not hit a target beyond the skill range, even with clear line of sight', () => {
      const map: MapDef = {
        formatVersion: 1,
        id: 'pierce-range',
        nameKey: 'map.piercerange.name',
        grid: openRoomGrid,
        baseHp: 8,
        playerStarts: [{ x: 2, y: 4 }],
        waves: [
          {
            turns: AMPLE_TURNS,
            monsters: [
              { monsterId: 'yin_ghost', spawn: { x: 4, y: 4 } }, // step 2, within range 5
              { monsterId: 'yin_ghost', spawn: { x: 9, y: 4 } }, // step 7, past range 5
            ],
          },
        ],
      };
      const engine = new BattleEngine(map, ['shape_caster'], shapeRegistry);
      engine.useSkill(0, 'pierce_bolt', 'right');
      expect(unitHpAt(engine, 4, 4)).toBe(0);
      expect(unitHpAt(engine, 9, 4)).toBe(2); // out of range — untouched
    });
  });

  describe('aoeCross', () => {
    it('hits exactly the 4 orthogonal neighbors, respects ally/enemy targeting, and never hits the caster itself', () => {
      const map: MapDef = {
        formatVersion: 1,
        id: 'cross-test',
        nameKey: 'map.crosstest.name',
        grid: openRoomGrid,
        baseHp: 8,
        playerStarts: [
          { x: 6, y: 4 }, // caster
          { x: 5, y: 4 }, // ally, standing on the LEFT cross tile — a naive "hit everything adjacent" bug would land here
        ],
        waves: [
          {
            turns: AMPLE_TURNS,
            monsters: [
              { monsterId: 'yin_ghost', spawn: { x: 6, y: 3 } }, // up
              { monsterId: 'yin_ghost', spawn: { x: 6, y: 5 } }, // down
              { monsterId: 'yin_ghost', spawn: { x: 7, y: 4 } }, // right
              { monsterId: 'yin_ghost', spawn: { x: 5, y: 3 } }, // diagonal — must NOT be hit
            ],
          },
        ],
      };
      const engine = new BattleEngine(map, ['shape_caster', 'su_qing'], shapeRegistry);
      const res = engine.useSkill(0, 'cross_burst', 'down'); // direction is irrelevant for aoeCross, just a placeholder
      expect(res).toEqual({ ok: true });
      expect(unitHpAt(engine, 6, 3)).toBe(1); // up, hit
      expect(unitHpAt(engine, 6, 5)).toBe(1); // down, hit
      expect(unitHpAt(engine, 7, 4)).toBe(1); // right, hit
      expect(unitHpAt(engine, 5, 3)).toBe(2); // diagonal, untouched
      expect(unitHpAt(engine, 5, 4)).toBe(5); // ally on the left tile, untouched (su_qing maxHp 5) — proves ally/enemy targeting, not just adjacency
      expect(unitHpAt(engine, 6, 4)).toBe(20); // caster itself, untouched (shape_caster maxHp 20)
    });
  });

  describe('aoeRing', () => {
    it('hits all 8 surrounding tiles (including diagonals) and nothing 2+ tiles away', () => {
      const map: MapDef = {
        formatVersion: 1,
        id: 'ring-test',
        nameKey: 'map.ringtest.name',
        grid: openRoomGrid,
        baseHp: 8,
        playerStarts: [{ x: 6, y: 4 }],
        waves: [
          {
            turns: AMPLE_TURNS,
            monsters: [
              { monsterId: 'yin_ghost', spawn: { x: 5, y: 3 } },
              { monsterId: 'yin_ghost', spawn: { x: 6, y: 3 } },
              { monsterId: 'yin_ghost', spawn: { x: 7, y: 3 } },
              { monsterId: 'yin_ghost', spawn: { x: 5, y: 4 } },
              { monsterId: 'yin_ghost', spawn: { x: 7, y: 4 } },
              { monsterId: 'yin_ghost', spawn: { x: 5, y: 5 } },
              { monsterId: 'yin_ghost', spawn: { x: 6, y: 5 } },
              { monsterId: 'yin_ghost', spawn: { x: 7, y: 5 } },
              { monsterId: 'yin_ghost', spawn: { x: 6, y: 2 } }, // 2 tiles away — must NOT be hit
            ],
          },
        ],
      };
      const engine = new BattleEngine(map, ['shape_caster'], shapeRegistry);
      engine.useSkill(0, 'ring_burst', 'down');
      for (const [x, y] of [
        [5, 3], [6, 3], [7, 3],
        [5, 4], [7, 4],
        [5, 5], [6, 5], [7, 5],
      ] as const) {
        expect(unitHpAt(engine, x, y)).toBe(1);
      }
      expect(unitHpAt(engine, 6, 2)).toBe(2); // untouched
    });
  });

  describe('aoeArc3', () => {
    // Shape: aiming a direction hits a 3-tile row one step ahead of the
    // caster — the forward cell, plus that same forward cell shifted one
    // tile to either side (perpendicular to the aim). Aiming 'up' from
    // (6,4) hits (5,3),(6,3),(7,3) — a short horizontal row facing the
    // caster, NOT a diagonal cone and NOT anything 2 tiles out.
    it('hits the forward cell and its two lateral neighbors, nothing else', () => {
      const map: MapDef = {
        formatVersion: 1,
        id: 'arc3-test',
        nameKey: 'map.arc3test.name',
        grid: openRoomGrid,
        baseHp: 8,
        playerStarts: [{ x: 6, y: 4 }],
        waves: [
          {
            turns: AMPLE_TURNS,
            monsters: [
              { monsterId: 'yin_ghost', spawn: { x: 6, y: 3 } }, // forward
              { monsterId: 'yin_ghost', spawn: { x: 7, y: 3 } }, // forward + 1 lateral
              { monsterId: 'yin_ghost', spawn: { x: 5, y: 3 } }, // forward - 1 lateral
              { monsterId: 'yin_ghost', spawn: { x: 5, y: 4 } }, // beside the caster, not in the fan — must NOT be hit
              { monsterId: 'yin_ghost', spawn: { x: 6, y: 2 } }, // 2 tiles straight ahead — must NOT be hit
            ],
          },
        ],
      };
      const engine = new BattleEngine(map, ['shape_caster'], shapeRegistry);
      engine.useSkill(0, 'arc3_strike', 'up');
      expect(unitHpAt(engine, 6, 3)).toBe(1);
      expect(unitHpAt(engine, 7, 3)).toBe(1);
      expect(unitHpAt(engine, 5, 3)).toBe(1);
      expect(unitHpAt(engine, 5, 4)).toBe(2); // untouched
      expect(unitHpAt(engine, 6, 2)).toBe(2); // untouched
    });
  });

  describe('allEnemies', () => {
    it('hits every living monster on the map regardless of distance, and leaves players untouched', () => {
      const map: MapDef = {
        formatVersion: 1,
        id: 'all-enemies-test',
        nameKey: 'map.allenemiestest.name',
        grid: openRoomGrid,
        baseHp: 8,
        playerStarts: [
          { x: 6, y: 4 },
          { x: 2, y: 2 },
        ],
        waves: [
          {
            turns: AMPLE_TURNS,
            monsters: [
              { monsterId: 'yin_ghost', spawn: { x: 2, y: 6 } },
              { monsterId: 'yin_ghost', spawn: { x: 10, y: 2 } },
              { monsterId: 'yin_ghost', spawn: { x: 9, y: 6 } },
            ],
          },
        ],
      };
      const engine = new BattleEngine(map, ['shape_caster', 'su_qing'], shapeRegistry);
      const res = engine.useSkill(0, 'call_all_enemies', 'down');
      expect(res).toEqual({ ok: true });
      expect(unitHpAt(engine, 2, 6)).toBe(1);
      expect(unitHpAt(engine, 10, 2)).toBe(1);
      expect(unitHpAt(engine, 9, 6)).toBe(1);
      expect(unitHpAt(engine, 2, 2)).toBe(5); // the other player, untouched
      expect(unitHpAt(engine, 6, 4)).toBe(20); // caster itself, untouched
    });
  });

  describe('allUnits', () => {
    it('hits every living unit on the map, players and monsters alike, EXCEPT the caster itself', () => {
      const map: MapDef = {
        formatVersion: 1,
        id: 'all-units-test',
        nameKey: 'map.allunitstest.name',
        grid: openRoomGrid,
        baseHp: 8,
        playerStarts: [
          { x: 6, y: 4 }, // caster
          { x: 2, y: 2 }, // ally teammate — must be hit
        ],
        waves: [
          {
            turns: AMPLE_TURNS,
            monsters: [
              { monsterId: 'yin_ghost', spawn: { x: 9, y: 3 } },
              { monsterId: 'yin_ghost', spawn: { x: 3, y: 6 } },
            ],
          },
        ],
      };
      const engine = new BattleEngine(map, ['shape_caster', 'su_qing'], shapeRegistry);
      const res = engine.useSkill(0, 'call_all_units', 'down');
      expect(res).toEqual({ ok: true });
      expect(unitHpAt(engine, 2, 2)).toBe(4); // teammate, hit (su_qing maxHp 5 -> 4)
      expect(unitHpAt(engine, 9, 3)).toBe(1); // monster, hit
      expect(unitHpAt(engine, 3, 6)).toBe(1); // monster, hit
      expect(unitHpAt(engine, 6, 4)).toBe(20); // caster itself, spared — see TargetMode 'allUnits' doc comment
      expect(engine.getLastEvents()).toHaveLength(3);
    });
  });

  describe('percent damage (amountIsPercent)', () => {
    it("scales damage to the target's CURRENT hp, not a flat amount — different targets take different real damage from the same effect", () => {
      const map: MapDef = {
        formatVersion: 1,
        id: 'percent-test',
        nameKey: 'map.percenttest.name',
        grid: openRoomGrid,
        baseHp: 8,
        playerStarts: [{ x: 2, y: 4 }],
        waves: [
          {
            turns: AMPLE_TURNS,
            monsters: [
              { monsterId: 'hp10_ghost', spawn: { x: 3, y: 4 } }, // step 1, 10 hp
              { monsterId: 'hp4_ghost', spawn: { x: 5, y: 4 } }, // step 3, 4 hp
            ],
          },
        ],
      };
      const engine = new BattleEngine(map, ['shape_caster'], shapeRegistry);
      engine.useSkill(0, 'percent_bolt', 'right'); // 50% of current hp, pierces both
      expect(unitHpAt(engine, 3, 4)).toBe(5); // floor(10 * 0.5) = 5 dmg -> 10-5=5
      expect(unitHpAt(engine, 5, 4)).toBe(2); // floor(4 * 0.5) = 2 dmg -> 4-2=2
    });

    it('floors to a 0-damage fizzle on a small target — no minimum-1 execute (the cast still lands and spends AP)', () => {
      const map: MapDef = {
        formatVersion: 1,
        id: 'percent-min-test',
        nameKey: 'map.percentmintest.name',
        grid: openRoomGrid,
        baseHp: 8,
        playerStarts: [{ x: 2, y: 4 }],
        waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'hp1_ghost', spawn: { x: 3, y: 4 } }] }],
      };
      const engine = new BattleEngine(map, ['shape_caster'], shapeRegistry);
      // 10% of 1 hp = floor(0.1) = 0 — the old minimum-1 rule turned every
      // whole-map percent Ultimate into a free execute on 1-2 HP tutorial
      // monsters, so a fizzle is now genuinely 0: the target survives, the
      // event records the honest amount (0), and the AP is still spent.
      const res = engine.useSkill(0, 'percent_bolt_min', 'right');
      expect(res).toEqual({ ok: true });
      expect(engine.getLastEvents()).toEqual([
        { kind: 'damage', target: { kind: 'monster', instanceId: expect.any(String) }, amount: 0, blocked: false },
      ]);
      expect(unitHpAt(engine, 3, 4)).toBe(1); // untouched — the hit fizzled
      expect(engine.getSnapshot().players[0].acted).toBe(true); // the action is still spent
    });
  });
});

describe('BattleEngine: allAllies targeting mode', () => {
  const openRoomGrid = [
    '#############',
    '#           #',
    '#           #',
    '#           #',
    '#           #',
    '#           #',
    '#           #',
    '#          B#',
    '#############',
  ];

  // 'shield' rather than 'heal' deliberately — a heal event only registers
  // when the target's hp actually rises, which a fresh-spawn unit at full
  // hp would never do (see applyEffect's heal branch), making the assertion
  // below flaky based on incidental hp state. shield always applies
  // unconditionally, so the event count cleanly proves who resolveTargets()
  // did and didn't reach.
  const rallyCry: SkillDef = {
    formatVersion: 1,
    id: 'rally_cry',
    nameKey: 'skill.rally_cry.name',
    descKey: 'skill.rally_cry.desc',
    range: 0,
    effects: [{ type: 'shield', amount: 1, target: 'allAllies' }],
  };

  const rallyCaster: CharacterDef = {
    formatVersion: 1,
    id: 'rally_caster',
    nameKey: 'character.rally_caster.name',
    spriteRef: 'char_rally_caster',
    maxHp: 20,
    moveRange: 5,
    skillIds: ['rally_cry'],
    ultimateSkillId: 'rally_cry',
  };

  const allyRegistry: ContentRegistry = {
    characters: { rally_caster: rallyCaster },
    skills: { rally_cry: rallyCry },
    monsters: { yin_ghost: yinGhost },
  };

  function unitHpAt(engine: BattleEngine, x: number, y: number): number | undefined {
    const snap = engine.getSnapshot();
    return (
      snap.players.find((p) => p.position.x === x && p.position.y === y)?.hp ??
      snap.monsters.find((m) => m.position.x === x && m.position.y === y)?.hp
    );
  }

  it('hits every other living ally, never a monster and never the caster itself', () => {
    const map: MapDef = {
      formatVersion: 1,
      id: 'all-allies-test',
      nameKey: 'map.allalliestest.name',
      grid: openRoomGrid,
      baseHp: 8,
      playerStarts: [
        { x: 6, y: 4 }, // caster
        { x: 2, y: 2 }, // ally — should be hit
        { x: 10, y: 5 }, // second ally — should be hit
      ],
      waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 9, y: 3 } }] }],
    };
    const engine = new BattleEngine(map, ['rally_caster', 'rally_caster', 'rally_caster'], allyRegistry);
    const res = engine.useSkill(0, 'rally_cry', 'down'); // direction irrelevant for allAllies
    expect(res).toEqual({ ok: true });
    const snap = engine.getSnapshot();
    expect(snap.players[0].shield).toBe(0); // caster itself, untouched
    expect(snap.players[1].shield).toBe(1); // ally, hit
    expect(snap.players[2].shield).toBe(1); // ally, hit
    const events = engine.getLastEvents();
    // Exactly 2 shield events: the other two players. The monster and the
    // caster itself must not appear.
    expect(events).toHaveLength(2);
    for (const ev of events) {
      expect(ev.kind).toBe('shield');
      expect(ev.target.kind).toBe('player');
      if (ev.target.kind === 'player') expect(ev.target.unitIndex).not.toBe(0);
    }
    expect(unitHpAt(engine, 9, 3)).toBe(2); // monster, untouched (yin_ghost maxHp 2)
  });

  it('for a monster caster, allAllies is caster-relative (would hit other monsters, not players) — verified via resolveTargets through a monster-cast skill', () => {
    // No monster content actually ships an allAllies skill (only player
    // Ultimates use this mode), but the engine's exclusion logic must stay
    // side-relative rather than hardcoded to "players", per the TargetMode
    // doc comment. This is exercised through the monster AI skill path
    // (endTurn's intent resolution) to prove the branch isn't player-only.
    const monsterRally: SkillDef = { ...rallyCry, id: 'monster_rally' };
    const rallyGhost: MonsterDef = {
      formatVersion: 1,
      id: 'rally_ghost',
      nameKey: 'monster.rally_ghost.name',
      spriteRef: 'mon_rally_ghost',
      maxHp: 5,
      moveRange: 1,
      skillIds: ['monster_rally'],
      aiRules: [{ when: { kind: 'always' }, action: { kind: 'useSkill', skillId: 'monster_rally' } }],
    };
    const map: MapDef = {
      formatVersion: 1,
      id: 'monster-allies-test',
      nameKey: 'map.monsteralliestest.name',
      grid: openRoomGrid,
      baseHp: 8,
      playerStarts: [{ x: 1, y: 1 }],
      waves: [
        {
          turns: AMPLE_TURNS,
          monsters: [
            { monsterId: 'rally_ghost', spawn: { x: 6, y: 4 } }, // caster
            { monsterId: 'rally_ghost', spawn: { x: 7, y: 4 } }, // ally monster — should be hit
          ],
        },
      ],
    };
    const monsterAllyRegistry: ContentRegistry = {
      characters: { rally_caster: rallyCaster },
      skills: { monster_rally: monsterRally },
      monsters: { rally_ghost: rallyGhost },
    };
    const engine = new BattleEngine(map, ['rally_caster'], monsterAllyRegistry);
    engine.endTurn(); // resolves both monsters' telegraphed 'monster_rally' casts
    const events = engine.getLastEvents();
    // Both ghosts cast allAllies shield at each other (each targets the
    // OTHER monster, never itself, never the human player) — 2 shield
    // events total, both landing on 'monster' targets, none on the player.
    expect(events.length).toBeGreaterThan(0);
    for (const ev of events) {
      expect(ev.kind).toBe('shield');
      expect(ev.target.kind).toBe('monster');
    }
  });
});

describe('BattleEngine: Ultimate skills (CharacterDef.ultimateSkillId / PlayerUnitState.ultimateUsed)', () => {
  const openRoomGrid = [
    '#############',
    '#           #',
    '#           #',
    '#           #',
    '#############',
  ];

  const zap: SkillDef = {
    formatVersion: 1,
    id: 'zap',
    nameKey: 'skill.zap.name',
    descKey: 'skill.zap.desc',
    range: 1,
    effects: [{ type: 'damage', amount: 1, target: 'firstInLine' }],
  };

  const ultimateNuke: SkillDef = {
    formatVersion: 1,
    id: 'ultimate_nuke',
    nameKey: 'skill.ultimate_nuke.name',
    descKey: 'skill.ultimate_nuke.desc',
    range: 0,
    effects: [{ type: 'damage', amount: 50, target: 'allEnemies', amountIsPercent: true }],
  };

  const ultimateCaster: CharacterDef = {
    formatVersion: 1,
    id: 'ultimate_caster',
    nameKey: 'character.ultimate_caster.name',
    spriteRef: 'char_ultimate_caster',
    maxHp: 10,
    moveRange: 3,
    skillIds: ['zap'],
    ultimateSkillId: 'ultimate_nuke',
  };

  const ultimateRegistry: ContentRegistry = {
    characters: { ultimate_caster: ultimateCaster },
    skills: { zap, ultimate_nuke: ultimateNuke },
    monsters: { yin_ghost: yinGhost },
  };

  function baseMap(): MapDef {
    return {
      formatVersion: 1,
      id: 'ultimate-test',
      nameKey: 'map.ultimatetest.name',
      grid: openRoomGrid,
      baseHp: 8,
      playerStarts: [{ x: 2, y: 2 }],
      waves: [
        { turns: 1, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 4, y: 2 } }] },
        { turns: AMPLE_TURNS, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 4, y: 2 } }] },
      ],
    };
  }

  it("can be cast even though it isn't in skillIds, hits its declared targets, spends the caster's one action, and locks ultimateUsed", () => {
    const engine = new BattleEngine(baseMap(), ['ultimate_caster'], ultimateRegistry);
    expect(engine.getSnapshot().players[0].ultimateUsed).toBe(false);
    const res = engine.useSkill(0, 'ultimate_nuke', 'right');
    expect(res).toEqual({ ok: true });
    const snap = engine.getSnapshot();
    expect(snap.players[0].acted).toBe(true); // an ultimate is an action like any other
    expect(snap.players[0].ultimateUsed).toBe(true);
    expect(snap.monsters[0].hp).toBe(1); // yin_ghost maxHp 2, 50% percent damage -> 1 dmg
  });

  it('is rejected with a distinct reason once already used this level run, even on a fresh later turn', () => {
    const engine = new BattleEngine(baseMap(), ['ultimate_caster'], ultimateRegistry);
    engine.useSkill(0, 'ultimate_nuke', 'right');
    expect(engine.getSnapshot().players[0].ultimateUsed).toBe(true);

    engine.endTurn(); // wave 1's 1-turn budget elapses -> reinforce, fresh turn
    expect(engine.getSnapshot().players[0].acted).toBe(false); // action economy refreshed by the new turn
    const res = engine.useSkill(0, 'ultimate_nuke', 'right');
    expect(res).toEqual({ ok: false, reason: 'ultimate-already-used' });
    expect(engine.getSnapshot().players[0].acted).toBe(false); // rejected cast spends nothing
  });

  it('resetTurn() undoes an ultimate cast made THIS turn (ordinary turn-reset semantics), unlocking it again', () => {
    const engine = new BattleEngine(baseMap(), ['ultimate_caster'], ultimateRegistry);
    engine.useSkill(0, 'ultimate_nuke', 'right');
    expect(engine.getSnapshot().players[0].ultimateUsed).toBe(true);
    engine.resetTurn();
    expect(engine.getSnapshot().players[0].ultimateUsed).toBe(false);
    expect(engine.getSnapshot().players[0].acted).toBe(false);
  });

  it('resetTurn() does NOT unlock an ultimate that was used in an earlier turn (only undoes THIS turn\'s actions)', () => {
    const engine = new BattleEngine(baseMap(), ['ultimate_caster'], ultimateRegistry);
    engine.useSkill(0, 'ultimate_nuke', 'right');
    engine.endTurn(); // ultimate cast is now locked in from a PRIOR turn
    expect(engine.getSnapshot().players[0].ultimateUsed).toBe(true);
    engine.moveUnit(0, { x: 3, y: 2 }); // take some unrelated action this turn
    engine.resetTurn(); // should only undo the move, not reach back into last turn
    expect(engine.getSnapshot().players[0].ultimateUsed).toBe(true);
  });

  it('resetLevel() (full level reset — constructor / defeat / victory / manual restart) is the only thing that clears ultimateUsed', () => {
    const engine = new BattleEngine(baseMap(), ['ultimate_caster'], ultimateRegistry);
    engine.useSkill(0, 'ultimate_nuke', 'right');
    engine.endTurn();
    expect(engine.getSnapshot().players[0].ultimateUsed).toBe(true);
    engine.resetLevel();
    expect(engine.getSnapshot().players[0].ultimateUsed).toBe(false);
    expect(engine.getSnapshot().players[0].hp).toBe(10); // full reset, not just the flag
  });
});

describe('BattleEngine: total party wipe is a defeat', () => {
  // A monster hard enough to one-shot any hero in these fixtures, so a wipe
  // can be produced in a controlled number of endTurn() calls.
  const heavyClaw: SkillDef = {
    formatVersion: 1,
    id: 'heavy_claw',
    nameKey: 'skill.heavy_claw.name',
    descKey: 'skill.heavy_claw.desc',
    range: 1,
    effects: [{ type: 'damage', amount: 99, target: 'firstInLine' }],
  };
  const brute: MonsterDef = {
    formatVersion: 1,
    id: 'brute',
    nameKey: 'monster.brute.name',
    spriteRef: 'mon_brute',
    maxHp: 50,
    moveRange: 1,
    skillIds: ['heavy_claw'],
    aiRules: [
      { when: { kind: 'targetInRange', target: 'nearestPlayer', range: 1 }, action: { kind: 'useSkill', skillId: 'heavy_claw' } },
      { when: { kind: 'always' }, action: { kind: 'moveToward', target: 'nearestPlayer' } },
    ],
  };
  const wipeRegistry: ContentRegistry = {
    characters: { li_yan, su_qing },
    skills: { ...registry.skills, heavy_claw: heavyClaw },
    monsters: { ...registry.monsters, brute },
  };

  it('all players dead at endTurn freezes a defeat outcome even though the base is untouched', () => {
    const map: MapDef = {
      ...twoWaveMap(),
      playerStarts: [
        { x: 2, y: 1 },
        { x: 2, y: 2 },
      ],
      // One brute adjacent to each hero — both telegraphed claws land on the
      // same endTurn, killing the entire squad in a single resolution.
      waves: [
        {
          turns: AMPLE_TURNS,
          monsters: [
            { monsterId: 'brute', spawn: { x: 3, y: 1 } },
            { monsterId: 'brute', spawn: { x: 3, y: 2 } },
          ],
        },
      ],
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], wipeRegistry);
    engine.endTurn();
    const snap = engine.getSnapshot();
    expect(snap.players.every((p) => p.hp <= 0)).toBe(true);
    expect(snap.outcome).toBe('defeat');
    expect(snap.baseHp).toBe(snap.baseMaxHp); // the base did NOT fall — this is the wipe branch
    // Same freeze-then-confirm flow as a base death: the board is locked
    // until confirmOutcome(), which restarts the level from wave 1.
    expect(engine.moveUnit(1, { x: 3, y: 2 })).toEqual({ ok: false, reason: 'outcome-pending' });
    engine.confirmOutcome();
    const fresh = engine.getSnapshot();
    expect(fresh.outcome).toBeNull();
    expect(fresh.players.every((p) => p.hp > 0)).toBe(true);
  });

  it('one hero dead, one alive is NOT a wipe — play continues', () => {
    const map: MapDef = {
      ...twoWaveMap(),
      playerStarts: [
        { x: 2, y: 1 },
        { x: 2, y: 2 },
      ],
      // Only the first hero has a brute in claw range; the second is safe.
      waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'brute', spawn: { x: 3, y: 1 } }] }],
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], wipeRegistry);
    engine.endTurn();
    const snap = engine.getSnapshot();
    expect(snap.players[0].hp).toBe(0);
    expect(snap.players[1].hp).toBeGreaterThan(0);
    expect(snap.outcome).toBeNull();
  });
});

describe('BattleEngine: shield stacking cap', () => {
  const heavyShieldSkill: SkillDef = {
    formatVersion: 1,
    id: 'heavy_shield_skill',
    nameKey: 'skill.heavy_shield_skill.name',
    descKey: 'skill.heavy_shield_skill.desc',
    range: 0,
    effects: [{ type: 'shield', amount: 2, target: 'self' }],
  };
  const shieldCaster: CharacterDef = {
    formatVersion: 1,
    id: 'shield_caster',
    nameKey: 'character.shield_caster.name',
    spriteRef: 'char_shield_caster',
    maxHp: 10,
    moveRange: 3,
    skillIds: ['shield_skill', 'heavy_shield_skill'],
    ultimateSkillId: 'shield_caster_ultimate_unused',
  };
  const capRegistry: ContentRegistry = {
    characters: { ...registry.characters, shield_caster: shieldCaster },
    skills: { ...registry.skills, heavy_shield_skill: heavyShieldSkill },
    monsters: registry.monsters,
  };
  const farMap = (): MapDef => ({
    ...twoWaveMap(),
    playerStarts: [{ x: 1, y: 1 }],
    waves: [{ turns: AMPLE_TURNS, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 6, y: 2 } }] }],
  });

  it('+1 shield stacks to 2 but a third cast does not push it past the cap (and reports zero gain)', () => {
    // One action per turn now — the three casts are spread across three
    // turns (the lone ghost spawns far away, outside claw range throughout).
    const engine = new BattleEngine(farMap(), ['shield_caster'], capRegistry);
    engine.useSkill(0, 'shield_skill', 'down');
    engine.endTurn();
    engine.useSkill(0, 'shield_skill', 'down');
    expect(engine.getSnapshot().players[0].shield).toBe(2);
    engine.endTurn();
    engine.useSkill(0, 'shield_skill', 'down'); // at the cap — wasted cast, zero gain
    expect(engine.getSnapshot().players[0].shield).toBe(2);
    // A zero-gain event still fires so the UI can show "no effect" — the
    // cast spent the player's resources, and a silent no-op reads as a
    // dropped click (same rationale as the percent-damage fizzle event).
    expect(engine.getLastEvents()).toEqual([
      { kind: 'shield', target: { kind: 'player', unitIndex: 0 }, amount: 0 },
    ]);
  });

  it('+2 shield lands exactly at the cap in one cast; the event reports only the charges actually gained', () => {
    const engine = new BattleEngine(farMap(), ['shield_caster'], capRegistry);
    engine.useSkill(0, 'heavy_shield_skill', 'down');
    expect(engine.getSnapshot().players[0].shield).toBe(2);
    expect(engine.getLastEvents()).toEqual([
      { kind: 'shield', target: { kind: 'player', unitIndex: 0 }, amount: 2 },
    ]);
    // +1 on top of an existing 1: only 1 real charge gained, capped at 2.
    // (Second cast happens on the next turn — one action per turn.)
    const engine2 = new BattleEngine(farMap(), ['shield_caster'], capRegistry);
    engine2.useSkill(0, 'shield_skill', 'down');
    engine2.endTurn();
    engine2.useSkill(0, 'heavy_shield_skill', 'down');
    expect(engine2.getSnapshot().players[0].shield).toBe(2);
    expect(engine2.getLastEvents()).toEqual([
      { kind: 'shield', target: { kind: 'player', unitIndex: 0 }, amount: 1 },
    ]);
  });
});
