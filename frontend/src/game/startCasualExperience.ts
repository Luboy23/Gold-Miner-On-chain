import type Phaser from 'phaser';

import { gameState } from './gameState';
import { SCENE_KEYS } from './sceneKeys';
import type { GoalScenePayload } from './types/index';

export function buildFreshCasualExperiencePayload(): GoalScenePayload {
  gameState.acknowledgeExperienceMode();
  gameState.resetForMenu();

  const run = gameState.startCasualRun();

  return {
    mode: 'next-goal',
    run,
  };
}

export function startFreshCasualExperience(scene: Phaser.Scene): void {
  scene.scene.start(
    SCENE_KEYS.Goal,
    buildFreshCasualExperiencePayload(),
  );
}
