import { describe, expect, it } from 'vitest';
import { LevelEngine } from '../core/level/engine';
import type { LevelData } from '../core/level/types';

function row(...tiles: LevelData['tiles'][number]): LevelData['tiles'][number] {
  return tiles;
}

const pushTestLevel: LevelData = {
  formatVersion: 1,
  id: 'test-push',
  name: 'push test',
  width: 5,
  height: 3,
  tiles: [
    row('wall', 'wall', 'wall', 'wall', 'wall'),
    row('wall', 'floor', 'floor', 'target', 'wall'),
    row('wall', 'wall', 'wall', 'wall', 'wall'),
  ],
  playerStart: { x: 1, y: 1 },
  boxStarts: [{ x: 2, y: 1 }],
  allowGravityFlip: false,
};

const gravityTestLevel: LevelData = {
  formatVersion: 1,
  id: 'test-gravity',
  name: 'gravity test',
  width: 5,
  height: 3,
  tiles: [
    row('wall', 'wall', 'wall', 'wall', 'wall'),
    row('wall', 'floor', 'floor', 'floor', 'wall'),
    row('wall', 'wall', 'wall', 'wall', 'wall'),
  ],
  playerStart: { x: 1, y: 1 },
  boxStarts: [{ x: 2, y: 1 }],
  allowGravityFlip: true,
};

describe('LevelEngine: sokoban move/push', () => {
  it('moves the player onto an empty floor tile', () => {
    const level: LevelData = { ...pushTestLevel, boxStarts: [] };
    const engine = new LevelEngine(level);
    const res = engine.move('right');
    expect(res.ok).toBe(true);
    expect(engine.getSnapshot().player).toEqual({ x: 2, y: 1 });
  });

  it('is blocked by a wall', () => {
    const engine = new LevelEngine(pushTestLevel);
    const res = engine.move('left');
    expect(res).toEqual({ ok: false, reason: 'blocked' });
    expect(engine.getSnapshot().player).toEqual({ x: 1, y: 1 });
  });

  it('pushes a box onto a target and wins', () => {
    const engine = new LevelEngine(pushTestLevel);
    expect(engine.isWon()).toBe(false);
    const res = engine.move('right');
    expect(res.ok).toBe(true);
    expect(engine.getSnapshot().boxes).toEqual([{ x: 3, y: 1 }]);
    expect(engine.isWon()).toBe(true);
  });

  it('refuses to push a box into a wall', () => {
    const engine = new LevelEngine(pushTestLevel);
    engine.move('right'); // box now at target (3,1), player at (2,1)
    const res = engine.move('right'); // would push box from (3,1) to (4,1) = wall
    expect(res).toEqual({ ok: false, reason: 'blocked' });
    expect(engine.getSnapshot().boxes).toEqual([{ x: 3, y: 1 }]);
  });
});

describe('LevelEngine: undo/reset', () => {
  it('undo restores the previous snapshot', () => {
    const engine = new LevelEngine(pushTestLevel);
    engine.move('right');
    expect(engine.getSnapshot().moveCount).toBe(1);
    const undone = engine.undo();
    expect(undone).toBe(true);
    expect(engine.getSnapshot()).toEqual({
      player: { x: 1, y: 1 },
      boxes: [{ x: 2, y: 1 }],
      gravity: 'down',
      moveCount: 0,
    });
  });

  it('undo on empty history is a no-op', () => {
    const engine = new LevelEngine(pushTestLevel);
    expect(engine.undo()).toBe(false);
  });

  it('reset clears history and moveCount', () => {
    const engine = new LevelEngine(pushTestLevel);
    engine.move('right');
    engine.reset();
    expect(engine.getSnapshot().moveCount).toBe(0);
    expect(engine.undo()).toBe(false);
  });
});

// 5 wide x 3 tall open room inside walls (floor x1..4, y1), used for
// multi-box settle-order and player-blocking tests.
const wideCorridor: LevelData = {
  formatVersion: 1,
  id: 'test-wide',
  name: 'wide corridor',
  width: 6,
  height: 3,
  tiles: [
    row('wall', 'wall', 'wall', 'wall', 'wall', 'wall'),
    row('wall', 'floor', 'floor', 'floor', 'target', 'wall'),
    row('wall', 'wall', 'wall', 'wall', 'wall', 'wall'),
  ],
  playerStart: { x: 1, y: 1 },
  boxStarts: [
    { x: 2, y: 1 },
    { x: 3, y: 1 },
  ],
  allowGravityFlip: true,
};

