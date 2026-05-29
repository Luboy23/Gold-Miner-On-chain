import type Phaser from 'phaser';

import type {
  RankedEmptyStateViewModel,
  RankedListRowViewModel,
  RankedUiTone,
} from '../types/index';
import { createUiText } from '../uiText';
import { getPalette, inferTextScript, type RankedRect } from './shared';
import { fitRankedText } from './text-fit';

export interface RankedCompactStatRowViewModel {
  leading?: string;
  primary: string;
  trailing?: string;
  tone?: RankedUiTone;
}

export function createRankedEmptyState(
  scene: Phaser.Scene,
  rect: RankedRect,
  emptyState: RankedEmptyStateViewModel,
): Phaser.GameObjects.Container {
  const tone = emptyState.tone ?? 'muted';
  const palette = getPalette(tone);
  const container = scene.add.container(rect.x, rect.y);
  const primaryText = createUiText(
    scene,
    rect.width / 2,
    Math.max(8, rect.height / 2 - 6),
    emptyState.primary,
    {
      variant: 'caption',
      script: inferTextScript(emptyState.primary),
      style: {
        fontSize: '8px',
        color: palette.text,
        align: 'center',
      },
    },
  ).setOrigin(0.5, 0.5);

  const secondaryText = createUiText(
    scene,
    rect.width / 2,
    Math.max(14, rect.height / 2 + 6),
    emptyState.secondary ?? '',
    {
      variant: 'caption',
      script: inferTextScript(emptyState.secondary ?? ''),
      style: {
        fontSize: '7px',
        color: palette.mutedText,
        align: 'center',
      },
    },
  ).setOrigin(0.5, 0.5);

  fitRankedText(primaryText, emptyState.primary, rect.width - 12);
  fitRankedText(secondaryText, emptyState.secondary ?? '', rect.width - 12);

  container.setSize(rect.width, rect.height);
  container.add(primaryText);

  if (emptyState.secondary) {
    container.add(secondaryText);
  }

  return container;
}

export function createRankedDivider(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  tone: RankedUiTone = 'muted',
): Phaser.GameObjects.Rectangle {
  return scene.add.rectangle(x, y, width, 1, getPalette(tone).stroke, 0.55).setOrigin(0, 0.5);
}

export function createRankedListRow(
  scene: Phaser.Scene,
  rect: RankedRect,
  row: RankedListRowViewModel,
): Phaser.GameObjects.Container {
  const PRIMARY_FONT_SIZE = 7;
  const SECONDARY_FONT_SIZE = 6;
  const PRIMARY_TOP = 2;
  const SECONDARY_TOP = 11;
  const tone = row.tone ?? 'muted';
  const palette = getPalette(tone);
  const container = scene.add.container(rect.x, rect.y);
  const background = scene.add
    .rectangle(rect.width / 2, rect.height / 2, rect.width, rect.height, palette.fillAlt, 0.68)
    .setStrokeStyle(1, palette.stroke, 0.35);
  const leadingText = row.leading
    ? createUiText(scene, 7, rect.height / 2, row.leading, {
        variant: 'caption',
        script: 'mixed',
        style: {
          fontSize: '7px',
          color: palette.mutedText,
        },
      }).setOrigin(0, 0.5)
    : null;
  const primaryX = row.leading ? 22 : 8;
  const primaryText = createUiText(scene, primaryX, PRIMARY_TOP, row.primary, {
    variant: 'caption',
    script: 'mixed',
    style: {
      fontSize: `${PRIMARY_FONT_SIZE}px`,
      color: palette.text,
    },
  }).setOrigin(0, 0);
  const secondaryText = createUiText(scene, primaryX, SECONDARY_TOP, row.secondary ?? '', {
    variant: 'caption',
    script: 'mixed',
    style: {
      fontSize: `${SECONDARY_FONT_SIZE}px`,
      color: palette.mutedText,
    },
  }).setOrigin(0, 0);
  const textWidth = rect.width - primaryX - 8;

  fitRankedText(primaryText, row.primary, textWidth);
  fitRankedText(secondaryText, row.secondary ?? '', textWidth);

  container.setSize(rect.width, rect.height);
  container.add(background);
  if (leadingText) {
    container.add(leadingText);
  }
  container.add([primaryText, secondaryText]);
  return container;
}

export function createRankedCompactStatRow(
  scene: Phaser.Scene,
  rect: RankedRect,
  row: RankedCompactStatRowViewModel,
): Phaser.GameObjects.Container {
  const tone = row.tone ?? 'muted';
  const palette = getPalette(tone);
  const container = scene.add.container(rect.x, rect.y);
  const emphasized = tone === 'accent' || tone === 'info' || tone === 'success';
  const background = scene.add
    .rectangle(
      rect.width / 2,
      rect.height / 2,
      rect.width,
      rect.height,
      palette.fillAlt,
      emphasized ? 0.8 : 0.62,
    )
    .setStrokeStyle(1, palette.stroke, emphasized ? 0.72 : 0.3);
  const accentBar = scene.add
    .rectangle(2, rect.height / 2, 2, Math.max(4, rect.height - 2), palette.stroke, emphasized ? 0.95 : 0.5)
    .setOrigin(0, 0.5);
  const leadingWidth = row.leading ? 20 : 0;
  const trailingWidth = row.trailing ? 36 : 0;
  const primaryLeft = row.leading ? 28 : 8;
  const primaryRight = row.trailing ? rect.width - trailingWidth - 8 : rect.width - 8;
  const primaryWidth = Math.max(16, primaryRight - primaryLeft);

  const leadingText = row.leading
    ? createUiText(scene, 8, rect.height / 2, row.leading, {
        variant: 'caption',
        script: inferTextScript(row.leading),
        style: {
          fontSize: '7px',
          color: emphasized ? palette.text : palette.mutedText,
        },
      })
        .setOrigin(0, 0.5)
        .setPadding(0, 0, 0, 0)
    : null;
  const primaryText = createUiText(scene, primaryLeft, rect.height / 2, row.primary, {
    variant: 'caption',
    script: inferTextScript(row.primary),
    style: {
      fontSize: '8px',
      color: palette.text,
    },
  })
    .setOrigin(0, 0.5)
    .setPadding(0, 0, 0, 0);
  const trailingText = row.trailing
    ? createUiText(scene, rect.width - 8, rect.height / 2, row.trailing, {
        variant: 'caption',
        script: inferTextScript(row.trailing),
        style: {
          fontSize: '7px',
          color: emphasized ? palette.text : palette.mutedText,
        },
      })
        .setOrigin(1, 0.5)
        .setPadding(0, 0, 0, 0)
    : null;

  if (leadingText) {
    fitRankedText(leadingText, row.leading ?? '', leadingWidth);
  }
  fitRankedText(primaryText, row.primary, primaryWidth);
  if (trailingText) {
    fitRankedText(trailingText, row.trailing ?? '', trailingWidth);
  }

  container.setSize(rect.width, rect.height);
  container.add(background);
  container.add(accentBar);
  if (leadingText) {
    container.add(leadingText);
  }
  container.add(primaryText);
  if (trailingText) {
    container.add(trailingText);
  }

  return container;
}
