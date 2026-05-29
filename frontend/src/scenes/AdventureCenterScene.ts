import Phaser from 'phaser';
import { keccak256, stringToHex } from 'viem';

import {
  type AdventureCampaignPreparation,
  fetchCampaignHistory,
} from '../api/rankedApi';
import { applyChallengeHubViewModel } from '../game/challengeHubSceneController';
import { ChallengeHubLayout } from '../game/challengeHubLayout';
import {
  createBrandFooter,
  type BrandFooterHandle,
  getBrandFooterLayout,
} from '../game/brandFooter';
import { LOGIC_CENTER_X, LOGIC_CENTER_Y } from '../game/constants';
import { configureLogicalCamera, setLogicalTextureSize } from '../game/display';
import { gameState } from '../game/gameState';
import {
  summarizeAdventureHistory,
  type AdventureHistorySummary,
} from '../game/adventureSummary';
import {
  formatAdventureStartError,
  prepareAdventureCampaign,
  type AdventureStartStage,
} from '../game/adventureStart';
import { createRankedBackdropOverlay } from '../game/ranked-ui/hub';
import { SCENE_KEYS } from '../game/sceneKeys';
import type {
  AdventureCenterScenePayload,
  RankedBoardSectionViewModel,
  RankedUiTone,
} from '../game/types/index';
import { web3State, type Web3StateShape } from '../game/web3State';
import { getRuntimeConfig } from '../web3/runtime/config';
import type { CampaignHistoryEntry } from '../web3/types';

/**
 * AdventureCenterScene 是冒险模式的中心页。
 *
 * 它与排位中心的区别在于：
 * - 左侧主卡展示的是多关 campaign 历史，而不是单 challenge 历史
 * - 右侧展示“最佳进度”摘要，而不是竞技诊断
 * - 主按钮既可能进入“准备中的 campaign”，也可能发起新的 campaign 准备流程
 */
type AdventureCenterViewModel = {
  header: {
    title: string;
    bestLabel: string;
  };
  history: RankedBoardSectionViewModel;
  summary: RankedBoardSectionViewModel;
  statusBanner: {
    text: string;
    tone: RankedUiTone;
  };
  actions: {
    startLabel: string;
    startHotkey?: string;
    canStart: boolean;
    backLabel: string;
    backHotkey?: string;
  };
};

export class AdventureCenterScene extends Phaser.Scene {
  private layout?: ChallengeHubLayout;
  private unsubscribeWeb3?: () => void;
  private brandFooter?: BrandFooterHandle;
  private history: CampaignHistoryEntry[] = [];
  private refreshing = false;
  private actionInFlight = false;
  private leavingScene = false;
  private localMessage = '';
  private localTone: RankedUiTone = 'info';
  private preparedCampaign: AdventureCampaignPreparation | null = null;
  private readonly handleEscKey = (): void => {
    this.goBackToMenu();
  };
  private readonly handleEnterKey = (): void => {
    void this.handlePrimaryAction();
  };

  constructor() {
    super(SCENE_KEYS.AdventureCenter);
  }

  init(data?: AdventureCenterScenePayload): void {
    this.leavingScene = false;
    this.localMessage = data?.statusMessage ?? '';
    this.localTone = data?.statusTone ?? 'info';
  }

