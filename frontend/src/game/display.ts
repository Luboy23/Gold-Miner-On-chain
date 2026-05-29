import type Phaser from 'phaser';

import {
  GAMEPLAY_BACKGROUND_HEIGHT,
  GAMEPLAY_TOP_HEIGHT,
  LOGIC_CENTER_X,
  LOGIC_CENTER_Y,
  LOGIC_HEIGHT,
  LOGIC_WIDTH,
  RENDER_SCALE,
} from './constants';

type TextureDisplaySize = {
  width: number;
  height: number;
};

export const LOGICAL_TEXTURE_DISPLAY_SIZES: Record<string, TextureDisplaySize> = {
  menu: { width: LOGIC_WIDTH, height: LOGIC_HEIGHT },
  goal: { width: LOGIC_WIDTH, height: LOGIC_HEIGHT },
  shop: { width: LOGIC_WIDTH, height: LOGIC_HEIGHT },
  levelCommonTop: { width: LOGIC_WIDTH, height: GAMEPLAY_TOP_HEIGHT },
  levelA: { width: LOGIC_WIDTH, height: GAMEPLAY_BACKGROUND_HEIGHT },
  levelB: { width: LOGIC_WIDTH, height: GAMEPLAY_BACKGROUND_HEIGHT },
  levelC: { width: LOGIC_WIDTH, height: GAMEPLAY_BACKGROUND_HEIGHT },
  levelD: { width: LOGIC_WIDTH, height: GAMEPLAY_BACKGROUND_HEIGHT },
  levelE: { width: LOGIC_WIDTH, height: GAMEPLAY_BACKGROUND_HEIGHT },
  miniGold: { width: 10, height: 8 },
  normalGold: { width: 15, height: 13 },
  normalGoldPlus: { width: 20, height: 18 },
  bigGold: { width: 32, height: 29 },
  miniRock: { width: 15, height: 11 },
  normalRock: { width: 22, height: 19 },
  bigRock: { width: 32, height: 28 },
  questionBag: { width: 20, height: 23 },
  diamond: { width: 10, height: 8 },
  skull: { width: 18, height: 17 },
  bone: { width: 20, height: 13 },
  tnt: { width: 26, height: 33 },
  tntDestroyed: { width: 13, height: 11 },
  miner: { width: 32, height: 40 },
  shopkeeper: { width: 80, height: 80 },
  mole: { width: 18, height: 13 },
  moleWithDiamond: { width: 18, height: 13 },
  hook: { width: 13, height: 15 },
  dynamite: { width: 18, height: 35 },
  strengthDrink: { width: 39, height: 43 },
  luckyClover: { width: 21, height: 38 },
  rockCollectorsBook: { width: 40, height: 37 },
  gemPolish: { width: 27, height: 32 },
  title: { width: 212, height: 43 },
  menuArrow: { width: 16, height: 16 },
  panel: { width: 266, height: 120 },
  dialogueBubble: { width: 200, height: 49 },
  selector: { width: 12, height: 14 },
  dynamiteUi: { width: 6, height: 11 },
  strengthLabel: { width: 64, height: 25 },
  goldBigFx: { width: 54, height: 54 },
  explosiveFx: { width: 64, height: 64 },
  biggerExplosiveFx: { width: 100, height: 100 },
  appIcon: { width: 256, height: 256 },
};

type ResizableTextureObject = Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;

export function configureLogicalCamera(
  scene: Phaser.Scene,
  backgroundColor = '#120b04',
): void {
  const camera = scene.cameras.main;

  camera.setBackgroundColor(backgroundColor);
  camera.setBounds(0, 0, LOGIC_WIDTH, LOGIC_HEIGHT);
  camera.setZoom(RENDER_SCALE);
  camera.centerOn(LOGIC_CENTER_X, LOGIC_CENTER_Y);
  camera.roundPixels = false;
}

export function setLogicalTextureSize<T extends ResizableTextureObject>(
  gameObject: T,
  textureKey: string,
  scale = 1,
): T {
  const size = LOGICAL_TEXTURE_DISPLAY_SIZES[textureKey];

  if (!size) {
    return gameObject;
  }

  gameObject.setDisplaySize(size.width * scale, size.height * scale);
  return gameObject;
}
