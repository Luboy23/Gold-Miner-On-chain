import Phaser from 'phaser';

import {
  fetchRankedOverview,
  fetchLeaderboard,
  fetchPlayerHistory,
} from '../api/rankedApi';
import {
  createBrandFooter,
  type BrandFooterHandle,
  getBrandFooterLayout,
} from '../game/brandFooter';
import { LOGIC_CENTER_X, LOGIC_CENTER_Y } from '../game/constants';
import { configureLogicalCamera, setLogicalTextureSize } from '../game/display';
import { gameState } from '../game/gameState';
import { buildRestartSnapshot } from '../game/runRestart';
import { getRankedChallengeDisplayName } from '../game/rankedChallengeDisplay';
import {
  formatRankedStartError,
  prepareRankedRun,
  RANKED_START_BUTTON_LABELS,
  RANKED_START_STAGE_MESSAGES,
  type RankedStartStage,
} from '../game/rankedStart';
import { createRankedBackdropOverlay } from '../game/ranked-ui/hub';
import {
  createRankedButton,
  createRankedCompactStatRow,
  createRankedDivider,
  createRankedPanel,
  createRankedEmptyState,
} from '../game/ranked-ui/hub';
import { SCENE_KEYS } from '../game/sceneKeys';
import type {
  RankedScenePayload,
  RankedUiTone,
} from '../game/types/index';
import { web3State, type Web3StateShape } from '../game/web3State';
import { createUiText } from '../game/uiText';
import type { LevelLeaderboardEntry, PlayerHistoryEntry, RankedOverview } from '../web3/types';

/**
 * RankedScene 是排位中心入口页。
 *
 * 这里负责把当前 challenge、个人进度、排行榜和历史记录组织成一个稳定的中心页，
 * 同时承接“开始排位挑战”的用户入口。
 *
 * 它不负责 replay、runtime 真值或结果同步，只负责：
 * - 自动拉取 read model
 * - 把启动阶段映射成页面状态
 * - 在用户确认后进入 gameplay scene
 */
export class RankedScene extends Phaser.Scene {
  private root?: Phaser.GameObjects.Container;
  private unsubscribeWeb3?: () => void;
  private brandFooter?: BrandFooterHandle;
  private leaderboard: LevelLeaderboardEntry[] = [];
  private history: PlayerHistoryEntry[] = [];
  private overview: RankedOverview | null = null;
  private refreshing = false;
  private actionInFlight = false;
  private rankedStartStage: RankedStartStage | null = null;
  private rankedStartError: string | null = null;
  private localMessage = '';
  private localTone: RankedUiTone = 'info';
  private leavingScene = false;
  private readonly handleEscKey = (): void => {
    this.goBackToMenu();
  };
  private readonly handleStartKey = (): void => {
    void this.startRankedChallenge();
  };

  constructor() {
    super(SCENE_KEYS.Ranked);
  }

