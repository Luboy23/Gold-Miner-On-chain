import Phaser from 'phaser';

import { configureLogicalCamera } from '../game/display';
import { LOGIC_CENTER_X, LOGIC_CENTER_Y } from '../game/constants';
import { gameState } from '../game/gameState';
import { web3State } from '../game/web3State';
import { SCENE_KEYS } from '../game/sceneKeys';
import { createUiText } from '../game/uiText';
import { isAssetManifest, type PreloaderSceneData } from '../game/types/index';
import { loadRuntimeConfig } from '../web3/runtime/config';
import type { GameplayScene } from './GameplayScene';
import type { GoalScene } from './GoalScene';
import type { AdventureCenterScene } from './AdventureCenterScene';
import type { RankedScene } from './RankedScene';
import type { ResultScene } from './ResultScene';
import type { ShopScene } from './ShopScene';

export class BootScene extends Phaser.Scene {
  private statusText?: Phaser.GameObjects.Text;

  constructor() {
    super(SCENE_KEYS.Boot);
  }

  create(): void {
    configureLogicalCamera(this);

    this.statusText = createUiText(
      this,
      LOGIC_CENTER_X,
      LOGIC_CENTER_Y,
      'Loading manifest...',
      {
        variant: 'status',
        script: 'mixed',
        style: {
        fontSize: '14px',
        color: '#f7d54a',
        align: 'center',
        },
      },
    ).setOrigin(0.5);

    void this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    try {
      await loadRuntimeConfig();
      gameState.bootstrap();
      await web3State.bootstrap();
      await this.registerDeferredScenes();

      const response = await fetch('/assets/phaser-asset-manifest.json', {
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`Manifest request failed with status ${response.status}.`);
      }

      const manifest = (await response.json()) as unknown;

      if (!isAssetManifest(manifest)) {
        throw new Error('Invalid asset manifest structure.');
      }

      gameState.setManifest(manifest);
      this.statusText?.setText('Manifest ready');

      const payload: PreloaderSceneData = { manifest };
      this.scene.start(SCENE_KEYS.Preloader, payload);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown boot error.';

      this.statusText?.setText(`Boot failed\n${message}`);
      this.statusText?.setColor('#ff8b73');
    }
  }

  private async registerDeferredScenes(): Promise<void> {
    const manager = this.scene.manager;
    const registrations: Array<Promise<void>> = [];

    if (!manager.keys[SCENE_KEYS.Ranked]) {
      registrations.push(
        import('./RankedScene').then((module) => {
          manager.add(
            SCENE_KEYS.Ranked,
            module.RankedScene as typeof RankedScene,
            false,
          );
        }),
      );
    }

    if (!manager.keys[SCENE_KEYS.AdventureCenter]) {
      registrations.push(
        import('./AdventureCenterScene').then((module) => {
          manager.add(
            SCENE_KEYS.AdventureCenter,
            module.AdventureCenterScene as typeof AdventureCenterScene,
            false,
          );
        }),
      );
    }

    if (!manager.keys[SCENE_KEYS.Result]) {
      registrations.push(
        import('./ResultScene').then((module) => {
          manager.add(
            SCENE_KEYS.Result,
            module.ResultScene as typeof ResultScene,
            false,
          );
        }),
      );
    }

    if (!manager.keys[SCENE_KEYS.Goal]) {
      registrations.push(
        import('./GoalScene').then((module) => {
          manager.add(
            SCENE_KEYS.Goal,
            module.GoalScene as typeof GoalScene,
            false,
          );
        }),
      );
    }

    if (!manager.keys[SCENE_KEYS.Gameplay]) {
      registrations.push(
        import('./GameplayScene').then((module) => {
          manager.add(
            SCENE_KEYS.Gameplay,
            module.GameplayScene as typeof GameplayScene,
            false,
          );
        }),
      );
    }

    if (!manager.keys[SCENE_KEYS.Shop]) {
      registrations.push(
        import('./ShopScene').then((module) => {
          manager.add(
            SCENE_KEYS.Shop,
            module.ShopScene as typeof ShopScene,
            false,
          );
        }),
      );
    }

    await Promise.all(registrations);
  }
}
