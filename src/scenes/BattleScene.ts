import Phaser from 'phaser';
import { BattleEngine } from '../../core/battle/engine';
import type { CardinalDir } from '../../core/geometry';
import { I18n } from '../../core/i18n';
import en from '../../locales/en.json';
import zhTW from '../../locales/zh-TW.json';
import { STARTING_SQUAD, courtyardMap, registry } from '../../content/registry';

const TILE = 80;

const COLORS = {
  bg: 0x14141a,
  floor: 0x2a2a35,
  wall: 0x111116,
  selected: 0xffd166,
  shield: 0x4cc9f0,
  intentMove: 0x8a8a9a,
  intentAttack: 0xef4444,
  hpBarFill: 0x70e000,
  hpBarFillLow: 0xef4444,
  reachable: 0x4cc9f0,
  targetable: 0xef4444,
  buttonBg: 0x2a2a35,
  buttonBgArmed: 0x5a4520,
  buttonBorder: 0x3a3a46,
};

const DIR_VECTORS: Record<CardinalDir, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const DIR_ARROW: Record<CardinalDir, string> = { up: '↑', down: '↓', left: '←', right: '→' };

const i18n = new I18n(en, zhTW);

interface Button {
  bg: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

export class BattleScene extends Phaser.Scene {
  private engine!: BattleEngine;
  private offsetX = 0;
  private offsetY = 0;

  private tileHighlights: Phaser.GameObjects.Rectangle[][] = [];
  private playerSprites: Phaser.GameObjects.Image[] = [];
  private playerHpBars: Phaser.GameObjects.Rectangle[] = [];
  private playerShieldIcons: Phaser.GameObjects.Arc[] = [];
  private monsterSprites: Map<string, Phaser.GameObjects.Image> = new Map();
  private monsterHpBars: Map<string, Phaser.GameObjects.Rectangle> = new Map();
  private intentMarkers: Phaser.GameObjects.GameObject[] = [];
  private spawnPreviewMarkers: Phaser.GameObjects.GameObject[] = [];
  private selectionRing!: Phaser.GameObjects.Rectangle;

  private hudText!: Phaser.GameObjects.Text;
  private instructionText!: Phaser.GameObjects.Text;
  private bannerText!: Phaser.GameObjects.Text;
  private skillButtons: Button[] = [];
  private endTurnButton!: Button;
  private undoButton!: Button;

  private selectedUnit = 0;
  private armedSkillId: string | null = null;
  private reachable: Map<string, CardinalDir[]> = new Map();
  private targetable: Map<string, CardinalDir> = new Map();

  constructor() {
    super('BattleScene');
  }

  preload() {
    this.load.image('char_aster', 'assets/characters/aster.png');
    this.load.image('char_wren', 'assets/characters/wren.png');
    this.load.image('mon_gloom_imp', 'assets/monsters/gloom_imp.png');
  }

