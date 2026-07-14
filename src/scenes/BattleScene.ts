import Phaser from 'phaser';
import { BattleEngine } from '../../core/battle/engine';
import type { CardinalDir } from '../../core/geometry';
import { I18n } from '../../core/i18n';
import en from '../../locales/en.json';
import zhTW from '../../locales/zh-TW.json';
import { STARTING_SQUAD, DEFAULT_MAP_ID, maps, registry } from '../../content/registry';
import type { EffectType, MapDef, SkillDef } from '../../core/content/types';
import type { BattleSnapshot, CombatTarget, RunOutcome, TurnEvent } from '../../core/battle/types';
import { levelSelectUrl } from './levelNav';

const EFFECT_ICON: Record<EffectType, string> = { damage: '⚔', push: '➜', shield: '🛡', heal: '✚' };

/** Every skill's numeric effects, exactly as the engine will apply them — e.g. "⚔2" or "⚔1 ➜2". */
function effectSummary(skill: SkillDef): string {
  return skill.effects.map((e) => `${EFFECT_ICON[e.type]}${e.amount}`).join(' ');
}

const TILE = 80;

const COLORS = {
  bg: 0x14141a,
  floor: 0x2a2a35,
  wall: 0x111116,
  hazard: 0x2e0a14,
  base: 0x6b4f14,
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

/** Phase 1 renders every actor as a text glyph instead of an image sprite — see design/roadmap.md ch.1/8. */
const HERO_GLYPHS = ['🤺', '🧙'];
const MONSTER_GLYPH = '👻'; // every Phase 1 monster is yin_ghost.
const BASE_GLYPH = '🏯';
const HAZARD_GLYPH = '▽';

/** Static Traditional-Chinese rules panel copy — placeholder-quality by design (Phase 1 is text-only, see roadmap ch.3). */
const RULES_PANEL_STATIC = [
  '【怎麼玩】',
  '',
  '守住左邊的『陣』🏯，別讓妖物 👻 打爆它。',
  '',
  '👻 頭上的箭頭是它下一步的動作，出手前就看得到。',
  '',
  '點角色→點亮起的格子移動；點技能→點目標施放。用『排雲掌』把妖物推開或推進深淵 ▽。',
  '',
  '俠客擋在妖物往陣的路上，妖物會改打俠客——用身體擋路要付出血量代價，要衡量值不值得。',
  '',
  '行動點 💧：每位俠客自己的一本帳，每回合 4 點——走一步花 1 點、技能費用標在按鈕上的『💧數字』，同一池點數，不分開算。',
  '',
  '行動點用完的俠客圖示會變暗，表示這回合他沒事可做了。',
  '',
  '鍵盤：方向鍵移動／瞄準、1・2 選技能、Q 換人、Z 重置本回合、Enter 結束回合。',
  '',
  '不用殺光——只要撐過每一波、陣還活著就贏。',
].join('\n');

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
  private map!: MapDef;
  private offsetX = 0;
  private offsetY = 0;

  private tileHighlights: Phaser.GameObjects.Rectangle[][] = [];
  private playerSprites: Phaser.GameObjects.Text[] = [];
  private playerHpBars: Phaser.GameObjects.Rectangle[] = [];
  private playerHpTexts: Phaser.GameObjects.Text[] = [];
  private playerApTexts: Phaser.GameObjects.Text[] = [];
  private playerShieldIcons: Phaser.GameObjects.Arc[] = [];
  private monsterSprites: Map<string, Phaser.GameObjects.Text> = new Map();
  private monsterHpBars: Map<string, Phaser.GameObjects.Rectangle> = new Map();
  private monsterHpTexts: Map<string, Phaser.GameObjects.Text> = new Map();
  private intentMarkers: Phaser.GameObjects.GameObject[] = [];
  private reachableCostMarkers: Phaser.GameObjects.GameObject[] = [];
  private damagePreviewMarkers: Phaser.GameObjects.GameObject[] = [];
  private spawnPreviewMarkers: Phaser.GameObjects.GameObject[] = [];
  private selectionRing!: Phaser.GameObjects.Rectangle;
  private baseHpText?: Phaser.GameObjects.Text;
  private rulesPanelText!: Phaser.GameObjects.Text;

  private hudText!: Phaser.GameObjects.Text;
  private instructionText!: Phaser.GameObjects.Text;
  private skillDescText!: Phaser.GameObjects.Text;
  private skillButtons: Button[] = [];
  private endTurnButton!: Button;
  private resetTurnButton!: Button;
  private resetLevelButton!: Button;
  private backToLevelSelectButton!: Button;
  private confirmButton!: Button;
  private outcomeOverlay!: Phaser.GameObjects.Rectangle;
  private outcomeText!: Phaser.GameObjects.Text;
  private lastWaveBanner!: Phaser.GameObjects.Text;

  private selectedUnit = 0;
  private armedSkillId: string | null = null;
  /** Set once the reminder banner has fired for this run — see render()'s isLastWave check. */
  private announcedLastWave = false;
  private reachable: Map<string, CardinalDir[]> = new Map();
  private targetable: Map<string, CardinalDir> = new Map();

  constructor() {
    super('BattleScene');
  }

  /**
   * Phaser scene-data hook — receives { mapId } from main.ts's boot-time
   * game.scene.start('BattleScene', { mapId }) when the URL names a level
   * (?map=...). Switching levels goes through a real page navigation (see
   * levelNav.ts), not a same-page scene.start() round-trip, so this only
   * ever runs once per page load in normal use — but the caches below are
   * still reset defensively: Phaser CAN reuse a scene instance across
   * restarts, and if that ever happens again, a fresh engine's monster
   * instanceIds collide with the previous run's (the spawn counter restarts
   * at 0 each time), so a stale map-keyed cache entry would get silently
   * reused instead of a fresh game object being created.
   */
  init(data: { mapId?: string }) {
    this.map = maps[data.mapId ?? DEFAULT_MAP_ID] ?? maps[DEFAULT_MAP_ID];
    this.tileHighlights = [];
    this.monsterSprites = new Map();
    this.monsterHpBars = new Map();
    this.monsterHpTexts = new Map();
    this.intentMarkers = [];
    this.reachableCostMarkers = [];
    this.damagePreviewMarkers = [];
    this.spawnPreviewMarkers = [];
    this.selectedUnit = 0;
    this.armedSkillId = null;
    this.announcedLastWave = false;
  }

  preload() {
    // Phase 1 renders every actor as a text glyph (see HERO_GLYPHS/MONSTER_GLYPH
    // above) instead of an image sprite — nothing to preload yet.
  }

  create() {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.engine = new BattleEngine(this.map, STARTING_SQUAD, registry);

    // Left-align the board so the right side has a wide column for the rules panel.
    this.offsetX = 40;
    this.offsetY = 80;

    this.drawStaticTiles();
    this.buildTileHighlights();

    this.selectionRing = this.add
      .rectangle(0, 0, TILE - 6, TILE - 6)
      .setStrokeStyle(3, COLORS.selected)
      .setFillStyle(0x000000, 0)
      .setDepth(2);

    const squad = this.engine.getSnapshot().players;
    this.playerSprites = squad.map((_p, i) => {
      const sprite = this.add
        .text(0, 0, HERO_GLYPHS[i] ?? '🧑', { fontSize: '40px' })
        .setOrigin(0.5)
        .setDepth(2)
        .setInteractive({ useHandCursor: true });
      sprite.on('pointerdown', () => {
        // A self-target skill's only valid tile IS the caster's own square,
        // which the sprite sits on top of — without this, clicking it while
        // armed just re-selects the unit and silently disarms the skill
        // instead of casting it (self-cast had no other way to click "yes").
        if (this.armedSkillId && i === this.selectedUnit) {
          const pos = this.engine.getSnapshot().players[i].position;
          this.handleTileClick(pos.x, pos.y);
        } else {
          this.selectUnit(i);
        }
      });
      return sprite;
    });
    this.playerHpBars = squad.map(() => this.add.rectangle(0, 0, TILE - 20, 6, COLORS.hpBarFill).setDepth(2));
    this.playerHpTexts = squad.map(() =>
      this.add
        .text(0, 0, '', { fontFamily: 'monospace', fontSize: '11px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 })
        .setOrigin(0.5)
        .setDepth(3),
    );
    this.playerApTexts = squad.map(() =>
      this.add
        .text(0, 0, '', { fontFamily: 'monospace', fontSize: '11px', color: '#4cc9f0', stroke: '#000000', strokeThickness: 3 })
        .setOrigin(0.5)
        .setDepth(3),
    );
    this.playerShieldIcons = squad.map(() =>
      this.add.circle(0, 0, 8, COLORS.shield).setDepth(2).setVisible(false),
    );

    this.hudText = this.add.text(20, 14, '', {
      fontFamily: 'monospace',
      fontSize: '17px',
      color: '#f1f1f6',
    });

    const boardCenterX = this.offsetX + (this.map.grid[0].length * TILE) / 2;
    this.instructionText = this.add
      .text(boardCenterX, this.offsetY - 34, '', {
        fontFamily: 'monospace',
        fontSize: '15px',
        color: '#c9c9d6',
        align: 'center',
      })
      .setOrigin(0.5, 0);

    this.rulesPanelText = this.add.text(this.offsetX + this.map.grid[0].length * TILE + 20, this.offsetY, '', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#c9c9d6',
      // useAdvancedWrap is required for CJK text: Phaser's wordWrap only ever
      // breaks on whitespace by default, and Chinese sentences have none —
      // without it, a long line silently overflows the box width instead of
      // wrapping, which reads as "text got clipped" at the panel's right edge.
      wordWrap: { width: this.scale.width - (this.offsetX + this.map.grid[0].length * TILE) - 40, useAdvancedWrap: true },
      lineSpacing: 4,
    });

    this.buildBottomButtons();
    this.buildOutcomeOverlay();
    this.setupKeyboard();
    this.render();
  }

  // ---------------------------------------------------------------------
  // Build (once)
  // ---------------------------------------------------------------------

  private drawStaticTiles() {
    const baseTileCenters: Array<{ px: number; py: number }> = [];
    this.map.grid.forEach((row, y) => {
      row.split('').forEach((ch, x) => {
        const { px, py } = this.tileCenter(x, y);
        const color = ch === '#' ? COLORS.wall : ch === '~' ? COLORS.hazard : ch === 'B' ? COLORS.base : COLORS.floor;
        this.add.rectangle(px, py, TILE - 2, TILE - 2, color);
        if (ch === '~') {
          this.add.text(px, py, HAZARD_GLYPH, { fontSize: '26px', color: '#ef4444' }).setOrigin(0.5).setDepth(1);
        }
        if (ch === 'B') baseTileCenters.push({ px, py });
      });
    });

    // One glyph + one shared HP label over the whole structure, not per-tile
    // — the base tiles must read as a single fortress, not separate cells.
    if (baseTileCenters.length > 0) {
      const cx = baseTileCenters.reduce((s, c) => s + c.px, 0) / baseTileCenters.length;
      const cy = baseTileCenters.reduce((s, c) => s + c.py, 0) / baseTileCenters.length;
      this.add.text(cx, cy - 8, BASE_GLYPH, { fontSize: '36px' }).setOrigin(0.5).setDepth(2);
      this.baseHpText = this.add
        .text(cx, cy + 30, '', {
          fontFamily: 'monospace',
          fontSize: '13px',
          color: '#ffd166',
          stroke: '#000000',
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(3);
    }
  }

  private buildTileHighlights() {
    this.map.grid.forEach((row, y) => {
      const rowArr: Phaser.GameObjects.Rectangle[] = [];
      row.split('').forEach((ch, x) => {
        const { px, py } = this.tileCenter(x, y);
        // Same footprint as the static tile rect (drawStaticTiles' TILE - 2) —
        // a smaller overlay left a permanent unpainted border where the
        // static color always showed through, which could look like a
        // leftover tint bleeding onto a tile that should be fully clear.
        const rect = this.add
          .rectangle(px, py, TILE - 2, TILE - 2, 0xffffff, 0)
          .setDepth(1);
        if (ch !== '#' && ch !== 'B') {
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
    const barY = this.scale.height - 92;
    this.skillButtons = [0, 1].map((i) =>
      this.makeButton(20 + i * 210, barY, 200, 40, () => this.toggleSkill(i)),
    );
    this.resetTurnButton = this.makeButton(this.scale.width - 340, barY, 150, 40, () => this.handleResetTurn());
    this.endTurnButton = this.makeButton(this.scale.width - 170, barY, 150, 40, () => this.handleEndTurn());
    // Full manual restart — always clickable, independent of resetTurn/endTurn
    // and of any pending outcome, so a player can bail out and start over
    // whenever they want, not just after losing.
    this.resetLevelButton = this.makeButton(this.scale.width - 290, 10, 130, 28, () => this.handleResetLevel());
    // Lets a playtester hop back to the level list — see LevelSelectScene /
    // design/roadmap.md ch.5. Goes through a real navigation (see levelNav.ts)
    // rather than scene.start(), which stopped routing pointer events after a
    // second start()/create() cycle in testing.
    this.backToLevelSelectButton = this.makeButton(this.scale.width - 150, 10, 130, 28, () => {
      window.location.href = levelSelectUrl();
    });

    this.skillDescText = this.add.text(20, barY + 46, '', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#9a9aa8',
      wordWrap: { width: this.scale.width - 40, useAdvancedWrap: true },
    });
  }

  /**
   * Frozen-result overlay (see design/roadmap.md ch.4 "Into the Breach 式失敗回饋"):
   * when a turn ends in a life lost / run over / win, endTurn() freezes the
   * board on that exact position instead of resetting it — this overlay sits
   * on top, blocks further play, and only confirmOutcome() (via the button
   * here) advances past it.
   */
  private buildOutcomeOverlay() {
    this.outcomeOverlay = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 0.55)
      .setOrigin(0, 0)
      .setDepth(10)
      .setVisible(false);
    this.outcomeText = this.add
      .text(this.scale.width / 2, this.scale.height / 2 - 40, '', {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#f1f1f6',
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(11)
      .setVisible(false);
    this.confirmButton = this.makeButton(
      this.scale.width / 2 - 90,
      this.scale.height / 2 + 20,
      180,
      44,
      () => this.handleConfirmOutcome(),
    );
    this.confirmButton.bg.setDepth(11).setVisible(false).disableInteractive();
    this.confirmButton.label.setDepth(12).setVisible(false);

    // One-shot reminder the instant the final wave arrives — the static
    // rules panel already explains "outlast the clock, no kill requirement,"
    // but that line sits in a wall of text at the start and players don't
    // carry it into the moment it actually matters. Doesn't block input
    // (unlike the outcome overlay); just a toast that fades on its own.
    this.lastWaveBanner = this.add
      .text(this.scale.width / 2, 150, '', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffd166',
        align: 'center',
        backgroundColor: '#1b1b22',
        padding: { x: 16, y: 10 },
      })
      .setOrigin(0.5)
      .setDepth(9)
      .setVisible(false);
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
          this.handleResetTurn();
          break;
        case 'Enter':
          this.handleEndTurn();
          break;
      }
    });
  }

  /** Arrow keys move one step, or fire an armed skill in that direction — mirrors clicking an adjacent highlighted tile. */
  private stepFromKeyboard(dir: CardinalDir) {
    if (this.engine.getSnapshot().outcome) return;
    if (this.armedSkillId) {
      const skillId = this.armedSkillId;
      this.armedSkillId = null;
      const res = this.engine.useSkill(this.selectedUnit, skillId, dir);
      if (!res.ok) this.cameras.main.shake(80, 0.002);
      else this.playHitFeedback(this.engine.getLastEvents());
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
    const skill = skillId ? registry.skills[skillId] : undefined;
    if (!skillId || !skill || unit.ap < skill.mpCost) return;
    this.armedSkillId = this.armedSkillId === skillId ? null : skillId;
    this.render();
  }

  private handleResetTurn() {
    this.engine.resetTurn();
    this.armedSkillId = null;
    this.render();
  }

  private handleTileClick(x: number, y: number) {
    if (this.engine.getSnapshot().outcome) return;
    const key = `${x},${y}`;

    if (this.armedSkillId) {
      const dir = this.targetable.get(key);
      if (!dir) {
        // Armed but clicked a tile the skill can't reach — same "that didn't
        // work" feedback as an engine-rejected action, so a miss never looks
        // like the click silently failed to register.
        this.cameras.main.shake(80, 0.002);
        return;
      }
      const skillId = this.armedSkillId;
      this.armedSkillId = null;
      const res = this.engine.useSkill(this.selectedUnit, skillId, dir);
      if (!res.ok) this.cameras.main.shake(80, 0.002);
      else this.playHitFeedback(this.engine.getLastEvents());
      this.render();
      return;
    }

    const path = this.reachable.get(key);
    if (!path) {
      this.cameras.main.shake(80, 0.002); // clicked a tile out of movement range
      return;
    }
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
    if (this.engine.getSnapshot().outcome) return;
    this.engine.endTurn();
    this.playHitFeedback(this.engine.getLastEvents());
    this.armedSkillId = null;
    this.render();
  }

  /** Advances past whatever endTurn() froze the board on — see buildOutcomeOverlay(). */
  private handleConfirmOutcome() {
    this.engine.confirmOutcome();
    this.armedSkillId = null;
    this.render();
  }

  private handleResetLevel() {
    this.engine.resetLevel();
    this.armedSkillId = null;
    this.render();
  }

  // ---------------------------------------------------------------------
  // Hit feedback (juice) — see design/roadmap.md ch.4 打擊感.
  // Turned engine.getLastEvents() into screen shake / floating numbers /
  // hit flash. Deliberately does NOT touch any number's underlying scale
  // (roadmap ch.5 decided against inflating damage values) — the punch is
  // entirely presentation, layered on top of the same small numbers.
  // ---------------------------------------------------------------------

  private playHitFeedback(events: TurnEvent[]) {
    if (events.length === 0) return;
    const snap = this.engine.getSnapshot();
    for (const event of events) {
      const pos = this.positionForCombatTarget(event.target, snap);
      if (!pos) continue;
      if (event.kind === 'damage') {
        if (event.blocked) {
          this.spawnFloatingText(pos, i18n.t('ui.blocked'), '#4cc9f0');
        } else if (event.amount > 0) {
          this.spawnFloatingText(pos, `-${event.amount}`, '#ff4d4d');
          this.flashSprite(event.target, 0xff6666);
          // Bigger hits shake harder — capped so a multi-hit combo turn
          // doesn't nauseate the camera. Small hits still get a token shake:
          // "did anything happen" should never be ambiguous.
          const intensity = Math.min(0.014, 0.0035 + event.amount * 0.0018);
          this.cameras.main.shake(140, intensity);
        }
      } else if (event.kind === 'shield') {
        this.spawnFloatingText(pos, `+${event.amount} 🛡`, '#4cc9f0');
      } else if (event.kind === 'heal') {
        this.spawnFloatingText(pos, `+${event.amount}`, '#70e000');
        this.flashSprite(event.target, 0x70e000);
      }
      // push: the position change itself is the feedback — no extra marker.
    }
  }

  private positionForCombatTarget(target: CombatTarget, snap: BattleSnapshot): { px: number; py: number } | null {
    if (target.kind === 'base') {
      const tiles = snap.baseTiles;
      if (tiles.length === 0) return null;
      const centers = tiles.map((t) => this.tileCenter(t.x, t.y));
      const px = centers.reduce((s, c) => s + c.px, 0) / centers.length;
      const py = centers.reduce((s, c) => s + c.py, 0) / centers.length;
      return { px, py: py - TILE / 2 - 8 };
    }
    if (target.kind === 'player') {
      const p = snap.players[target.unitIndex];
      if (!p) return null;
      const c = this.tileCenter(p.position.x, p.position.y);
      return { px: c.px, py: c.py - TILE / 2 - 8 };
    }
    // Monster targets: look up against the FULL list (not just hp>0), since
    // a damage event's own hit can be the one that just killed it — the
    // impact should still land at its last position, not silently vanish.
    const m = snap.monsters.find((x) => x.instanceId === target.instanceId);
    if (!m) return null;
    const c = this.tileCenter(m.position.x, m.position.y);
    return { px: c.px, py: c.py - TILE / 2 - 8 };
  }

  private flashSprite(target: CombatTarget, color: number) {
    let sprite: Phaser.GameObjects.Text | undefined;
    if (target.kind === 'player') sprite = this.playerSprites[target.unitIndex];
    else if (target.kind === 'monster') sprite = this.monsterSprites.get(target.instanceId);
    if (!sprite) return; // base has no single sprite to tint — shake/number alone carry it
    sprite.setTint(color);
    this.time.delayedCall(120, () => sprite?.clearTint());
  }

  private spawnFloatingText(pos: { px: number; py: number }, text: string, color: string) {
    const obj = this.add
      .text(pos.px, pos.py, text, {
        fontFamily: 'monospace',
        fontSize: '20px',
        color,
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(6);
    this.tweens.add({
      targets: obj,
      y: pos.py - 40,
      alpha: 0,
      duration: 700,
      ease: 'Cubic.Out',
      onComplete: () => obj.destroy(),
    });
  }

  // ---------------------------------------------------------------------
  // Grid helpers (mirrors engine's own walkability rules for previewing)
  // ---------------------------------------------------------------------

  /** A real wall or a base tile blocks movement / a skill's line of sight — a shot flies over a hazard tile. */
  private isWallAt(x: number, y: number): boolean {
    const row = this.map.grid[y];
    if (!row || x < 0 || x >= row.length) return true;
    return row[x] === '#' || row[x] === 'B';
  }

  private isHazardAt(x: number, y: number): boolean {
    const row = this.map.grid[y];
    if (!row || x < 0 || x >= row.length) return false;
    return row[x] === '~';
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
    const budget = unit.ap;
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
        if (seen.has(key) || this.isWallAt(nx, ny) || this.isHazardAt(nx, ny) || this.isOccupiedAt(nx, ny)) continue;
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
    const outcomePending = !!snap.outcome;

    this.reachable = this.armedSkillId ? new Map() : this.computeReachable(this.selectedUnit);
    this.targetable = this.armedSkillId ? this.computeTargetable(this.selectedUnit, this.armedSkillId) : new Map();

    this.reachableCostMarkers.forEach((o) => o.destroy());
    this.reachableCostMarkers = [];
    this.map.grid.forEach((row, y) => {
      row.split('').forEach((_ch, x) => {
        const rect = this.tileHighlights[y][x];
        const key = `${x},${y}`;
        if (this.targetable.has(key)) {
          rect.setFillStyle(COLORS.targetable, 0.35);
        } else if (this.reachable.has(key)) {
          rect.setFillStyle(COLORS.reachable, 0.25);
          // Steps to get here == AP it'll cost — the highlight alone answers
          // "can I get there," not "what will it cost me," and AP now pays
          // for skills too so spending it carelessly on distance bites later.
          const steps = this.reachable.get(key)!.length;
          const { px, py } = this.tileCenter(x, y);
          const cost = this.add
            .text(px, py, `${steps}`, {
              fontFamily: 'monospace',
              fontSize: '13px',
              color: '#4cc9f0',
              stroke: '#000000',
              strokeThickness: 3,
            })
            .setOrigin(0.5)
            .setDepth(1);
          this.reachableCostMarkers.push(cost);
        } else {
          rect.setFillStyle(0xffffff, 0);
        }
      });
    });

    snap.players.forEach((p, i) => {
      const { px, py } = this.tileCenter(p.position.x, p.position.y);
      // Dead → 0.25 (barely there). Alive but out of AP → 0.5 ("nothing left
      // to do this turn" — AP now pays for both movement and skills, so
      // ap===0 means truly nothing, not just "out of one of two resources").
      // Alive with AP left → fully lit.
      const alpha = p.hp <= 0 ? 0.25 : p.ap === 0 ? 0.5 : 1;
      this.playerSprites[i].setPosition(px, py).setAlpha(alpha);
      const bar = this.playerHpBars[i];
      const ratio = Math.max(0, p.hp / p.maxHp);
      bar.setPosition(px, py + TILE / 2 - 10).setSize((TILE - 20) * ratio, 6);
      bar.setFillStyle(ratio > 0.34 ? COLORS.hpBarFill : COLORS.hpBarFillLow);
      this.playerHpTexts[i].setPosition(px, py + TILE / 2 - 20).setText(`${Math.max(0, p.hp)}/${p.maxHp}`);
      this.playerApTexts[i]
        .setPosition(px - TILE / 2 + 14, py - TILE / 2 + 12)
        .setText(`${p.ap}/${p.maxAp}`)
        .setVisible(p.hp > 0);
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
        this.monsterHpTexts.get(id)?.destroy();
        this.monsterSprites.delete(id);
        this.monsterHpBars.delete(id);
        this.monsterHpTexts.delete(id);
      }
    }
    livingMonsters.forEach((m) => {
      const { px, py } = this.tileCenter(m.position.x, m.position.y);
      let sprite = this.monsterSprites.get(m.instanceId);
      if (!sprite) {
        sprite = this.add.text(0, 0, MONSTER_GLYPH, { fontSize: '36px' }).setOrigin(0.5).setDepth(2);
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

      let hpText = this.monsterHpTexts.get(m.instanceId);
      if (!hpText) {
        hpText = this.add
          .text(0, 0, '', { fontFamily: 'monospace', fontSize: '11px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 })
          .setOrigin(0.5)
          .setDepth(3);
        this.monsterHpTexts.set(m.instanceId, hpText);
      }
      hpText.setPosition(px, py - TILE / 2 + 20).setText(`${m.hp}/${m.maxHp}`);
    });

    this.intentMarkers.forEach((o) => o.destroy());
    this.intentMarkers = [];
    for (const intent of this.engine.getIntents()) {
      const m = livingMonsters.find((x) => x.instanceId === intent.instanceId);
      if (!m) continue;
      const { px, py } = this.tileCenter(m.position.x, m.position.y);
      let dir: CardinalDir | null = null;
      let color = '#8a8a9a';
      let label = '';
      if (intent.kind === 'skill') {
        dir = intent.direction;
        color = '#ef4444';
        const skill = registry.skills[intent.skillId];
        label = `${DIR_ARROW[dir]} ${skill ? effectSummary(skill) : ''}`.trim();
      } else if (intent.to.x !== m.position.x || intent.to.y !== m.position.y) {
        if (intent.to.x > m.position.x) dir = 'right';
        else if (intent.to.x < m.position.x) dir = 'left';
        else if (intent.to.y > m.position.y) dir = 'down';
        else dir = 'up';
        label = DIR_ARROW[dir];
        // Destination-tile outline — the arrow alone only says "which way,"
        // not "how far" or "does it actually get there" (a monster whose
        // path is currently blocked telegraphs a direction but won't move).
        const dest = this.tileCenter(intent.to.x, intent.to.y);
        const destMarker = this.add
          .rectangle(dest.px, dest.py, TILE - 14, TILE - 14)
          .setStrokeStyle(2, 0x8a8a9a, 0.8)
          .setFillStyle(0x000000, 0)
          .setDepth(1);
        this.intentMarkers.push(destMarker);
      }
      if (!dir) continue;
      const v = DIR_VECTORS[dir];
      const marker = this.add
        .text(px + v.x * (TILE / 2 - 4), py + v.y * (TILE / 2 - 4) - TILE / 2, label, {
          fontFamily: 'monospace',
          fontSize: '18px',
          color,
          stroke: '#000000',
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(2);
      this.intentMarkers.push(marker);
    }

    // Combined damage a target is about to take THIS turn, from however many
    // monsters are currently locked onto it (e.g. two ghosts each telegraphing
    // ⚔2 on the base show one "-4" here) — resolved live off the current
    // board, so it updates the instant a player's move changes a line of fire.
    // Suppressed once an outcome is frozen: currentIntents at that point
    // describes an attack that ALREADY happened (kept around so the intent
    // arrows still show what killed you), and re-previewing it as a future
    // "-N" would misleadingly imply it's still about to land.
    this.damagePreviewMarkers.forEach((o) => o.destroy());
    this.damagePreviewMarkers = [];
    for (const preview of outcomePending ? [] : this.engine.getAttackPreviews()) {
      // Preview targets are always alive (they're resolved live off currentIntents,
      // which only exist for hp>0 monsters), so the unfiltered lookup is safe here.
      const pos = this.positionForCombatTarget(preview.target, snap);
      if (!pos) continue;
      const marker = this.add
        .text(pos.px, pos.py, `-${preview.damage}`, {
          fontFamily: 'monospace',
          fontSize: '17px',
          color: '#ff4d4d',
          stroke: '#000000',
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setDepth(4);
      this.damagePreviewMarkers.push(marker);
    }

    this.spawnPreviewMarkers.forEach((o) => o.destroy());
    this.spawnPreviewMarkers = [];
    if (livingMonsters.length === 0 && !snap.outcome) {
      const nextWave = this.map.waves[snap.waveIndex + 1];
      for (const spawn of nextWave?.monsters ?? []) {
        const { px, py } = this.tileCenter(spawn.spawn.x, spawn.spawn.y);
        const ghost = this.add
          .text(px, py, MONSTER_GLYPH, { fontSize: '36px' })
          .setOrigin(0.5)
          .setAlpha(0.4)
          .setDepth(2);
        this.spawnPreviewMarkers.push(ghost);
      }
    }

    this.skillButtons.forEach((btn, i) => {
      const skillId = selected?.skillIds[i];
      const skill = skillId ? registry.skills[skillId] : undefined;
      const unitAlive = (selected?.hp ?? 0) > 0;
      // Distinguished from "unit dead" / "no skill" so a player can tell
      // "not enough Qi" apart from a click that simply didn't land.
      const notEnoughAp = !!skill && unitAlive && selected!.ap < skill.mpCost;
      const nameWithStats = skill
        ? `${i18n.t(`skill.${skillId}.name`)} ${effectSummary(skill)} 💧${skill.mpCost}`
        : '';
      const label = notEnoughAp ? `${nameWithStats}\n${i18n.t('ui.not_enough_ap')}` : nameWithStats;
      if (!skillId || notEnoughAp || !unitAlive || outcomePending) {
        btn.bg.setFillStyle(COLORS.buttonBg, 0.4);
        btn.label.setText(label);
        btn.bg.disableInteractive();
      } else {
        const armed = this.armedSkillId === skillId;
        btn.bg.setFillStyle(armed ? COLORS.buttonBgArmed : COLORS.buttonBg, 1);
        btn.label.setText(nameWithStats + (armed ? ' ◀' : ''));
        btn.bg.setInteractive({ useHandCursor: true });
      }
    });
    this.resetTurnButton.label.setText(i18n.t('ui.reset_turn'));
    this.endTurnButton.label.setText(i18n.t('ui.end_turn'));
    this.resetLevelButton.label.setText(i18n.t('ui.reset_level'));
    this.backToLevelSelectButton.label.setText(i18n.t('ui.select_level'));
    [this.resetTurnButton, this.endTurnButton].forEach((btn) => {
      btn.bg.setFillStyle(COLORS.buttonBg, outcomePending ? 0.4 : 1);
      if (outcomePending) btn.bg.disableInteractive();
      else btn.bg.setInteractive({ useHandCursor: true });
    });

    this.skillDescText.setText(
      (selected?.skillIds ?? [])
        .map((id, i) => `${i + 1}. ${i18n.t(`skill.${id}.desc`)}`)
        .join('    '),
    );

    if (livingMonsters.length === 0 && !snap.outcome) {
      this.instructionText.setText(i18n.t('ui.wave_cleared_hint'));
    } else {
      this.instructionText.setText(
        i18n.t(this.armedSkillId ? 'ui.instruction_armed' : 'ui.instruction_idle'),
      );
    }

    const isLastWave = snap.waveIndex === this.map.waves.length - 1;
    if (isLastWave && !this.announcedLastWave) {
      this.announcedLastWave = true;
      this.lastWaveBanner.setText(i18n.t('ui.last_wave_reminder')).setVisible(true);
      this.time.delayedCall(3000, () => this.lastWaveBanner.setVisible(false));
    }
    // The last wave's countdown IS the win condition (outlast it with the
    // base alive, no kill requirement) — hiding the number here was the bug:
    // a player watching "撐住" with no digits has no way to see victory
    // coming, so it reads as sudden/arbitrary instead of an outlastable clock.
    const waveCountdown = isLastWave
      ? `${i18n.t('ui.last_wave_hold')} ${snap.turnsLeftInWave} ${i18n.t('ui.turns_suffix')}`
      : `${i18n.t('ui.next_wave_in')} ${snap.turnsLeftInWave} ${i18n.t('ui.turns_suffix')}`;

    this.hudText.setText(
      `${i18n.t(this.map.nameKey)}   ${i18n.t('ui.base_hp')} ${snap.baseHp}/${snap.baseMaxHp}   ${i18n.t('ui.wave')} ${snap.waveIndex + 1}/${this.map.waves.length}   ${waveCountdown}   ${i18n.t('ui.turn')} ${snap.turnNumber}`,
    );

    this.baseHpText?.setText(`${snap.baseHp}/${snap.baseMaxHp}`);

    const selectedAp = selected ? `${selected.ap}/${selected.maxAp}` : '-';
    const liveStatus = [
      `${i18n.t('ui.base_hp')} ${snap.baseHp}/${snap.baseMaxHp}`,
      `${i18n.t('ui.wave')} ${snap.waveIndex + 1}/${this.map.waves.length}`,
      waveCountdown,
      `AP ${selectedAp}`,
    ].join('\n');
    this.rulesPanelText.setText(`${RULES_PANEL_STATIC}\n\n${liveStatus}`);

    const OUTCOME_KEY: Record<RunOutcome, string> = {
      defeat: 'ui.outcome_defeat',
      victory: 'ui.outcome_victory',
    };
    this.outcomeOverlay.setVisible(outcomePending);
    this.outcomeText.setVisible(outcomePending);
    this.confirmButton.bg.setVisible(outcomePending);
    this.confirmButton.label.setVisible(outcomePending);
    if (snap.outcome) {
      this.outcomeText.setText(i18n.t(OUTCOME_KEY[snap.outcome]));
      this.confirmButton.label.setText(i18n.t('ui.confirm'));
      this.confirmButton.bg.setInteractive({ useHandCursor: true });
    } else {
      this.confirmButton.bg.disableInteractive();
    }
  }
}
