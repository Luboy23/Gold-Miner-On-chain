import type Phaser from 'phaser';

import { buildRestartSnapshot } from '../../game/runRestart';
import { SCENE_KEYS } from '../../game/sceneKeys';
import type {
  GoalSceneMode,
  RunRestartSnapshot,
  RunState,
} from '../../game/types/index';

export class GoalSceneNavigationController {
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  goToNextCasualScene(
    mode: GoalSceneMode,
    run: RunState | null,
    restartSnapshot: RunRestartSnapshot | null = null,
  ): void {
    if (!run) {
      this.scene.scene.start(SCENE_KEYS.Menu);
      return;
    }

    if (mode === 'level-clear') {
      this.scene.scene.start(SCENE_KEYS.Shop, {
        run,
        restartSnapshot: restartSnapshot ?? buildRestartSnapshot(run),
      });
      return;
    }

    this.scene.scene.start(SCENE_KEYS.Gameplay, {
      run,
      restartSnapshot: buildRestartSnapshot(run),
    });
  }

  goToGameplay(run: RunState | null): void {
    if (!run) {
      this.scene.scene.start(SCENE_KEYS.Menu);
      return;
    }

    this.scene.scene.start(SCENE_KEYS.Gameplay, {
      run,
      restartSnapshot: buildRestartSnapshot(run),
    });
  }

  goBackToRanked(): void {
    this.scene.scene.start(SCENE_KEYS.Ranked);
  }
}
