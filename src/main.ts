import Phaser from 'phaser';
import { BattleScene } from './scenes/BattleScene';
import { LevelSelectScene } from './scenes/LevelSelectScene';
import { mapIdFromUrl } from './scenes/levelNav';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: 1200,
  height: 720,
  parent: 'game',
  backgroundColor: '#14141a',
  scene: [LevelSelectScene, BattleScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
});

// Debug/verification handle: background-tab test tooling needs to reach the
// game instance (e.g. to hand-step the paused loop), and Phaser doesn't
// register instances globally. Everything in a client-side single-player game
// is inspectable anyway, so there's nothing to gate this behind.
(window as unknown as { __game: Phaser.Game }).__game = game;

// LevelSelectScene auto-starts (it's first in the scene list above); if the
// URL already names a level (?map=demo2, set by LevelSelectScene's own
// buttons or shared directly), skip straight to it instead.
const mapId = mapIdFromUrl();
if (mapId) {
  game.scene.start('BattleScene', { mapId });
}
