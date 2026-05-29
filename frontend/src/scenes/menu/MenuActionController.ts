import type Phaser from 'phaser';

import {
  formatAdventureStartError,
  prepareAdventureRun,
} from '../../game/adventureStart';
import { buildRestartSnapshot } from '../../game/runRestart';
import {
  formatRankedStartError,
  prepareRankedRun,
} from '../../game/rankedStart';
import { SCENE_KEYS } from '../../game/sceneKeys';
import { startFreshCasualExperience } from '../../game/startCasualExperience';
import { web3State } from '../../game/web3State';
import type { GoalScenePayload } from '../../game/types/index';

type MenuActionCallbacks = {
  onAdventureError: (message: string) => void;
  onRankedStageChange: (stage: string | null) => void;
  onRankedError: (message: string | null) => void;
};

export class MenuActionController {
  private rankedQuickStartBusy = false;
  private adventureQuickStartBusy = false;
  private readonly scene: Phaser.Scene;
  private readonly callbacks: MenuActionCallbacks;

  constructor(scene: Phaser.Scene, callbacks: MenuActionCallbacks) {
    this.scene = scene;
    this.callbacks = callbacks;
  }

  startExperience(): void {
    startFreshCasualExperience(this.scene);
  }

  startAdventureChallenge(): void {
    void this.startAdventureChallengeAsync();
  }

  startRankedChallenge(): void {
    void this.startRankedChallengeAsync();
  }

  openRankedCenter(): void {
    this.scene.scene.start(SCENE_KEYS.Ranked);
  }

  async openAdventureCenter(): Promise<void> {
    const state = web3State.snapshot;

    if (!state.walletAvailable || !state.address) {
      try {
        await web3State.connectWallet();
      } catch (error) {
        const message = error instanceof Error ? error.message : '连接钱包失败';
        this.callbacks.onAdventureError(message);
        return;
      }
    }

    if (!web3State.snapshot.address) {
      this.callbacks.onAdventureError('请先连接钱包');
      return;
    }

    this.scene.scene.start(SCENE_KEYS.AdventureCenter);
  }

  private async startAdventureChallengeAsync(): Promise<void> {
    if (this.adventureQuickStartBusy) {
      return;
    }

    this.adventureQuickStartBusy = true;
    web3State.clearError();
    this.callbacks.onAdventureError('');

    try {
      const run = await prepareAdventureRun();
      const payload: GoalScenePayload = {
        mode: 'next-goal',
        run,
      };

      this.scene.scene.start(SCENE_KEYS.Goal, payload);
    } catch (error) {
      const message = formatAdventureStartError(error);
      this.callbacks.onAdventureError(message);
    } finally {
      this.adventureQuickStartBusy = false;
    }
  }

  private async startRankedChallengeAsync(): Promise<void> {
    if (this.rankedQuickStartBusy) {
      return;
    }

    this.rankedQuickStartBusy = true;
    this.callbacks.onRankedStageChange(null);
    this.callbacks.onRankedError(null);
    web3State.clearError();
    this.callbacks.onAdventureError('');

    try {
      const run = await prepareRankedRun({
        onStageStart: (stage) => {
          this.callbacks.onRankedStageChange(stage);
          this.callbacks.onRankedError(null);
        },
      });

      this.scene.scene.start(SCENE_KEYS.Gameplay, {
        run,
        restartSnapshot: buildRestartSnapshot(run),
      });
    } catch (error) {
      const message = formatRankedStartError(error);
      this.callbacks.onRankedError(message);
      this.callbacks.onAdventureError(message);
    } finally {
      this.rankedQuickStartBusy = false;
      this.callbacks.onRankedStageChange(null);
    }
  }
}
