import { describe, expect, it } from 'vitest';
import {
  CONTENT_FORMAT_VERSION,
  parseCharacterDef,
  parseMapDef,
  parseMonsterDef,
  parseSkillDef,
} from '../core/content';

const meleeSkill = {
  formatVersion: CONTENT_FORMAT_VERSION,
  id: 'sword_qi',
  nameKey: 'skill.sword_qi.name',
  descKey: 'skill.sword_qi.desc',
  range: 1,
  effects: [{ type: 'damage', amount: 2, target: 'firstInLine' }],
};

const qiShieldSkill = {
  formatVersion: CONTENT_FORMAT_VERSION,
  id: 'qi_shield',
  nameKey: 'skill.qi_shield.name',
  descKey: 'skill.qi_shield.desc',
  range: 0,
  effects: [{ type: 'shield', amount: 1, target: 'self' }],
};

describe('parseSkillDef', () => {
  it('parses a valid melee damage skill', () => {
    const skill = parseSkillDef(meleeSkill);
    expect(skill.effects[0].type).toBe('damage');
  });

  it('parses a valid self-target shield skill with range 0', () => {
    const skill = parseSkillDef(qiShieldSkill);
    expect(skill.range).toBe(0);
  });

  it('rejects firstInLine target with range 0', () => {
    expect(() => parseSkillDef({ ...meleeSkill, range: 0 })).toThrow(/firstInLine/);
  });

  it('rejects an unsupported formatVersion', () => {
    expect(() => parseSkillDef({ ...meleeSkill, formatVersion: 99 })).toThrow(/formatVersion/);
  });

  it('rejects a skill with no effects', () => {
    expect(() => parseSkillDef({ ...meleeSkill, effects: [] })).toThrow(/no effects/);
  });

  it('rejects a non-positive amount', () => {
    expect(() =>
      parseSkillDef({ ...meleeSkill, effects: [{ type: 'damage', amount: 0, target: 'firstInLine' }] }),
    ).toThrow(/amount must be > 0/);
  });
});

const liYanCharacter = {
  formatVersion: CONTENT_FORMAT_VERSION,
  id: 'li_yan',
  nameKey: 'character.li_yan.name',
  spriteRef: 'char_li_yan',
  maxHp: 6,
  moveRange: 3,
  skillIds: ['sword_qi', 'palm_wave'],
  ultimateSkillId: 'sword_tempest',
};

describe('parseCharacterDef', () => {
  it('parses a valid character', () => {
    expect(parseCharacterDef(liYanCharacter).id).toBe('li_yan');
  });

  it('rejects a character with no skills', () => {
    expect(() => parseCharacterDef({ ...liYanCharacter, skillIds: [] })).toThrow(/no skills/);
  });

  it('rejects non-positive maxHp', () => {
    expect(() => parseCharacterDef({ ...liYanCharacter, maxHp: 0 })).toThrow(/maxHp/);
  });

  it('rejects a character missing ultimateSkillId', () => {
    const { ultimateSkillId: _drop, ...noUltimate } = liYanCharacter;
    expect(() => parseCharacterDef(noUltimate as typeof liYanCharacter)).toThrow(/ultimateSkillId/);
  });
});

const yinGhost = {
  formatVersion: CONTENT_FORMAT_VERSION,
  id: 'yin_ghost',
  nameKey: 'monster.yin_ghost.name',
  spriteRef: 'mon_yin_ghost',
  maxHp: 3,
  moveRange: 1,
  skillIds: ['ghost_claw'],
  aiRules: [
    { when: { kind: 'targetInRange', target: 'nearestPlayer', range: 1 }, action: { kind: 'useSkill', skillId: 'ghost_claw' } },
    { when: { kind: 'always' }, action: { kind: 'moveToward', target: 'nearestPlayer' } },
  ],
};

