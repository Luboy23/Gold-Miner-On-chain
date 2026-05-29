import Phaser from 'phaser';

import {
  type BrandFooterLayout,
  getBrandFooterLayout,
} from './brandFooterLayout';
import { createUiText } from './uiText';

export type BrandFooterHandle = {
  destroy: () => void;
  setVisible: (visible: boolean) => void;
};

type CreateBrandFooterOptions = BrandFooterLayout & {
  depth?: number;
  text?: string;
};

const DEFAULT_FOOTER_TEXT = '© 2026 lllu_23 · GoldMiner On-chain';
const DEFAULT_FOOTER_DEPTH = 48;
const FOOTER_TEXT_COLOR = '#fff4d0';
const FOOTER_LINE_COLOR = 0xf7d54a;
const FOOTER_SHADOW_COLOR = 0x120b04;
const FOOTER_SHADOW_TEXT = '#120b04';
export { getBrandFooterLayout };
export type { BrandFooterLayout, BrandFooterVariant } from './brandFooterLayout';

export function createBrandFooter(
  scene: Phaser.Scene,
  options: CreateBrandFooterOptions,
): BrandFooterHandle {
  const depth = options.depth ?? DEFAULT_FOOTER_DEPTH;
  const root = scene.add.container(0, 0).setDepth(depth).setName('brand.footer');
  const ornament = scene.add.graphics().setDepth(depth);
  const text = options.text ?? DEFAULT_FOOTER_TEXT;

  const label = createUiText(scene, options.x, options.y, text, {
    variant: 'caption',
    script: 'mixed',
    style: {
      fontSize: options.variant === 'wide' ? '7px' : '6px',
      color: FOOTER_TEXT_COLOR,
    },
  })
    .setOrigin(1, 1)
    .setAlpha(options.variant === 'wide' ? 0.88 : 0.82)
    .setShadow(0, 1, FOOTER_SHADOW_TEXT, 1.1, false, true)
    .setName('brand.footer.label');

  if (options.variant === 'wide') {
    drawWideFooter(ornament, options.x, options.y);
  } else {
    drawMicroFooter(ornament, options.x, options.y);
  }

  root.add([ornament, label]);

  return {
    destroy: () => {
      root.destroy(true);
    },
    setVisible: (visible: boolean) => {
      root.setVisible(visible);
    },
  };
}

function drawWideFooter(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
): void {
  graphics.clear();
  // 右下角布局下，装饰记号贴着文案左侧，避免正文尾部显得过重。
  const diamond = [
    new Phaser.Geom.Point(x - 6, y - 10),
    new Phaser.Geom.Point(x - 3, y - 8),
    new Phaser.Geom.Point(x - 6, y - 6),
    new Phaser.Geom.Point(x - 9, y - 8),
  ];
  graphics.fillStyle(0xffefc8, 0.4);
  graphics.lineStyle(1, FOOTER_SHADOW_COLOR, 0.22);
  graphics.fillPoints(diamond, true);
  graphics.strokePoints(diamond, true);

  graphics.fillStyle(FOOTER_LINE_COLOR, 0.28);
  graphics.fillCircle(x - 13, y - 8, 1.1);
}

function drawMicroFooter(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
): void {
  graphics.clear();
  graphics.lineStyle(1, FOOTER_SHADOW_COLOR, 0.18);
  graphics.beginPath();
  graphics.moveTo(x + 1, y - 6);
  graphics.lineTo(x - 9, y - 6);
  graphics.strokePath();

  graphics.lineStyle(1, FOOTER_LINE_COLOR, 0.54);
  graphics.beginPath();
  graphics.moveTo(x, y - 7);
  graphics.lineTo(x - 8, y - 7);
  graphics.strokePath();

  graphics.fillStyle(0xffefc8, 0.42);
  graphics.fillCircle(x - 12, y - 7, 1.35);
}
