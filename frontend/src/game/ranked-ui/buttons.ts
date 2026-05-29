import type Phaser from 'phaser';

import type { RankedUiTone } from '../types/index';
import { createUiText } from '../uiText';
import { drawRoundedPanel } from './panels';
import {
  adjustHex,
  BUTTON_HOVER_LIFT,
  BUTTON_PRESS_DARKEN,
  DISABLED_BUTTON_PALETTE,
  getPalette,
  type RankedRect,
} from './shared';
import { fitRankedText } from './text-fit';

export interface RankedButtonHandle {
  root: Phaser.GameObjects.Container;
  setDisabled(disabled: boolean): void;
  setLabel(label: string, hotkey?: string): void;
  setTone(tone: RankedUiTone): void;
  onPress(handler: () => void): void;
}

export function createRankedButton(
  scene: Phaser.Scene,
  rect: RankedRect,
  options: {
    label: string;
    hotkey?: string;
    tone?: RankedUiTone;
    disabled?: boolean;
  },
): RankedButtonHandle {
  let tone = options.tone ?? 'accent';
  let disabled = Boolean(options.disabled);
  let label = options.label;
  let hotkey = options.hotkey;
  let onPress: (() => void) | null = null;
  let hovered = false;
  let pressed = false;
  const horizontalPadding = 8;
  const hotkeySlotWidth = 22;

  const container = scene.add.container(rect.x, rect.y);
  const graphics = scene.add.graphics();
  const labelText = createUiText(scene, rect.width / 2, rect.height / 2, label, {
    variant: 'caption',
    script: 'mixed',
    style: {
      fontSize: '9px',
      color: getPalette(tone).text,
    },
  }).setOrigin(0.5);
  const hotkeyText = createUiText(
    scene,
    rect.width - 8,
    rect.height / 2,
    hotkey ? `[${hotkey}]` : '',
    {
      variant: 'caption',
      script: 'latin',
      style: {
        fontSize: '7px',
        color: getPalette(tone).mutedText,
      },
    },
  ).setOrigin(1, 0.5);
  const hitArea = scene.add
    .zone(rect.width / 2, rect.height / 2, rect.width, rect.height)
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true });

  const canRedraw = (): boolean =>
    Boolean(
      container.scene &&
        graphics.scene &&
        labelText.scene &&
        hotkeyText.scene &&
        hitArea.scene &&
        scene.sys.isActive(),
    );

  const redraw = (): void => {
    const palette = disabled ? DISABLED_BUTTON_PALETTE : getPalette(tone);
    let fill = palette.fill;
    let fillAlt = palette.fillAlt;

    if (!disabled && hovered) {
      fill = adjustHex(fill, BUTTON_HOVER_LIFT);
      fillAlt = adjustHex(fillAlt, BUTTON_HOVER_LIFT);
    }

    if (!disabled && pressed) {
      fill = adjustHex(fill, -BUTTON_PRESS_DARKEN);
      fillAlt = adjustHex(fillAlt, -BUTTON_PRESS_DARKEN);
    }

    graphics.clear();
    drawRoundedPanel(
      graphics,
      rect.width,
      rect.height,
      {
        ...palette,
        fill,
        fillAlt,
      },
      {
        shadowOffsetX: 2,
        shadowOffsetY: 2,
        shadowAlpha: 0.22,
        radius: 5,
        accentHeight: 3,
      },
    );

    labelText.setColor(palette.text);
    hotkeyText.setText(hotkey ? `[${hotkey}]` : '');
    hotkeyText.setColor(palette.mutedText);
    const slotWidth = hotkey ? hotkeySlotWidth : 0;
    const labelAreaLeft = horizontalPadding;
    const labelAreaRight = rect.width - horizontalPadding - slotWidth;
    const labelAreaWidth = Math.max(0, labelAreaRight - labelAreaLeft);
    fitRankedText(labelText, label, labelAreaWidth);
    labelText.setOrigin(0.5, 0.5);
    labelText.setPosition(labelAreaLeft + labelAreaWidth / 2, rect.height / 2);
    hotkeyText.setVisible(Boolean(hotkey));
    hotkeyText.setPosition(rect.width - horizontalPadding, rect.height / 2);

    if (disabled) {
      hitArea.disableInteractive();
    } else if (!hitArea.input?.enabled) {
      hitArea.setInteractive({ useHandCursor: true });
    }
  };

  hitArea.on('pointerover', () => {
    if (disabled) {
      return;
    }

    hovered = true;
    redraw();
  });
  hitArea.on('pointerout', () => {
    hovered = false;
    pressed = false;
    redraw();
  });
  hitArea.on('pointerdown', () => {
    if (disabled) {
      return;
    }

    pressed = true;
    redraw();
    onPress?.();
    scene.time.delayedCall(90, () => {
      if (!canRedraw()) {
        return;
      }

      pressed = false;
      redraw();
    });
  });

  container.setSize(rect.width, rect.height);
  container.add([graphics, labelText, hotkeyText, hitArea]);
  redraw();

  return {
    root: container,
    setDisabled(nextDisabled: boolean): void {
      disabled = nextDisabled;
      redraw();
    },
    setLabel(nextLabel: string, nextHotkey?: string): void {
      label = nextLabel;
      hotkey = nextHotkey;
      redraw();
    },
    setTone(nextTone: RankedUiTone): void {
      tone = nextTone;
      redraw();
    },
    onPress(handler: () => void): void {
      onPress = handler;
    },
  };
}
