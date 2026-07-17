import Phaser from 'phaser';
import { I18n } from '../../core/i18n';
import en from '../../locales/en.json';
import zhTW from '../../locales/zh-TW.json';
import { maps, WORLD_STRUCTURE, LEVEL_GROUPS, LESSON_MAP_IDS } from '../../content/registry';
import { MAP_QUERY_PARAM, tutorialStepUrl } from './levelNav';

const i18n = new I18n(en, zhTW);

/**
 * Each map is its own testable level (demo1, demo2, ...) — see
 * design/roadmap.md ch.5. This screen exists so different playtesters can be
 * pointed at different levels without a build swap, and so their feedback on
 * one mechanic doesn't tangle with feedback on another.
 *
 * World-structure batch: levels are grouped by WORLD_STRUCTURE (content/
 * registry.ts) into "World N" blocks — lesson level(s) first, that world's
 * finale last — instead of the old flat "all lessons, then all demos" split.
 * LEVEL_GROUPS (demo1's easy/normal/hard tier buttons) still layers on top
 * of whichever WORLD_STRUCTURE entry is that group's `normal` map; see the
 * per-level rendering below for how the two combine without regressing the
 * "four buttons for one map" bug fixed in commit 5bc5427 (grouped maps'
 * main row must NOT also be independently clickable, or demo1 ends up with
 * a generic button AND a redundant "normal" tier button both going to the
 * same place).
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

    // A grouped map's own easy/normal/hard tier buttons (rendered per-level
    // below) are the only way to reach it — see the "four buttons" note
    // above. Today only demo1 (WORLD_STRUCTURE's 1-4) has a LEVEL_GROUPS
    // entry; demo2/3/4 and every lesson level render as a single plain row.
    const groupByNormalMapId = new Map(LEVEL_GROUPS.map((g) => [g.normal, g]));

    const ROW_H = 36;
    const HEADER_H = 22;
    const WORLD_GAP = 8;
    let y = 80;

    // ITB alignment (2026-07-17): a standalone "Combat Simulation"-style
    // tutorial entry, separate from the world/level tree — reuses the same
    // isLesson green treatment. Clicking starts the 5-step LESSON_MAP_IDS
    // sequence at step 0; BattleScene auto-advances through the rest (see
    // handleConfirmOutcome()).
    {
      const tutorialBg = this.add
        .rectangle(this.scale.width / 2, y, 340, ROW_H - 4, 0x1f3a2e)
        .setStrokeStyle(1, 0x2e5a44)
        .setInteractive({ useHandCursor: true });
      const tutorialLabel = this.add
        .text(this.scale.width / 2, y, i18n.t('ui.tutorial_entry'), {
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
      y += ROW_H + WORLD_GAP;
    }

    for (const world of WORLD_STRUCTURE) {
      this.add
        .text(this.scale.width / 2, y, i18n.t(world.worldNameKey), {
          fontFamily: 'monospace',
          fontSize: '17px',
          color: '#c9c9d6',
        })
        .setOrigin(0.5);
      y += HEADER_H;

      for (const level of world.levels) {
        const map = maps[level.mapId];
        const group = groupByNormalMapId.get(level.mapId);
        const rowY = y;

        // Small-lesson visual treatment (green tint + 【小關】 prefix) is the
        // same visual language LESSON_MAP_IDS levels already use — carried
        // over here via WorldLevelEntry.isLesson so a world's finale (the
        // one isLesson:false entry, always last) still reads as the "real"
        // battle at the end of the world.
        const baseColor = level.isLesson ? 0x1f3a2e : 0x2a2a35;
        const hoverColor = level.isLesson ? 0x2e5a44 : 0x3a3a46;
        const textColor = level.isLesson ? '#8fe3b0' : '#f1f1f6';
        const labelText = level.isLesson
          ? `${level.label} ${i18n.t('ui.lesson_label')} ${i18n.t(map.nameKey)}`
          : `${level.label} ${i18n.t(map.nameKey)}`;

        const bg = this.add.rectangle(this.scale.width / 2, rowY, 340, ROW_H - 4, baseColor).setStrokeStyle(1, hoverColor);
        const label = this.add
          .text(this.scale.width / 2, rowY, labelText, {
            fontFamily: 'monospace',
            fontSize: '14px',
            color: textColor,
          })
          .setOrigin(0.5);
        label.setDepth(1);

        if (!group) {
          bg.setInteractive({ useHandCursor: true });
          bg.on('pointerover', () => bg.setFillStyle(hoverColor));
          bg.on('pointerout', () => bg.setFillStyle(baseColor));
          bg.on('pointerdown', () => goToMap(level.mapId));
        } else {
          // Grouped map (today: only demo1 / WORLD_STRUCTURE's 1-4) — the
          // main row above stays a non-interactive label; its own tier
          // buttons here are the only way to reach it. Same fix as commit
          // 5bc5427 ("grouped maps no longer show a redundant fourth
          // button"): making the main row ALSO clickable here would put
          // both a generic button and a "normal" tier button on the same
          // map again.
          const tierX = this.scale.width / 2 + 230;
          const tiers: { key: 'easy' | 'normal' | 'hard'; mapId?: string; color: number; hoverColor: number }[] = [
            { key: 'easy', mapId: group.easy, color: 0x1f3a2e, hoverColor: 0x2e5a44 },
            { key: 'normal', mapId: group.normal, color: 0x2a2a35, hoverColor: 0x3a3a46 },
            { key: 'hard', mapId: group.hard, color: 0x3a1f1f, hoverColor: 0x5a2e2e },
          ];
          tiers.forEach((tier, ti) => {
            if (!tier.mapId) return;
            const tx = tierX + ti * 80;
            const tierBg = this.add
              .rectangle(tx, rowY, 72, ROW_H - 4, tier.color)
              .setStrokeStyle(1, tier.hoverColor)
              .setInteractive({ useHandCursor: true });
            const tierLabel = this.add
              .text(tx, rowY, i18n.t(`ui.difficulty_${tier.key}`), {
                fontFamily: 'monospace',
                fontSize: '12px',
                color: '#f1f1f6',
              })
              .setOrigin(0.5);
            tierBg.on('pointerover', () => tierBg.setFillStyle(tier.hoverColor));
            tierBg.on('pointerout', () => tierBg.setFillStyle(tier.color));
            tierBg.on('pointerdown', () => goToMap(tier.mapId!));
            tierLabel.setDepth(1);
          });
        }

        y += ROW_H;
      }
      y += WORLD_GAP;
    }
  }
}
