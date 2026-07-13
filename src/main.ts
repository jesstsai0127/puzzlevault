import Phaser from 'phaser';
import { PuzzleScene } from './scenes/PuzzleScene';

new Phaser.Game({
  type: Phaser.AUTO,
  width: 960,
  height: 720,
  parent: 'game',
  backgroundColor: '#14141a',
  pixelArt: true,
  scene: [PuzzleScene],
});