describe('parseMonsterDef', () => {
  it('parses a valid monster with a fallback aiRule', () => {
    expect(parseMonsterDef(yinGhost).aiRules).toHaveLength(2);
  });

  it('rejects a monster whose aiRules do not end in an unconditional fallback', () => {
    expect(() =>
      parseMonsterDef({ ...yinGhost, aiRules: [yinGhost.aiRules[0]] }),
    ).toThrow(/fallback/);
  });

  it('rejects an aiRule referencing a skill the monster does not have', () => {
    expect(() =>
      parseMonsterDef({
        ...yinGhost,
        aiRules: [
          { when: { kind: 'always' }, action: { kind: 'useSkill', skillId: 'nonexistent' } },
        ],
      }),
    ).toThrow(/not in this monster's skillIds/);
  });
});

const yanwuGroundMap = {
  formatVersion: CONTENT_FORMAT_VERSION,
  id: 'yanwu_ground',
  nameKey: 'map.yanwu_ground.name',
  grid: ['######', '#B   #', '#    #', '######'],
  baseHp: 8,
  playerStarts: [
    { x: 2, y: 1 },
    { x: 2, y: 2 },
  ],
  initialMonsters: [{ monsterId: 'yin_ghost', spawn: { x: 4, y: 1 } }],
  spawnSchedule: [{ telegraphTurn: 2, monsterId: 'yin_ghost', tile: { x: 4, y: 2 } }],
  totalTurns: 4,
};

describe('parseMapDef', () => {
  it('parses a valid map', () => {
    const parsed = parseMapDef(yanwuGroundMap);
    expect(parsed.initialMonsters).toHaveLength(1);
    expect(parsed.spawnSchedule).toHaveLength(1);
    expect(parsed.totalTurns).toBe(4);
  });

  it('rejects a playerStart on a wall', () => {
    expect(() =>
      parseMapDef({ ...yanwuGroundMap, playerStarts: [{ x: 0, y: 0 }, { x: 1, y: 2 }] }),
    ).toThrow(/not on a walkable tile/);
  });

  it('rejects an initialMonsters spawn outside the grid', () => {
    expect(() =>
      parseMapDef({
        ...yanwuGroundMap,
        initialMonsters: [{ monsterId: 'yin_ghost', spawn: { x: 99, y: 99 } }],
      }),
    ).toThrow(/not walkable/);
  });

  it('rejects a spawnSchedule entry tile outside the grid', () => {
    expect(() =>
      parseMapDef({
        ...yanwuGroundMap,
        spawnSchedule: [{ telegraphTurn: 2, monsterId: 'yin_ghost', tile: { x: 99, y: 99 } }],
      }),
    ).toThrow(/not walkable/);
  });

  it('rejects a map with no monsters (initialMonsters and spawnSchedule both empty)', () => {
    expect(() =>
      parseMapDef({ ...yanwuGroundMap, initialMonsters: [], spawnSchedule: [] }),
    ).toThrow(/no monsters/);
  });

  it('accepts a hazard tile (~) in the grid', () => {
    const withHazard = { ...yanwuGroundMap, grid: ['######', '#B   #', '#  ~ #', '######'] };
    expect(parseMapDef(withHazard).grid[2]).toBe('#  ~ #');
  });

  it('rejects a map with no base tile', () => {
    expect(() =>
      parseMapDef({ ...yanwuGroundMap, grid: ['######', '#    #', '#    #', '######'] }),
    ).toThrow(/no base/);
  });

  it('rejects a non-positive baseHp', () => {
    expect(() => parseMapDef({ ...yanwuGroundMap, baseHp: 0 })).toThrow(/baseHp/);
  });

  it('rejects a non-positive totalTurns', () => {
    expect(() => parseMapDef({ ...yanwuGroundMap, totalTurns: 0 })).toThrow(/totalTurns/);
  });

  it('rejects a spawnSchedule entry whose telegraphTurn exceeds totalTurns', () => {
    expect(() =>
      parseMapDef({
        ...yanwuGroundMap,
        spawnSchedule: [{ telegraphTurn: 5, monsterId: 'yin_ghost', tile: { x: 4, y: 2 } }],
      }),
    ).toThrow(/exceeds totalTurns/);
  });

  it('rejects a spawnSchedule entry with a non-positive telegraphTurn', () => {
    expect(() =>
      parseMapDef({
        ...yanwuGroundMap,
        spawnSchedule: [{ telegraphTurn: 0, monsterId: 'yin_ghost', tile: { x: 4, y: 2 } }],
      }),
    ).toThrow(/telegraphTurn must be > 0/);
  });

  it('rejects an unknown grid character', () => {
    expect(() =>
      parseMapDef({ ...yanwuGroundMap, grid: ['######', '# X  #', '#    #', '######'] }),
    ).toThrow(/unknown character/);
  });
});