  init(data?: RankedScenePayload): void {
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
    this.brandFooter = createBrandFooter(
      this,
      getBrandFooterLayout('ranked-center'),
    );

    this.bindKeyboard();
    this.refreshView(web3State.snapshot);

    this.unsubscribeWeb3 = web3State.subscribe((state) => {
      this.refreshView(state);
    });
    void this.refreshRemoteData();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.leavingScene = true;
      this.actionInFlight = false;
      this.rankedStartStage = null;
      this.rankedStartError = null;
      this.localMessage = '';
      this.localTone = 'info';
      this.root?.destroy(true);
      this.root = undefined;
      this.brandFooter?.destroy();
      this.brandFooter = undefined;
      this.unsubscribeWeb3?.();
      this.unsubscribeWeb3 = undefined;
      const keyboard = this.input.keyboard;
      if (keyboard) {
        keyboard.off('keydown-ESC', this.handleEscKey);
        keyboard.off('keydown-ENTER', this.handleStartKey);
      }
    });
  }

  private bindKeyboard(): void {
    const keyboard = this.input.keyboard;

    if (!keyboard) {
      return;
    }

    keyboard.on('keydown-ESC', this.handleEscKey);
    keyboard.on('keydown-ENTER', this.handleStartKey);
  }

  private async refreshRemoteData(): Promise<void> {
    if (this.refreshing) {
      return;
    }

    this.refreshing = true;
    web3State.clearError();
    this.refreshView(web3State.snapshot);

    try {
      // 约束：排位中心只保留“进入页面时自动刷新”这一个数据入口。
      // 不再提供手动刷新按钮，避免多条异步刷新路径相互覆盖状态和文案。
      await web3State.refreshReadModels();
      const state = web3State.snapshot;
      const challenge = state.rankedBoardState?.currentChallenge ?? null;

      if (challenge) {
        const overviewPromise = state.address
          ? fetchRankedOverview(state.address, challenge.challengeId, challenge.version)
          : Promise.resolve(null);
        const [leaderboard, history, overview] = await Promise.all([
          fetchLeaderboard(challenge.challengeId, challenge.version, 5),
          state.address ? fetchPlayerHistory(state.address, 5) : Promise.resolve([]),
          overviewPromise,
        ]);
        this.leaderboard = leaderboard;
        this.history = history;
        this.overview = overview;
      } else {
        this.leaderboard = [];
        this.history = [];
        this.overview = null;
      }

      if (!this.localMessage) {
        this.showStatus('', 'info');
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '加载排位中心失败';
      if (!this.leavingScene) {
        this.showStatus(message, 'danger');
      }
    } finally {
      this.refreshing = false;
      if (this.leavingScene || !this.sys.isActive()) {
        return;
      }
      this.refreshView(web3State.snapshot);
    }
  }

  private async startRankedChallenge(): Promise<void> {
    if (this.actionInFlight) {
      return;
    }

    this.actionInFlight = true;
    this.rankedStartStage = null;
    this.rankedStartError = null;
    web3State.clearError();
    this.showStatus('正在准备排位挑战...', 'info');
    this.refreshView(web3State.snapshot);

    try {
      // 排位准备流程横跨钱包、签名、会话激活和 challenge 载入。
      // 场景层只展示阶段反馈，不在这里重复实现底层启动逻辑。
      const run = await prepareRankedRun({
        onStageStart: (stage) => {
          this.rankedStartStage = stage;
          this.rankedStartError = null;
          this.showStatus(RANKED_START_STAGE_MESSAGES[stage], 'info');
          this.refreshView(web3State.snapshot);
        },
      });
      this.rankedStartStage = 'building-run';
      this.showStatus('正在进入挑战...', 'info');
      this.refreshView(web3State.snapshot);
      await this.startGameplayScene(run);
    } catch (error) {
      const message = this.formatRankedStartError(error);
      this.rankedStartError = message;
      this.showStatus(message, 'danger');
    } finally {
      this.actionInFlight = false;
      this.rankedStartStage = null;

      if (this.leavingScene || !this.sys.isActive()) {
        return;
      }

      this.refreshView(web3State.snapshot);
    }
  }

  private async startGameplayScene(
    run: ReturnType<typeof gameState.startRankedRun>,
  ): Promise<void> {
    this.leavingScene = true;

    await new Promise<void>((resolve, reject) => {
      this.time.delayedCall(0, () => {
        try {
          this.scene.start(SCENE_KEYS.Gameplay, {
            run,
            restartSnapshot: buildRestartSnapshot(run),
          });
          resolve();
        } catch (error) {
          this.leavingScene = false;
          reject(error);
        }
      });
    });
  }

  private refreshView(state: Readonly<Web3StateShape>): void {
    if (this.leavingScene || !this.sys.isActive()) {
      return;
    }
    this.root?.destroy(true);
    const root = this.add.container(0, 0);
    this.root = root;
    const challenge = state.rankedBoardState?.currentChallenge ?? null;
    const statusText =
      this.rankedStartError
      ?? this.localMessage
      ?? (this.rankedStartStage ? RANKED_START_STAGE_MESSAGES[this.rankedStartStage] : '准备好了，按 Enter 开始挑战。');
    const canStart = !this.refreshing && !this.actionInFlight && challenge !== null;
    const startLabel = this.rankedStartStage
      ? RANKED_START_BUTTON_LABELS[this.rankedStartStage]
      : '再来一局';

    const headerPanel = createRankedPanel(this, {
      x: 16,
      y: 10,
      width: 288,
      height: 28,
    }).setName('ranked.header.panel');
    root.add(headerPanel);
    root.add(createUiText(this, 24, 21, '排位中心', {
      variant: 'heading',
      script: 'mixed',
      style: { fontSize: '13px', color: '#fff8de' },
    }).setOrigin(0, 0.5).setName('ranked.header.title'));
    root.add(createUiText(this, 24, 31, challenge
      ? `当前挑战 ${getRankedChallengeDisplayName(challenge)} · 第${challenge.version}期`
      : '当前无可用挑战', {
      variant: 'caption',
      script: 'mixed',
      style: { fontSize: '7px', color: '#d7c696' },
    }).setOrigin(0, 0.5).setName('ranked.header.best'));

    const progressPanel = createRankedPanel(this, {
      x: 16,
      y: 46,
      width: 136,
      height: 144,
    });
    root.add(progressPanel);
    root.add(createUiText(this, 24, 58, '我的进度', {
      variant: 'caption',
      script: 'mixed',
      style: { fontSize: '9px', color: '#f7d54a' },
    }).setOrigin(0, 0.5));

    const pbDiamonds = this.overview?.personalBest?.bestDiamondsCaught ?? 0;
    const pbTimeSec = this.overview?.personalBest?.bestLastDiamondAtMs != null
      ? (this.overview.personalBest.bestLastDiamondAtMs / 1000).toFixed(1)
      : null;
    const latest = this.overview?.latestRun ?? null;
    const leaderGap = this.overview?.leaderGap ?? null;
    const nextBeatGap = this.overview?.nextBeatGap ?? null;

    const progressRows = [
      '当前挑战个人最佳',
      pbTimeSec ? `${pbDiamonds} 钻 · ${pbTimeSec}s` : `${pbDiamonds} 钻`,
      leaderGap
        ? `距榜首 ${leaderGap.diamondsDelta} 钻${leaderGap.timeDeltaMs != null ? ` / ${(leaderGap.timeDeltaMs / 1000).toFixed(1)}s` : ''}`
        : '已是榜首或暂无榜首差距',
      nextBeatGap
        ? `距前一名 ${nextBeatGap.diamondsDelta} 钻${nextBeatGap.timeDeltaMs != null ? ` / ${(nextBeatGap.timeDeltaMs / 1000).toFixed(1)}s` : ''}`
        : '再跑一局争取刷新成绩',
      latest
        ? `最近一局 ${latest.diamondsCaught} 钻 · ${(latest.lastDiamondAtMs / 1000).toFixed(1)}s`
        : '最近一局：暂无记录',
    ];

    progressRows.forEach((line, index) => {
      root.add(createUiText(this, 24, 76 + index * 18, line, {
        variant: index === 1 ? 'body' : 'caption',
        script: 'mixed',
        style: {
          fontSize: index === 1 ? '11px' : '8px',
          color: index === 1 ? '#fff8de' : '#d7c696',
          wordWrap: { width: 118 },
        },
      }).setOrigin(0, 0));
    });

    const leaderboardPanel = createRankedPanel(this, {
      x: 160,
      y: 46,
      width: 144,
      height: 74,
    }).setName('ranked.board.leaderboard.panel');
    const historyPanel = createRankedPanel(this, {
      x: 160,
      y: 124,
      width: 144,
      height: 74,
    }).setName('ranked.board.history.panel');
    root.add([leaderboardPanel, historyPanel]);

    root.add(createUiText(this, 170, 57, '排行榜 前 5 名', {
      variant: 'caption',
      script: 'mixed',
      style: { fontSize: '9px', color: '#f7d54a' },
    }).setOrigin(0, 0.5));
    root.add(createRankedDivider(this, 170, 66, 124, 'muted'));
    root.add(createUiText(this, 170, 135, '我的最近 5 局', {
      variant: 'caption',
      script: 'mixed',
      style: { fontSize: '9px', color: '#f7d54a' },
    }).setOrigin(0, 0.5));
    root.add(createRankedDivider(this, 170, 144, 124, 'muted'));

    if (this.leaderboard.length > 0) {
      this.leaderboard.slice(0, 5).forEach((entry, index) => {
        const row = createRankedCompactStatRow(this, {
          x: 168,
          y: 71 + index * 9,
          width: 128,
          height: 9,
        }, {
          leading: `#${index + 1}`,
          primary: `${entry.result.diamondsCaught} 钻`,
          trailing: formatRankedRunTime(entry.result.lastDiamondAtMs),
          tone: index === 0 ? 'accent' : 'muted',
        });
        row.setName(`ranked.board.leaderboard.row.${index}`);
        root.add(row);
      });
    } else {
      root.add(createRankedEmptyState(this, {
        x: 170,
        y: 70,
        width: 124,
        height: 34,
      }, {
        primary: '首个上榜成绩等你来打',
        secondary: '打出有效成绩即可上榜',
        tone: 'muted',
      }).setName('ranked.board.leaderboard.empty'));
    }

    if (this.history.length > 0) {
      this.history.slice(0, 5).forEach((entry, index) => {
        const row = createRankedCompactStatRow(this, {
          x: 168,
          y: 149 + index * 9,
          width: 128,
          height: 9,
        }, {
          primary: `${entry.result.diamondsCaught} 钻`,
          trailing: formatRankedRunTime(entry.result.lastDiamondAtMs),
          tone: index === 0 ? 'info' : 'muted',
        });
        row.setName(`ranked.board.history.row.${index}`);
        root.add(row);
      });
    } else {
      root.add(createRankedEmptyState(this, {
        x: 170,
        y: 146,
        width: 124,
        height: 34,
      }, {
        primary: state.address ? '开始第一局挑战' : '连接钱包后查看你的历史成绩',
        secondary: state.address ? '完成挑战后，这里会显示你的战绩' : '连接钱包后查看你的战绩',
        tone: 'muted',
      }).setName('ranked.board.history.empty'));
    }

    const statusPanel = createRankedPanel(this, {
      x: 16,
      y: 202,
      width: 288,
      height: 12,
    }).setName('ranked.status.panel');
    root.add(statusPanel);
    root.add(createUiText(this, 22, 208, statusText, {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '7px',
        color: this.rankedStartError ? '#ffcdc0' : this.localTone === 'success' ? '#b9f7a4' : '#c7faff',
      },
    }).setOrigin(0, 0.5).setName('ranked.status.banner'));

    const startButton = createRankedButton(this, {
      x: 16,
      y: 220,
      width: 134,
      height: 20,
    }, {
      label: startLabel,
      hotkey: 'Enter',
      tone: canStart ? 'success' : 'muted',
      disabled: !canStart,
    });
    startButton.root.setName('ranked.actions.start');
    const backButton = createRankedButton(this, {
      x: 156,
      y: 220,
      width: 148,
      height: 20,
    }, {
      label: '返回主菜单',
      hotkey: 'Esc',
      tone: 'default',
      disabled: false,
    });
    backButton.root.setName('ranked.actions.back');
    startButton.onPress(() => {
      void this.startRankedChallenge();
    });
    backButton.onPress(() => {
      this.goBackToMenu();
    });
    root.add([startButton.root, backButton.root]);
  }

  private showStatus(message: string, tone: RankedUiTone): void {
    this.localMessage = message;
    this.localTone = tone;
  }

  private goBackToMenu(): void {
    gameState.resetForMenu();
    this.scene.start(SCENE_KEYS.Menu);
  }

  private formatRankedStartError(error: unknown): string {
    return formatRankedStartError(error);
  }
}

function formatRankedRunTime(lastDiamondAtMs: number): string {
  return `${(lastDiamondAtMs / 1000).toFixed(1)}s`;
}
