import type Phaser from 'phaser';

import { ResultActionDockController } from './ResultActionDockController';
import { ResultAnalysisController } from './ResultAnalysisController';
import { ResultHeaderController } from './ResultHeaderController';
import { ResultSummaryController } from './ResultSummaryController';
import { ResultSyncController } from './ResultSyncController';
import { ResultSyncFlowController } from './ResultSyncFlowController';

export interface RankedResultSceneControllers {
  root: Phaser.GameObjects.Container;
  headerController: ResultHeaderController;
  summaryController: ResultSummaryController;
  analysisController: ResultAnalysisController;
  syncController: ResultSyncController;
  actionDockController: ResultActionDockController;
}

export function composeRankedResultSceneControllers(
  scene: Phaser.Scene,
  options: {
    onPrimaryAction: () => void;
    onSecondaryAction: () => void;
  },
): RankedResultSceneControllers {
  const root = scene.add.container(0, 0);

  return {
    root,
    headerController: new ResultHeaderController(scene, root),
    summaryController: new ResultSummaryController(scene, root),
    analysisController: new ResultAnalysisController(scene, root),
    syncController: new ResultSyncController(scene, root),
    actionDockController: new ResultActionDockController(scene, root, {
      onPrimaryAction: options.onPrimaryAction,
      onSecondaryAction: options.onSecondaryAction,
    }),
  };
}

export function createResultSyncFlowController(
  scene: Phaser.Scene,
  callbacks: {
    onSnapshotChange: () => void;
  },
): ResultSyncFlowController {
  return new ResultSyncFlowController(scene, {
    onSnapshotChange: callbacks.onSnapshotChange,
  });
}
