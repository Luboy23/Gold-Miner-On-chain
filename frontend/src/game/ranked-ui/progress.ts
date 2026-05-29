import type Phaser from 'phaser';

import type { RankedUiTone } from '../types/index';
import { getPalette, type RankedRect } from './shared';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export interface RankedProgressBarHandle {
  root: Phaser.GameObjects.Container;
  setProgress(value: number, max: number, tone?: RankedUiTone): void;
}

export function createRankedProgressBar(
  scene: Phaser.Scene,
  rect: RankedRect,
  options: {
    value: number;
    max: number;
    tone?: RankedUiTone;
  },
): RankedProgressBarHandle {
  const container = scene.add.container(rect.x, rect.y);
  const background = scene.add.graphics();
  const fill = scene.add.graphics();
  let tone = options.tone ?? 'accent';

  const redraw = (value: number, max: number): void => {
    const palette = getPalette(tone);
    const safeMax = Math.max(max, 1);
    const ratio = clamp(value / safeMax, 0, 1);

    background.clear();
    background.fillStyle(getPalette('muted').fillAlt, 0.95);
    background.fillRoundedRect(0, 0, rect.width, rect.height, Math.min(4, rect.height / 2));
    background.lineStyle(1, getPalette('muted').stroke, 0.5);
    background.strokeRoundedRect(0.5, 0.5, rect.width - 1, rect.height - 1, Math.min(4, rect.height / 2));

    fill.clear();
    fill.fillStyle(palette.accent, 0.95);
    fill.fillRoundedRect(
      1,
      1,
      Math.max(0, (rect.width - 2) * ratio),
      Math.max(0, rect.height - 2),
      Math.min(3, rect.height / 2),
    );
  };

  container.setSize(rect.width, rect.height);
  container.add([background, fill]);
  redraw(options.value, options.max);

  return {
    root: container,
    setProgress(value: number, max: number, nextTone?: RankedUiTone): void {
      tone = nextTone ?? tone;
      redraw(value, max);
    },
  };
}
