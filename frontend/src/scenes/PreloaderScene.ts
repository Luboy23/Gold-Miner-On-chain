import Phaser from 'phaser';

import { ANIMATION_KEYS } from '../game/constants';
import { LOGIC_CENTER_X } from '../game/constants';
import { configureLogicalCamera } from '../game/display';
import { SCENE_KEYS } from '../game/sceneKeys';
import { createUiText } from '../game/uiText';
import type { AssetManifest, PreloaderSceneData } from '../game/types/index';

export class PreloaderScene extends Phaser.Scene {
  private manifest?: AssetManifest;
  private progressBar?: Phaser.GameObjects.Graphics;
  private progressBox?: Phaser.GameObjects.Graphics;
  private progressLabel?: Phaser.GameObjects.Text;

  constructor() {
    super(SCENE_KEYS.Preloader);
  }

  init(data: PreloaderSceneData): void {
    this.manifest = data.manifest;
  }

  preload(): void {
    if (!this.manifest) {
      throw new Error('PreloaderScene requires an asset manifest.');
    }

    configureLogicalCamera(this);
    this.createLoadingUi();
    this.bindLoaderEvents();
    this.queueManifestAssets(this.manifest);
  }

  create(): void {
    void this.finishSetup();
  }

  private createLoadingUi(): void {
    this.progressBox = this.add.graphics();
    this.progressBox.fillStyle(0x3a220c, 0.95);
    this.progressBox.fillRoundedRect(40, 112, 240, 18, 4);

    this.progressBar = this.add.graphics();
    this.progressLabel = createUiText(this, LOGIC_CENTER_X, 94, 'Loading 0%', {
      variant: 'status',
      script: 'mixed',
      style: {
        fontSize: '12px',
        color: '#f7d54a',
      },
    }).setOrigin(0.5);
  }

  private bindLoaderEvents(): void {
    this.load.on('progress', (value: number) => {
      this.progressBar?.clear();
      this.progressBar?.fillStyle(0xf7d54a, 1);
      this.progressBar?.fillRoundedRect(44, 116, 232 * value, 10, 4);
      this.progressLabel?.setText(`Loading ${Math.round(value * 100)}%`);
    });
  }

  private queueManifestAssets(manifest: AssetManifest): void {
    const assetPath = (path: string): string =>
      `/${manifest.basePath}/${path}`.replaceAll('//', '/');

    Object.values(manifest.images).forEach((group) => {
      Object.entries(group).forEach(([key, path]) => {
        this.load.image(key, assetPath(path));
      });
    });

    Object.entries(manifest.audio.sfx).forEach(([key, path]) => {
      this.load.audio(key, assetPath(path));
    });

    Object.entries(manifest.audio.music).forEach(([key, path]) => {
      this.load.audio(key, assetPath(path));
    });

    Object.entries(manifest.spriteSheets).forEach(([key, config]) => {
      this.load.spritesheet(key, assetPath(config.path), {
        frameWidth: config.frameWidth,
        frameHeight: config.frameHeight,
      });
    });
  }

  private async finishSetup(): Promise<void> {
    if (!this.manifest) {
      throw new Error('Missing asset manifest after preload.');
    }

    this.progressLabel?.setText('Preparing fonts...');
    await this.loadFonts(this.manifest);
    this.registerAnimations();
    this.scene.start(SCENE_KEYS.Menu);
  }

  private async loadFonts(manifest: AssetManifest): Promise<void> {
    const fontEntries = [
      ['PixelSquare', manifest.fonts.pixelSquare],
      ['Kurland', manifest.fonts.kurland],
      ['Visitor', manifest.fonts.visitor],
    ] as const;

    await Promise.all(
      fontEntries.map(async ([family, path]) => {
        const font = new FontFace(family, `url(/${manifest.basePath}/${path})`);
        await font.load();
        document.fonts.add(font);
      }),
    );

    await Promise.all([
      document.fonts.load('12px Visitor'),
      document.fonts.load('28px Kurland'),
    ]);
    await document.fonts.ready;
  }

