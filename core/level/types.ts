export interface Vec2 {
  x: number;
  y: number;
}

export type TileType = 'floor' | 'wall' | 'target';

export type GravityDir = 'down' | 'right' | 'up' | 'left';

export const GRAVITY_ORDER: GravityDir[] = ['down', 'right', 'up', 'left'];

export const GRAVITY_VECTORS: Record<GravityDir, Vec2> = {
  down: { x: 0, y: 1 },
  up: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export interface LevelData {
  /** Level file format version; bump when the schema changes incompatibly. */
  formatVersion: number;
  id: string;
  name: string;
  width: number;
  height: number;
  /** tiles[y][x] */
  tiles: TileType[][];
  playerStart: Vec2;
  boxStarts: Vec2[];
  allowGravityFlip: boolean;
  tutorialText?: string;
}
