import Phaser from 'phaser';
import { BattleScene } from './scenes/BattleScene';

new Phaser.Game({
  type: Phaser.AUTO,
  width: 1200,
  height: 720,
  parent: 'game',
  backgroundColor: '#14141a',
  scene: [BattleScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
});
