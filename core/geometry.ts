// Shared grid primitives. core/level/* is legacy (Sokoban prototype, slated
// for removal) — new modules (content, battle) depend on this file instead,
// not on core/level, so deleting core/level later doesn't ripple.

export interface Vec2 {
  x: number;
  y: number;
}

export type CardinalDir = 'up' | 'down' | 'left' | 'right';

export const MOVE_VECTORS: Record<CardinalDir, Vec2> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function equalsVec2(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

export function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Greedy single-step cardinal direction from `from` toward `to` (reduces the larger axis first). */
export function stepDirectionToward(from: Vec2, to: Vec2): CardinalDir {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'down' : 'up';
}

const OPPOSITE_DIR: Record<CardinalDir, CardinalDir> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

export function oppositeDir(dir: CardinalDir): CardinalDir {
  return OPPOSITE_DIR[dir];
}
