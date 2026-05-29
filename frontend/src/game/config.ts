import Phaser from 'phaser';

import { RENDER_HEIGHT, RENDER_WIDTH } from './constants';
import { BootScene } from '../scenes/BootScene';
import { MenuScene } from '../scenes/MenuScene';
import { PreloaderScene } from '../scenes/PreloaderScene';

export const GAME_CONFIG: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  width: RENDER_WIDTH,
  height: RENDER_HEIGHT,
  backgroundColor: '#ffffff',
  antialias: true,
  pixelArt: false,
  roundPixels: false,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [
    BootScene,
    PreloaderScene,
    MenuScene,
  ],
};
