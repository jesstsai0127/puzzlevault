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
  mpCost: 2,
  effects: [{ type: 'damage', amount: 2, target: 'firstInLine' }],
};

const pushSkill: SkillDef = {
  formatVersion: 1,
  id: 'push_skill',
  nameKey: 'skill.push_skill.name',
  descKey: 'skill.push_skill.desc',
  range: 1,
  mpCost: 1,
  effects: [{ type: 'push', amount: 2, target: 'firstInLine' }],
};

const rangedSkill: SkillDef = {
  formatVersion: 1,
  id: 'ranged_skill',
  nameKey: 'skill.ranged_skill.name',
  descKey: 'skill.ranged_skill.desc',
  range: 3,
  mpCost: 2,
  effects: [{ type: 'damage', amount: 2, target: 'firstInLine' }],
};

const shieldSkill: SkillDef = {
  formatVersion: 1,
  id: 'shield_skill',
  nameKey: 'skill.shield_skill.name',
  descKey: 'skill.shield_skill.desc',
  range: 0,
  mpCost: 1,
  effects: [{ type: 'shield', amount: 1, target: 'self' }],
};

const ghostClaw: SkillDef = {
  formatVersion: 1,
  id: 'ghost_claw',
  nameKey: 'skill.ghost_claw.name',
  descKey: 'skill.ghost_claw.desc',
  range: 1,
  mpCost: 1,
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
  actionPoints: 4,
  skillIds: ['strike', 'push_skill'],
};