  create() {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.engine = new BattleEngine(courtyardMap, STARTING_SQUAD, registry);

    this.offsetX = (this.scale.width - courtyardMap.grid[0].length * TILE) / 2;
    this.offsetY = 80;

    this.drawStaticTiles();
    this.buildTileHighlights();

    this.selectionRing = this.add
      .rectangle(0, 0, TILE - 6, TILE - 6)
      .setStrokeStyle(3, COLORS.selected)
      .setFillStyle(0x000000, 0)
      .setDepth(2);

    const squad = this.engine.getSnapshot().players;
    this.playerSprites = squad.map((p, i) => {
      const textureKey = registry.characters[p.characterId].spriteRef;
      const sprite = this.add
        .image(0, 0, textureKey)
        .setDisplaySize(TILE - 16, TILE - 16)
        .setDepth(2)
        .setInteractive({ useHandCursor: true });
      sprite.on('pointerdown', () => this.selectUnit(i));
      return sprite;
    });
    this.playerHpBars = squad.map(() => this.add.rectangle(0, 0, TILE - 20, 6, COLORS.hpBarFill).setDepth(2));
    this.playerShieldIcons = squad.map(() =>
      this.add.circle(0, 0, 8, COLORS.shield).setDepth(2).setVisible(false),
    );

    this.hudText = this.add.text(20, 14, '', {
      fontFamily: 'monospace',
      fontSize: '17px',
      color: '#f1f1f6',
    });

    this.instructionText = this.add
      .text(this.scale.width / 2, this.offsetY - 34, '', {
        fontFamily: 'monospace',
        fontSize: '15px',
        color: '#c9c9d6',
        align: 'center',
      })
      .setOrigin(0.5, 0);

    this.bannerText = this.add
      .text(this.scale.width / 2, this.scale.height / 2, '', {
        fontFamily: 'monospace',
        fontSize: '32px',
        color: '#70e000',
        align: 'center',
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.buildBottomButtons();
    this.setupKeyboard();
    this.render();
  }

  // ---------------------------------------------------------------------
  // Build (once)
  // ---------------------------------------------------------------------

  private drawStaticTiles() {
    courtyardMap.grid.forEach((row, y) => {
      row.split('').forEach((ch, x) => {
        const { px, py } = this.tileCenter(x, y);
        const color = ch === '#' ? COLORS.wall : COLORS.floor;
        this.add.rectangle(px, py, TILE - 2, TILE - 2, color);
      });
    });
  }

  private buildTileHighlights() {
    courtyardMap.grid.forEach((row, y) => {
      const rowArr: Phaser.GameObjects.Rectangle[] = [];
      row.split('').forEach((ch, x) => {
        const { px, py } = this.tileCenter(x, y);
        const rect = this.add
          .rectangle(px, py, TILE - 4, TILE - 4, 0xffffff, 0)
          .setDepth(1);
        if (ch !== '#') {
          rect.setInteractive({ useHandCursor: true });
          rect.on('pointerdown', () => this.handleTileClick(x, y));
        }
        rowArr.push(rect);
      });
      this.tileHighlights.push(rowArr);
    });
  }

  private makeButton(x: number, y: number, w: number, h: number, onClick: () => void): Button {
    const bg = this.add
      .rectangle(x, y, w, h, COLORS.buttonBg)
      .setStrokeStyle(1, COLORS.buttonBorder)
      .setInteractive({ useHandCursor: true })
      .setOrigin(0, 0);
    const label = this.add
      .text(x + w / 2, y + h / 2, '', { fontFamily: 'monospace', fontSize: '14px', color: '#f1f1f6' })
      .setOrigin(0.5);
    bg.on('pointerdown', onClick);
    return { bg, label };
  }

  private buildBottomButtons() {
    const barY = this.scale.height - 56;
    this.skillButtons = [0, 1].map((i) =>
      this.makeButton(20 + i * 210, barY, 200, 40, () => this.toggleSkill(i)),
    );
    this.undoButton = this.makeButton(this.scale.width - 340, barY, 150, 40, () => this.handleUndo());
    this.endTurnButton = this.makeButton(this.scale.width - 170, barY, 150, 40, () => this.handleEndTurn());
  }

  // ---------------------------------------------------------------------
  // Keyboard (kept as a shortcut layer; mouse is the primary path)
  // ---------------------------------------------------------------------

  private static readonly DIR_KEYS: Record<string, CardinalDir> = {
    ArrowUp: 'up',
    w: 'up',
    ArrowDown: 'down',
    s: 'down',
    ArrowLeft: 'left',
    a: 'left',
    ArrowRight: 'right',
    d: 'right',
  };

  private setupKeyboard() {
    const kb = this.input.keyboard;
    if (!kb) return;
    kb.on('keydown', (event: KeyboardEvent) => {
      if (event.repeat) return;
      const dir = BattleScene.DIR_KEYS[event.key];
      if (dir) {
        this.stepFromKeyboard(dir);
        return;
      }
      switch (event.key) {
        case '1':
          this.toggleSkill(0);
          break;
        case '2':
          this.toggleSkill(1);
          break;
        case 'q':
        case 'Q':
          this.selectUnit(1 - this.selectedUnit);
          break;
        case 'z':
        case 'Z':
          this.handleUndo();
          break;
        case 'Enter':
          this.handleEndTurn();
          break;
      }
    });
  }

  /** Arrow keys move one step, or fire an armed skill in that direction — mirrors clicking an adjacent highlighted tile. */
  private stepFromKeyboard(dir: CardinalDir) {
    if (this.engine.getSnapshot().victory) return;
    if (this.armedSkillId) {
      const skillId = this.armedSkillId;
      this.armedSkillId = null;
      const res = this.engine.useSkill(this.selectedUnit, skillId, dir);
      if (!res.ok) this.cameras.main.shake(80, 0.002);
    } else {
      const res = this.engine.moveUnit(this.selectedUnit, dir);
      if (!res.ok) this.cameras.main.shake(80, 0.002);
    }
    this.render();
  }

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------

  private selectUnit(index: number) {
    const unit = this.engine.getSnapshot().players[index];
    if (!unit || unit.hp <= 0) return;
    this.selectedUnit = index;
    this.armedSkillId = null;
    this.render();
  }

  private toggleSkill(skillIndex: number) {
    const unit = this.engine.getSnapshot().players[this.selectedUnit];
    if (!unit || unit.hp <= 0) return;
    const skillId = unit.skillIds[skillIndex];
    if (!skillId || unit.actionsUsed >= unit.maxActionPoints) return;
    this.armedSkillId = this.armedSkillId === skillId ? null : skillId;
    this.render();
  }

  private handleUndo() {
    this.engine.undo();
    this.armedSkillId = null;
    this.render();
  }

  private handleTileClick(x: number, y: number) {
    if (this.engine.getSnapshot().victory) return;
    const key = `${x},${y}`;

    if (this.armedSkillId) {
      const dir = this.targetable.get(key);
      if (!dir) return;
      const skillId = this.armedSkillId;
      this.armedSkillId = null;
      const res = this.engine.useSkill(this.selectedUnit, skillId, dir);
      if (!res.ok) this.cameras.main.shake(80, 0.002);
      this.render();
      return;
    }

    const path = this.reachable.get(key);
    if (!path) return;
    for (const dir of path) {
      const res = this.engine.moveUnit(this.selectedUnit, dir);
      if (!res.ok) {
        this.cameras.main.shake(80, 0.002);
        break;
      }
    }
    this.render();
  }

  private handleEndTurn() {
    if (this.engine.getSnapshot().victory) return;
    const before = this.engine.getSnapshot();
    this.engine.endTurn();
    const after = this.engine.getSnapshot();
    this.armedSkillId = null;

    if (after.lives < before.lives) {
      this.flashBanner(i18n.t('ui.defeat'));
    } else if (after.victory) {
      this.flashBanner(i18n.t('ui.game_complete'));
    }
    this.render();
  }

  private flashBanner(msg: string) {
    this.bannerText.setText(msg).setVisible(true);
    this.time.delayedCall(1400, () => this.bannerText.setVisible(false));
  }

  // ---------------------------------------------------------------------
  // Grid helpers (mirrors engine's own walkability rules for previewing)
  // ---------------------------------------------------------------------

  private isWallAt(x: number, y: number): boolean {
    const row = courtyardMap.grid[y];
    if (!row || x < 0 || x >= row.length) return true;
    return row[x] === '#';
  }

  private isOccupiedAt(x: number, y: number): boolean {
    const snap = this.engine.getSnapshot();
    return (
      snap.players.some((p) => p.hp > 0 && p.position.x === x && p.position.y === y) ||
      snap.monsters.some((m) => m.hp > 0 && m.position.x === x && m.position.y === y)
    );
  }

  /** BFS over remaining move budget; returns tile -> path (list of steps) for every reachable tile. */
  private computeReachable(unitIndex: number): Map<string, CardinalDir[]> {
    const result = new Map<string, CardinalDir[]>();
    const snap = this.engine.getSnapshot();
    const unit = snap.players[unitIndex];
    if (!unit || unit.hp <= 0) return result;
    const budget = unit.maxActionPoints - unit.actionsUsed;
    if (budget <= 0) return result;

    const start = unit.position;
    const queue: Array<{ x: number; y: number; path: CardinalDir[] }> = [{ ...start, path: [] }];
    const seen = new Set<string>([`${start.x},${start.y}`]);

    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur.path.length >= budget) continue;
      for (const dir of Object.keys(DIR_VECTORS) as CardinalDir[]) {
        const v = DIR_VECTORS[dir];
        const nx = cur.x + v.x;
        const ny = cur.y + v.y;
        const key = `${nx},${ny}`;
        if (seen.has(key) || this.isWallAt(nx, ny) || this.isOccupiedAt(nx, ny)) continue;
        seen.add(key);
        const path = [...cur.path, dir];
        result.set(key, path);
        queue.push({ x: nx, y: ny, path });
      }
    }
    return result;
  }