  create(): void {
    configureLogicalCamera(this);

    setLogicalTextureSize(
      this.add.image(LOGIC_CENTER_X, LOGIC_CENTER_Y, 'goal').setOrigin(0.5),
      'goal',
    );
    createRankedBackdropOverlay(this, 0.58);

    this.bindKeyboard();
    this.layout = new ChallengeHubLayout(this);
    this.brandFooter = createBrandFooter(
      this,
      getBrandFooterLayout('adventure-center'),
    );
    this.refreshView(web3State.snapshot);

    this.unsubscribeWeb3 = web3State.subscribe((state) => {
      if (!state.address) {
        this.history = [];
        this.preparedCampaign = null;
      }
      this.refreshView(state);
      void this.refreshRemoteData();
    });
    void this.refreshRemoteData();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.leavingScene = true;
      this.layout?.destroy();
      this.layout = undefined;
      this.brandFooter?.destroy();
      this.brandFooter = undefined;
      this.unsubscribeWeb3?.();
      this.unsubscribeWeb3 = undefined;
      const keyboard = this.input.keyboard;
      if (keyboard) {
        keyboard.off('keydown-ESC', this.handleEscKey);
        keyboard.off('keydown-ENTER', this.handleEnterKey);
      }
    });
  }

  private bindKeyboard(): void {
    const keyboard = this.input.keyboard;

    if (!keyboard) {
      return;
    }

    keyboard.on('keydown-ESC', this.handleEscKey);
    keyboard.on('keydown-ENTER', this.handleEnterKey);
  }

  private async refreshRemoteData(): Promise<void> {
    const state = web3State.snapshot;
    if (this.refreshing) {
      return;
    }

    if (!state.address) {
      this.history = [];
      this.preparedCampaign = null;
      if (!this.localMessage) {
        this.showStatus('', 'info');
      }
      this.refreshView(state);
      return;
    }

    this.refreshing = true;
    if (!this.localMessage) {
      this.showStatus('', 'info');
    }
    this.refreshView(state);

    try {
      // 约束：左侧历史虽然最多保留 8 条，但布局只展示 3 条可视窗口，
      // 其余条目通过卡片内部滚动查看，不允许再改写整页骨架。
      this.history = await fetchCampaignHistory(state.address, 8);
      if (!this.localMessage) {
        this.showStatus('', 'info');
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '读取冒险历史失败';
      if (!this.leavingScene) {
        this.showStatus(message, 'danger');
      }
    } finally {
      this.refreshing = false;
      if (!this.leavingScene && this.sys.isActive()) {
        this.refreshView(web3State.snapshot);
      }
    }
  }

  private async handlePrimaryAction(): Promise<void> {
    if (this.actionInFlight) {
      return;
    }

    if (this.preparedCampaign) {
      // 一旦 campaign 已准备完成，主按钮的语义就切换为“消费已准备好的会话”，
      // 而不是重新发起一次新的 prepare 请求。
      this.enterPreparedCampaign();
      return;
    }

    const state = web3State.snapshot;
    if (!state.address || !state.isSupportedChain) {
      this.preparedCampaign = null;
      this.showStatus('请先连接钱包并切换到目标网络。', 'danger');
      this.refreshView(state);
      return;
    }

    this.actionInFlight = true;
    this.showStatus('正在准备冒险...', 'info');
    this.refreshView(state);

    try {
      this.preparedCampaign = await prepareAdventureCampaign({
        onStageStart: (stage: AdventureStartStage) => {
          this.showStatus(
            stage === 'building-run'
              ? '正在进入第一关...'
              : stage === 'creating-session'
                ? '正在准备本次冒险...'
                : stage === 'awaiting-signature'
                  ? '等待钱包签名...'
                  : stage === 'activating-session'
                    ? '正在确认本次冒险...'
                    : stage === 'switching-chain'
                      ? '正在切换网络...'
                      : '正在连接钱包...',
            'info',
          );
          this.refreshView(web3State.snapshot);
        },
      });
      this.showStatus('冒险已就绪，按 Enter 开始', 'success');
    } catch (error) {
      this.preparedCampaign = null;
      this.showStatus(formatAdventureStartError(error), 'danger');
    } finally {
      this.actionInFlight = false;
      if (!this.leavingScene && this.sys.isActive()) {
        this.refreshView(web3State.snapshot);
      }
    }
  }

  private enterPreparedCampaign(): void {
    if (!this.preparedCampaign) {
      return;
    }

    const clientBuildHash = keccak256(
      stringToHex(`${getRuntimeConfig().deploymentId}:frontend:campaign:v2`),
    );
    const run = gameState.startCampaignRun(this.preparedCampaign.levels, {
      campaignId: this.preparedCampaign.campaignId,
      sessionId: this.preparedCampaign.sessionId,
      campaignSeed: this.preparedCampaign.campaignSeed,
      clientBuildHash,
    });

    this.scene.start(SCENE_KEYS.Goal, {
      mode: 'next-goal',
      run,
    });
  }

  private refreshView(state: Readonly<Web3StateShape>): void {
    if (this.leavingScene || !this.sys.isActive() || !this.layout) {
      return;
    }

    const model = this.buildDashboardModel(state);
    // 场景层先把业务状态映射成 view model，再交给布局层渲染。
    // 布局层不直接读取 web3State/history，避免 UI 组件反向依赖业务状态。
    applyChallengeHubViewModel(this.layout, {
      header: {
        prefix: 'adventure',
        headerTitle: model.header.title,
        headerBestText: `最高分 ${model.header.bestLabel}`,
        leftTitle: model.history.title,
        rightTitle: model.summary.title,
        statusText: model.statusBanner.text,
        statusTone: model.statusBanner.tone,
      },
      leftSection: {
        prefix: 'adventure.board.history',
        section: model.history,
      },
      rightSection: {
        prefix: 'adventure.board.summary',
        section: model.summary,
      },
      status: {
        text: model.statusBanner.text,
        tone: model.statusBanner.tone,
      },
      actions: {
        primary: {
          name: 'adventure.actions.start',
          label: model.actions.startLabel,
          hotkey: model.actions.startHotkey,
          tone: model.actions.canStart ? 'success' : 'muted',
          disabled: !model.actions.canStart,
          onPress: () => {
            void this.handlePrimaryAction();
          },
        },
        secondary: {
          name: 'adventure.actions.back',
          label: model.actions.backLabel,
          hotkey: model.actions.backHotkey,
          tone: 'default',
          disabled: false,
          onPress: () => {
            this.goBackToMenu();
          },
        },
      },
    });
  }

  private buildDashboardModel(
    state: Readonly<Web3StateShape>,
  ): AdventureCenterViewModel {
    const hasConnectedWallet = Boolean(state.address);
    const summary = this.buildSummary(this.history);
    const bestLabel =
      summary.highestScore !== null ? `$${summary.highestScore}` : '暂无成绩';

    return {
      header: {
        title: '冒险中心',
        bestLabel,
      },
      history: {
        title: '冒险记录',
        // 这里统一展示用户语义上的“第N关”，不直接暴露内部 levelId 形式。
        rows:
          this.history.length > 0
            ? this.history.map((entry) => ({
                primary: `$${entry.result.finalScore} · 第${entry.result.reachedLevel}关`,
                secondary: entry.result.completed
                  ? '已通关'
                  : `到达第${entry.result.reachedLevel}关`,
              }))
            : [],
        emptyState:
          this.history.length > 0
            ? null
            : {
                primary: hasConnectedWallet ? '开始第一局冒险' : '连接钱包后查看你的历史成绩',
                secondary: hasConnectedWallet
                  ? '完成冒险后，这里会显示你的战绩'
                  : '连接钱包后查看冒险战绩',
                tone: 'muted',
              },
      },
      summary: {
        title: '最佳进度',
        rows:
          this.history.length > 0
            ? [
                {
                  primary:
                    summary.bestReachedLevel !== null
                      ? `最高到达第${summary.bestReachedLevel}关`
                      : '最高到达第0关',
                  secondary:
                    summary.highestScore !== null
                      ? `最高分 $${summary.highestScore}`
                      : '还没有最高分',
                },
                {
                  primary: summary.completedL10 ? '已通关第10关' : '尚未通关第10关',
                  secondary: summary.completedL10 ? '已通关全部关卡' : '继续挑战后面的关卡',
                },
              ]
            : [],
        emptyState:
          this.history.length > 0
            ? null
            : {
                primary: '尚未建立最佳进度',
                secondary: '尚未通关第10关',
                tone: 'muted',
              },
      },
      statusBanner: {
        text: this.localMessage || '查看战绩，继续闯关。',
        tone: this.localTone,
      },
      actions: {
        startLabel: this.preparedCampaign ? '进入第一关' : '开始冒险',
        startHotkey: 'Enter',
        canStart:
          (!!this.preparedCampaign && !this.actionInFlight) ||
          (!this.preparedCampaign &&
            hasConnectedWallet &&
            state.isSupportedChain &&
            !this.actionInFlight),
        backLabel: '返回主菜单',
        backHotkey: 'Esc',
      },
    };
  }

  private buildSummary(entries: CampaignHistoryEntry[]): AdventureHistorySummary {
    return summarizeAdventureHistory(entries);
  }

  private showStatus(message: string, tone: RankedUiTone): void {
    this.localMessage = message;
    this.localTone = tone;
  }

  public scrollHistoryBy(deltaY: number): void {
    this.layout?.scrollHistoryBy(deltaY);
  }

  public scrollHistoryDownForTests(): void {
    this.layout?.scrollHistoryBy(48);
  }

  public getHistoryScrollState(): {
    currentScrollY: number;
    maxScrollY: number;
    rowCount: number;
    scrollbarVisible: boolean;
  } | null {
    return this.layout?.getHistoryScrollState() ?? null;
  }

  private goBackToMenu(): void {
    gameState.resetForMenu();
    this.scene.start(SCENE_KEYS.Menu);
  }
}
