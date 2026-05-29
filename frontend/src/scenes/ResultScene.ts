/**
 * ResultScene 负责把 run 结果分流成三种展示路径：
 * - casual：本地体验结果
 * - ranked：竞技结算 + 同步
 * - campaign：冒险结算 + 历史记录 + 同步
 *
 * 这个 scene 的核心约束是：它只消费已经封存好的 RunResult，不在这里修正 replay、
 * 不在这里重建 evidence，也不在这里替代 sync flow 解释业务真相。
 */
import Phaser from 'phaser';

import {
  createBrandFooter,
  type BrandFooterHandle,
  getBrandFooterLayout,
} from '../game/brandFooter';
import { LOGIC_CENTER_X, LOGIC_CENTER_Y } from '../game/constants';
import { configureLogicalCamera, setLogicalTextureSize } from '../game/display';
import { gameState } from '../game/gameState';
import { buildRestartSnapshot } from '../game/runRestart';
import { startFreshCasualExperience } from '../game/startCasualExperience';
import { web3State } from '../game/web3State';
import { createRankedBackdropOverlay } from '../game/ranked-ui/result';
import { SCENE_KEYS } from '../game/sceneKeys';
import type {
  RankedSyncStage,
  ResultScenePayload,
  RunResult,
} from '../game/types/index';
import { ResultActionDockController } from './result/ResultActionDockController';
import { buildResultViewModel } from './result/buildResultViewModel';
import { CasualResultController } from './result/CasualResultController';
import { ResultAnalysisController } from './result/ResultAnalysisController';
import { ResultHeaderController } from './result/ResultHeaderController';
import { ResultSummaryController } from './result/ResultSummaryController';
import { ResultSyncFlowController } from './result/ResultSyncFlowController';
import { ResultSyncController } from './result/ResultSyncController';
import {
  ResultRequestTracker,
  type ResultRequestKind,
  type ResultRequestToken,
} from './result/ResultRequestTracker';
import {
  getRankedRetryTarget,
  getRankedSyncEnvelope,
} from './result/rankedResultSelectors';
import {
  composeRankedResultSceneControllers,
  createResultSyncFlowController,
} from './result/ResultSceneComposition';
import { prepareRankedRunForChallenge } from '../game/rankedStart';
import { fetchCampaignHistory, fetchRankedOverview } from '../api/rankedApi';
import type { CampaignHistoryEntry, RankedOverview } from '../web3/types';

export class ResultScene extends Phaser.Scene {
  private result: RunResult | null = null;
  private rankedOverview: RankedOverview | null = null;
  private campaignHistory: CampaignHistoryEntry[] = [];
  private brandFooter: BrandFooterHandle | null = null;
  rankedSyncStage?: RankedSyncStage;
  rankedSyncMessage?: string;
  private rankedRoot?: Phaser.GameObjects.Container;
  private rankedHeaderController?: ResultHeaderController;
  private rankedSummaryController?: ResultSummaryController;
  private rankedAnalysisController?: ResultAnalysisController;
  private rankedSyncController?: ResultSyncController;
  private rankedActionDockController?: ResultActionDockController;
  private syncFlowController?: ResultSyncFlowController;
  private casualResultController?: CasualResultController;
  private readonly requestTracker = new ResultRequestTracker();
  private readonly handleCasualEnterKey = (): void => {
    this.restartCasualExperience();
  };
  private readonly handleCasualEscKey = (): void => {
    gameState.resetForMenu();
    this.scene.start(SCENE_KEYS.Menu);
  };
  private readonly handleRankedRetryKey = (): void => {
    if (!this.result) {
      return;
    }

    const viewModel = buildResultViewModel(
      this.result,
      this.rankedOverview,
      this.campaignHistory,
      Boolean(web3State.snapshot.address),
      this.syncFlowController?.getSnapshot() ?? {
        syncing: false,
        stage: 'idle',
        message: '',
      },
    );

    if (viewModel.actions.primaryKind === 'retry-sync') {
      void this.syncCurrentResult();
    }
  };
  private readonly handleRankedEnterKey = (): void => {
    this.handlePrimaryAction();
  };
  private readonly handleRankedEscKey = (): void => {
    if (this.result?.mode === 'campaign') {
      this.openAdventureCenter();
      return;
    }
    this.scene.start(SCENE_KEYS.Menu);
  };