const su_qing: CharacterDef = {
  formatVersion: 1,
  id: 'su_qing',
  nameKey: 'character.su_qing.name',
  spriteRef: 'char_su_qing',
  maxHp: 5,
  actionPoints: 4,
  skillIds: ['ranged_skill', 'shield_skill'],
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

  it('moves a unit one step and is blocked by a wall', () => {
    const engine = new BattleEngine(roomyMap(), ['li_yan', 'su_qing'], registry);
    expect(engine.moveUnit(0, 'up')).toEqual({ ok: false, reason: 'blocked' }); // y=0 is wall
    expect(engine.moveUnit(0, 'down')).toEqual({ ok: true });
    expect(engine.getSnapshot().players[0].position).toEqual({ x: 1, y: 2 });
  });

  it('is blocked by an occupied tile', () => {
    const engine = new BattleEngine(twoWaveMap(), ['li_yan', 'su_qing'], registry);
    // su_qing is at (1,2), directly below li_yan (1,1)
    expect(engine.moveUnit(0, 'down')).toEqual({ ok: false, reason: 'blocked' });
  });

  it('strike deals damage to a monster in the aimed direction', () => {
    const engine = new BattleEngine(twoWaveMap(), ['li_yan', 'su_qing'], registry);
    const res = engine.useSkill(0, 'strike', 'right'); // monster at (2,1), li_yan at (1,1)
    expect(res).toEqual({ ok: true });
    expect(engine.getSnapshot().monsters[0].hp).toBe(0);
  });

  it("each character's AP pool is independent — exhausting one unit's AP does not block the other", () => {
    const engine = new BattleEngine(roomyMap(), ['li_yan', 'su_qing'], registry);
    for (let i = 0; i < 4; i++) engine.moveUnit(0, 'right'); // li_yan: 4 AP -> 0
    expect(engine.getSnapshot().players[0].ap).toBe(0);
    expect(engine.moveUnit(0, 'right')).toEqual({ ok: false, reason: 'not-enough-ap' });
    expect(engine.moveUnit(1, 'left')).toEqual({ ok: true }); // su_qing's own AP untouched
    expect(engine.getSnapshot().players[1].ap).toBe(3);
  });

  it('movement and skills draw from the same AP pool — casting can exhaust the AP moving would need', () => {
    const engine = new BattleEngine(roomyMap(), ['li_yan', 'su_qing'], registry);
    engine.moveUnit(0, 'right');
    engine.moveUnit(0, 'right'); // li_yan: 4 AP -> 2
    expect(engine.useSkill(0, 'strike', 'right')).toEqual({ ok: true }); // strike costs 2 AP, exactly what's left
    expect(engine.getSnapshot().players[0].ap).toBe(0);
    expect(engine.moveUnit(0, 'right')).toEqual({ ok: false, reason: 'not-enough-ap' }); // same pool, now empty
    expect(engine.useSkill(0, 'strike', 'right')).toEqual({ ok: false, reason: 'not-enough-ap' });
  });

  it("resets every unit's own AP at the start of every turn, not only when a wave clears", () => {
    // Monster starts 5 tiles from li_yan, so a couple of moves won't clear the wave.
    const engine = new BattleEngine(roomyMap(), ['li_yan', 'su_qing'], registry);
    engine.moveUnit(0, 'down');
    engine.moveUnit(0, 'right');
    expect(engine.getSnapshot().players[0].ap).toBe(2); // maxAp 4 - 2 moves

    engine.endTurn();

    expect(engine.getSnapshot().monsters.length).toBeGreaterThan(0); // sanity: wave still active
    expect(engine.getSnapshot().players[0].ap).toBe(4); // fresh AP for the new turn
  });

  it('push moves the target away from the caster, stopping at a wall', () => {
    const map = twoWaveMap();
    map.waves[0].monsters[0].spawn = { x: 5, y: 1 }; // one tile from the right wall (x=6 is the last floor col)
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    // move li_yan 3 tiles right (3 of its 4 action points), landing adjacent to the monster at (4,1)
    engine.moveUnit(0, 'right');
    engine.moveUnit(0, 'right');
    engine.moveUnit(0, 'right');
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

  it("undo restores the pre-action snapshot (including the mover's own AP); history clears after endTurn", () => {
    const engine = new BattleEngine(roomyMap(), ['li_yan', 'su_qing'], registry);
    const before = engine.getSnapshot().players[0].position;
    engine.moveUnit(0, 'down');
    expect(engine.getSnapshot().players[0].ap).toBe(3);
    expect(engine.undo()).toBe(true);
    expect(engine.getSnapshot().players[0].position).toEqual(before);
    expect(engine.getSnapshot().players[0].ap).toBe(4); // AP restored too
    expect(engine.undo()).toBe(false);

    engine.moveUnit(0, 'down');
    engine.endTurn();
    expect(engine.undo()).toBe(false);
  });

  it('resetTurn reverts every action taken this turn back to the turn-start snapshot in one call', () => {
    const engine = new BattleEngine(roomyMap(), ['li_yan', 'su_qing'], registry);
    const before = engine.getSnapshot();
    engine.moveUnit(0, 'right');
    engine.moveUnit(0, 'right');
    engine.useSkill(1, 'shield_skill', 'down'); // su_qing shields herself, spending AP
    expect(engine.getSnapshot().players[0].ap).toBe(2);
    expect(engine.getSnapshot().players[1].ap).toBe(3);

    engine.resetTurn();

    const after = engine.getSnapshot();
    expect(after.players[0].position).toEqual(before.players[0].position);
    expect(after.players[0].ap).toBe(4);
    expect(after.players[1].ap).toBe(4);
    expect(after.players[1].shield).toBe(0);
  });

  it('resetTurn only reaches back to the start of the CURRENT turn, not earlier turns', () => {
    const engine = new BattleEngine(roomyMap(), ['li_yan', 'su_qing'], registry);
    engine.moveUnit(0, 'right');
    engine.endTurn(); // this turn's moves are now locked in as the new turn-start baseline
    const afterEndTurn = engine.getSnapshot().players[0].position;

    engine.moveUnit(0, 'right');
    engine.resetTurn();

    expect(engine.getSnapshot().players[0].position).toEqual(afterEndTurn); // not all the way back to game start
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
    expect(snap.players[0].ap).toBe(4); // still a fresh round every turn
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
    expect(engine.moveUnit(0, 'right')).toEqual({ ok: false, reason: 'outcome-pending' });

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
    engine.moveUnit(0, 'right'); // li_yan (1,2) -> (2,2), adjacent to the ghost at (3,2)
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
      mpCost: 1,
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
    engine.moveUnit(0, 'down');
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

  it("pushing a target into a wall records only the distance actually covered, not the skill's nominal amount", () => {
    const map = twoWaveMap();
    map.waves[0].monsters[0].spawn = { x: 5, y: 1 }; // one tile from the x=6 floor edge (x=7 is wall)
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    engine.moveUnit(0, 'right'); // li_yan (1,1) -> (4,1), adjacent to the ghost at (5,1)
    engine.moveUnit(0, 'right');
    engine.moveUnit(0, 'right');
    const targetId = engine.getSnapshot().monsters[0].instanceId;
    engine.useSkill(0, 'push_skill', 'right'); // push_skill's amount is 2, but the wall at x=7 stops it after 1
    expect(engine.getLastEvents()).toEqual([
      { kind: 'push', target: { kind: 'monster', instanceId: targetId }, distance: 1 },
    ]);
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
    engine.moveUnit(1, 'right'); // a no-op-for-events action right after
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

describe('BattleEngine: opportunity attacks (closes the attack-then-retreat exploit)', () => {
  // yin_ghost's maxHp (2) dies to a single strike (2 dmg) — need a target
  // that survives the hit to prove the retreat itself costs something.
  const tankyGhost: MonsterDef = { ...yinGhost, id: 'tanky_ghost', maxHp: 10 };
  const localRegistry: ContentRegistry = { ...registry, monsters: { ...registry.monsters, tanky_ghost: tankyGhost } };

  function openRoomMap(monsterIds: string[]): MapDef {
    return {
      formatVersion: 1,
      id: 'test-opportunity',
      nameKey: 'map.testopportunity.name',
      grid: ['##########', '#        #', '#        #', '#B       #', '##########'],
      baseHp: 8,
      playerStarts: [
        { x: 3, y: 1 },
        { x: 3, y: 3 }, // out of the way, irrelevant to these scenarios
      ],
      waves: [
        {
          turns: AMPLE_TURNS,
          monsters: monsterIds.map((monsterId, i) => ({ monsterId, spawn: { x: 2, y: 1 + i } })),
        },
      ],
    };
  }

  it('retreating out of range after landing a hit provokes a free counter-attack — attack-then-disengage is no longer free', () => {
    const engine = new BattleEngine(openRoomMap(['tanky_ghost']), ['li_yan', 'su_qing'], localRegistry);
    engine.useSkill(0, 'strike', 'left'); // li_yan (3,1) hits the ghost at (2,1); it survives (10 - 2 = 8 hp)
    expect(engine.getSnapshot().players[0].hp).toBe(6); // no self-damage from the attack itself

    const res = engine.moveUnit(0, 'right'); // (3,1) -> (4,1): breaks adjacency with the ghost at (2,1)
    expect(res).toEqual({ ok: true });
    expect(engine.getSnapshot().players[0].hp).toBe(5); // ghost_claw's 1 dmg opportunity attack landed
    expect(engine.getLastEvents()).toEqual([
      { kind: 'damage', target: { kind: 'player', unitIndex: 0 }, amount: 1, blocked: false },
    ]);
  });

  it('moving toward a monster you started adjacent to is rejected as blocked, not treated as a disengage', () => {
    // On a cardinal-only single-tile grid, a step from an adjacent tile can only
    // land at manhattan distance 0 (the monster's own tile — blocked, occupied)
    // or distance 2 (a disengage) — there's no move that keeps distance 1, so
    // the only "harmless move while already adjacent" case is walking INTO it.
    const engine = new BattleEngine(openRoomMap(['tanky_ghost']), ['li_yan', 'su_qing'], localRegistry);
    const res = engine.moveUnit(0, 'left'); // (3,1) -> (2,1): occupied by the ghost
    expect(res).toEqual({ ok: false, reason: 'blocked' });
    expect(engine.getSnapshot().players[0].hp).toBe(6);
    expect(engine.getLastEvents()).toEqual([]);
  });

  it('moving without ever having been adjacent to anything provokes nothing (baseline, no false positives)', () => {
    const engine = new BattleEngine(roomyMap(), ['li_yan', 'su_qing'], registry);
    const res = engine.moveUnit(0, 'right');
    expect(res).toEqual({ ok: true });
    expect(engine.getLastEvents()).toEqual([]);
  });

  it('disengaging from two flanking monsters at once provokes a free hit from each of them', () => {
    const map: MapDef = {
      formatVersion: 1,
      id: 'test-flanked',
      nameKey: 'map.testflanked.name',
      grid: ['######', '#    #', '#    #', '#B   #', '######'],
      baseHp: 8,
      playerStarts: [
        { x: 2, y: 1 }, // flanked: ghost0 at (1,1) left, ghost1 at (3,1) right — both adjacent
        { x: 2, y: 3 },
      ],
      waves: [
        {
          turns: AMPLE_TURNS,
          monsters: [
            { monsterId: 'tanky_ghost', spawn: { x: 1, y: 1 } },
            { monsterId: 'tanky_ghost', spawn: { x: 3, y: 1 } },
          ],
        },
      ],
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], localRegistry);
    const before = engine.getSnapshot().players[0].hp;
    const res = engine.moveUnit(0, 'down'); // (2,1) -> (2,2): breaks adjacency with BOTH flanking ghosts
    expect(res).toEqual({ ok: true });
    expect(engine.getSnapshot().players[0].hp).toBe(before - 2); // one ghost_claw hit from each
    expect(engine.getLastEvents()).toHaveLength(2);
  });

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
});
