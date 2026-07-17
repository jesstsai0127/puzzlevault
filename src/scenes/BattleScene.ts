import Phaser from 'phaser';
import { BattleEngine } from '../../core/battle/engine';
import type { CardinalDir } from '../../core/geometry';
import { I18n } from '../../core/i18n';
import en from '../../locales/en.json';
import zhTW from '../../locales/zh-TW.json';
import { STARTING_SQUAD, DEFAULT_MAP_ID, LESSON_MAP_IDS, maps, registry } from '../../content/registry';
import type { EffectType, MapDef, SkillDef } from '../../core/content/types';
import type { BattleSnapshot, CombatTarget, RunOutcome, TurnEvent } from '../../core/battle/types';
import { levelSelectUrl, tutorialStepUrl } from './levelNav';

const EFFECT_ICON: Record<EffectType, string> = { damage: '⚔', push: '➜', shield: '🛡', heal: '✚', taunt: '👁' };

/**
 * ITB alignment (2026-07-16 定案): the Ultimate system is shelved — not
 * deleted — while the game is brought rule-for-rule in line with Into the
 * Breach. Engine logic (ultimateUsed, useSkill's ultimate path) stays live
 * and tested; only this UI entry point is hidden. Flip to true in the
 * post-alignment optimization phase to bring the button back.
 */
const ULTIMATES_ENABLED = false;

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
  poisonMist: 0x1f2e14,
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
  // Ultimate button: deliberately gold/high-contrast against the regular
  // skill buttons above so a player recognizes it as a different KIND of
  // action (once-per-level, high cost) at a glance, not just "another skill".
  ultimateBg: 0x4a3a10,
  ultimateBgArmed: 0x8a6a10,
  ultimateBorder: 0xffd700,
};

/** Phase 1 renders every actor as a text glyph instead of an image sprite — see design/roadmap.md ch.1/8. */
const HERO_GLYPHS = ['🤺', '🧙', '💉'];
const MONSTER_GLYPH = '👻'; // every Phase 1 monster is yin_ghost.
const BASE_GLYPH = '🏯';
const HAZARD_GLYPH = '▽';
const POISON_MIST_GLYPH = '☠';
const EMERGENCE_GLYPH = '⚠';

