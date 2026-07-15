import Phaser from 'phaser';
import { BattleScene } from './scenes/BattleScene';
import { LevelSelectScene } from './scenes/LevelSelectScene';
import { mapIdFromUrl, tutorialIdFromUrl } from './scenes/levelNav';

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

// LevelSelectScene auto-starts (it's first in the scene list above); if the
// URL already names a level (?map=demo2, set by LevelSelectScene's own
// buttons or shared directly), skip straight to it instead. ?tutorial=<id>
// is the same handoff for a scripted tutorial level (see levelNav.ts).
const mapId = mapIdFromUrl();
const tutorialId = tutorialIdFromUrl();
if (tutorialId) {
  game.scene.start('BattleScene', { tutorialId });
} else if (mapId) {
  game.scene.start('BattleScene', { mapId });
}
