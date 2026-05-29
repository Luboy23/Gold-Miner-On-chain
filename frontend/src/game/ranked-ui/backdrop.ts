import type Phaser from 'phaser';

import { LOGIC_CENTER_X, LOGIC_CENTER_Y, LOGIC_HEIGHT, LOGIC_WIDTH } from '../constants';

export function createRankedBackdropOverlay(
  scene: Phaser.Scene,
  alpha = 0.56,
): Phaser.GameObjects.Rectangle {
  return scene.add
    .rectangle(LOGIC_CENTER_X, LOGIC_CENTER_Y, LOGIC_WIDTH, LOGIC_HEIGHT, 0x080503, alpha)
    .setOrigin(0.5);
}