  /** Tiles a skill can be aimed at from the unit's current position: each cardinal ray up to range, stopping at walls. */
  private computeTargetable(unitIndex: number, skillId: string): Map<string, CardinalDir> {
    const result = new Map<string, CardinalDir>();
    const snap = this.engine.getSnapshot();
    const unit = snap.players[unitIndex];
    const skill = registry.skills[skillId];
    if (!unit || !skill) return result;

    if (skill.effects.every((e) => e.target === 'self')) {
      result.set(`${unit.position.x},${unit.position.y}`, 'down');
      return result;
    }

    for (const dir of Object.keys(DIR_VECTORS) as CardinalDir[]) {
      const v = DIR_VECTORS[dir];
      for (let step = 1; step <= skill.range; step++) {
        const x = unit.position.x + v.x * step;
        const y = unit.position.y + v.y * step;
        if (this.isWallAt(x, y)) break;
        result.set(`${x},${y}`, dir);
      }
    }
    return result;
  }

  private tileCenter(x: number, y: number): { px: number; py: number } {
    return { px: this.offsetX + x * TILE + TILE / 2, py: this.offsetY + y * TILE + TILE / 2 };
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  private render() {
    const snap = this.engine.getSnapshot();
    const selected = snap.players[this.selectedUnit];

    this.reachable = this.armedSkillId ? new Map() : this.computeReachable(this.selectedUnit);
    this.targetable = this.armedSkillId ? this.computeTargetable(this.selectedUnit, this.armedSkillId) : new Map();

    courtyardMap.grid.forEach((row, y) => {
      row.split('').forEach((_ch, x) => {
        const rect = this.tileHighlights[y][x];
        const key = `${x},${y}`;
        if (this.targetable.has(key)) {
          rect.setFillStyle(COLORS.targetable, 0.35);
        } else if (this.reachable.has(key)) {
          rect.setFillStyle(COLORS.reachable, 0.25);
        } else {
          rect.setFillStyle(0xffffff, 0);
        }
      });
    });

    snap.players.forEach((p, i) => {
      const { px, py } = this.tileCenter(p.position.x, p.position.y);
      this.playerSprites[i].setPosition(px, py).setAlpha(p.hp > 0 ? 1 : 0.25);
      const bar = this.playerHpBars[i];
      const ratio = Math.max(0, p.hp / p.maxHp);
      bar.setPosition(px, py + TILE / 2 - 10).setSize((TILE - 20) * ratio, 6);
      bar.setFillStyle(ratio > 0.34 ? COLORS.hpBarFill : COLORS.hpBarFillLow);
      const shieldIcon = this.playerShieldIcons[i];
      shieldIcon.setPosition(px + TILE / 2 - 12, py - TILE / 2 + 12).setVisible(p.shield > 0);
    });

    if (selected) {
      const { px, py } = this.tileCenter(selected.position.x, selected.position.y);
      this.selectionRing.setPosition(px, py).setVisible(true);
    }

    // A monster killed mid-turn keeps hp:0 in the engine until endTurn()
    // purges it (so its already-shown intent can be skipped) — treat it as
    // gone the instant it dies rather than leaving a lifeless sprite on screen.
    const livingMonsters = snap.monsters.filter((m) => m.hp > 0);
    const aliveIds = new Set(livingMonsters.map((m) => m.instanceId));
    for (const [id, sprite] of this.monsterSprites) {
      if (!aliveIds.has(id)) {
        sprite.destroy();
        this.monsterHpBars.get(id)?.destroy();
        this.monsterSprites.delete(id);
        this.monsterHpBars.delete(id);
      }
    }
    livingMonsters.forEach((m) => {
      const { px, py } = this.tileCenter(m.position.x, m.position.y);
      let sprite = this.monsterSprites.get(m.instanceId);
      if (!sprite) {
        const textureKey = registry.monsters[m.monsterId].spriteRef;
        sprite = this.add.image(0, 0, textureKey).setDisplaySize(TILE - 24, TILE - 24).setDepth(2);
        this.monsterSprites.set(m.instanceId, sprite);
      }
      sprite.setPosition(px, py);

      let bar = this.monsterHpBars.get(m.instanceId);
      if (!bar) {
        bar = this.add.rectangle(px, py, TILE - 30, 5, COLORS.hpBarFillLow).setDepth(2);
        this.monsterHpBars.set(m.instanceId, bar);
      }
      const ratio = Math.max(0, m.hp / m.maxHp);
      bar.setPosition(px, py - TILE / 2 + 10).setSize((TILE - 30) * ratio, 5);
    });

    this.intentMarkers.forEach((o) => o.destroy());
    this.intentMarkers = [];
    for (const intent of this.engine.getIntents()) {
      const m = livingMonsters.find((x) => x.instanceId === intent.instanceId);
      if (!m) continue;
      const { px, py } = this.tileCenter(m.position.x, m.position.y);
      let dir: CardinalDir | null = null;
      let color = '#8a8a9a';
      if (intent.kind === 'skill') {
        dir = intent.direction;
        color = '#ef4444';
      } else if (intent.to.x !== m.position.x || intent.to.y !== m.position.y) {
        if (intent.to.x > m.position.x) dir = 'right';
        else if (intent.to.x < m.position.x) dir = 'left';
        else if (intent.to.y > m.position.y) dir = 'down';
        else dir = 'up';
      }
      if (!dir) continue;
      const v = DIR_VECTORS[dir];
      const marker = this.add
        .text(px + v.x * (TILE / 2 - 4), py + v.y * (TILE / 2 - 4) - TILE / 2, DIR_ARROW[dir], {
          fontFamily: 'monospace',
          fontSize: '20px',
          color,
        })
        .setOrigin(0.5)
        .setDepth(2);
      this.intentMarkers.push(marker);
    }

    this.spawnPreviewMarkers.forEach((o) => o.destroy());
    this.spawnPreviewMarkers = [];
    if (livingMonsters.length === 0 && !snap.victory) {
      const nextWave = courtyardMap.waves[snap.waveIndex + 1];
      for (const spawn of nextWave?.monsters ?? []) {
        const { px, py } = this.tileCenter(spawn.spawn.x, spawn.spawn.y);
        const textureKey = registry.monsters[spawn.monsterId].spriteRef;
        const ghost = this.add
          .image(px, py, textureKey)
          .setDisplaySize(TILE - 24, TILE - 24)
          .setAlpha(0.4)
          .setDepth(2);
        this.spawnPreviewMarkers.push(ghost);
      }
    }

    const noActionsLeft = (selected?.actionsUsed ?? 0) >= (selected?.maxActionPoints ?? 0);
    this.skillButtons.forEach((btn, i) => {
      const skillId = selected?.skillIds[i];
      if (!skillId || noActionsLeft || (selected?.hp ?? 0) <= 0) {
        btn.bg.setFillStyle(COLORS.buttonBg, 0.4);
        btn.label.setText(skillId ? i18n.t(`skill.${skillId}.name`) : '');
        btn.bg.disableInteractive();
      } else {
        const armed = this.armedSkillId === skillId;
        btn.bg.setFillStyle(armed ? COLORS.buttonBgArmed : COLORS.buttonBg, 1);
        btn.label.setText(i18n.t(`skill.${skillId}.name`) + (armed ? ' ◀' : ''));
        btn.bg.setInteractive({ useHandCursor: true });
      }
    });
    this.undoButton.label.setText(i18n.t('ui.undo'));
    this.endTurnButton.label.setText(i18n.t('ui.end_turn'));

    if (livingMonsters.length === 0 && !snap.victory) {
      this.instructionText.setText(i18n.t('ui.wave_cleared_hint'));
    } else {
      this.instructionText.setText(
        i18n.t(this.armedSkillId ? 'ui.instruction_armed' : 'ui.instruction_idle'),
      );
    }

    const apText = selected
      ? `   ${i18n.t('ui.ap')} ${selected.maxActionPoints - selected.actionsUsed}/${selected.maxActionPoints}`
      : '';
    this.hudText.setText(
      `${i18n.t('map.courtyard.name')}   ${i18n.t('ui.wave')} ${snap.waveIndex + 1}/${courtyardMap.waves.length}   ${i18n.t('ui.lives')} ${snap.lives}   ${i18n.t('ui.turn')} ${snap.turnNumber}${apText}`,
    );

    if (snap.victory) {
      this.bannerText.setText(i18n.t('ui.game_complete')).setVisible(true);
    }
  }
}
