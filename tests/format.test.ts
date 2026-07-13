import { describe, expect, it } from 'vitest';
import { LEVEL_FORMAT_VERSION, parseLevelFile, validateLevel } from '../core/level/format';
import type { LevelData } from '../core/level/types';
import { LEVELS } from '../levels/builtin';

const validFile = {
  formatVersion: LEVEL_FORMAT_VERSION,
  id: 'fmt-1',
  name: 'format test',
  allowGravityFlip: false,
  grid: [
    '#####',
    '#@$.#',
    '#####',
  ],
};

describe('parseLevelFile', () => {
  it('parses a char grid into tiles, player, and boxes', () => {
    const level = parseLevelFile(validFile);
    expect(level.width).toBe(5);
    expect(level.height).toBe(3);
    expect(level.playerStart).toEqual({ x: 1, y: 1 });
    expect(level.boxStarts).toEqual([{ x: 2, y: 1 }]);
    expect(level.tiles[1][3]).toBe('target');
    expect(level.tiles[0][0]).toBe('wall');
  });

  it('treats + and * as player/box standing on targets', () => {
    const level = parseLevelFile({
      ...validFile,
      grid: ['#####', '#+*.#', '#####'],
    });
    expect(level.tiles[1][1]).toBe('target');
    expect(level.tiles[1][2]).toBe('target');
    expect(level.playerStart).toEqual({ x: 1, y: 1 });
    expect(level.boxStarts).toEqual([{ x: 2, y: 1 }]);
  });

  it('rejects an unsupported formatVersion', () => {
    expect(() => parseLevelFile({ ...validFile, formatVersion: 999 })).toThrow(/formatVersion/);
  });

  it('rejects ragged grid rows', () => {
    expect(() =>
      parseLevelFile({ ...validFile, grid: ['#####', '#@$.', '#####'] }),
    ).toThrow(/length/);
  });

  it('rejects unknown characters', () => {
    expect(() =>
      parseLevelFile({ ...validFile, grid: ['#####', '#@$X#', '#####'] }),
    ).toThrow(/unknown char/);
  });

  it('rejects a grid with no player or two players', () => {
    expect(() =>
      parseLevelFile({ ...validFile, grid: ['#####', '# $.#', '#####'] }),
    ).toThrow(/no player/);
    expect(() =>
      parseLevelFile({ ...validFile, grid: ['#####', '#@@$#', '#####'] }),
    ).toThrow(/multiple players/);
  });

  it('rejects a level with fewer targets than boxes', () => {
    expect(() =>
      parseLevelFile({ ...validFile, grid: ['#####', '#@$$#', '#####'] }),
    ).toThrow(/targets/);
  });

  it('rejects a level with no boxes', () => {
    expect(() =>
      parseLevelFile({ ...validFile, grid: ['#####', '#@ .#', '#####'] }),
    ).toThrow(/no boxes/);
  });
});

describe('validateLevel', () => {
  it('flags out-of-bounds player and overlapping boxes', () => {
    const bad: LevelData = {
      formatVersion: 1,
      id: 'bad',
      name: 'bad',
      width: 3,
      height: 3,
      tiles: [
        ['wall', 'wall', 'wall'],
        ['wall', 'target', 'wall'],
        ['wall', 'wall', 'wall'],
      ],
      playerStart: { x: 9, y: 9 },
      boxStarts: [
        { x: 1, y: 1 },
        { x: 1, y: 1 },
      ],
      allowGravityFlip: false,
    };
    const problems = validateLevel(bad);
    expect(problems.join('; ')).toMatch(/playerStart/);
    expect(problems.join('; ')).toMatch(/overlapping boxes/);
    expect(problems.join('; ')).toMatch(/targets/);
  });
});

describe('builtin levels', () => {
  it('all builtin levels parse and validate cleanly', () => {
    expect(LEVELS).toHaveLength(3);
    for (const level of LEVELS) {
      expect(validateLevel(level)).toEqual([]);
    }
  });

  it('lvl-3 matches the previous hand-written layout', () => {
    const lvl3 = LEVELS[2];
    expect(lvl3.playerStart).toEqual({ x: 3, y: 1 });
    expect(lvl3.boxStarts).toEqual([
      { x: 2, y: 1 },
      { x: 3, y: 2 },
    ]);
    expect(lvl3.tiles[1][6]).toBe('target');
    expect(lvl3.tiles[3][6]).toBe('target');
  });
});
