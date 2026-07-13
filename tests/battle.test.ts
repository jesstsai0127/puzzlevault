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

const impClaw: SkillDef = {
  formatVersion: 1,
  id: 'imp_claw',
  nameKey: 'skill.imp_claw.name',
  descKey: 'skill.imp_claw.desc',
  range: 1,
  effects: [{ type: 'damage', amount: 1, target: 'firstInLine' }],
};

const gloomImp: MonsterDef = {
  formatVersion: 1,
  id: 'gloom_imp',
  nameKey: 'monster.gloom_imp.name',
  spriteRef: 'mon_gloom_imp',
  maxHp: 2,
  moveRange: 1,
  skillIds: ['imp_claw'],
  aiRules: [
    { when: { kind: 'targetInRange', target: 'nearestPlayer', range: 1 }, action: { kind: 'useSkill', skillId: 'imp_claw' } },
    { when: { kind: 'always' }, action: { kind: 'moveToward', target: 'nearestPlayer' } },
  ],
};

const aster: CharacterDef = {
  formatVersion: 1,
  id: 'aster',
  nameKey: 'character.aster.name',
  spriteRef: 'char_aster',
  maxHp: 6,
  actionPoints: 4,
  skillIds: ['strike', 'push_skill'],
};

const wren: CharacterDef = {
  formatVersion: 1,
  id: 'wren',
  nameKey: 'character.wren.name',
  spriteRef: 'char_wren',
  maxHp: 5,
  actionPoints: 4,
  skillIds: ['ranged_skill', 'shield_skill'],
};

const registry: ContentRegistry = {
  characters: { aster, wren },
  skills: {
    strike,
    push_skill: pushSkill,
    ranged_skill: rangedSkill,
    shield_skill: shieldSkill,
    imp_claw: impClaw,
  },
  monsters: { gloom_imp: gloomImp },
};

// 8x4 room: '#' wall, ' ' floor.
const grid = ['########', '#      #', '#      #', '########'];

function twoWaveMap(): MapDef {
  return {
    formatVersion: 1,
    id: 'test-arena',
    nameKey: 'map.test.name',
    grid,
    playerStarts: [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
    ],
    waves: [
      { monsters: [{ monsterId: 'gloom_imp', spawn: { x: 2, y: 1 } }] }, // adjacent to player 0
      { monsters: [{ monsterId: 'gloom_imp', spawn: { x: 6, y: 1 } }] },
    ],
  };
}