  private registerAnimations(): void {
    if (this.anims.exists(ANIMATION_KEYS.minerIdle)) {
      return;
    }

    this.anims.create({
      key: ANIMATION_KEYS.minerIdle,
      frames: [{ key: 'miner', frame: 0 }],
      frameRate: 1,
      repeat: -1,
    });

    this.anims.create({
      key: ANIMATION_KEYS.minerGrab,
      frames: [{ key: 'miner', frame: 2 }],
      frameRate: 1,
      repeat: -1,
    });

    this.anims.create({
      key: ANIMATION_KEYS.minerGrabBack,
      frames: this.anims.generateFrameNumbers('miner', {
        frames: [0, 1, 2],
      }),
      frameRate: 8,
      repeat: -1,
    });

    this.anims.create({
      key: ANIMATION_KEYS.minerUseDynamite,
      frames: this.anims.generateFrameNumbers('miner', {
        frames: [3, 4, 5],
      }),
      frameRate: 8,
      repeat: -1,
    });

    this.anims.create({
      key: ANIMATION_KEYS.minerStrengthen,
      frames: this.anims.generateFrameNumbers('miner', {
        frames: [6, 7, 6, 7],
      }),
      frameRate: 8,
      repeat: -1,
    });

    this.anims.create({
      key: ANIMATION_KEYS.shopkeeperIdle,
      frames: [{ key: 'shopkeeper', frame: 0 }],
      frameRate: 1,
      repeat: -1,
    });

    this.anims.create({
      key: ANIMATION_KEYS.shopkeeperSad,
      frames: [{ key: 'shopkeeper', frame: 1 }],
      frameRate: 1,
      repeat: -1,
    });

    this.anims.create({
      key: ANIMATION_KEYS.hookIdle,
      frames: [{ key: 'hook', frame: 0 }],
      frameRate: 1,
      repeat: -1,
    });

    this.anims.create({
      key: ANIMATION_KEYS.hookGrabNormal,
      frames: [{ key: 'hook', frame: 1 }],
      frameRate: 1,
      repeat: -1,
    });

    this.anims.create({
      key: ANIMATION_KEYS.hookGrabMini,
      frames: [{ key: 'hook', frame: 2 }],
      frameRate: 1,
      repeat: -1,
    });

    this.anims.create({
      key: ANIMATION_KEYS.moleIdle,
      frames: [{ key: 'mole', frame: 0 }],
      frameRate: 1,
      repeat: -1,
    });

    this.anims.create({
      key: ANIMATION_KEYS.moleMove,
      frames: this.anims.generateFrameNumbers('mole', { start: 0, end: 6 }),
      frameRate: 7,
      repeat: -1,
    });

    this.anims.create({
      key: ANIMATION_KEYS.moleDiamondIdle,
      frames: [{ key: 'moleWithDiamond', frame: 0 }],
      frameRate: 1,
      repeat: -1,
    });

    this.anims.create({
      key: ANIMATION_KEYS.moleDiamondMove,
      frames: this.anims.generateFrameNumbers('moleWithDiamond', {
        start: 0,
        end: 6,
      }),
      frameRate: 7,
      repeat: -1,
    });

    this.anims.create({
      key: ANIMATION_KEYS.fxGoldBig,
      frames: this.anims.generateFrameNumbers('goldBigFx', { start: 0, end: 8 }),
      frameRate: 5,
      repeat: -1,
    });

    this.anims.create({
      key: ANIMATION_KEYS.fxExplosive,
      frames: this.anims.generateFrameNumbers('explosiveFx', {
        start: 0,
        end: 11,
      }),
      frameRate: 8,
      repeat: 0,
    });

    this.anims.create({
      key: ANIMATION_KEYS.fxExplosiveLarge,
      frames: this.anims.generateFrameNumbers('biggerExplosiveFx', {
        start: 0,
        end: 11,
      }),
      frameRate: 8,
      repeat: 0,
    });
  }
}
