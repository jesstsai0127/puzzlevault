import Phaser from 'phaser';
import { I18n } from '../../core/i18n';
import en from '../../locales/en.json';
import zhTW from '../../locales/zh-TW.json';
import { maps, WORLD_STRUCTURE, LESSON_MAP_IDS } from '../../content/registry';
import { MAP_QUERY_PARAM, tutorialStepUrl } from './levelNav';
import { availableMissions, isCampaignWon } from '../../core/campaign/state';
import { clearCampaign, loadCampaign } from '../campaign/storage';

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
 *
 * ITB alignment (2026-07-21): this screen is now the campaign's status
 * display as well as its menu. It reads the saved run (core/campaign) to
 * show the carried power grid, gate rows the unlock rules don't currently
 * offer, mark what has been cleared, and — when the grid is gone — replace
 * the whole thing with a campaign-over screen. The page-reload navigation
 * above is what makes reading the save in create() sufficient: this scene is
 * re-created from a fresh document after every mission, so it can never show
 * a stale grid.
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

    const campaign = loadCampaign();
    const unlocked = new Set(availableMissions(campaign));
    const cleared = new Set(campaign.clearedMapIds);

    // Grid readout, top-right. Colour is the warning: it goes amber below
    // half and red at 2 or less, because "the grid is nearly gone" is the
    // single fact this screen most needs to communicate — once it hits zero
    // the run is over with no way back.
    const gridColor = campaign.gridHp <= 2 ? '#ff6b6b' : campaign.gridHp <= campaign.gridMax / 2 ? '#e6c05a' : '#8fe3b0';
    this.add
      .text(this.scale.width - 30, 32, `${i18n.t('ui.campaign_grid')}  ${campaign.gridHp}/${campaign.gridMax}`, {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: gridColor,
      })
      .setOrigin(1, 0.5);
    this.add
      .text(this.scale.width - 30, 54, i18n.t('ui.campaign_grid_hint'), {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#7a7a8a',
      })
      .setOrigin(1, 0.5);

    if (isCampaignWon(campaign)) {
      this.add
        .text(this.scale.width / 2, 66, i18n.t('ui.campaign_won'), {
          fontFamily: 'monospace',
          fontSize: '15px',
          color: '#8fe3b0',
        })
        .setOrigin(0.5);
    }

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

        // Three mutually exclusive row states. Cleared rows stay visible
        // (dimmed green, ticked) rather than disappearing, so the island's
        // 3-of-4 progress is readable at a glance; locked rows are dimmed
        // near to the background and lose their hover/cursor affordances
        // entirely, so "not clickable" is obvious before the click.
        const isCleared = cleared.has(level.mapId);
        const isUnlocked = unlocked.has(level.mapId);

        const baseColor = isCleared ? 0x1c2a24 : isUnlocked ? (level.isLesson ? 0x1f3a2e : 0x2a2a35) : 0x1a1a20;
        const hoverColor = level.isLesson ? 0x2e5a44 : 0x3a3a46;
        const strokeColor = isCleared ? 0x2e5a44 : isUnlocked ? hoverColor : 0x24242c;
        const textColor = isCleared ? '#5f8f73' : isUnlocked ? (level.isLesson ? '#8fe3b0' : '#f1f1f6') : '#4a4a58';

        const name = `${level.label} ${level.isLesson ? `${i18n.t('ui.lesson_label')} ` : ''}${i18n.t(map.nameKey)}`;
        const suffix = isCleared
          ? `  ✔ ${i18n.t('ui.campaign_cleared')}`
          : isUnlocked
            ? ''
            : `  🔒 ${i18n.t('ui.campaign_locked')}`;
        const labelText = `${name}${suffix}`;

        const bg = this.add.rectangle(colX, rowY, ROW_W, ROW_H - 4, baseColor).setStrokeStyle(1, strokeColor);
        const label = this.add
          .text(colX, rowY, labelText, {
            fontFamily: 'monospace',
            fontSize: '14px',
            color: textColor,
          })
          .setOrigin(0.5);
        label.setDepth(1);

        if (isUnlocked) {
          bg.setInteractive({ useHandCursor: true });
          bg.on('pointerover', () => bg.setFillStyle(hoverColor));
          bg.on('pointerout', () => bg.setFillStyle(baseColor));
          bg.on('pointerdown', () => goToMap(level.mapId));
        }

        y += ROW_H;
      }
    });

    if (campaign.campaignOver) this.buildCampaignOverOverlay();
  }

  /**
   * Full-screen campaign-over screen. Drawn over the (fully locked) mission
   * list rather than replacing it, so the player can see how far the dead run
   * got. The only action is a restart, which discards the save entirely and
   * reloads — the rule is that a lost campaign starts again from island 1,
   * with no partial-progress carry.
   */
  private buildCampaignOverOverlay() {
    const { width, height } = this.scale;
    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.82).setDepth(20);

    this.add
      .text(width / 2, height / 2 - 60, i18n.t('ui.campaign_over'), {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#ff6b6b',
      })
      .setOrigin(0.5)
      .setDepth(21);

    const btn = this.add
      .rectangle(width / 2, height / 2 + 20, 280, 44, 0x2a2a35)
      .setStrokeStyle(1, 0x3a3a46)
      .setDepth(21)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(width / 2, height / 2 + 20, i18n.t('ui.campaign_restart'), {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#f1f1f6',
      })
      .setOrigin(0.5)
      .setDepth(22);

    btn.on('pointerover', () => btn.setFillStyle(0x3a3a46));
    btn.on('pointerout', () => btn.setFillStyle(0x2a2a35));
    btn.on('pointerdown', () => {
      clearCampaign();
      // Reload rather than re-running create(): this scene is built around
      // the page-navigation model (see the class comment), and a reload is
      // the same clean-document path every other transition here uses.
      window.location.reload();
    });
  }
}
