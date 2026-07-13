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
  maxMp: 4,
  skillIds: ['strike', 'push_skill'],
};

const su_qing: CharacterDef = {
  formatVersion: 1,
  id: 'su_qing',
  nameKey: 'character.su_qing.name',
  spriteRef: 'char_su_qing',
  maxHp: 5,
  actionPoints: 4,
  maxMp: 4,
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
    expect(snap.lives).toBe(3);
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

  it('the shared movement pool exhausts after 8 total moves across the squad, not per-unit', () => {
    const engine = new BattleEngine(roomyMap(), ['li_yan', 'su_qing'], registry);
    for (let i = 0; i < 4; i++) engine.moveUnit(0, 'right'); // li_yan (1,1) -> (5,1)
    for (let i = 0; i < 4; i++) engine.moveUnit(0, 'left'); // back to (1,1)
    expect(engine.getSnapshot().movement).toEqual({ used: 8, max: 8 });
    expect(engine.moveUnit(0, 'right')).toEqual({ ok: false, reason: 'no-movement-left' });
    expect(engine.moveUnit(1, 'right')).toEqual({ ok: false, reason: 'no-movement-left' }); // shared, not per-unit
  });

  it('mp and the shared movement pool are independent — exhausting one does not block the other', () => {
    const engine = new BattleEngine(roomyMap(), ['li_yan', 'su_qing'], registry);
    for (let i = 0; i < 4; i++) engine.moveUnit(0, 'right');
    for (let i = 0; i < 4; i++) engine.moveUnit(0, 'left'); // shared movement pool now exhausted
    expect(engine.useSkill(0, 'strike', 'right')).toEqual({ ok: true }); // mp untouched by movement
    expect(engine.getSnapshot().players[0].mp).toBe(2); // maxMp 4 - strike's mpCost 2

    const res = engine.useSkill(0, 'strike', 'right'); // now mp 2, still enough for one more cast
    expect(res).toEqual({ ok: true });
    expect(engine.useSkill(0, 'strike', 'right')).toEqual({ ok: false, reason: 'not-enough-mp' }); // mp is 0
    expect(engine.moveUnit(1, 'right')).toEqual({ ok: false, reason: 'no-movement-left' }); // still shared/exhausted
  });

  it('resets the shared movement pool and every unit\'s mp at the start of every turn, not only when a wave clears', () => {
    // Monster starts 5 tiles from li_yan, so a couple of moves won't clear the wave.
    const engine = new BattleEngine(roomyMap(), ['li_yan', 'su_qing'], registry);
    engine.moveUnit(0, 'down');
    engine.moveUnit(0, 'right');
    engine.useSkill(0, 'strike', 'right'); // whiffs (no monster in range yet), still costs mp
    expect(engine.getSnapshot().movement).toEqual({ used: 2, max: 8 });
    expect(engine.getSnapshot().players[0].mp).toBe(2); // maxMp 4 - strike's mpCost 2

    engine.endTurn();

    expect(engine.getSnapshot().monsters.length).toBeGreaterThan(0); // sanity: wave still active
    expect(engine.getSnapshot().movement).toEqual({ used: 0, max: 8 }); // fresh budget for the new turn
    expect(engine.getSnapshot().players[0].mp).toBe(4); // mp fully restored too
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

  it('undo restores the pre-action snapshot (including the shared movement pool); history clears after endTurn', () => {
    const engine = new BattleEngine(roomyMap(), ['li_yan', 'su_qing'], registry);
    const before = engine.getSnapshot().players[0].position;
    engine.moveUnit(0, 'down');
    expect(engine.getSnapshot().movement.used).toBe(1);
    expect(engine.undo()).toBe(true);
    expect(engine.getSnapshot().players[0].position).toEqual(before);
    expect(engine.getSnapshot().movement.used).toBe(0); // shared pool restored too
    expect(engine.undo()).toBe(false);

    engine.moveUnit(0, 'down');
    engine.endTurn();
    expect(engine.undo()).toBe(false);
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

describe('BattleEngine: wave clear and victory', () => {
  it('clearing a wave advances to the next wave and resets per-turn budgets', () => {
    const engine = new BattleEngine(twoWaveMap(), ['li_yan', 'su_qing'], registry);
    engine.useSkill(0, 'strike', 'right'); // kills wave-0's only monster
    engine.endTurn();
    const snap = engine.getSnapshot();
    expect(snap.waveIndex).toBe(1);
    expect(snap.monsters).toHaveLength(1);
    expect(snap.monsters[0].position).toEqual({ x: 6, y: 1 });
    expect(snap.players[0].hp).toBe(6); // no full-heal between waves, but also took no damage here
    expect(snap.victory).toBe(false);
  });

  it('relocates a spawn to the nearest free tile and ambushes the player standing on it', () => {
    const map: MapDef = {
      ...twoWaveMap(),
      waves: [
        twoWaveMap().waves[0],
        { turns: AMPLE_TURNS, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 1, y: 1 } }] }, // li_yan's own tile
      ],
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    engine.useSkill(0, 'strike', 'right'); // kills wave-0's monster
    engine.endTurn(); // advances to wave 1
    const snap = engine.getSnapshot();
    expect(snap.waveIndex).toBe(1);
    expect(snap.monsters[0].position).not.toEqual({ x: 1, y: 1 }); // not on top of li_yan
    const p = snap.monsters[0].position;
    expect(grid[p.y][p.x]).toBe(' '); // still a valid floor tile
    expect(snap.players[0].hp).toBe(5); // ghost_claw's 1 damage as an ambush hit before relocating
  });

  it('clearing the final wave sets victory', () => {
    const map = twoWaveMap();
    map.waves = [map.waves[0]]; // only one wave
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    engine.useSkill(0, 'strike', 'right');
    engine.endTurn();
    expect(engine.getSnapshot().victory).toBe(true);
    expect(engine.getIntents()).toEqual([]);
  });
});

describe('BattleEngine: base destruction and lives', () => {
  // Phase 1's lose condition is base HP, not player HP — a monster that
  // targets nearestBaseTile instead of nearestPlayer, so hitting 0 base HP
  // (not a player wipe) is what should now decrement lives / reset the run.
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

  it('base HP reaching 0 costs a life and resets the wave with base HP back to full', () => {
    const engine = new BattleEngine(baseAssaultMap(), ['li_yan', 'su_qing'], baseRegistry);
    engine.endTurn(); // both ghosts hit the base for 1 each: baseHp 2 -> 0
    const snap = engine.getSnapshot();
    expect(snap.lives).toBe(2);
    expect(snap.waveIndex).toBe(0);
    expect(snap.baseHp).toBe(2); // reset to full (baseMaxHp)
    expect(snap.monsters).toHaveLength(2); // wave respawned
  });

  it('exhausting all lives resets the whole run to wave 0 with lives back to 3', () => {
    const engine = new BattleEngine(baseAssaultMap(), ['li_yan', 'su_qing'], baseRegistry);
    engine.endTurn(); // lives 3 -> 2
    engine.endTurn(); // lives 2 -> 1
    engine.endTurn(); // lives 1 -> 0 -> full reset to 3
    const snap = engine.getSnapshot();
    expect(snap.lives).toBe(3);
    expect(snap.waveIndex).toBe(0);
    expect(snap.baseHp).toBe(2);
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
      { kind: 'move', instanceId: expect.any(String), to: { x: 3, y: 1 } }, // steps further away, not toward
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

  it('surviving the wave turn budget with monsters still alive advances the wave', () => {
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
        { turns: AMPLE_TURNS, monsters: [{ monsterId: 'base_ghost', spawn: { x: 6, y: 1 } }] },
      ],
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], baseRegistry);
    engine.endTurn(); // turn 1 of 2: just closing the distance
    expect(engine.getSnapshot().waveIndex).toBe(0);
    engine.endTurn(); // turn 2 of 2: clock runs out — wave survived despite the ghost still being alive
    const snap = engine.getSnapshot();
    expect(snap.waveIndex).toBe(1); // you did NOT have to kill it
    expect(snap.baseHp).toBe(8); // it never got close enough to land a hit
  });

  it('clearing all monsters before the turn budget also advances the wave (early clear)', () => {
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
        { turns: 10, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 3, y: 1 } }] }, // a big turn budget, deliberately not exhausted
        { turns: AMPLE_TURNS, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 6, y: 1 } }] },
      ],
    };
    const engine = new BattleEngine(map, ['li_yan', 'su_qing'], registry);
    expect(engine.getSnapshot().turnsLeftInWave).toBe(10); // plenty of clock left
    engine.useSkill(0, 'strike', 'right'); // kills the only monster well before the budget runs out
    engine.endTurn();
    expect(engine.getSnapshot().waveIndex).toBe(1); // advanced by clearing, not by the clock
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
