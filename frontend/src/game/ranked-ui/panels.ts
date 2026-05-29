import type Phaser from 'phaser';

import type { RankedUiTone } from '../types/index';
import type { RankedRect, TonePalette } from './shared';
import { getPalette } from './shared';

export function drawRoundedPanel(
  graphics: Phaser.GameObjects.Graphics,
  width: number,
  height: number,
  palette: TonePalette,
  options?: {
    shadowOffsetX?: number;
    shadowOffsetY?: number;
    shadowAlpha?: number;
    radius?: number;
    accentHeight?: number;
  },
): void {
  const radius = options?.radius ?? 6;
  const shadowOffsetX = options?.shadowOffsetX ?? 3;
  const shadowOffsetY = options?.shadowOffsetY ?? 4;
  const shadowAlpha = options?.shadowAlpha ?? 0.3;
  const accentHeight = options?.accentHeight ?? 4;

  graphics.clear();

  graphics.fillStyle(0x000000, shadowAlpha);
  graphics.fillRoundedRect(shadowOffsetX, shadowOffsetY, width, height, radius);

  graphics.fillStyle(palette.fill, 0.96);
  graphics.fillRoundedRect(0, 0, width, height, radius);

  graphics.fillStyle(palette.fillAlt, 0.9);
  graphics.fillRoundedRect(1, 1, width - 2, height - 2, Math.max(0, radius - 1));

  graphics.fillStyle(palette.accent, 0.22);
  graphics.fillRoundedRect(2, 2, width - 4, accentHeight, Math.max(0, radius - 2));

  graphics.lineStyle(1.5, palette.stroke, 1);
  graphics.strokeRoundedRect(0.75, 0.75, width - 1.5, height - 1.5, radius);
}

function createPanelFrame(
  scene: Phaser.Scene,
  rect: RankedRect,
  tone: RankedUiTone,
): Phaser.GameObjects.Container {
  const container = scene.add.container(rect.x, rect.y);
  const graphics = scene.add.graphics();
  drawRoundedPanel(graphics, rect.width, rect.height, getPalette(tone));
  container.setSize(rect.width, rect.height);
  container.add(graphics);
  return container;
}

export function createRankedPanel(
  scene: Phaser.Scene,
  rect: RankedRect,
  tone: RankedUiTone = 'default',
): Phaser.GameObjects.Container {
  return createPanelFrame(scene, rect, tone);
}
