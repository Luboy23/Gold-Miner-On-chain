/**
 * GameplayPresentationController 负责纯表现层同步：
 * - 背景与矿工精灵
 * - 调试碰撞圈
 * - 炸药使用动画态
 * - DEV toast
 *
 * 它不拥有 gameplay 真值，也不决定 hook/score/catch；scene 只把已经确认的状态
 * 镜像给它，让表现层保持与账本层解耦。
 */
import Phaser from 'phaser';

import {
  ANIMATION_KEYS,
  GAMEPLAY_TOP_HEIGHT,
  HOOK_COLLISION_RADIUS,
  LEVEL_THEME_BACKGROUND_KEYS,
  PLAYER_POSITION,
} from '../../game/constants';
import { setLogicalTextureSize } from '../../game/display';
import { createUiText } from '../../game/uiText';
import type { LevelDefinition } from '../../game/types/index';
import type { LevelEntity } from '../../objects/LevelEntity';

const DEV_TOAST_WIDTH = 124;
const DEV_TOAST_HEIGHT = 18;
const DEV_TOAST_Y = 74;

export class GameplayPresentationController {
  private readonly scene: Phaser.Scene;
  private minerSprite: Phaser.GameObjects.Sprite | null = null;
  private debugGraphics: Phaser.GameObjects.Graphics | null = null;
  private devToastContainer: Phaser.GameObjects.Container | null = null;
  private devToastTimer: Phaser.Time.TimerEvent | null = null;
  private devToastTween: Phaser.Tweens.Tween | null = null;
  private showCollision = false;
  private isUsingDynamite = false;
  private usingDynamiteTimerSec = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  create(level: LevelDefinition, showCollision: boolean): void {
    this.showCollision = showCollision;
    this.createBackground(level);
    this.createMiner();
    this.debugGraphics = this.scene.add.graphics();
  }

  destroy(): void {
    this.devToastTimer?.destroy();
    this.devToastTimer = null;
    this.devToastTween?.stop();
    this.devToastTween = null;
    this.devToastContainer?.destroy(true);
    this.devToastContainer = null;
    this.debugGraphics?.destroy();
    this.debugGraphics = null;
    this.minerSprite?.destroy();
    this.minerSprite = null;
    this.isUsingDynamite = false;
    this.usingDynamiteTimerSec = 0;
  }

  getMinerSprite(): Phaser.GameObjects.Sprite | null {
    return this.minerSprite;
  }

  isCollisionDebugVisible(): boolean {
    return this.showCollision;
  }

  toggleCollisionDebug(): boolean {
    this.showCollision = !this.showCollision;
    return this.showCollision;
  }

  triggerDynamiteUse(durationSec: number): void {
    this.isUsingDynamite = true;
    this.usingDynamiteTimerSec = durationSec;
  }

  updatePresentationState(deltaSec: number): void {
    // 炸药表现是短时视觉态，不写回 run；倒计时结束后只恢复动画，不改变 gameplay 账本。
    if (!this.isUsingDynamite) {
      return;
    }

    this.usingDynamiteTimerSec = Math.max(0, this.usingDynamiteTimerSec - deltaSec);

    if (this.usingDynamiteTimerSec === 0) {
      this.isUsingDynamite = false;
    }
  }

  syncMinerAnimation(hookState: string | null): void {
    if (!this.minerSprite) {
      return;
    }

    // 矿工动画只依赖当前 hook 表现态和炸药表现态，不单独再推导抓取结果。
    const animationKey =
      this.isUsingDynamite
        ? ANIMATION_KEYS.minerUseDynamite
        : hookState === 'extending'
          ? ANIMATION_KEYS.minerGrab
          : hookState === 'returning-empty' || hookState === 'returning-loaded'
            ? ANIMATION_KEYS.minerGrabBack
            : ANIMATION_KEYS.minerIdle;

    if (this.minerSprite.anims.getName() !== animationKey) {
      this.minerSprite.play(animationKey);
    }
  }

  syncDebugGraphics(
    entities: LevelEntity[],
    hookSnapshot:
      | {
          collisionX: number;
          collisionY: number;
        }
      | null,
  ): void {
    if (!this.debugGraphics) {
      return;
    }

    this.debugGraphics.clear();

    // 调试碰撞圈只在 DEV 可见路径下使用，不能影响正常帧逻辑或实体状态。
    if (!this.showCollision || !hookSnapshot) {
      return;
    }

    this.debugGraphics.lineStyle(1, 0xf7d54a, 1);

    for (const entity of entities) {
      if (!entity.isActive) {
        continue;
      }

      this.debugGraphics.strokeCircle(
        entity.collisionX,
        entity.collisionY,
        entity.collisionRadius,
      );
    }

    this.debugGraphics.lineStyle(1, 0x54f7d9, 1);
    this.debugGraphics.strokeCircle(
      hookSnapshot.collisionX,
      hookSnapshot.collisionY,
      HOOK_COLLISION_RADIUS,
    );
  }

  showDevToast(message: string): void {
    if (!import.meta.env.DEV) {
      return;
    }

    this.devToastTimer?.destroy();
    this.devToastTimer = null;
    this.devToastTween?.stop();
    this.devToastTween = null;
    this.devToastContainer?.destroy(true);

    const panel = this.scene.add
      .rectangle(0, 0, DEV_TOAST_WIDTH, DEV_TOAST_HEIGHT, 0x120b04, 0.92)
      .setStrokeStyle(1, 0x54f7d9, 0.95);
    const text = createUiText(this.scene, 0, 0, message, {
      variant: 'caption',
      script: 'mixed',
      style: {
        fontSize: '10px',
        color: '#54f7d9',
      },
    }).setOrigin(0.5);

    this.devToastContainer = this.scene.add.container(160, DEV_TOAST_Y, [panel, text]);
    this.devToastContainer.setAlpha(0);

    this.devToastTween = this.scene.tweens.add({
      targets: this.devToastContainer,
      alpha: 1,
      duration: 120,
      ease: 'Quad.easeOut',
    });

    this.devToastTimer = this.scene.time.delayedCall(900, () => {
      if (!this.devToastContainer) {
        return;
      }

      this.devToastTween?.stop();
      this.devToastTween = this.scene.tweens.add({
        targets: this.devToastContainer,
        alpha: 0,
        duration: 160,
        ease: 'Quad.easeIn',
        onComplete: () => {
          this.devToastContainer?.destroy(true);
          this.devToastContainer = null;
          this.devToastTween = null;
        },
      });
      this.devToastTimer = null;
    });
  }

  private createBackground(level: LevelDefinition): void {
    setLogicalTextureSize(
      this.scene.add.image(0, 0, 'levelCommonTop').setOrigin(0, 0),
      'levelCommonTop',
    );
    setLogicalTextureSize(
      this.scene.add
        .image(0, GAMEPLAY_TOP_HEIGHT, LEVEL_THEME_BACKGROUND_KEYS[level.theme])
        .setOrigin(0, 0),
      LEVEL_THEME_BACKGROUND_KEYS[level.theme],
    );
  }

  private createMiner(): void {
    this.minerSprite = setLogicalTextureSize(
      this.scene.add
        .sprite(PLAYER_POSITION.x, PLAYER_POSITION.y, 'miner')
        .setOrigin(0.5, 1)
        .play(ANIMATION_KEYS.minerIdle),
      'miner',
    );
  }
}
