import Phaser from 'phaser';
import { I18n } from '../../core/i18n';
import en from '../../locales/en.json';
import zhTW from '../../locales/zh-TW.json';
import { maps, tutorials, LEVEL_GROUPS } from '../../content/registry';
import { MAP_QUERY_PARAM, TUTORIAL_QUERY_PARAM } from './levelNav';

const i18n = new I18n(en, zhTW);

/**
 * Each map is its own testable level (demo1, demo2, ...) — see
 * design/roadmap.md ch.5. This screen exists so different playtesters can be
 * pointed at different levels without a build swap, and so their feedback on
 * one mechanic doesn't tangle with feedback on another.
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
      .text(this.scale.width / 2, 100, i18n.t('ui.select_level'), {
        fontFamily: 'monospace',
        fontSize: '32px',
        color: '#f1f1f6',
      })
      .setOrigin(0.5);

    // Tutorials are listed first — they're the suggested starting point, not
    // a gate: every demo map below is always clickable too, nothing here is
    // locked/unlocked. A distinct fill color + "【教學】" prefix is the only
    // thing that tells them apart from a real level in the list.
    const tutorialIds = Object.keys(tutorials);
    tutorialIds.forEach((tutorialId, i) => {
      const tutorial = tutorials[tutorialId];
      const y = 220 + i * 70;
      const bg = this.add
        .rectangle(this.scale.width / 2, y, 360, 50, 0x1f3a2e)
        .setStrokeStyle(1, 0x2e5a44)
        .setInteractive({ useHandCursor: true });
      const label = this.add
        .text(this.scale.width / 2, y, `${i18n.t('ui.tutorial_label')} ${i18n.t(tutorial.nameKey)}`, {
          fontFamily: 'monospace',
          fontSize: '18px',
          color: '#8fe3b0',
        })
        .setOrigin(0.5);
      bg.on('pointerover', () => bg.setFillStyle(0x2e5a44));
      bg.on('pointerout', () => bg.setFillStyle(0x1f3a2e));
      bg.on('pointerdown', () => {
        const url = new URL(window.location.href);
        url.searchParams.delete(MAP_QUERY_PARAM);
        url.searchParams.set(TUTORIAL_QUERY_PARAM, tutorialId);
        window.location.href = url.toString();
      });
      label.setDepth(1);
    });

    // Difficulty tiers (LEVEL_GROUPS, content/registry.ts) are a pure
    // selection-screen grouping on top of `maps` — the easy/hard mapIds they
    // reference are real entries in `maps` (so autoplay-harness etc. can
    // still address them directly by id) but must NOT also get their own
    // top-level row here, or demo1's three difficulty variants would show up
    // as four confusing entries (one generic + three tiered). Hide them from
    // the normal per-map loop below; the group's own row (rendered right
    // after) is what surfaces them.
    const tieredMapIds = new Set(LEVEL_GROUPS.flatMap((g) => [g.easy, g.hard].filter((id): id is string => !!id)));
    const mapIds = Object.keys(maps).filter((id) => !tieredMapIds.has(id));
    const groupByNormalMapId = new Map(LEVEL_GROUPS.map((g) => [g.normal, g]));

    const goToMap = (mapId: string) => {
      const url = new URL(window.location.href);
      url.searchParams.delete(TUTORIAL_QUERY_PARAM);
      url.searchParams.set(MAP_QUERY_PARAM, mapId);
      window.location.href = url.toString();
    };

    mapIds.forEach((mapId, i) => {
      const map = maps[mapId];
      const y = 220 + (tutorialIds.length + i) * 70;
      const group = groupByNormalMapId.get(mapId);

      // The main row button always targets this map's own "normal" entry —
      // demo2/3/4 (no group) behave exactly as before.
      const bg = this.add
        .rectangle(this.scale.width / 2, y, 360, 50, 0x2a2a35)
        .setStrokeStyle(1, 0x3a3a46)
        .setInteractive({ useHandCursor: true });
      const label = this.add
        .text(this.scale.width / 2, y, `${mapId} — ${i18n.t(map.nameKey)}`, {
          fontFamily: 'monospace',
          fontSize: '18px',
          color: '#f1f1f6',
        })
        .setOrigin(0.5);
      bg.on('pointerover', () => bg.setFillStyle(0x3a3a46));
      bg.on('pointerout', () => bg.setFillStyle(0x2a2a35));
      bg.on('pointerdown', () => goToMap(mapId));
      label.setDepth(1);

      if (!group) return;

      // Difficulty-tier buttons: small, color-coded, stacked to the right of
      // the main row so demo1's easy/normal/hard choice reads as one level
      // with three doors, not three separate levels.
      const tierX = this.scale.width / 2 + 260;
      const tiers: { key: 'easy' | 'normal' | 'hard'; mapId?: string; color: number; hoverColor: number }[] = [
        { key: 'easy', mapId: group.easy, color: 0x1f3a2e, hoverColor: 0x2e5a44 },
        { key: 'normal', mapId: group.normal, color: 0x2a2a35, hoverColor: 0x3a3a46 },
        { key: 'hard', mapId: group.hard, color: 0x3a1f1f, hoverColor: 0x5a2e2e },
      ];
      tiers.forEach((tier, ti) => {
        if (!tier.mapId) return;
        const tx = tierX + ti * 90;
        const tierBg = this.add
          .rectangle(tx, y, 80, 50, tier.color)
          .setStrokeStyle(1, tier.hoverColor)
          .setInteractive({ useHandCursor: true });
        const tierLabel = this.add
          .text(tx, y, i18n.t(`ui.difficulty_${tier.key}`), {
            fontFamily: 'monospace',
            fontSize: '14px',
            color: '#f1f1f6',
          })
          .setOrigin(0.5);
        tierBg.on('pointerover', () => tierBg.setFillStyle(tier.hoverColor));
        tierBg.on('pointerout', () => tierBg.setFillStyle(tier.color));
        tierBg.on('pointerdown', () => goToMap(tier.mapId!));
        tierLabel.setDepth(1);
      });
    });
  }
}