  constructor() {
    super(SCENE_KEYS.Result);
  }

  init(data?: Partial<ResultScenePayload>): void {
    this.requestTracker.beginSession();
    this.result = data?.result ?? null;
    this.rankedOverview = null;
    this.campaignHistory = [];
    this.rankedSyncStage = undefined;
    this.rankedSyncMessage = undefined;
    if (import.meta.env.DEV && this.result) {
      window.__goldMinerResultPayload = this.result as unknown;
    }
  }

  create(): void {
    if (!this.result) {
      this.scene.start(SCENE_KEYS.Menu);
      return;
    }

    configureLogicalCamera(this);

    if (this.result.mode === 'casual') {
      setLogicalTextureSize(
        this.add.image(LOGIC_CENTER_X, LOGIC_CENTER_Y, 'goal').setOrigin(0.5),
        'goal',
      );
      this.brandFooter = createBrandFooter(
        this,
        getBrandFooterLayout('result-casual'),
      );
      gameState.applyRunResult(this.result);
      this.casualResultController = new CasualResultController(this, {
        onReplay: () => {
          this.restartCasualExperience();
        },
        onReturnToMenu: this.handleCasualEscKey,
      });
      this.casualResultController.show(this.result);
      this.input.keyboard?.on('keydown-ENTER', this.handleCasualEnterKey);
      this.input.keyboard?.on('keydown-ESC', this.handleCasualEscKey);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.casualResultController?.destroy();
        this.casualResultController = undefined;
        this.brandFooter?.destroy();
        this.brandFooter = null;
        this.input.keyboard?.off('keydown-ENTER', this.handleCasualEnterKey);
        this.input.keyboard?.off('keydown-ESC', this.handleCasualEscKey);
      });
      return;
    }

    setLogicalTextureSize(
      this.add.image(LOGIC_CENTER_X, LOGIC_CENTER_Y, 'goal').setOrigin(0.5),
      'goal',
    );
    createRankedBackdropOverlay(this, 0.58);
    this.brandFooter = createBrandFooter(
      this,
      getBrandFooterLayout('result-verified'),
    );
    gameState.resetForMenu();
    this.syncFlowController = createResultSyncFlowController(this, {
      onSnapshotChange: () => {
        if (!this.isSceneResultActive()) {
          return;
        }

        this.renderRankedResult();
      },
    });
    this.syncFlowController.initialize(this.result);

    this.renderRankedResult();
    this.bindRankedKeyboard();
    // ranked overview 和 campaign history 都属于结果页的补充读模型。
    // 它们晚到时只触发重渲染，不允许反向改写 result 本身。
    void this.loadRankedOverview();
    void this.loadCampaignHistory();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.rankedRoot?.destroy(true);
      this.rankedRoot = undefined;
      this.rankedHeaderController = undefined;
      this.rankedSummaryController = undefined;
      this.rankedAnalysisController = undefined;
      this.rankedSyncController = undefined;
      this.rankedActionDockController = undefined;
      this.syncFlowController = undefined;
      this.rankedSyncStage = undefined;
      this.rankedSyncMessage = undefined;
      this.brandFooter?.destroy();
      this.brandFooter = null;
      this.campaignHistory = [];
      const keyboard = this.input.keyboard;
      if (keyboard) {
        keyboard.off('keydown-ENTER', this.handleCasualEnterKey);
        keyboard.off('keydown-ESC', this.handleCasualEscKey);
        keyboard.off('keydown-R', this.handleRankedRetryKey);
        keyboard.off('keydown-ENTER', this.handleRankedEnterKey);
        keyboard.off('keydown-ESC', this.handleRankedEscKey);
      }
    });

    if (getRankedSyncEnvelope(this.result)) {
      void this.syncCurrentResult();
    } else if (this.result.campaignEvidence) {
      void this.syncCurrentResult();
    }
  }

  private bindRankedKeyboard(): void {
    const keyboard = this.input.keyboard;

    if (!keyboard) {
      return;
    }

    keyboard.on('keydown-R', this.handleRankedRetryKey);
    keyboard.on('keydown-ENTER', this.handleRankedEnterKey);
    keyboard.on('keydown-ESC', this.handleRankedEscKey);
  }

  private renderRankedResult(): void {
    if (!this.result) {
      return;
    }

    if (!this.rankedRoot) {
      this.createRankedResultRoot();
    }

    const viewModel = buildResultViewModel(
      this.result,
      this.rankedOverview,
      this.campaignHistory,
      Boolean(web3State.snapshot.address),
      this.getEffectiveSyncSnapshot(),
    );

    this.rankedHeaderController?.apply(viewModel.header);
    this.rankedSummaryController?.apply(viewModel.summary);
    this.rankedAnalysisController?.apply(viewModel.analysis);
    this.rankedSyncController?.apply(viewModel.sync);
    this.rankedActionDockController?.apply(viewModel.actions);
  }

  private createRankedResultRoot(): void {
    const controllers = composeRankedResultSceneControllers(this, {
      onPrimaryAction: () => {
        this.handlePrimaryAction();
      },
      onSecondaryAction: () => {
        this.handleSecondaryAction();
      },
    });
    this.rankedRoot = controllers.root;
    this.rankedHeaderController = controllers.headerController;
    this.rankedSummaryController = controllers.summaryController;
    this.rankedAnalysisController = controllers.analysisController;
    this.rankedSyncController = controllers.syncController;
    this.rankedActionDockController = controllers.actionDockController;
  }

  private handlePrimaryAction(): void {
    if (!this.result) {
      return;
    }

    const viewModel = buildResultViewModel(
      this.result,
      this.rankedOverview,
      this.campaignHistory,
      Boolean(web3State.snapshot.address),
      this.getEffectiveSyncSnapshot(),
    );

    if (viewModel.actions.primaryKind === 'retry-sync') {
      void this.syncCurrentResult();
      return;
    }

    if (viewModel.actions.primaryKind === 'retry-run') {
      void this.retryCurrentChallenge();
      return;
    }

    if (viewModel.actions.primaryKind === 'go-adventure') {
      this.openAdventureCenter();
      return;
    }

    if (viewModel.actions.primaryKind === 'go-menu') {
      this.scene.start(SCENE_KEYS.Menu);
    }
  }

  private handleSecondaryAction(): void {
    if (!this.result) {
      return;
    }

    const viewModel = buildResultViewModel(
      this.result,
      this.rankedOverview,
      this.campaignHistory,
      Boolean(web3State.snapshot.address),
      this.getEffectiveSyncSnapshot(),
    );

    if (viewModel.actions.secondaryKind === 'go-menu') {
      this.scene.start(SCENE_KEYS.Menu);
      return;
    }

    if (viewModel.actions.secondaryKind === 'retry-run') {
      void this.retryCurrentChallenge();
      return;
    }

    if (viewModel.actions.secondaryKind === 'go-adventure') {
      this.openAdventureCenter();
    }
  }

  private openAdventureCenter(): void {
    this.scene.start(SCENE_KEYS.AdventureCenter);
  }

  private restartCasualExperience(): void {
    startFreshCasualExperience(this);
  }

  private async syncCurrentResult(): Promise<void> {
    // 同步动作只把当前已封存的 result 交给 sync flow；结果页本身不参与 replay 修正。
    if (!this.result || !this.syncFlowController) {
      return;
    }

    const result = this.result;
    const syncFlowController = this.syncFlowController;
    const request = this.beginResultRequest('sync');

    await syncFlowController.sync(result, {
      acceptUpdate: () => this.canApplyResultRequest(request, result.mode),
    });
  }

  private async loadRankedOverview(): Promise<void> {
    const retryTarget = this.result ? getRankedRetryTarget(this.result) : null;
    const address = web3State.snapshot.address;

    if (
      !this.result ||
      this.result.mode !== 'ranked' ||
      !retryTarget ||
      !address
    ) {
      return;
    }

    const request = this.beginResultRequest('overview');

    try {
      const overview = await fetchRankedOverview(
        address,
        retryTarget.challengeId,
        retryTarget.version,
      );
      if (
        !this.canApplyResultRequest(request, 'ranked')
        || web3State.snapshot.address !== address
      ) {
        return;
      }

      this.rankedOverview = overview;
      this.renderRankedResult();
    } catch {
      if (
        !this.canApplyResultRequest(request, 'ranked')
        || web3State.snapshot.address !== address
      ) {
        return;
      }

      this.rankedOverview = null;
      this.renderRankedResult();
    }
  }

  private async loadCampaignHistory(): Promise<void> {
    // campaign 结果页右侧历史记录是展示性补充数据，不是本次 run 的真相源。
    // 拉取失败时必须静默回落为空列表，不能阻塞结算页主链路。
    const address = web3State.snapshot.address;

    if (!this.result || this.result.mode !== 'campaign' || !address) {
      this.campaignHistory = [];
      return;
    }

    const request = this.beginResultRequest('history');

    try {
      const history = await fetchCampaignHistory(address, 3);
      if (
        !this.canApplyResultRequest(request, 'campaign')
        || web3State.snapshot.address !== address
      ) {
        return;
      }

      this.campaignHistory = history;
      this.renderRankedResult();
    } catch {
      if (
        !this.canApplyResultRequest(request, 'campaign')
        || web3State.snapshot.address !== address
      ) {
        return;
      }

      this.campaignHistory = [];
      this.renderRankedResult();
    }
  }

  private async retryCurrentChallenge(): Promise<void> {
    const retryTarget = this.result ? getRankedRetryTarget(this.result) : null;

    if (!retryTarget) {
      return;
    }

    try {
      const run = await prepareRankedRunForChallenge(retryTarget);
      this.scene.start(SCENE_KEYS.Gameplay, {
        run,
        restartSnapshot: buildRestartSnapshot(run),
      });
    } catch (error) {
      this.rankedSyncStage = 'failed';
      this.rankedSyncMessage =
        error instanceof Error ? error.message : '重开当前挑战失败';
      this.renderRankedResult();
    }
  }

  private getEffectiveSyncSnapshot(): {
    syncing: boolean;
    stage: RankedSyncStage;
    message: string;
  } {
    // 结果页允许用 scene 级的临时覆盖态覆盖 sync flow snapshot，
    // 但只覆盖展示，不回写到底层 sync 账本。
    const base =
      this.syncFlowController?.getSnapshot() ?? {
        syncing: false,
        stage: 'idle' as RankedSyncStage,
        message: '',
      };

    if (!this.rankedSyncStage && !this.rankedSyncMessage) {
      return base;
    }

    return {
      syncing: base.syncing,
      stage: this.rankedSyncStage ?? base.stage,
      message: this.rankedSyncMessage ?? base.message,
    };
  }

  private beginResultRequest(kind: ResultRequestKind): ResultRequestToken {
    return this.requestTracker.beginRequest(kind);
  }

  private canApplyResultRequest(
    request: ResultRequestToken,
    expectedMode?: RunResult['mode'],
  ): boolean {
    return this.requestTracker.isCurrent(request)
      && this.isSceneResultActive(expectedMode);
  }

  private isSceneResultActive(expectedMode?: RunResult['mode']): boolean {
    if (!this.sys.isActive() || !this.result) {
      return false;
    }

    return !expectedMode || this.result.mode === expectedMode;
  }
}