describe('BattleEngine: setup', () => {
  it('spawns players at playerStarts with full HP and computes initial intents', () => {
    const engine = new BattleEngine(twoWaveMap(), ['aster', 'wren'], registry);
    const snap = engine.getSnapshot();
    expect(snap.players).toEqual([
      expect.objectContaining({ characterId: 'aster', position: { x: 1, y: 1 }, hp: 6 }),
      expect.objectContaining({ characterId: 'wren', position: { x: 1, y: 2 }, hp: 5 }),
    ]);
    expect(snap.monsters).toHaveLength(1);
    expect(snap.waveIndex).toBe(0);
    expect(snap.lives).toBe(3);
  });

  it('an adjacent monster telegraphs a skill intent, not a move', () => {
    const engine = new BattleEngine(twoWaveMap(), ['aster', 'wren'], registry);
    const intents = engine.getIntents();
    expect(intents).toEqual([
      { kind: 'skill', instanceId: expect.any(String), skillId: 'imp_claw', direction: 'left' },
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
      waves: [{ monsters: [{ monsterId: 'gloom_imp', spawn: { x: 6, y: 1 } }] }],
    };
  }

  it('moves a unit one step and is blocked by a wall', () => {
    const engine = new BattleEngine(roomyMap(), ['aster', 'wren'], registry);
    expect(engine.moveUnit(0, 'up')).toEqual({ ok: false, reason: 'blocked' }); // y=0 is wall
    expect(engine.moveUnit(0, 'down')).toEqual({ ok: true });
    expect(engine.getSnapshot().players[0].position).toEqual({ x: 1, y: 2 });
  });

  it('is blocked by an occupied tile', () => {
    const engine = new BattleEngine(twoWaveMap(), ['aster', 'wren'], registry);
    // wren is at (1,2), directly below aster (1,1)
    expect(engine.moveUnit(0, 'down')).toEqual({ ok: false, reason: 'blocked' });
  });

  it('strike deals damage to a monster in the aimed direction', () => {
    const engine = new BattleEngine(twoWaveMap(), ['aster', 'wren'], registry);
    const res = engine.useSkill(0, 'strike', 'right'); // monster at (2,1), aster at (1,1)
    expect(res).toEqual({ ok: true });
    expect(engine.getSnapshot().monsters[0].hp).toBe(0);
  });

  it('a unit cannot act after exhausting all action points', () => {
    const engine = new BattleEngine(roomyMap(), ['aster', 'wren'], registry);
    engine.moveUnit(0, 'down');
    engine.moveUnit(0, 'right');
    engine.moveUnit(0, 'right');
    engine.moveUnit(0, 'right');
    expect(engine.getSnapshot().players[0].actionsUsed).toBe(4);
    expect(engine.moveUnit(0, 'right')).toEqual({ ok: false, reason: 'no-actions-left' });
    expect(engine.useSkill(0, 'strike', 'right')).toEqual({ ok: false, reason: 'no-actions-left' });
  });

  it('resets action points at the start of every turn, not only when a wave clears', () => {
    // Monster starts 5 tiles from aster, so a couple of moves won't clear the wave.
    const engine = new BattleEngine(roomyMap(), ['aster', 'wren'], registry);
    engine.moveUnit(0, 'down');
    engine.moveUnit(0, 'right');
    expect(engine.getSnapshot().players[0].actionsUsed).toBe(2);

    engine.endTurn();

    expect(engine.getSnapshot().monsters.length).toBeGreaterThan(0); // sanity: wave still active
    expect(engine.getSnapshot().players[0].actionsUsed).toBe(0); // fresh budget for the new turn
  });

  it('push moves the target away from the caster, stopping at a wall', () => {
    const map = twoWaveMap();
    map.waves[0].monsters[0].spawn = { x: 5, y: 1 }; // one tile from the right wall (x=6 is the last floor col)
    const engine = new BattleEngine(map, ['aster', 'wren'], registry);
    // move aster 3 tiles right (3 of its 4 action points), landing adjacent to the monster at (4,1)
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
    // wren adjacent to the monster (so it's the one attacked); aster stays out of range.
    const map: MapDef = {
      ...twoWaveMap(),
      playerStarts: [
        { x: 1, y: 2 },
        { x: 1, y: 1 },
      ],
    };
    const engine = new BattleEngine(map, ['aster', 'wren'], registry);
    engine.useSkill(1, 'shield_skill', 'down'); // wren (unit 1) shields itself
    expect(engine.getSnapshot().players[1].shield).toBe(1);

    engine.endTurn(); // adjacent imp's stored intent attacks wren

    const wren2 = engine.getSnapshot().players[1];
    expect(wren2.shield).toBe(0); // charge consumed
    expect(wren2.hp).toBe(5); // fully blocked, no HP lost
  });

  it('undo restores the pre-action snapshot; history clears after endTurn', () => {
    const engine = new BattleEngine(roomyMap(), ['aster', 'wren'], registry);
    const before = engine.getSnapshot().players[0].position;
    engine.moveUnit(0, 'down');
    expect(engine.undo()).toBe(true);
    expect(engine.getSnapshot().players[0].position).toEqual(before);
    expect(engine.undo()).toBe(false);

    engine.moveUnit(0, 'down');
    engine.endTurn();
    expect(engine.undo()).toBe(false);
  });
});

describe('BattleEngine: turn resolution', () => {
  it('resolves a stored skill intent as damage to the player on endTurn', () => {
    const engine = new BattleEngine(twoWaveMap(), ['aster', 'wren'], registry);
    engine.endTurn(); // adjacent imp attacks aster for 1
    expect(engine.getSnapshot().players[0].hp).toBe(5);
  });

  it('a monster killed during the player turn does not act on endTurn', () => {
    const engine = new BattleEngine(twoWaveMap(), ['aster', 'wren'], registry);
    engine.useSkill(0, 'strike', 'right'); // kills the imp (2 dmg, maxHp 2)
    engine.endTurn();
    expect(engine.getSnapshot().players[0].hp).toBe(6); // took no damage
  });
});

describe('BattleEngine: wave clear and victory', () => {
  it('clearing a wave advances to the next wave and resets per-turn budgets', () => {
    const engine = new BattleEngine(twoWaveMap(), ['aster', 'wren'], registry);
    engine.useSkill(0, 'strike', 'right'); // kills wave-0's only monster
    engine.endTurn();
    const snap = engine.getSnapshot();
    expect(snap.waveIndex).toBe(1);
    expect(snap.monsters).toHaveLength(1);
    expect(snap.monsters[0].position).toEqual({ x: 6, y: 1 });
    expect(snap.players[0].hp).toBe(6); // no full-heal between waves, but also took no damage here
    expect(snap.victory).toBe(false);
  });

  it('relocates a spawn to the nearest free tile if a player is standing on it', () => {
    const map: MapDef = {
      ...twoWaveMap(),
      waves: [
        twoWaveMap().waves[0],
        { monsters: [{ monsterId: 'gloom_imp', spawn: { x: 1, y: 1 } }] }, // aster's own tile
      ],
    };
    const engine = new BattleEngine(map, ['aster', 'wren'], registry);
    engine.useSkill(0, 'strike', 'right'); // kills wave-0's monster
    engine.endTurn(); // advances to wave 1
    const snap = engine.getSnapshot();
    expect(snap.waveIndex).toBe(1);
    expect(snap.monsters[0].position).not.toEqual({ x: 1, y: 1 }); // not on top of aster
    const p = snap.monsters[0].position;
    expect(grid[p.y][p.x]).toBe(' '); // still a valid floor tile
  });

  it('clearing the final wave sets victory', () => {
    const map = twoWaveMap();
    map.waves = [map.waves[0]]; // only one wave
    const engine = new BattleEngine(map, ['aster', 'wren'], registry);
    engine.useSkill(0, 'strike', 'right');
    engine.endTurn();
    expect(engine.getSnapshot().victory).toBe(true);
    expect(engine.getIntents()).toEqual([]);
  });
});

describe('BattleEngine: wipe and lives', () => {
  const fragileAster: CharacterDef = { ...aster, maxHp: 1 };
  const fragileWren: CharacterDef = { ...wren, maxHp: 1 };
  const fragileRegistry: ContentRegistry = {
    ...registry,
    characters: { aster: fragileAster, wren: fragileWren },
  };

  function doubleAdjacentMap(): MapDef {
    return {
      formatVersion: 1,
      id: 'test-arena-2',
      nameKey: 'map.test2.name',
      grid,
      playerStarts: [
        { x: 1, y: 1 },
        { x: 4, y: 1 },
      ],
      waves: [
        {
          monsters: [
            { monsterId: 'gloom_imp', spawn: { x: 2, y: 1 } }, // adjacent to player 0
            { monsterId: 'gloom_imp', spawn: { x: 3, y: 1 } }, // adjacent to player 1
          ],
        },
      ],
    };
  }

  it('a full wipe with lives remaining decrements lives and retries the same wave', () => {
    const engine = new BattleEngine(doubleAdjacentMap(), ['aster', 'wren'], fragileRegistry);
    engine.endTurn(); // both imps attack, both 1-HP players die
    const snap = engine.getSnapshot();
    expect(snap.lives).toBe(2);
    expect(snap.waveIndex).toBe(0);
    expect(snap.players.every((p) => p.hp === 1)).toBe(true); // reset to full
    expect(snap.monsters).toHaveLength(2); // wave respawned
  });

  it('exhausting all lives resets the whole run to wave 0 with lives back to 3', () => {
    const engine = new BattleEngine(doubleAdjacentMap(), ['aster', 'wren'], fragileRegistry);
    engine.endTurn(); // lives 3 -> 2
    engine.endTurn(); // lives 2 -> 1
    engine.endTurn(); // lives 1 -> 0 -> full reset to 3
    const snap = engine.getSnapshot();
    expect(snap.lives).toBe(3);
    expect(snap.waveIndex).toBe(0);
  });
});
