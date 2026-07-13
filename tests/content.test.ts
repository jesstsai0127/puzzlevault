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
  id: 'arcane_strike',
  nameKey: 'skill.arcane_strike.name',
  descKey: 'skill.arcane_strike.desc',
  range: 1,
  effects: [{ type: 'damage', amount: 2, target: 'firstInLine' }],
};

const wardSkill = {
  formatVersion: CONTENT_FORMAT_VERSION,
  id: 'ward',
  nameKey: 'skill.ward.name',
  descKey: 'skill.ward.desc',
  range: 0,
  effects: [{ type: 'shield', amount: 1, target: 'self' }],
};

describe('parseSkillDef', () => {
  it('parses a valid melee damage skill', () => {
    const skill = parseSkillDef(meleeSkill);
    expect(skill.effects[0].type).toBe('damage');
  });

  it('parses a valid self-target shield skill with range 0', () => {
    const skill = parseSkillDef(wardSkill);
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

const asterCharacter = {
  formatVersion: CONTENT_FORMAT_VERSION,
  id: 'aster',
  nameKey: 'character.aster.name',
  spriteRef: 'char_aster',
  maxHp: 6,
  actionPoints: 4,
  skillIds: ['arcane_strike', 'repel_charm'],
};

describe('parseCharacterDef', () => {
  it('parses a valid character', () => {
    expect(parseCharacterDef(asterCharacter).id).toBe('aster');
  });

  it('rejects a character with no skills', () => {
    expect(() => parseCharacterDef({ ...asterCharacter, skillIds: [] })).toThrow(/no skills/);
  });

  it('rejects non-positive maxHp', () => {
    expect(() => parseCharacterDef({ ...asterCharacter, maxHp: 0 })).toThrow(/maxHp/);
  });
});

const gloomImp = {
  formatVersion: CONTENT_FORMAT_VERSION,
  id: 'gloom_imp',
  nameKey: 'monster.gloom_imp.name',
  spriteRef: 'mon_gloom_imp',
  maxHp: 3,
  moveRange: 1,
  skillIds: ['imp_claw'],
  aiRules: [
    { when: { kind: 'targetInRange', target: 'nearestPlayer', range: 1 }, action: { kind: 'useSkill', skillId: 'imp_claw' } },
    { when: { kind: 'always' }, action: { kind: 'moveToward', target: 'nearestPlayer' } },
  ],
};

describe('parseMonsterDef', () => {
  it('parses a valid monster with a fallback aiRule', () => {
    expect(parseMonsterDef(gloomImp).aiRules).toHaveLength(2);
  });

  it('rejects a monster whose aiRules do not end in an unconditional fallback', () => {
    expect(() =>
      parseMonsterDef({ ...gloomImp, aiRules: [gloomImp.aiRules[0]] }),
    ).toThrow(/fallback/);
  });

  it('rejects an aiRule referencing a skill the monster does not have', () => {
    expect(() =>
      parseMonsterDef({
        ...gloomImp,
        aiRules: [
          { when: { kind: 'always' }, action: { kind: 'useSkill', skillId: 'nonexistent' } },
        ],
      }),
    ).toThrow(/not in this monster's skillIds/);
  });
});

const courtyardMap = {
  formatVersion: CONTENT_FORMAT_VERSION,
  id: 'courtyard',
  nameKey: 'map.courtyard.name',
  grid: ['######', '#    #', '#    #', '######'],
  playerStarts: [
    { x: 1, y: 1 },
    { x: 1, y: 2 },
  ],
  waves: [{ monsters: [{ monsterId: 'gloom_imp', spawn: { x: 4, y: 1 } }] }],
};

describe('parseMapDef', () => {
  it('parses a valid map', () => {
    expect(parseMapDef(courtyardMap).waves).toHaveLength(1);
  });

  it('rejects a playerStart on a wall', () => {
    expect(() =>
      parseMapDef({ ...courtyardMap, playerStarts: [{ x: 0, y: 0 }, { x: 1, y: 2 }] }),
    ).toThrow(/not on a walkable tile/);
  });

  it('rejects a wave spawn outside the grid', () => {
    expect(() =>
      parseMapDef({
        ...courtyardMap,
        waves: [{ monsters: [{ monsterId: 'gloom_imp', spawn: { x: 99, y: 99 } }] }],
      }),
    ).toThrow(/not walkable/);
  });

  it('rejects a map with no waves', () => {
    expect(() => parseMapDef({ ...courtyardMap, waves: [] })).toThrow(/no waves/);
  });
});
