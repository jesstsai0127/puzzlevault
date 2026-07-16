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
  mpCost: 2,
  effects: [{ type: 'damage', amount: 2, target: 'firstInLine' }],
};

const qiShieldSkill = {
  formatVersion: CONTENT_FORMAT_VERSION,
  id: 'qi_shield',
  nameKey: 'skill.qi_shield.name',
  descKey: 'skill.qi_shield.desc',
  range: 0,
  mpCost: 1,
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
  actionPoints: 4,
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
  waves: [{ turns: 4, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 4, y: 1 } }] }],
};

describe('parseMapDef', () => {
  it('parses a valid map', () => {
    expect(parseMapDef(yanwuGroundMap).waves).toHaveLength(1);
  });

  it('rejects a playerStart on a wall', () => {
    expect(() =>
      parseMapDef({ ...yanwuGroundMap, playerStarts: [{ x: 0, y: 0 }, { x: 1, y: 2 }] }),
    ).toThrow(/not on a walkable tile/);
  });

  it('rejects a wave spawn outside the grid', () => {
    expect(() =>
      parseMapDef({
        ...yanwuGroundMap,
        waves: [{ monsters: [{ monsterId: 'yin_ghost', spawn: { x: 99, y: 99 } }] }],
      }),
    ).toThrow(/not walkable/);
  });

  it('rejects a map with no waves', () => {
    expect(() => parseMapDef({ ...yanwuGroundMap, waves: [] })).toThrow(/no waves/);
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

  it('rejects a wave with a non-positive turns budget', () => {
    expect(() =>
      parseMapDef({
        ...yanwuGroundMap,
        waves: [{ turns: 0, monsters: [{ monsterId: 'yin_ghost', spawn: { x: 4, y: 1 } }] }],
      }),
    ).toThrow(/turns/);
  });

  it('rejects an unknown grid character', () => {
    expect(() =>
      parseMapDef({ ...yanwuGroundMap, grid: ['######', '# X  #', '#    #', '######'] }),
    ).toThrow(/unknown character/);
  });
});
