import Phaser from 'phaser';
import { LevelEngine } from '../../core/level';
import type { GravityDir, LevelData, MoveDir } from '../../core/level';
import { LEVELS } from '../../levels/builtin';

const TILE = 64;

const COLORS = {
  bg: 0x14141a,
  target: 0xffd166,
  boxOnTarget: 0x70e000,
  boxDefault: 0xffffff,
};

export class PuzzleScene extends Phaser.Scene {
  private levelIndex = 0;
  private engine!: LevelEngine;
  private level!: LevelData;
  private offsetX = 0;
  private offsetY = 0;

  private boxSprites: Phaser.GameObjects.Image[] = [];
  private playerSprite!: Phaser.GameObjects.Image;
  private hudText!: Phaser.GameObjects.Text;
  private tutorialText!: Phaser.GameObjects.Text;
  private winText!: Phaser.GameObjects.Text;
  private won = false;

  constructor() {
    super('PuzzleScene');
  }

  init(data: { levelIndex?: number }) {
    this.levelIndex = data.levelIndex ?? 0;
    this.won = false;
  }

  preload() {
    this.load.image('floor', 'assets/tiles/floor.png');
    this.load.image('wall', 'assets/tiles/wall.png');
    this.load.image('box', 'assets/tiles/box.png');
    this.load.image('player', 'assets/tiles/player.png');
  }

  create() {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.level = LEVELS[this.levelIndex];
    this.engine = new LevelEngine(this.level);

    this.offsetX = (this.scale.width - this.level.width * TILE) / 2;
    this.offsetY = 100;

    this.drawStaticTiles();

    this.boxSprites = this.level.boxStarts.map(() =>
      this.add.image(0, 0, 'box').setDisplaySize(TILE - 18, TILE - 18),
    );
    this.playerSprite = this.add.image(0, 0, 'player').setDisplaySize(TILE - 20, TILE - 20);

    this.hudText = this.add.text(20, 16, '', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#f1f1f6',
    });

    this.add
      .text(this.scale.width - 20, 16, 'G 翻轉重力　Z 復原　R 重來', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#8a8a9a',
      })
      .setOrigin(1, 0);

    this.tutorialText = this.add
      .text(this.scale.width / 2, this.scale.height - 36, this.level.tutorialText ?? '', {
        fontFamily: 'monospace',
        fontSize: '15px',
        color: '#c9c9d6',
        align: 'center',
        wordWrap: { width: this.scale.width - 80 },
      })
      .setOrigin(0.5);

    this.winText = this.add
      .text(this.scale.width / 2, this.scale.height / 2, '', {
        fontFamily: 'monospace',
        fontSize: '32px',
        color: '#70e000',
        align: 'center',
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.setupInput();
    this.render();
  }

  private drawStaticTiles() {
    for (let y = 0; y < this.level.height; y++) {
      for (let x = 0; x < this.level.width; x++) {
        const tile = this.level.tiles[y][x];
        const px = this.offsetX + x * TILE + TILE / 2;
        const py = this.offsetY + y * TILE + TILE / 2;
        if (tile === 'wall') {
          this.add.image(px, py, 'wall').setDisplaySize(TILE, TILE);
        } else {
          this.add.image(px, py, 'floor').setDisplaySize(TILE, TILE);
          if (tile === 'target') {
            this.add.circle(px, py, 10, COLORS.target, 0.9);
          }
        }
      }
    }
  }

  private setupInput() {
    const kb = this.input.keyboard;
    if (!kb) return;

    const dirKeys: Array<[string, MoveDir]> = [
      ['keydown-UP', 'up'],
      ['keydown-W', 'up'],
      ['keydown-DOWN', 'down'],
      ['keydown-S', 'down'],
      ['keydown-LEFT', 'left'],
      ['keydown-A', 'left'],
      ['keydown-RIGHT', 'right'],
      ['keydown-D', 'right'],
    ];
    for (const [event, dir] of dirKeys) {
      kb.on(event, () => this.handleMove(dir));
    }
    kb.on('keydown-G', () => this.handleFlip());
    kb.on('keydown-Z', () => this.handleUndo());
    kb.on('keydown-BACKSPACE', () => this.handleUndo());
    kb.on('keydown-R', () => this.handleReset());
    kb.on('keydown-ENTER', () => this.handleAdvance());
    kb.on('keydown-SPACE', () => this.handleAdvance());
  }

  private handleMove(dir: MoveDir) {
    if (this.won) return;
    const res = this.engine.move(dir);
    this.afterAction(res.ok);
  }

  private handleFlip() {
    if (this.won) return;
    const res = this.engine.flipGravity();
    if (!res.ok && res.reason === 'gravity-locked') {
      this.flashTutorial('這關還沒解鎖重力翻轉');
      return;
    }
    this.afterAction(res.ok);
  }

  private handleUndo() {
    if (this.won) return;
    this.engine.undo();
    this.render();
  }

  private handleReset() {
    this.engine.reset();
    this.won = false;
    this.winText.setVisible(false);
    this.render();
  }

  private handleAdvance() {
    if (!this.won) return;
    const next = this.levelIndex + 1;
    if (next < LEVELS.length) {
      this.scene.restart({ levelIndex: next });
    } else {
      this.winText.setText('全部關卡完成！');
    }
  }

  private afterAction(ok: boolean) {
    if (!ok) {
      this.cameras.main.shake(80, 0.002);
    }
    this.render();
    if (!this.won && this.engine.isWon()) {
      this.won = true;
      this.winText.setText('過關！\n按 Enter 繼續').setVisible(true);
    }
  }

  private flashTutorial(msg: string) {
    this.tutorialText.setText(msg);
    this.time.delayedCall(1500, () => {
      this.tutorialText.setText(this.level.tutorialText ?? '');
    });
  }

  private render() {
    const snap = this.engine.getSnapshot();

    snap.boxes.forEach((b, i) => {
      const sprite = this.boxSprites[i];
      sprite.setPosition(
        this.offsetX + b.x * TILE + TILE / 2,
        this.offsetY + b.y * TILE + TILE / 2,
      );
      const onTarget = this.level.tiles[b.y][b.x] === 'target';
      sprite.setTint(onTarget ? COLORS.boxOnTarget : COLORS.boxDefault);
    });

    this.playerSprite.setPosition(
      this.offsetX + snap.player.x * TILE + TILE / 2,
      this.offsetY + snap.player.y * TILE + TILE / 2,
    );

    const arrow: Record<GravityDir, string> = { down: '↓', right: '→', up: '↑', left: '←' };
    const lockNote = this.level.allowGravityFlip ? '' : '（未解鎖）';
    this.hudText.setText(
      `${this.level.name}　步數: ${snap.moveCount}　重力: ${arrow[snap.gravity]}${lockNote}`,
    );
  }
}
