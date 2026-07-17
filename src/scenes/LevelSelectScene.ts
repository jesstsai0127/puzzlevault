import Phaser from 'phaser';
import { I18n } from '../../core/i18n';
import en from '../../locales/en.json';
import zhTW from '../../locales/zh-TW.json';
import { maps, WORLD_STRUCTURE, LESSON_MAP_IDS } from '../../content/registry';
import { MAP_QUERY_PARAM, tutorialStepUrl } from './levelNav';

const i18n = new I18n(en, zhTW);

/**
 * Campaign level select — 4 islands × 5 missions (WORLD_STRUCTURE), laid out
 * as two columns of two islands each so all 20 missions fit the canvas
 * without scrolling, plus the standalone tutorial entry up top.
 *
 * The old LEVEL_GROUPS easy/normal/hard tier buttons are gone with the
 * full campaign replacement (2026-07-17) — every mission is a single plain
 * row now; a future difficulty system would be designed fresh, not revived
 * from that per-map tier hack.
 *
 * Navigation between this screen and BattleScene goes through a real page
 * load (see levelNav.ts) rather than Phaser's scene.start() — Phaser's
 * SceneManager stopped routing pointer events to this scene's objects after
 * a second start()/create() cycle in testing (repro: demo → back to select →
 * pick a level a second time — clicks silently stopped landing, with no
 * thrown error to explain why). A full navigation sidesteps whatever
 * internal state got wedged, at the cost of a page reload per level switch.
 */
export class LevelSelectScene extends Phaser.Scene {
  constructor() {
    super('LevelSelectScene');
  }

  create() {
    this.cameras.main.setBackgroundColor('#14141a');

    this.add
      .text(this.scale.width / 2, 40, i18n.t('ui.select_level'), {
        fontFamily: 'monospace',
        fontSize: '26px',
        color: '#f1f1f6',
      })
      .setOrigin(0.5);

    const goToMap = (mapId: string) => {
      const url = new URL(window.location.href);
      url.searchParams.set(MAP_QUERY_PARAM, mapId);
      window.location.href = url.toString();
    };

    const ROW_H = 36;
    const HEADER_H = 26;
    const WORLD_GAP = 14;
    const ROW_W = 340;

    // ITB alignment (2026-07-17): a standalone "Combat Simulation"-style
    // tutorial entry, separate from the campaign tree — green lesson
    // styling. Clicking starts the 5-step LESSON_MAP_IDS sequence at step 0;
    // BattleScene auto-advances through the rest (see handleConfirmOutcome()).
    {
      const ty = 80;
      const tutorialBg = this.add
        .rectangle(this.scale.width / 2, ty, ROW_W, ROW_H - 4, 0x1f3a2e)
        .setStrokeStyle(1, 0x2e5a44)
        .setInteractive({ useHandCursor: true });
      const tutorialLabel = this.add
        .text(this.scale.width / 2, ty, i18n.t('ui.tutorial_entry'), {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#8fe3b0',
        })
        .setOrigin(0.5);
      tutorialLabel.setDepth(1);
      tutorialBg.on('pointerover', () => tutorialBg.setFillStyle(0x2e5a44));
      tutorialBg.on('pointerout', () => tutorialBg.setFillStyle(0x1f3a2e));
      tutorialBg.on('pointerdown', () => {
        window.location.href = tutorialStepUrl(LESSON_MAP_IDS, 0);
      });
    }

    // Two columns × two islands per column: islands 1-2 left, 3-4 right.
    // 5 missions per island at ROW_H each stacks well within the canvas.
    // The 5th entry (the final battle) sits centered below both columns —
    // apart from the island grid, same way ITB's Volcanic Hive sits apart
    // from the 4 corporate islands.
    const columnX = [this.scale.width / 2 - 210, this.scale.width / 2 + 210];
    const topY = 130;
    const ISLAND_BLOCK_H = HEADER_H + 5 * ROW_H + WORLD_GAP;

    WORLD_STRUCTURE.forEach((world, wi) => {
      const isFinal = wi >= 4;
      const colX = isFinal ? this.scale.width / 2 : columnX[Math.floor(wi / 2)];
      let y = isFinal ? topY + 2 * ISLAND_BLOCK_H : topY + (wi % 2) * ISLAND_BLOCK_H;

      this.add
        .text(colX, y, i18n.t(world.worldNameKey), {
          fontFamily: 'monospace',
          fontSize: '17px',
          color: '#c9c9d6',
        })
        .setOrigin(0.5);
      y += HEADER_H;

      for (const level of world.levels) {
        const map = maps[level.mapId];
        const rowY = y;

        const baseColor = level.isLesson ? 0x1f3a2e : 0x2a2a35;
        const hoverColor = level.isLesson ? 0x2e5a44 : 0x3a3a46;
        const textColor = level.isLesson ? '#8fe3b0' : '#f1f1f6';
        const labelText = level.isLesson
          ? `${level.label} ${i18n.t('ui.lesson_label')} ${i18n.t(map.nameKey)}`
          : `${level.label} ${i18n.t(map.nameKey)}`;

        const bg = this.add.rectangle(colX, rowY, ROW_W, ROW_H - 4, baseColor).setStrokeStyle(1, hoverColor);
        const label = this.add
          .text(colX, rowY, labelText, {
            fontFamily: 'monospace',
            fontSize: '14px',
            color: textColor,
          })
          .setOrigin(0.5);
        label.setDepth(1);

        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => bg.setFillStyle(hoverColor));
        bg.on('pointerout', () => bg.setFillStyle(baseColor));
        bg.on('pointerdown', () => goToMap(level.mapId));

        y += ROW_H;
      }
    });
  }
}