/** Static Traditional-Chinese rules panel copy — placeholder-quality by design (Phase 1 is text-only, see roadmap ch.3). */
const RULES_PANEL_STATIC = [
  '【怎麼玩】',
  '',
  '守住左邊的『陣』🏯，別讓妖物 👻 打爆它。',
  '',
  '👻 頭上的箭頭是它下一步的動作，出手前就看得到。',
  '',
  '每位俠客每回合：先移動、再做一個動作。移動一次走完（點亮起的格子，最遠走到自己的移動力）；動作是技能或『調息』擇一，做完這回合就結束。',
  '',
  '順序固定：先移動後動作——出手之後就不能再走位了。移動或動作也都可以放棄不做。',
  '',
  '『調息』：不出招，原地回 1 點血（不超過上限）。任何俠客都會，跟技能一樣算掉這回合的動作。',
  '',
  '點角色→點亮起的格子移動；點技能→點目標施放。用『排雲掌』把妖物推開或推進深淵 ▽。',
  '',
  '俠客擋在妖物往陣的路上，妖物會改打俠客——用身體擋路要付出血量代價，要衡量值不值得。',
  '',
  '做完動作的俠客圖示會變暗，表示這回合他沒事可做了。',
  '',
  '『重置本回合』整關只能用一次——用掉之後按鈕變灰，每一步都要想清楚再走。',
  '',
  '鍵盤：方向鍵規劃路線、空白鍵確認移動、Esc 取消、1・2・3 選技能（再按方向鍵瞄準）、R 調息、Q 換人、Z 重置本回合、Enter 結束回合。',
  '',
  '地上發光 ⚠ 的格子下一回合會鑽出新妖物；站上去可以堵住，自己吃 1 點傷但妖物不會出現。',
  '',
  '這關要撐過固定回合數，陣還活著就贏——不用殺光所有妖物。',
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
  private playerShieldIcons: Phaser.GameObjects.Arc[] = [];
  private monsterSprites: Map<string, Phaser.GameObjects.Text> = new Map();
  private monsterHpBars: Map<string, Phaser.GameObjects.Rectangle> = new Map();
  private monsterHpTexts: Map<string, Phaser.GameObjects.Text> = new Map();
  private intentMarkers: Phaser.GameObjects.GameObject[] = [];
  private pendingPathMarkers: Phaser.GameObjects.GameObject[] = [];
  private damagePreviewMarkers: Phaser.GameObjects.GameObject[] = [];
  private emergenceMarkers: Phaser.GameObjects.GameObject[] = [];
  private selectionRing!: Phaser.GameObjects.Rectangle;
  private baseHpText?: Phaser.GameObjects.Text;
  private rulesPanelText!: Phaser.GameObjects.Text;
  private rulesPanelContainer!: Phaser.GameObjects.Container;
  private rulesPanelBounds = { x: 0, y: 0, width: 0, height: 0 };
  private rulesPanelMaxScroll = 0;

  private hudText!: Phaser.GameObjects.Text;
  private instructionText!: Phaser.GameObjects.Text;
  private skillDescText!: Phaser.GameObjects.Text;
  private skillButtons: Button[] = [];
  private restButton!: Button;
  /** Only built when ULTIMATES_ENABLED — the whole Ultimate system is shelved during ITB alignment (see the flag's doc comment). */
  private ultimateButton?: Button;
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
  /**
   * Keyboard move planning: the engine now takes a whole move as ONE
   * committed destination (moveUnit(unitIndex, to)), so arrow keys can't
   * fire a step each anymore — a keyboard player would burn their entire
   * move phase on a single tile. Instead the arrows ACCUMULATE a path
   * (each step validated against the same BFS-reachable set the mouse
   * highlight uses; pressing back along the path pops a step), rendered as
   * an outline trail, and Space commits the destination in one moveUnit()
   * call — mirroring the mouse's click-a-destination interaction instead
   * of crippling it. Cleared on select/skill/reset/endTurn/commit.
   */
  private pendingSteps: Array<{ x: number; y: number }> = [];
  /** ITB alignment (2026-07-17): set when this map is being played as a step of the standalone tutorial sequence (LESSON_MAP_IDS) — see handleConfirmOutcome()'s auto-advance. Undefined for every normal level. */
  private tutorialIndex?: number;

  constructor() {
    super('BattleScene');
  }

  /**
   * Phaser scene-data hook — receives { mapId, tutorialIndex? } from main.ts's
   * boot-time game.scene.start('BattleScene', ...) when the URL names a level
   * (?map=...) and, for a tutorial step, an index (?tutorial=...). Switching
   * levels goes through a real page navigation (see levelNav.ts), not a
   * same-page scene.start() round-trip, so this only ever runs once per page
   * load in normal use — but the caches below are still reset defensively:
   * Phaser CAN reuse a scene instance across restarts, and if that ever
   * happens again, a fresh engine's monster instanceIds collide with the
   * previous run's (the spawn counter restarts at 0 each time), so a stale
   * map-keyed cache entry would get silently reused instead of a fresh game
   * object being created.
   */
  init(data: { mapId?: string; tutorialIndex?: number }) {
    this.map = maps[data.mapId ?? DEFAULT_MAP_ID] ?? maps[DEFAULT_MAP_ID];
    this.tutorialIndex = data.tutorialIndex;
    this.tileHighlights = [];
    this.monsterSprites = new Map();
    this.monsterHpBars = new Map();
    this.monsterHpTexts = new Map();
    this.intentMarkers = [];
    this.pendingPathMarkers = [];
    this.damagePreviewMarkers = [];
    this.emergenceMarkers = [];
    this.selectedUnit = 0;
    this.armedSkillId = null;
    this.pendingSteps = [];
    this.announcedLastWave = false;
  }

  preload() {
    // Phase 1 renders every actor as a text glyph (see HERO_GLYPHS/MONSTER_GLYPH
    // above) instead of an image sprite — nothing to preload yet.
  }

  create() {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    // A map can declare its own squad (e.g. demo4's 3-hero roster) — falls
    // back to the game's default 2-hero squad when it doesn't, so existing
    // maps need no changes. See MapDef.squadCharacterIds.
    this.engine = new BattleEngine(this.map, this.map.squadCharacterIds ?? STARTING_SQUAD, registry);

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

    this.buildRulesPanel();

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
        const color =
          ch === '#'
            ? COLORS.wall
            : ch === '~'
              ? COLORS.hazard
              : ch === '*'
                ? COLORS.poisonMist
                : ch === 'B'
                  ? COLORS.base
                  : COLORS.floor;
        this.add.rectangle(px, py, TILE - 2, TILE - 2, color);
        if (ch === '~') {
          this.add.text(px, py, HAZARD_GLYPH, { fontSize: '26px', color: '#ef4444' }).setOrigin(0.5).setDepth(1);
        }
        if (ch === '*') {
          this.add.text(px, py, POISON_MIST_GLYPH, { fontSize: '24px', color: '#8fbf5a' }).setOrigin(0.5).setDepth(1);
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

  /**
   * The rules panel's content grows with a map's hintKey plus the live
   * status block appended every render() call, and the design canvas is a
   * fixed 1200x720 — a canvas has no native scrolling, so text that outgrows
   * the panel's box used to just render past the bottom edge of the canvas
   * and become permanently invisible (no amount of page-scrolling helps,
   * since it's not DOM content). Fix: mask the panel to a fixed rectangle
   * that stops short of the bottom button bar, and let the mouse wheel pan
   * the text within it.
   */
  private buildRulesPanel() {
    const panelX = this.offsetX + this.map.grid[0].length * TILE + 20;
    const panelY = this.offsetY;
    const panelWidth = this.scale.width - panelX - 20;
    // Stops above the bottom button bar (barY = scale.height - 92) with a
    // gap so the panel's mask edge never visually collides with it.
    const panelHeight = this.scale.height - 92 - 20 - panelY;
    this.rulesPanelBounds = { x: panelX, y: panelY, width: panelWidth, height: panelHeight };

    this.rulesPanelText = this.add.text(0, 0, '', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#c9c9d6',
      // useAdvancedWrap is required for CJK text: Phaser's wordWrap only ever
      // breaks on whitespace by default, and Chinese sentences have none —
      // without it, a long line silently overflows the box width instead of
      // wrapping, which reads as "text got clipped" at the panel's right edge.
      wordWrap: { width: panelWidth - 20, useAdvancedWrap: true },
      lineSpacing: 4,
    });

    this.rulesPanelContainer = this.add.container(panelX, panelY, [this.rulesPanelText]);

    // A graphics object used purely as a mask shape — created with add:false
    // so it never itself renders (a visible mask shape would paint an extra
    // rectangle on top of the panel).
    const maskShape = this.make.graphics({ x: 0, y: 0 }, false);
    maskShape.fillStyle(0xffffff);
    maskShape.fillRect(panelX, panelY, panelWidth, panelHeight);
    this.rulesPanelContainer.setMask(maskShape.createGeometryMask());

    // Faint scroll hint so a player with overflowing content (a lesson-level
    // hint pushes the panel past one screen) knows scrolling is possible
    // instead of assuming the text is simply cut off.
    this.add
      .text(panelX + panelWidth - 4, panelY - 18, '↕ 滾輪捲動', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#6a6a78',
      })
      .setOrigin(1, 0);

    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      const b = this.rulesPanelBounds;
      if (pointer.x < b.x || pointer.x > b.x + b.width || pointer.y < b.y || pointer.y > b.y + b.height) return;
      const nextY = Phaser.Math.Clamp(this.rulesPanelText.y - dy * 0.6, -this.rulesPanelMaxScroll, 0);
      this.rulesPanelText.y = nextY;
    });
  }

  private buildBottomButtons() {
    const barY = this.scale.height - 92;
    // Button count is driven by whichever squad member on THIS map carries
    // the most skills, not hardcoded to 2 — a 3-hero map like demo4 has a
    // healer whose 2 skills still fit, but a future roster with more per
    // character shouldn't need this touched again. Floors at 2 so an
    // all-1-skill roster still shows the layout every other map expects.
    const squad = this.engine.getSnapshot().players;
    const skillButtonCount = Math.max(2, ...squad.map((p) => p.skillIds.length));
    this.skillButtons = Array.from({ length: skillButtonCount }, (_, i) =>
      this.makeButton(20 + i * 210, barY, 200, 40, () => this.toggleSkill(i)),
    );
    // The built-in rest action ("調息", ITB's repair): shared by every
    // character, so it lives right after the per-character skill buttons.
    // Narrower than a skill button — its label is a fixed short verb.
    this.restButton = this.makeButton(20 + skillButtonCount * 210 + 10, barY, 140, 40, () => this.handleRest());
    if (ULTIMATES_ENABLED) {
      // Placed after the rest button, before the reset/end-turn buttons on
      // the right, so it never collides regardless of how many ordinary
      // skills a character has. Gold border (see COLORS.ultimateBorder) is
      // the visual cue that sets it apart from a normal skill button.
      this.ultimateButton = this.makeButton(20 + skillButtonCount * 210 + 160, barY, 200, 40, () =>
        this.toggleUltimate(),
      );
      this.ultimateButton.bg.setStrokeStyle(3, COLORS.ultimateBorder);
    }
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
        case '3':
          this.toggleSkill(2);
          break;
        case ' ':
          this.commitPendingMove();
          break;
        case 'r':
        case 'R':
          this.handleRest();
          break;
        case 'q':
        case 'Q':
          this.selectNextUnit();
          break;
        case 'z':
        case 'Z':
          this.handleResetTurn();
          break;
        case 'Escape':
          this.pendingSteps = [];
          this.armedSkillId = null;
          this.render();
          break;
        case 'Enter':
          this.handleEndTurn();
          break;
      }
    });
  }

  /**
   * Arrow keys: fire an armed skill in that direction, or EXTEND the pending
   * move path by one tile (Space commits it — see the pendingSteps doc
   * comment for why keyboard movement plans-then-commits instead of moving
   * per keypress). Pressing back onto the previous path tile pops a step,
   * so a mis-planned route is walked back key by key, no Escape needed.
   */
  private stepFromKeyboard(dir: CardinalDir) {
    if (this.engine.getSnapshot().outcome) return;
    if (this.armedSkillId) {
      const skillId = this.armedSkillId;
      this.armedSkillId = null;
      const res = this.engine.useSkill(this.selectedUnit, skillId, dir);
      if (!res.ok) this.cameras.main.shake(80, 0.002);
      else this.playHitFeedback(this.engine.getLastEvents());
      this.render();
      return;
    }

    const unit = this.engine.getSnapshot().players[this.selectedUnit];
    if (!unit || unit.hp <= 0 || unit.moved || unit.acted) {
      this.cameras.main.shake(80, 0.002);
      return;
    }
    const cur = this.pendingSteps.length > 0 ? this.pendingSteps[this.pendingSteps.length - 1] : unit.position;
    const v = DIR_VECTORS[dir];
    const next = { x: cur.x + v.x, y: cur.y + v.y };

    // Backtrack: stepping onto the previous tile of the planned path (or
    // back onto the unit itself from the first step) pops the last step.
    const prev = this.pendingSteps.length > 1 ? this.pendingSteps[this.pendingSteps.length - 2] : unit.position;
    if (this.pendingSteps.length > 0 && next.x === prev.x && next.y === prev.y) {
      this.pendingSteps.pop();
      this.render();
      return;
    }

    const key = `${next.x},${next.y}`;
    const alreadyOnPath = this.pendingSteps.some((p) => p.x === next.x && p.y === next.y);
    if (!this.reachable.has(key) || alreadyOnPath || this.pendingSteps.length >= unit.moveRange) {
      this.cameras.main.shake(80, 0.002); // out of range / revisiting / budget spent
      return;
    }
    this.pendingSteps.push(next);
    this.render();
  }

  /** Space: commit the keyboard-planned path as one whole move — the engine only sees the destination, same as a mouse click. */
  private commitPendingMove() {
    if (this.pendingSteps.length === 0) return;
    const dest = this.pendingSteps[this.pendingSteps.length - 1];
    this.pendingSteps = [];
    const res = this.engine.moveUnit(this.selectedUnit, dest);
    if (!res.ok) this.cameras.main.shake(80, 0.002);
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
    this.pendingSteps = [];
    this.render();
  }

  /** Cycles to the next LIVING squad member, wrapping around — a squad of 3+ with a fallen hero in the middle can't just flip index 0/1 forever like a 2-hero squad could. */
  private selectNextUnit() {
    const players = this.engine.getSnapshot().players;
    for (let step = 1; step <= players.length; step++) {
      const candidate = (this.selectedUnit + step) % players.length;
      if (players[candidate]?.hp > 0) {
        this.selectUnit(candidate);
        return;
      }
    }
  }

  private toggleSkill(skillIndex: number) {
    const unit = this.engine.getSnapshot().players[this.selectedUnit];
    if (!unit || unit.hp <= 0) return;
    const skillId = unit.skillIds[skillIndex];
    const skill = skillId ? registry.skills[skillId] : undefined;
    if (!skillId || !skill || unit.acted) return; // acting once per turn is the only gate — skills have no cost of their own anymore
    this.armedSkillId = this.armedSkillId === skillId ? null : skillId;
    this.pendingSteps = [];
    this.render();
  }

  /** Arms the selected unit's Ultimate (CharacterDef.ultimateSkillId) — mirrors toggleSkill(), gated additionally on ultimateUsed (this level run only allows one cast). Unreachable while ULTIMATES_ENABLED is false (the button is never built). */
  private toggleUltimate() {
    const unit = this.engine.getSnapshot().players[this.selectedUnit];
    if (!unit || unit.hp <= 0) return;
    const charDef = registry.characters[unit.characterId];
    const skillId = charDef?.ultimateSkillId;
    const skill = skillId ? registry.skills[skillId] : undefined;
    if (!skillId || !skill || unit.acted || unit.ultimateUsed) return;
    this.armedSkillId = this.armedSkillId === skillId ? null : skillId;
    this.pendingSteps = [];
    this.render();
  }

  /** The built-in rest action ("調息"): self-heal 1, spends the unit's one action — no arming/aiming step, it fires immediately. */
  private handleRest() {
    if (this.engine.getSnapshot().outcome) return;
    const res = this.engine.rest(this.selectedUnit);
    if (!res.ok) {
      this.cameras.main.shake(80, 0.002);
    } else {
      this.playHitFeedback(this.engine.getLastEvents());
    }
    this.armedSkillId = null;
    this.pendingSteps = [];
    this.render();
  }

  private handleResetTurn() {
    this.engine.resetTurn();
    this.armedSkillId = null;
    this.pendingSteps = [];
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

    if (!this.reachable.has(key)) {
      this.cameras.main.shake(80, 0.002); // clicked a tile out of movement range
      return;
    }
    // One committed move: the engine validates BFS reachability itself and
    // the whole path is walked in a single call — there is no per-step
    // movement (and no opportunity attacks) under the ITB action economy.
    const res = this.engine.moveUnit(this.selectedUnit, { x, y });
    if (!res.ok) this.cameras.main.shake(80, 0.002);
    this.pendingSteps = [];
    this.render();
  }

  private handleEndTurn() {
    if (this.engine.getSnapshot().outcome) return;
    this.engine.endTurn();
    this.playHitFeedback(this.engine.getLastEvents());
    this.armedSkillId = null;
    this.pendingSteps = [];
    this.render();
  }

  /**
   * Advances past whatever endTurn() froze the board on — see
   * buildOutcomeOverlay(). ITB alignment (2026-07-17): a tutorial-sequence
   * win auto-advances to the next step (or back to level select after the
   * last one) instead of just resetting this same map — read BEFORE calling
   * engine.confirmOutcome(), since that call clears the outcome.
   */
  private handleConfirmOutcome() {
    const outcome = this.engine.getSnapshot().outcome;
    if (this.tutorialIndex !== undefined && outcome === 'victory') {
      const nextIndex = this.tutorialIndex + 1;
      window.location.href =
        nextIndex < LESSON_MAP_IDS.length ? tutorialStepUrl(LESSON_MAP_IDS, nextIndex) : levelSelectUrl();
      return;
    }
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
        } else if (event.amount === 0) {
          // A percent-damage hit floored to 0 (fizzle) — deliberately loud,
          // not silent: the cast DID land and DID spend AP, so showing
          // nothing would read as "did my click even register?". A muted
          // gray "no effect" marker (visually distinct from the bright
          // blue shield block) tells the player the skill connected but
          // this target is too small for percent damage to bite.
          this.spawnFloatingText(pos, i18n.t('ui.no_effect'), '#8d99ae');
        } else {
          this.spawnFloatingText(pos, `-${event.amount}`, '#ff4d4d');
          this.flashSprite(event.target, 0xff6666);
          // Bigger hits shake harder — capped so a multi-hit combo turn
          // doesn't nauseate the camera. Small hits still get a token shake:
          // "did anything happen" should never be ambiguous.
          const intensity = Math.min(0.014, 0.0035 + event.amount * 0.0018);
          this.cameras.main.shake(140, intensity);
        }
      } else if (event.kind === 'shield') {
        if (event.amount === 0) {
          // Cast landed on a unit already at the shield cap — same "loud
          // no-op" treatment as the percent-damage fizzle above: the player
          // spent resources, so silence would read as a dropped click.
          this.spawnFloatingText(pos, i18n.t('ui.no_effect'), '#8d99ae');
        } else {
          this.spawnFloatingText(pos, `+${event.amount} 🛡`, '#4cc9f0');
        }
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

  /** BFS over the unit's moveRange; returns tile -> path (list of steps) for every reachable tile. Empty once the unit has moved or acted (movement strictly precedes the one action). */
  private computeReachable(unitIndex: number): Map<string, CardinalDir[]> {
    const result = new Map<string, CardinalDir[]>();
    const snap = this.engine.getSnapshot();
    const unit = snap.players[unitIndex];
    if (!unit || unit.hp <= 0 || unit.moved || unit.acted) return result;
    const budget = unit.moveRange;

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

    // Directionless modes: 'self' (existing) plus the three whole-field
    // Ultimate modes (allEnemies/allUnits/allAllies) — none of these need an
    // aim, so arming the skill just needs a single confirmable tile. The
    // caster's own tile is the natural, always-reachable choice, same as
    // the existing self-cast convention (e.g. heavy_shield).
    const NO_AIM_MODES = new Set(['self', 'allEnemies', 'allUnits', 'allAllies']);
    if (skill.effects.every((e) => NO_AIM_MODES.has(e.target))) {
      result.set(`${unit.position.x},${unit.position.y}`, 'down');
      return result;
    }

    // A heal skill's engine-side resolveTarget() only ever lands on a living
    // ally (see engine.ts's `targetsAllies` search) — never a monster. Mirror
    // that restriction here so a player can't even AIM a heal at a direction
    // that has no ally in it (which would either hit nothing or, if the UI
    // didn't restrict it, look aimable at a monster it can never actually
    // reach). Only the tiles up to and including the first living ally in
    // each direction are offered — same "any tile in this direction fires
    // the same way" convention as every other skill, just bounded to where
    // the ally actually is instead of the skill's full nominal range.
    const isHeal = skill.effects.some((e) => e.type === 'heal');
    if (isHeal) {
      for (const dir of Object.keys(DIR_VECTORS) as CardinalDir[]) {
        const v = DIR_VECTORS[dir];
        const tilesThisDir: Array<{ x: number; y: number }> = [];
        let allyFound = false;
        for (let step = 1; step <= skill.range; step++) {
          const x = unit.position.x + v.x * step;
          const y = unit.position.y + v.y * step;
          if (this.isWallAt(x, y)) break;
          tilesThisDir.push({ x, y });
          // A monster standing in the way doesn't block a heal ray, same as
          // hazard terrain doesn't block line of sight — keep scanning past
          // it for a living ally further down the line.
          const ally = snap.players.some((p, i) => i !== unitIndex && p.hp > 0 && p.position.x === x && p.position.y === y);
          if (ally) {
            allyFound = true;
            break;
          }
        }
        if (allyFound) {
          for (const t of tilesThisDir) result.set(`${t.x},${t.y}`, dir);
        }
      }
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

    // Reachable tiles carry no per-tile step cost anymore: a move is one
    // committed action regardless of distance, so "can I get there" (the
    // highlight) is the whole answer — there is no "what will it cost me."
    this.map.grid.forEach((row, y) => {
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

    // Keyboard-planned (not yet committed) path — outlined so it reads as a
    // plan on top of the reachable highlight, with the would-be destination
    // drawn heavier. See the pendingSteps doc comment for the interaction.
    this.pendingPathMarkers.forEach((o) => o.destroy());
    this.pendingPathMarkers = [];
    this.pendingSteps.forEach((step, i) => {
      const { px, py } = this.tileCenter(step.x, step.y);
      const isDest = i === this.pendingSteps.length - 1;
      const marker = this.add
        .rectangle(px, py, TILE - 18, TILE - 18)
        .setStrokeStyle(isDest ? 3 : 2, COLORS.selected, isDest ? 1 : 0.7)
        .setFillStyle(0x000000, 0)
        .setDepth(1);
      this.pendingPathMarkers.push(marker);
    });

    snap.players.forEach((p, i) => {
      const { px, py } = this.tileCenter(p.position.x, p.position.y);
      // Dead → 0.25 (barely there). Acted → 0.5 (the unit's turn is over —
      // acting is what ends it; a unit that has only MOVED stays fully lit,
      // it still has its one action left).
      const alpha = p.hp <= 0 ? 0.25 : p.acted ? 0.5 : 1;
      this.playerSprites[i].setPosition(px, py).setAlpha(alpha);
      const bar = this.playerHpBars[i];
      const ratio = Math.max(0, p.hp / p.maxHp);
      bar.setPosition(px, py + TILE / 2 - 10).setSize((TILE - 20) * ratio, 6);
      bar.setFillStyle(ratio > 0.34 ? COLORS.hpBarFill : COLORS.hpBarFillLow);
      this.playerHpTexts[i].setPosition(px, py + TILE / 2 - 20).setText(`${Math.max(0, p.hp)}/${p.maxHp}`);
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
    // A2: currentIntents is already resolution order (endTurn() applies them
    // in this same array order) — a small order badge on each monster makes
    // that order visible instead of implicit, so "who goes first" is read off
    // the board, not guessed.
    this.engine.getIntents().forEach((intent, order) => {
      const m = livingMonsters.find((x) => x.instanceId === intent.instanceId);
      if (!m) return;
      const orderPos = this.tileCenter(m.position.x, m.position.y);
      const orderBadge = this.add
        .text(orderPos.px - TILE / 2 + 10, orderPos.py - TILE / 2 + 10, `${order + 1}`, {
          fontFamily: 'monospace',
          fontSize: '13px',
          color: '#ffd166',
          stroke: '#000000',
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(3);
      this.intentMarkers.push(orderBadge);
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
      if (!dir) return;
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
    });

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

    this.emergenceMarkers.forEach((o) => o.destroy());
    this.emergenceMarkers = [];
    // A3: glowing warning on every tile telegraphed to spawn a monster at the
    // end of THIS turn — a player standing on one blocks the spawn (see
    // resolveScheduledSpawns()), so this is a real "hold the line" choice,
    // not decoration.
    for (const tile of snap.pendingSpawnTiles) {
      const { px, py } = this.tileCenter(tile.x, tile.y);
      const warning = this.add
        .text(px, py, EMERGENCE_GLYPH, { fontSize: '36px', color: '#ffd166' })
        .setOrigin(0.5)
        .setDepth(2);
      this.emergenceMarkers.push(warning);
    }

    const unitAlive = (selected?.hp ?? 0) > 0;
    const unitActed = !!selected?.acted;
    this.skillButtons.forEach((btn, i) => {
      const skillId = selected?.skillIds[i];
      const skill = skillId ? registry.skills[skillId] : undefined;
      const nameWithStats = skill ? `${i18n.t(`skill.${skillId}.name`)} ${effectSummary(skill)}` : '';
      // "Already acted" is the only economy gate left — shown explicitly so
      // a disabled button reads as "this unit's turn is spent," not a bug.
      const label = skill && unitActed && unitAlive ? `${nameWithStats}\n${i18n.t('ui.already_acted')}` : nameWithStats;
      if (!skillId || unitActed || !unitAlive || outcomePending) {
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

    // Rest button — the built-in action every character shares. Same gates
    // as a skill button (one action per turn), no arming step.
    {
      const restLabel = `${i18n.t('ui.rest')} ✚1`;
      const label = unitActed && unitAlive ? `${restLabel}\n${i18n.t('ui.already_acted')}` : restLabel;
      if (unitActed || !unitAlive || outcomePending) {
        this.restButton.bg.setFillStyle(COLORS.buttonBg, 0.4);
        this.restButton.label.setText(label);
        this.restButton.bg.disableInteractive();
      } else {
        this.restButton.bg.setFillStyle(COLORS.buttonBg, 1);
        this.restButton.label.setText(restLabel);
        this.restButton.bg.setInteractive({ useHandCursor: true });
      }
    }

    // Ultimate button — only exists while ULTIMATES_ENABLED (the system is
    // shelved during ITB alignment). Driven by CharacterDef.ultimateSkillId,
    // not skillIds, with its own once-per-level lock (ultimateUsed) on top
    // of the usual acted/alive/outcome gates.
    if (this.ultimateButton) {
      const charDef = selected ? registry.characters[selected.characterId] : undefined;
      const ultimateId = charDef?.ultimateSkillId;
      const ultimateSkill = ultimateId ? registry.skills[ultimateId] : undefined;
      const ultimateUsed = !!selected?.ultimateUsed;
      const nameWithStatsUlt = ultimateSkill
        ? `★${i18n.t(`skill.${ultimateId}.name`)} ${effectSummary(ultimateSkill)}`
        : '';
      let statusLine = '';
      if (ultimateUsed) statusLine = i18n.t('ui.ultimate_used');
      else if (unitActed && unitAlive) statusLine = i18n.t('ui.already_acted');
      else if (ultimateSkill) statusLine = i18n.t('ui.ultimate_hint');
      const labelUlt = statusLine ? `${nameWithStatsUlt}\n${statusLine}` : nameWithStatsUlt;

      if (!ultimateId || !ultimateSkill || unitActed || !unitAlive || outcomePending || ultimateUsed) {
        this.ultimateButton.bg.setFillStyle(COLORS.ultimateBg, 0.35);
        this.ultimateButton.label.setText(labelUlt);
        this.ultimateButton.bg.disableInteractive();
      } else {
        const armed = this.armedSkillId === ultimateId;
        this.ultimateButton.bg.setFillStyle(armed ? COLORS.ultimateBgArmed : COLORS.ultimateBg, 1);
        this.ultimateButton.label.setText(labelUlt + (armed ? ' ◀' : ''));
        this.ultimateButton.bg.setInteractive({ useHandCursor: true });
      }
    }

    // Reset-turn is a once-per-level resource now (ITB rule): once spent it
    // stays grayed out with an explicit "used up" label until resetLevel().
    this.resetTurnButton.label.setText(
      snap.resetTurnUsed ? `${i18n.t('ui.reset_turn')}\n${i18n.t('ui.reset_turn_used')}` : i18n.t('ui.reset_turn'),
    );
    this.endTurnButton.label.setText(i18n.t('ui.end_turn'));
    this.resetLevelButton.label.setText(i18n.t('ui.reset_level'));
    this.backToLevelSelectButton.label.setText(i18n.t('ui.select_level'));
    {
      const resetDisabled = outcomePending || snap.resetTurnUsed;
      this.resetTurnButton.bg.setFillStyle(COLORS.buttonBg, resetDisabled ? 0.4 : 1);
      if (resetDisabled) this.resetTurnButton.bg.disableInteractive();
      else this.resetTurnButton.bg.setInteractive({ useHandCursor: true });
      this.endTurnButton.bg.setFillStyle(COLORS.buttonBg, outcomePending ? 0.4 : 1);
      if (outcomePending) this.endTurnButton.bg.disableInteractive();
      else this.endTurnButton.bg.setInteractive({ useHandCursor: true });
    }

    this.skillDescText.setText(
      (selected?.skillIds ?? [])
        .map((id, i) => `${i + 1}. ${i18n.t(`skill.${id}.desc`)}`)
        .join('    '),
    );

    this.instructionText.setText(
      i18n.t(this.armedSkillId ? 'ui.instruction_armed' : 'ui.instruction_idle'),
    );

    // A4: fixed mission length — the final turn IS the win condition
    // (outlast it with the base alive, no kill requirement), so the reminder
    // fires once the turn counter reaches the last turn, not off any
    // wave/monster state.
    const isFinalTurn = snap.turnNumber === snap.totalTurns;
    if (isFinalTurn && !this.announcedLastWave) {
      this.announcedLastWave = true;
      this.lastWaveBanner.setText(i18n.t('ui.last_wave_reminder')).setVisible(true);
      this.time.delayedCall(3000, () => this.lastWaveBanner.setVisible(false));
    }
    const turnCountdown = isFinalTurn
      ? i18n.t('ui.last_wave_hold')
      : `${i18n.t('ui.next_wave_in')} ${snap.totalTurns - snap.turnNumber} ${i18n.t('ui.turns_suffix')}`;

    // ITB alignment (2026-07-17): a tutorial-sequence step shows its
    // progress through the 5-step flow instead of the map's own name — the
    // map name is an internal id ("lesson_ap_cost"), not something a player
    // mid-tutorial needs to see.
    const titleSegment =
      this.tutorialIndex !== undefined
        ? i18n.t('ui.tutorial_progress').replace('{n}', String(this.tutorialIndex + 1)).replace('{total}', String(LESSON_MAP_IDS.length))
        : i18n.t(this.map.nameKey);
    this.hudText.setText(
      `${titleSegment}   ${i18n.t('ui.base_hp')} ${snap.baseHp}/${snap.baseMaxHp}   ${i18n.t('ui.turn')} ${snap.turnNumber}/${snap.totalTurns}   ${turnCountdown}`,
    );

    this.baseHpText?.setText(`${snap.baseHp}/${snap.baseMaxHp}`);

    const liveStatus = [
      `${i18n.t('ui.base_hp')} ${snap.baseHp}/${snap.baseMaxHp}`,
      `${i18n.t('ui.turn')} ${snap.turnNumber}/${snap.totalTurns}`,
      turnCountdown,
    ].join('\n');
    // A lesson-level's one-off tip (see MapDef.hintKey) sits right under the
    // general rules panel, in the same static-text style — not a separate
    // popup, not something that blocks or auto-advances. Most maps have no
    // hintKey at all and this block is simply skipped for them.
    const hintBlock = this.map.hintKey ? `\n\n【本關提示】\n${i18n.t(this.map.hintKey)}` : '';
    this.rulesPanelText.setText(`${RULES_PANEL_STATIC}${hintBlock}\n\n${liveStatus}`);
    // Content height changes every render (live status ticks each turn) —
    // reclamp so a previously-scrolled position doesn't leave blank space
    // dangling below the text once it shrinks, and so newly-overflowing
    // content becomes scrollable the instant it exceeds the panel height.
    this.rulesPanelMaxScroll = Math.max(0, this.rulesPanelText.height - this.rulesPanelBounds.height);
    this.rulesPanelText.y = Phaser.Math.Clamp(this.rulesPanelText.y, -this.rulesPanelMaxScroll, 0);

    // Two distinct defeat causes share one engine outcome ('defeat'): the
    // base dying, and the whole squad dying (total party wipe). The engine
    // doesn't tag which one froze the board, but the snapshot disambiguates
    // them exactly — a wipe defeat is the only defeat where the base is
    // still standing (the base-death branch fires first in endTurn).
    const defeatKey = snap.baseHp > 0 ? 'ui.outcome_wipe' : 'ui.outcome_defeat';
    const OUTCOME_KEY: Record<RunOutcome, string> = {
      defeat: defeatKey,
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