// 6 wide x 5 tall open room (floor x1..4, y1..3) for the semantics-lock test.
const openRoom: LevelData = {
  formatVersion: 1,
  id: 'test-open',
  name: 'open room',
  width: 6,
  height: 5,
  tiles: [
    row('wall', 'wall', 'wall', 'wall', 'wall', 'wall'),
    row('wall', 'floor', 'floor', 'floor', 'target', 'wall'),
    row('wall', 'floor', 'floor', 'floor', 'floor', 'wall'),
    row('wall', 'floor', 'floor', 'floor', 'target', 'wall'),
    row('wall', 'wall', 'wall', 'wall', 'wall', 'wall'),
  ],
  playerStart: { x: 1, y: 1 },
  boxStarts: [
    { x: 1, y: 2 },
    { x: 2, y: 2 },
  ],
  allowGravityFlip: true,
};

describe('LevelEngine: gravity flip', () => {
  it('refuses to flip when the level has not unlocked it', () => {
    const engine = new LevelEngine(pushTestLevel);
    const res = engine.flipGravity();
    expect(res).toEqual({ ok: false, reason: 'gravity-locked' });
    expect(engine.getSnapshot().gravity).toBe('down');
  });

  it('slides the box until it hits a wall, then the player behind it', () => {
    const engine = new LevelEngine(gravityTestLevel);
    const res = engine.flipGravity();
    expect(res.ok).toBe(true);
    const snap = engine.getSnapshot();
    expect(snap.gravity).toBe('right');
    expect(snap.boxes).toEqual([{ x: 3, y: 1 }]);
    expect(snap.player).toEqual({ x: 2, y: 1 });
  });

  it('settles multiple boxes in gravity order without overlap', () => {
    const engine = new LevelEngine(wideCorridor);
    engine.flipGravity(); // gravity → right
    const snap = engine.getSnapshot();
    expect(snap.boxes).toEqual([
      { x: 3, y: 1 },
      { x: 4, y: 1 },
    ]);
    expect(snap.player).toEqual({ x: 2, y: 1 });
  });

  it('a sliding box comes to rest against the player', () => {
    const level: LevelData = {
      ...wideCorridor,
      playerStart: { x: 3, y: 1 },
      boxStarts: [{ x: 1, y: 1 }],
    };
    const engine = new LevelEngine(level);
    engine.flipGravity(); // gravity → right; player slides to wall first
    const snap = engine.getSnapshot();
    expect(snap.player).toEqual({ x: 4, y: 1 });
    expect(snap.boxes).toEqual([{ x: 3, y: 1 }]);
  });

  it('undo after a flip restores gravity and all positions', () => {
    const engine = new LevelEngine(gravityTestLevel);
    const before = engine.getSnapshot();
    engine.flipGravity();
    expect(engine.undo()).toBe(true);
    expect(engine.getSnapshot()).toEqual(before);
  });

  it('a failed flip (gravity-locked) does not pollute undo history', () => {
    const engine = new LevelEngine(pushTestLevel);
    engine.flipGravity(); // locked, refused
    expect(engine.undo()).toBe(false);
  });
});

describe('LevelEngine: physics semantics lock (flip is a one-shot event)', () => {
  // If settle() ever runs after regular moves, this test breaks — that is
  // intentional: changing the semantics invalidates published solutions.
  it('a box left unsupported after a push does NOT fall', () => {
    const engine = new LevelEngine(openRoom);
    engine.flipGravity(); // gravity → right: player→(4,1), boxes→(4,2),(3,2)
    expect(engine.getSnapshot().player).toEqual({ x: 4, y: 1 });
    expect(engine.getSnapshot().boxes).toEqual(
      expect.arrayContaining([
        { x: 4, y: 2 },
        { x: 3, y: 2 },
      ]),
    );

    engine.move('down'); // push box (4,2)→(4,3); player→(4,2)
    engine.move('up'); // player back to (4,1); box at (3,2) now "unsupported"

    const snap = engine.getSnapshot();
    expect(snap.boxes).toEqual(
      expect.arrayContaining([
        { x: 4, y: 3 },
        { x: 3, y: 2 }, // stays put — no settling on regular moves
      ]),
    );
  });
});

describe('LevelEngine: restoreSnapshot', () => {
  it('round-trips a snapshot and clears history', () => {
    const engine = new LevelEngine(gravityTestLevel);
    engine.move('right');
    engine.flipGravity();
    const saved = engine.getSnapshot();

    const fresh = new LevelEngine(gravityTestLevel);
    fresh.restoreSnapshot(saved);
    expect(fresh.getSnapshot()).toEqual(saved);
    expect(fresh.undo()).toBe(false);
  });
});
