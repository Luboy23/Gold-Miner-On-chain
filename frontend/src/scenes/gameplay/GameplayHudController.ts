/**
 * GameplayHudController 负责局内 HUD 的纯展示层。
 *
 * 它统一承载 casual / campaign / ranked 的顶部信息展示，但不参与抓钩判定、
 * 分数结算或 replay 账本记录。所有文本和值都必须来自上层已经确认的 run / timer / catch 结果。
 */
import Phaser from 'phaser';

import { setLogicalTextureSize } from '../../game/display';
import { createUiText } from '../../game/uiText';
import { getRankedChallengeShortName } from '../../game/rankedChallengeDisplay';
import type { CatchResult, RunState } from '../../game/types/index';
import type { ScoreTimerSystem } from '../../systems/ScoreTimerSystem';

type GameplayLayoutRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export interface GameplayLayoutSnapshot {
  hudRects: {
    score: GameplayLayoutRect | null;
    status: GameplayLayoutRect | null;
  };
  minerRect: GameplayLayoutRect | null;
  hookOrigin: {
    x: number;
    y: number;
  } | null;
  hookTip: {
    x: number;
    y: number;
  } | null;
}

export interface ClassicGameplayHud {
  root: Phaser.GameObjects.Container;
  scoreGroup: Phaser.GameObjects.Container;
  statusGroup: Phaser.GameObjects.Container;
  money: Phaser.GameObjects.Text;
  goal: Phaser.GameObjects.Text;
  time: Phaser.GameObjects.Text;
  dynamiteCount: Phaser.GameObjects.Text;
  dynamiteIcons: Phaser.GameObjects.Image[];
  bonusText: Phaser.GameObjects.Text;
  strengthLabel: Phaser.GameObjects.Image;
}

const DYNAMITE_ICON_POSITIONS = [
  { x: 294, y: 24 },
  { x: 299, y: 24 },
  { x: 304, y: 24 },
  { x: 309, y: 24 },
  { x: 314, y: 24 },
  { x: 319, y: 24 },
  { x: 294, y: 13 },
  { x: 299, y: 13 },
  { x: 304, y: 13 },
  { x: 309, y: 13 },
  { x: 314, y: 13 },
  { x: 319, y: 13 },
] as const;

const HUD_LABEL_COLOR = '#c28804';
const HUD_VALUE_GOLD = '#7d3000';
const HUD_VALUE_ORANGE = '#ef8804';
const HUD_TIME_DANGER_COLOR = '#ffb29d';
const HUD_BONUS_DEFAULT_COLOR = '#dcb64a';
const HUD_STATUS_VALUE_Y_OFFSET = -1;

function setTextIfChanged(
  textObject: Phaser.GameObjects.Text,
  nextValue: string,
): void {
  if (textObject.text !== nextValue) {
    textObject.setText(nextValue);
  }
}

