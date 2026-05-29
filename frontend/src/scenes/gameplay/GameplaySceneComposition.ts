import type Phaser from 'phaser';

import { GameplayEntityFactory } from './GameplayEntityFactory';
import { GameplayHudController } from './GameplayHudController';
import { GameplayInputController } from './GameplayInputController';
import { GameplayLoopCoordinator } from './GameplayLoopCoordinator';
import { GameplayOutcomeController } from './GameplayOutcomeController';
import { GameplayPresentationController } from './GameplayPresentationController';
import { RankedDiamondRushController } from './RankedDiamondRushController';

export interface GameplaySceneControllers {
  hudController: GameplayHudController;
  rankedDiamondRushController: RankedDiamondRushController;
  outcomeController: GameplayOutcomeController;
  presentationController: GameplayPresentationController;
  inputController: GameplayInputController;
  entityFactory: GameplayEntityFactory;
  loopCoordinator: GameplayLoopCoordinator;
}

export function composeGameplaySceneControllers(
  scene: Phaser.Scene,
  existingRankedController?: RankedDiamondRushController | null,
): GameplaySceneControllers {
  return {
    hudController: new GameplayHudController(scene),
    rankedDiamondRushController: existingRankedController ?? new RankedDiamondRushController(),
    outcomeController: new GameplayOutcomeController(scene),
    presentationController: new GameplayPresentationController(scene),
    inputController: new GameplayInputController(scene),
    entityFactory: new GameplayEntityFactory(scene),
    loopCoordinator: new GameplayLoopCoordinator(),
  };
}
