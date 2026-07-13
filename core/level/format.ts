import type { LevelData, TileType, Vec2 } from './types';

export const LEVEL_FORMAT_VERSION = 1;

/**
 * On-disk level file (v1). `grid` is a character map using the classic
 * Sokoban convention:
 *   '#' wall   ' ' floor    '.' target
 *   '@' player '+' player on target
 *   '$' box    '*' box on target
 */
export interface LevelFileV1 {
  formatVersion: number;
  id: string;
  name: string;
  allowGravityFlip: boolean;
  tutorialText?: string;
  grid: string[];
}

/**
 * Parse an untrusted level file (e.g. builtin JSON now, downloaded/decrypted
 * .lvlpack payloads in Phase 2) into LevelData. Throws with all collected
 * problems joined, so authors see everything wrong at once.
 */
export function parseLevelFile(raw: unknown): LevelData {
  const errors: string[] = [];
  const file = raw as Partial<LevelFileV1>;

  if (typeof raw !== 'object' || raw === null) {
    throw new Error('level file: not an object');
  }
  if (file.formatVersion !== LEVEL_FORMAT_VERSION) {
    throw new Error(
      `level file: unsupported formatVersion ${String(file.formatVersion)} (expected ${LEVEL_FORMAT_VERSION})`,
    );
  }
  if (typeof file.id !== 'string' || file.id.length === 0) errors.push('missing id');
  if (typeof file.name !== 'string' || file.name.length === 0) errors.push('missing name');
  if (typeof file.allowGravityFlip !== 'boolean') errors.push('missing allowGravityFlip');
  if (!Array.isArray(file.grid) || file.grid.length === 0) {
    errors.push('grid must be a non-empty array of strings');
    throw new Error(`level file: ${errors.join('; ')}`);
  }

  const height = file.grid.length;
  const width = file.grid[0].length;
  const tiles: TileType[][] = [];
  let playerStart: Vec2 | null = null;
  const boxStarts: Vec2[] = [];

  for (let y = 0; y < height; y++) {
    const row = file.grid[y];
    if (typeof row !== 'string' || row.length !== width) {
      errors.push(`grid row ${y} length ${row?.length ?? 'n/a'} != ${width}`);
      continue;
    }
    const tileRow: TileType[] = [];
    for (let x = 0; x < width; x++) {
      const ch = row[x];
      switch (ch) {
        case '#':
          tileRow.push('wall');
          break;
        case ' ':
          tileRow.push('floor');
          break;
        case '.':
          tileRow.push('target');
          break;
        case '@':
        case '+':
          tileRow.push(ch === '+' ? 'target' : 'floor');
          if (playerStart) errors.push(`multiple players (second at ${x},${y})`);
          playerStart = { x, y };
          break;
        case '$':
        case '*':
          tileRow.push(ch === '*' ? 'target' : 'floor');
          boxStarts.push({ x, y });
          break;
        default:
          errors.push(`grid row ${y} col ${x}: unknown char '${ch}'`);
          tileRow.push('floor');
      }
    }
    tiles.push(tileRow);
  }

  if (!playerStart) errors.push('no player (@ or +) in grid');
  if (errors.length > 0) {
    throw new Error(`level file '${String(file.id)}': ${errors.join('; ')}`);
  }

  const level: LevelData = {
    formatVersion: LEVEL_FORMAT_VERSION,
    id: file.id as string,
    name: file.name as string,
    width,
    height,
    tiles,
    playerStart: playerStart as Vec2,
    boxStarts,
    allowGravityFlip: file.allowGravityFlip as boolean,
    tutorialText: typeof file.tutorialText === 'string' ? file.tutorialText : undefined,
  };

  const problems = validateLevel(level);
  if (problems.length > 0) {
    throw new Error(`level file '${level.id}': ${problems.join('; ')}`);
  }
  return level;
}

/** Structural sanity checks on parsed LevelData. Returns all problems found. */
export function validateLevel(level: LevelData): string[] {
  const problems: string[] = [];
  const { width, height, tiles, playerStart, boxStarts } = level;

  if (tiles.length !== height) problems.push(`tiles has ${tiles.length} rows, expected ${height}`);
  tiles.forEach((row, y) => {
    if (row.length !== width) problems.push(`tiles row ${y} has ${row.length} cols, expected ${width}`);
  });

  const inBounds = (p: Vec2) => p.x >= 0 && p.y >= 0 && p.x < width && p.y < height;
  const walkable = (p: Vec2) => inBounds(p) && tiles[p.y][p.x] !== 'wall';

  if (!walkable(playerStart)) problems.push(`playerStart (${playerStart.x},${playerStart.y}) not on walkable tile`);

  const seen = new Set<string>();
  for (const b of boxStarts) {
    const key = `${b.x},${b.y}`;
    if (seen.has(key)) problems.push(`overlapping boxes at (${key})`);
    seen.add(key);
    if (!walkable(b)) problems.push(`box (${key}) not on walkable tile`);
    if (b.x === playerStart.x && b.y === playerStart.y) problems.push(`box (${key}) overlaps player`);
  }

  if (boxStarts.length === 0) problems.push('level has no boxes');
  const targetCount = tiles.flat().filter((t) => t === 'target').length;
  if (targetCount < boxStarts.length) {
    problems.push(`only ${targetCount} targets for ${boxStarts.length} boxes`);
  }

  return problems;
}