function toLayoutRect(
  bounds:
    | Phaser.Geom.Rectangle
    | {
        x: number;
        y: number;
        width: number;
        height: number;
      },
): GameplayLayoutRect {
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function getVisibleContainerBounds(
  container: Phaser.GameObjects.Container | null,
): GameplayLayoutRect | null {
  if (!container) {
    return null;
  }

  const visibleChildren = container.list.filter(
    (child): child is Phaser.GameObjects.GameObject & {
      visible: boolean;
      getBounds: () => Phaser.Geom.Rectangle;
    } =>
      'visible' in child &&
      child.visible !== false &&
      typeof (child as Phaser.GameObjects.GameObject & {
        getBounds?: () => Phaser.Geom.Rectangle;
      }).getBounds === 'function',
  );

  if (visibleChildren.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const child of visibleChildren) {
    const bounds = child.getBounds();
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function createHudLabel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  value: string,
  script: 'latin' | 'mixed' = 'latin',
): Phaser.GameObjects.Text {
  return createUiText(scene, x, y, value, {
    variant: 'caption',
    script,
    style: {
      fontSize: '9px',
      color: HUD_LABEL_COLOR,
    },
  }).setOrigin(0, 0);
}

function createHudValue(
  scene: Phaser.Scene,
  x: number,
  y: number,
  value: string,
  color: string,
  script: 'latin' | 'mixed' = 'latin',
): Phaser.GameObjects.Text {
  return createUiText(scene, x, y, value, {
    variant: 'caption',
    script,
    style: {
      fontSize: '12px',
      color,
    },
  }).setOrigin(0, 0);
}

function formatTimeRemaining(value: number): string {
  return `${Math.ceil(value)}秒`;
}

function formatDynamiteCount(value: number): string {
  return `x${value}`;
}

function resolveCatchTextColor(result: {
  rewardKind?: CatchResult['rewardKind'] | null;
  bonusTier?: CatchResult['bonusTier'] | null;
}): string {
  if (result.rewardKind === 'dynamite') {
    return '#fff6ba';
  }

  if (result.rewardKind === 'strength') {
    return '#8ff8ff';
  }

  return HUD_BONUS_DEFAULT_COLOR;
}

export class GameplayHudController {
  private hud: ClassicGameplayHud | null = null;
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  createHud(run: RunState): void {
    // ranked HUD 与 casual/campaign HUD 共用同一套几何骨架，但文案语义不同：
    // ranked 展示 challenge/限制，其他模式展示目标金额与炸药数。
    const isRanked = run.mode === 'ranked';
    const root = this.scene.add.container(0, 0).setDepth(40).setName('gameplay.hud.root');
    const scoreGroup = this.scene.add.container(0, 0).setName('gameplay.hud.scoreGroup');
    const statusGroup = this.scene.add.container(0, 0).setName('gameplay.hud.statusGroup');

    const moneyLabel = createHudLabel(this.scene, 5, 4, isRanked ? '钻石' : '金币', 'mixed');
    const moneyValue = createHudValue(
      this.scene,
      33,
      4,
      isRanked ? `${run.caughtCount} 钻` : `$${run.scoreView}`,
      HUD_VALUE_GOLD,
      'mixed',
    );
    const goalLabel = createHudLabel(this.scene, 5, 21, isRanked ? '挑战' : '目标', 'mixed');
    const goalValue = createHudValue(
      this.scene,
      33,
      21,
      isRanked
        ? getRankedChallengeShortName({
            challengeId: run.rankedContext?.challengeId ?? run.levelId,
          })
        : `$${run.goal}`,
      HUD_VALUE_GOLD,
      'mixed',
    );
    if (isRanked) {
      goalValue.setFontSize('8px');
    }
    scoreGroup.add([moneyLabel, moneyValue, goalLabel, goalValue]);

    const timeLabel = createHudLabel(this.scene, 235, 4, '剩余', 'mixed');
    const timeValue = createHudValue(
      this.scene,
      263,
      4 + HUD_STATUS_VALUE_Y_OFFSET,
      formatTimeRemaining(run.timeRemainingSec),
      HUD_VALUE_ORANGE,
      'mixed',
    );
    const dynamiteLabel = createHudLabel(this.scene, 235, 21, isRanked ? '道具' : '炸药', 'mixed');
    const dynamiteCount = createHudValue(
      this.scene,
      263,
      21 + HUD_STATUS_VALUE_Y_OFFSET,
      isRanked ? '禁用' : formatDynamiteCount(run.dynamiteCount),
      HUD_VALUE_ORANGE,
      'mixed',
    );
    if (isRanked) {
      dynamiteCount.setFontSize('8px');
    }
    statusGroup.add([timeLabel, timeValue, dynamiteLabel, dynamiteCount]);

    const dynamiteIcons = DYNAMITE_ICON_POSITIONS.map((position, index) =>
      setLogicalTextureSize(
        this.scene.add
          .image(position.x, position.y, 'dynamiteUi')
          .setOrigin(0, 0)
          .setName(`gameplay.hud.dynamite.${index + 1}`)
          .setVisible(false),
        'dynamiteUi',
      ),
    );
    statusGroup.add(dynamiteIcons);

    const bonusText = createUiText(this.scene, 90, 18, '', {
      variant: 'status',
      script: 'mixed',
      style: {
        fontSize: '12px',
        color: HUD_BONUS_DEFAULT_COLOR,
      },
    })
      .setName('gameplay.hud.bonusText')
      .setOrigin(0, 0)
      .setVisible(false);
    const strengthLabel = setLogicalTextureSize(
      this.scene.add
        .image(80, 10, 'strengthLabel')
        .setName('gameplay.hud.strengthLabel')
        .setOrigin(0, 0)
        .setVisible(false),
      'strengthLabel',
    );

    root.add([scoreGroup, statusGroup, bonusText, strengthLabel]);
    this.hud = {
      root,
      scoreGroup,
      statusGroup,
      money: moneyValue,
      goal: goalValue,
      time: timeValue,
      dynamiteCount,
      dynamiteIcons,
      bonusText,
      strengthLabel,
    };
    this.syncDynamiteIcons(isRanked ? 0 : run.dynamiteCount);
  }

  destroy(): void {
    this.hud?.root.destroy(true);
    this.hud = null;
  }

  syncHud(run: RunState | null, scoreTimerSystem: ScoreTimerSystem | null): void {
    if (!this.hud || !scoreTimerSystem || !run) {
      return;
    }

    const snapshot = scoreTimerSystem.snapshot;
    // HUD 只镜像当前 run/timer/catch 的已确认值，不在这里推导任何 replay 关键字段。
    if (run.mode === 'ranked') {
      setTextIfChanged(this.hud.money, `${run.caughtCount} 钻`);
      setTextIfChanged(
        this.hud.goal,
        getRankedChallengeShortName({
          challengeId: run.rankedContext?.challengeId ?? run.levelId,
        }),
      );
    } else {
      setTextIfChanged(this.hud.money, `$${snapshot.scoreView}`);
      setTextIfChanged(this.hud.goal, `$${snapshot.goal}`);
    }
    setTextIfChanged(this.hud.time, formatTimeRemaining(snapshot.timeRemainingSec));
    this.hud.time.setColor(
      snapshot.timeRemainingSec <= 10 ? HUD_TIME_DANGER_COLOR : HUD_VALUE_ORANGE,
    );
    setTextIfChanged(
      this.hud.dynamiteCount,
      run.mode === 'ranked'
        ? '禁用道具'
        : formatDynamiteCount(run.dynamiteCount),
    );
    this.syncDynamiteIcons(run.mode === 'ranked' ? 0 : run.dynamiteCount);

    if (snapshot.lastCatchVisible && snapshot.lastCatchKind === 'strength') {
      this.hud.bonusText.setVisible(false);
      this.hud.strengthLabel.setVisible(true);
      return;
    }

    this.hud.strengthLabel.setVisible(false);

    if (snapshot.lastCatchVisible && snapshot.lastCatchText) {
      setTextIfChanged(this.hud.bonusText, snapshot.lastCatchText);
      this.hud.bonusText.setColor(
        resolveCatchTextColor({
          rewardKind: snapshot.lastCatchKind,
          bonusTier: snapshot.lastCatchTier,
        }),
      );
      this.hud.bonusText.setVisible(true);
    } else {
      this.hud.bonusText.setVisible(false);
    }
  }

  getLayoutSnapshot(
    minerSprite: Phaser.GameObjects.Sprite | null,
    hookSnapshot: {
      originX: number;
      originY: number;
      tipX: number;
      tipY: number;
    } | null,
  ): GameplayLayoutSnapshot | null {
    const scoreBounds = getVisibleContainerBounds(this.hud?.scoreGroup ?? null);
    const statusBounds = getVisibleContainerBounds(this.hud?.statusGroup ?? null);
    const minerBounds = minerSprite?.getBounds();

    return {
      hudRects: {
        score: scoreBounds ? toLayoutRect(scoreBounds) : null,
        status: statusBounds ? toLayoutRect(statusBounds) : null,
      },
      minerRect: minerBounds ? toLayoutRect(minerBounds) : null,
      hookOrigin: hookSnapshot
        ? {
            x: hookSnapshot.originX,
            y: hookSnapshot.originY,
          }
        : null,
      hookTip: hookSnapshot
        ? {
            x: hookSnapshot.tipX,
            y: hookSnapshot.tipY,
          }
        : null,
    };
  }

  private syncDynamiteIcons(count: number): void {
    if (!this.hud) {
      return;
    }

    this.hud.dynamiteIcons.forEach((icon, index) => {
      icon.setVisible(index < count);
    });
  }
}
