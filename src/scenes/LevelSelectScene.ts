import Phaser from 'phaser';
import { I18n } from '../../core/i18n';
import en from '../../locales/en.json';
import zhTW from '../../locales/zh-TW.json';
import { maps } from '../../content/registry';
import { MAP_QUERY_PARAM } from './levelNav';

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

    const mapIds = Object.keys(maps);
    mapIds.forEach((mapId, i) => {
      const map = maps[mapId];
      const y = 220 + i * 70;
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
      bg.on('pointerdown', () => {
        const url = new URL(window.location.href);
        url.searchParams.set(MAP_QUERY_PARAM, mapId);
        window.location.href = url.toString();
      });
      label.setDepth(1);
    });
  }
}
