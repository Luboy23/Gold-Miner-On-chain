import type Phaser from 'phaser';

import type { RankedUiTone } from '../types/index';
import { createUiText } from '../uiText';
import { getPalette } from './shared';
import { fitRankedText } from './text-fit';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export interface RankedBadgeHandle {
  root: Phaser.GameObjects.Container;
  text: Phaser.GameObjects.Text;
  setLabel(label: string): void;
  setTone(tone: RankedUiTone): void;
  setVisible(visible: boolean): void;
}

export function createRankedBadge(
  scene: Phaser.Scene,
  x: number,
  y: number,
  options: {
    label: string;
    tone?: RankedUiTone;
    minWidth?: number;
    maxWidth?: number;
    paddingX?: number;
    truncate?: 'ellipsis' | 'none';
    fixedWidth?: number;
    align?: 'center' | 'left';
  },
): RankedBadgeHandle {
  let tone = options.tone ?? 'accent';
  let label = options.label;
  const container = scene.add.container(x, y);
  const text = createUiText(scene, 0, 0, label, {
    variant: 'caption',
    script: 'mixed',
    style: {
      fontSize: '8px',
      color: getPalette(tone).text,
    },
  }).setOrigin(0.5);

  const graphics = scene.add.graphics();
  container.add(graphics);
  container.add(text);

  const redraw = (): void => {
    const minWidth = options.minWidth ?? 34;
    const maxWidth = options.maxWidth ?? Number.POSITIVE_INFINITY;
    const paddingX = options.paddingX ?? 6;
    const align = options.align ?? 'center';
    text.setText(label);
    const fullWidth = Math.ceil(text.width) + paddingX * 2;
    const width = clamp(
      options.fixedWidth ?? fullWidth,
      minWidth,
      Math.max(minWidth, maxWidth),
    );
    const height = 14;
    const availableWidth = Math.max(0, width - paddingX * 2);

    if (options.truncate !== 'none') {
      fitRankedText(text, label, availableWidth);
    } else {
      text.setText(label);
    }

    graphics.clear();
    const palette = getPalette(tone);
    graphics.fillStyle(palette.fillAlt, 0.95);
    graphics.fillRoundedRect(0, 0, width, height, Math.min(5, height / 2));
    graphics.lineStyle(1, palette.stroke, 0.95);
    graphics.strokeRoundedRect(0.5, 0.5, width - 1, height - 1, Math.min(5, height / 2));
    text.setColor(getPalette(tone).text);
    text.setOrigin(align === 'left' ? 0 : 0.5, 0.5);
    text.setPosition(align === 'left' ? paddingX : width / 2, height / 2);
    container.setSize(width, height);
    container.setPosition(x - width / 2, y - height / 2);
  };

  redraw();

  return {
    root: container,
    text,
    setLabel(nextLabel: string): void {
      label = nextLabel;
      text.setText(nextLabel);
      redraw();
    },
    setTone(nextTone: RankedUiTone): void {
      tone = nextTone;
      redraw();
    },
    setVisible(visible: boolean): void {
      container.setVisible(visible);
    },
  };
}
