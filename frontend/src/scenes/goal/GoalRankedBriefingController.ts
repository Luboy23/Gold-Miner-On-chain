/**
 * GoalRankedBriefingController 负责排位挑战开局前的简报页。
 *
 * 这页的职责很窄：
 * - 展示当前 challenge 的核心信息
 * - 提醒上榜规则
 * - 把 Enter / Esc 映射到开始或返回
 *
 * 它不参与 challenge 准备、session 创建或 evidence 逻辑；这些都在 rankedStart 链路里完成。
 */
import type Phaser from 'phaser';

import { createRankedBackdropOverlay } from '../../game/ranked-ui/backdrop';
import { createRankedBadge } from '../../game/ranked-ui/badges';
import { createRankedButton } from '../../game/ranked-ui/buttons';
import { createRankedMetric } from '../../game/ranked-ui/metrics';
import { createRankedPanel } from '../../game/ranked-ui/panels';
import { getRankedChallengeDisplayName } from '../../game/rankedChallengeDisplay';
import { createUiText } from '../../game/uiText';
import type { RunState } from '../../game/types/index';

type GoalRankedBriefingCallbacks = {
  onStart: () => void;
  onBack: () => void;
};

export class GoalRankedBriefingController {
  private readonly scene: Phaser.Scene;
  private readonly callbacks: GoalRankedBriefingCallbacks;
  private readonly handleEnterKey = (): void => {
    this.callbacks.onStart();
  };
  private readonly handleEscKey = (): void => {
    this.callbacks.onBack();
  };

  constructor(scene: Phaser.Scene, callbacks: GoalRankedBriefingCallbacks) {
    this.scene = scene;
    this.callbacks = callbacks;
  }

  show(run: RunState): void {
    const rankedContext = run.rankedContext;
    // 简报页显示的时长必须与 rankedContext/time limit 对齐，不能自行估算另一套规则。
    const timeLimitSec =
      rankedContext && rankedContext.logicFps > 0
        ? Math.round(rankedContext.timeLimitTicks / rankedContext.logicFps)
        : Math.round(run.timeRemainingSec);

    createRankedBackdropOverlay(this.scene, 0.58);

    const headerPanel = createRankedPanel(this.scene, {
      x: 16,
      y: 10,
      width: 288,
      height: 24,
    });
    const detailPanel = createRankedPanel(this.scene, {
      x: 16,
      y: 44,
      width: 168,
      height: 118,
    });
    const rulesPanel = createRankedPanel(this.scene, {
      x: 190,
      y: 44,
      width: 114,
      height: 118,
    });

    createUiText(this.scene, 26, 22, '排位赛·钻石挑战', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '10px',
        color: '#f7d54a',
      },
    }).setOrigin(0, 0.5);

    const seasonBadge = createRankedBadge(this.scene, 263, 22, {
      label: rankedContext ? `第${rankedContext.challengeVersion}期` : '未配置',
      tone: 'accent',
      minWidth: 76,
      maxWidth: 76,
      fixedWidth: 76,
    });

    createUiText(this.scene, 26, 56, '当前挑战', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '8px',
        color: '#d7c696',
      },
    }).setOrigin(0, 0.5);

    createUiText(
      this.scene,
      26,
      75,
      getRankedChallengeDisplayName({
        challengeId: rankedContext?.challengeId ?? run.levelId,
      }),
      {
        variant: 'heading',
        script: 'mixed',
        style: {
          fontSize: '18px',
          color: '#fff8de',
        },
      },
    ).setOrigin(0, 0.5);

    const versionBadge = createRankedBadge(this.scene, 49, 92, {
      label: `${timeLimitSec}s`,
      tone: 'muted',
      minWidth: 34,
      maxWidth: 38,
    });
    const targetMetric = createRankedMetric(
      this.scene,
      {
        x: 26,
        y: 101,
        width: 72,
        height: 24,
      },
      {
        label: '时长',
        value: `${timeLimitSec}s`,
        accent: 'accent',
      },
    );
    const seasonMetric = createRankedMetric(
      this.scene,
      {
        x: 104,
        y: 101,
        width: 70,
        height: 24,
      },
      {
        label: '模式',
        value: '单钻模式',
        accent: 'info',
      },
    );

    createUiText(
      this.scene,
      26,
      138,
      '60 秒内尽量多抓钻石，场上始终只会出现 1 颗钻石。',
      {
        variant: 'caption',
        script: 'mixed',
        style: {
          fontSize: '8px',
          color: '#d7c696',
          wordWrap: { width: 148 },
        },
      },
    ).setOrigin(0, 0);

    createUiText(this.scene, 200, 56, '排名规则', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '8px',
        color: '#f7d54a',
      },
    }).setOrigin(0, 0.5);

    // 这里展示的是玩家可见规则摘要，不替代 authoritative/runtime 的正式规则实现。
    const rules = ['抓回才刷新下一颗', '禁用炸药和道具', '按钻石数与达成时间排名'];
    rules.forEach((rule, index) => {
      createUiText(this.scene, 200, 79 + index * 24, '•', {
        variant: 'caption',
        script: 'latin',
        style: {
          fontSize: '10px',
          color: '#ef8804',
        },
      }).setOrigin(0, 0.5);
      createUiText(this.scene, 211, 79 + index * 24, rule, {
        variant: 'body',
        script: 'mixed',
        style: {
          fontSize: '11px',
          color: '#fff4d0',
        },
      }).setOrigin(0, 0.5);
    });

    createUiText(this.scene, 200, 133, '有效成绩会计入排行榜。', {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '8px',
        color: '#d7c696',
        wordWrap: { width: 92 },
      },
    }).setOrigin(0, 0);

    const startButton = createRankedButton(
      this.scene,
      {
        x: 16,
        y: 188,
        width: 168,
        height: 20,
      },
      {
        label: '开始挑战',
        hotkey: 'Enter',
        tone: 'accent',
        disabled: false,
      },
    );
    startButton.root.setName('goal.ranked.actions.start');
    startButton.onPress(this.callbacks.onStart);

    const backButton = createRankedButton(
      this.scene,
      {
        x: 190,
        y: 188,
        width: 114,
        height: 20,
      },
      {
        label: '返回排位中心',
        hotkey: 'Esc',
        tone: 'muted',
        disabled: false,
      },
    );
    backButton.root.setName('goal.ranked.actions.back');
    backButton.onPress(this.callbacks.onBack);

    this.scene.input.keyboard?.on('keydown-ENTER', this.handleEnterKey);
    this.scene.input.keyboard?.on('keydown-ESC', this.handleEscKey);

    void headerPanel;
    void detailPanel;
    void rulesPanel;
    void seasonBadge;
    void versionBadge;
    void targetMetric;
    void seasonMetric;
    void startButton;
    void backButton;
  }

  destroy(): void {
    // 键盘监听只在 briefing 生命周期内有效；scene 切换后必须显式解绑，避免把 Enter/Esc 泄漏到后续场景。
    this.scene.input.keyboard?.off('keydown-ENTER', this.handleEnterKey);
    this.scene.input.keyboard?.off('keydown-ESC', this.handleEscKey);
  }
}
