import type Phaser from 'phaser';

import type { RankedFitTextOptions } from './shared';

export function fitRankedText(
  textObject: Phaser.GameObjects.Text,
  value: string,
  maxWidth: number,
  options?: RankedFitTextOptions,
): string {
  const ellipsis = options?.ellipsis ?? '…';

  textObject.setText(value);

  if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
    textObject.setText('');
    return '';
  }

  if (textObject.width <= maxWidth) {
    return value;
  }

  textObject.setText(ellipsis);

  if (textObject.width > maxWidth) {
    textObject.setText('');
    return '';
  }

  let low = 0;
  let high = value.length;
  let best = ellipsis;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = `${value.slice(0, middle)}${ellipsis}`;
    textObject.setText(candidate);

    if (textObject.width <= maxWidth) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  textObject.setText(best);
  return best;
}
