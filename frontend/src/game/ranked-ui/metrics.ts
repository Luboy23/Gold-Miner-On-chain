import type Phaser from 'phaser';

import type { RankedUiTone } from '../types/index';
import { createUiText } from '../uiText';
import { drawRoundedPanel } from './panels';
import { getPalette, inferTextScript, type RankedRect } from './shared';
import { fitRankedText } from './text-fit';

export interface RankedMetricHandle {
  root: Phaser.GameObjects.Container;
  labelText: Phaser.GameObjects.Text;
  valueText: Phaser.GameObjects.Text;
  setValue(value: string): void;
  setAccent(tone: RankedUiTone): void;
}

export function createRankedMetric(
  scene: Phaser.Scene,
  rect: RankedRect,
  options: {
    label: string;
    value: string;
    accent?: RankedUiTone;
  },
): RankedMetricHandle {
  let accent = options.accent ?? 'accent';
  let value = options.value;
  const height = Math.max(rect.height, 30);
  const container = scene.add.container(rect.x, rect.y);
  const graphics = scene.add.graphics();
  const labelText = createUiText(scene, 8, 4, options.label, {
    variant: 'caption',
    script: 'mixed',
    style: {
      fontSize: '7px',
      color: '#d8c8a1',
    },
  }).setOrigin(0, 0);
  const valueText = createUiText(scene, 8, height - 4, value, {
    variant: 'body',
    script: inferTextScript(options.value),
    style: {
      fontSize: '11px',
      color: '#fff8df',
    },
  }).setOrigin(0, 1);

  const redraw = (): void => {
    const palette = getPalette(accent);
    graphics.clear();
    drawRoundedPanel(
      graphics,
      rect.width,
      height,
      {
        ...getPalette('muted'),
        stroke: palette.stroke,
        accent: palette.accent,
      },
      {
        shadowOffsetX: 1,
        shadowOffsetY: 2,
        shadowAlpha: 0.18,
        radius: 5,
        accentHeight: 3,
      },
    );
    labelText.setColor(getPalette('muted').mutedText);
    valueText.setColor(palette.text);
    fitRankedText(labelText, options.label, rect.width - 16);
    fitRankedText(valueText, value, rect.width - 16);
  };

  container.setSize(rect.width, height);
  container.add([graphics, labelText, valueText]);
  redraw();

  return {
    root: container,
    labelText,
    valueText,
    setValue(nextValue: string): void {
      value = nextValue;
      valueText.setText(nextValue);
      redraw();
    },
    setAccent(nextTone: RankedUiTone): void {
      accent = nextTone;
      redraw();
    },
  };
}
