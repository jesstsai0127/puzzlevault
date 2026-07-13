import { GRAVITY_VECTORS, GRAVITY_ORDER } from './types';
import type { GravityDir, LevelData, Vec2 } from './types';

export type MoveDir = 'up' | 'down' | 'left' | 'right';

const MOVE_VECTORS: Record<MoveDir, Vec2> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export interface Snapshot {
  player: Vec2;
  boxes: Vec2[];
  gravity: GravityDir;
  moveCount: number;
}

export type ActionResult =
  | { ok: true }
  | { ok: false; reason: 'blocked' | 'gravity-locked' };

/**
 * Pure grid-puzzle state machine: no rendering, no I/O.
 *
 * Physics semantics (locked by tests — changing this invalidates published
 * level solutions and mid-level saves): gravity acts ONLY as a one-shot slide
 * when flipGravity() is called. Regular moves never trigger settling; a box
 * left "unsupported" after a push stays where it is.
 */
export class LevelEngine {
  private level: LevelData;
  private player: Vec2;
  private boxes: Vec2[];
  private gravity: GravityDir = 'down';
  private moveCount = 0;
  private history: Snapshot[] = [];

  constructor(level: LevelData) {
    this.level = level;
    this.player = { ...level.playerStart };
    this.boxes = level.boxStarts.map((b) => ({ ...b }));
  }

  getSnapshot(): Snapshot {
    return {
      player: { ...this.player },
      boxes: this.boxes.map((b) => ({ ...b })),
      gravity: this.gravity,
      moveCount: this.moveCount,
    };
  }

  private pushHistory(): void {
    this.history.push(this.getSnapshot());
  }

  private inBounds(p: Vec2): boolean {
    return p.x >= 0 && p.y >= 0 && p.x < this.level.width && p.y < this.level.height;
  }

  private tileAt(p: Vec2): 'wall' | 'floor' | 'target' | 'out' {
    if (!this.inBounds(p)) return 'out';
    return this.level.tiles[p.y][p.x];
  }

  private isWalkable(p: Vec2): boolean {
    const t = this.tileAt(p);
    return t === 'floor' || t === 'target';
  }

  private boxIndexAt(p: Vec2, excludeIndex?: number): number {
    return this.boxes.findIndex(
      (b, i) => i !== excludeIndex && b.x === p.x && b.y === p.y,
    );
  }

  private isPlayerAt(p: Vec2): boolean {
    return this.player.x === p.x && this.player.y === p.y;
  }

  /** Classic Sokoban step: move into empty tile, or push a single box ahead. */
  move(dir: MoveDir): ActionResult {
    const v = MOVE_VECTORS[dir];
    const next: Vec2 = { x: this.player.x + v.x, y: this.player.y + v.y };

    if (!this.isWalkable(next)) return { ok: false, reason: 'blocked' };

    const boxIdx = this.boxIndexAt(next);
    if (boxIdx !== -1) {
      const boxNext: Vec2 = { x: next.x + v.x, y: next.y + v.y };
      if (!this.isWalkable(boxNext) || this.boxIndexAt(boxNext) !== -1) {
        return { ok: false, reason: 'blocked' };
      }
      this.pushHistory();
      this.boxes[boxIdx] = boxNext;
      this.player = next;
      this.moveCount += 1;
      return { ok: true };
    }

    this.pushHistory();
    this.player = next;
    this.moveCount += 1;
    return { ok: true };
  }

  /** Rotate gravity to the next cardinal direction and let player + boxes settle. */
  flipGravity(): ActionResult {
    if (!this.level.allowGravityFlip) {
      return { ok: false, reason: 'gravity-locked' };
    }
    this.pushHistory();
    const idx = GRAVITY_ORDER.indexOf(this.gravity);
    this.gravity = GRAVITY_ORDER[(idx + 1) % GRAVITY_ORDER.length];
    this.settle();
    this.moveCount += 1;
    return { ok: true };
  }

  /** Repeatedly slide player + boxes along the current gravity vector until nothing moves. */
  private settle(): void {
    const v = GRAVITY_VECTORS[this.gravity];
    let changed = true;
    while (changed) {
      changed = false;

      // Boxes furthest along the gravity direction settle first so trailing
      // boxes don't get blocked by ones that haven't moved yet this tick.
      const order = this.boxes
        .map((_, i) => i)
        .sort((a, b) => {
          const da = this.boxes[a].x * v.x + this.boxes[a].y * v.y;
          const db = this.boxes[b].x * v.x + this.boxes[b].y * v.y;
          return db - da;
        });

      for (const i of order) {
        const box = this.boxes[i];
        const next: Vec2 = { x: box.x + v.x, y: box.y + v.y };
        if (
          this.isWalkable(next) &&
          this.boxIndexAt(next, i) === -1 &&
          !this.isPlayerAt(next)
        ) {
          this.boxes[i] = next;
          changed = true;
        }
      }

      const playerNext: Vec2 = { x: this.player.x + v.x, y: this.player.y + v.y };
      if (this.isWalkable(playerNext) && this.boxIndexAt(playerNext) === -1) {
        this.player = playerNext;
        changed = true;
      }
    }
  }

  /**
   * Replace current state with a previously captured snapshot (e.g. loading a
   * mid-level save). Undo history is cleared: undoing across a load boundary
   * would teleport the player into a state they never saw.
   */
  restoreSnapshot(snap: Snapshot): void {
    this.player = { ...snap.player };
    this.boxes = snap.boxes.map((b) => ({ ...b }));
    this.gravity = snap.gravity;
    this.moveCount = snap.moveCount;
    this.history = [];
  }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.player = prev.player;
    this.boxes = prev.boxes;
    this.gravity = prev.gravity;
    this.moveCount = prev.moveCount;
    return true;
  }

  reset(): void {
    this.player = { ...this.level.playerStart };
    this.boxes = this.level.boxStarts.map((b) => ({ ...b }));
    this.gravity = 'down';
    this.moveCount = 0;
    this.history = [];
  }

  isWon(): boolean {
    return this.boxes.every((b) => this.tileAt(b) === 'target');
  }
}
