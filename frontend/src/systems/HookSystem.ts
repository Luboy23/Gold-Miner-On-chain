import Phaser from 'phaser';

import {
  ANIMATION_KEYS,
  HOOK_COLLISION_OFFSET,
  HOOK_COLLISION_RADIUS,
  HOOK_EMPTY_RETURN_SPEED,
  HOOK_GRAB_SPEED,
  HOOK_MAX_ANGLE,
  HOOK_MAX_LENGTH,
  HOOK_MIN_ANGLE,
  HOOK_ORIGIN,
  HOOK_RESOLVE_DURATION_SEC,
  HOOK_ROTATE_SPEED,
} from '../game/constants';
import { setLogicalTextureSize } from '../game/display';
import type { RankedWasmRuntimeSnapshot } from '../game/rankedWasmRuntime';
import type { CatchResult, HookState } from '../game/types/index';
import type { LevelEntity } from '../objects/LevelEntity';
import {
  BONUS_SOUND_BY_TIER,
  deriveRankedHookAudioEvents,
} from './rankedHookAudio';
import { areCirclesOverlapping, getHookDirection } from '../utils/geometry';

/**
 * HookSystem 管理抓钩状态机、命中判定和抓取结算。
 *
 * 这是 gameplay 中最敏感的状态机之一：
 * - fireHook 只允许在 swinging 时触发
 * - returning-loaded 的回收速度直接受 strengthMultiplier 和实体质量影响
 * - ranked replay / authoritative snapshot 都默认这套状态转移是确定性的
 *
 * 因此这里最重要的不是“动画怎么播”，而是状态转移和碰撞窗口必须保持稳定。
 */
// The source hook art is 13px wide. Its shaft lives on the center column
// (logical pixel 6), so the visual rotation axis is the center of that
// column, not its left edge.
const HOOK_SPRITE_ANCHOR_X = 0.5;

export interface HookSnapshot {
  state: HookState;
  angleDeg: number;
  length: number;
  originX: number;
  originY: number;
  tipX: number;
  tipY: number;
  collisionX: number;
  collisionY: number;
  explosiveFxVisible: boolean;
  explosiveFxX: number;
  explosiveFxY: number;
}

export class HookSystem {
  private readonly scene: Phaser.Scene;
  private readonly lineGraphics: Phaser.GameObjects.Graphics;
  private readonly hookSprite: Phaser.GameObjects.Sprite;
  private readonly explosiveFxSprite: Phaser.GameObjects.Sprite;
  private readonly origin = new Phaser.Math.Vector2(HOOK_ORIGIN.x, HOOK_ORIGIN.y);
  private readonly tip = new Phaser.Math.Vector2(HOOK_ORIGIN.x, HOOK_ORIGIN.y);
  private readonly collisionCenter = new Phaser.Math.Vector2(
    HOOK_ORIGIN.x,
    HOOK_ORIGIN.y + HOOK_COLLISION_OFFSET,
  );

  private state: HookState = 'swinging';
  private angleDeg = HOOK_MAX_ANGLE;
  private length = 0;
  private rotateRight = true;
  private resolveTimerSec = HOOK_RESOLVE_DURATION_SEC;
  private caughtEntity: LevelEntity | null = null;
  private strengthMultiplier = 1;
  private silent = false;
  private lastRankedSnapshot: RankedWasmRuntimeSnapshot | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.lineGraphics = scene.add.graphics().setDepth(20);
    this.hookSprite = setLogicalTextureSize(
      scene.add
        .sprite(HOOK_ORIGIN.x, HOOK_ORIGIN.y, 'hook')
        .setOrigin(HOOK_SPRITE_ANCHOR_X, 0)
        .play(ANIMATION_KEYS.hookIdle)
        .setDepth(21),
      'hook',
    );
    this.explosiveFxSprite = setLogicalTextureSize(
      scene.add
        .sprite(HOOK_ORIGIN.x, HOOK_ORIGIN.y, 'explosiveFx')
        .setName('hook.dynamiteFx')
        .setVisible(false)
        .setDepth(22),
      'explosiveFx',
    );
    this.explosiveFxSprite.on(
      Phaser.Animations.Events.ANIMATION_COMPLETE,
      this.handleExplosiveFxComplete,
      this,
    );

    this.resetToInitialSwing(false);
  }

  fire(): void {
    if (this.state !== 'swinging') {
      return;
    }

    // 约束：任何非 swinging 状态都不允许再次 fire。
    // 这是前后端 replay 共同依赖的输入合法性边界。
    this.state = 'extending';
    if (!this.silent) {
      this.scene.sound.play('grabStart');
    }
  }

  setStrengthMultiplier(multiplier: number): void {
    this.strengthMultiplier = Math.max(1, multiplier);
  }

  setSilent(silent: boolean): void {
    this.silent = silent;
  }

  canUseDynamite(): boolean {
    return this.caughtEntity !== null && this.state === 'returning-loaded';
  }

  useDynamite(): boolean {
    if (!this.canUseDynamite() || !this.caughtEntity) {
      return false;
    }

    const blastX = this.collisionCenter.x;
    const blastY = this.collisionCenter.y;
    this.caughtEntity.resolveCatch();
    this.caughtEntity = null;
    this.state = 'returning-empty';
    this.hookSprite.play(ANIMATION_KEYS.hookIdle);
    this.playExplosiveFx(blastX, blastY);
    if (!this.silent) {
      this.scene.sound.play('explosive');
    }
    this.syncVisuals();
    return true;
  }

  update(deltaSec: number, entities: LevelEntity[]): CatchResult | null {
    let catchResult: CatchResult | null = null;

    // 状态机只有这 5 个入口状态，所有抓钩行为都必须通过这里推进。
    // 不允许在 scene/controller 层绕过 HookSystem 直接改 state，否则 replay 语义会失真。
    switch (this.state) {
      case 'swinging':
        this.updateSwing(deltaSec);
        break;
      case 'extending':
        this.updateExtending(deltaSec, entities);
        break;
      case 'returning-empty':
        this.updateReturningEmpty(deltaSec);
        break;
      case 'returning-loaded':
        catchResult = this.updateReturningLoaded(deltaSec);
        break;
      case 'resolving-catch':
        catchResult = this.updateResolvingCatch(deltaSec);
        break;
    }

    this.syncVisuals();
    return catchResult;
  }

  applyRankedSnapshot(
    snapshot: RankedWasmRuntimeSnapshot,
    entities: LevelEntity[],
  ): void {
    this.playRankedSnapshotAudio(snapshot, entities);

    // authoritative ranked 回放时，HookSystem 只做“镜像当前真值”，
    // 不在前端本地重新判断碰撞或补做抓取结算。
    this.state = this.fromRankedHookState(snapshot.hookState);
    this.angleDeg = snapshot.hookAngleDeg;
    this.length = snapshot.hookLength;
    this.caughtEntity =
      snapshot.caughtEntityIndex !== null
        ? (entities[snapshot.caughtEntityIndex] ?? null)
        : null;
    this.lastRankedSnapshot = {
      ...snapshot,
      entities: snapshot.entities.map((entity) => ({ ...entity })),
    };
    this.syncVisuals();
  }

  get snapshot(): HookSnapshot {
    return {
      state: this.state,
      angleDeg: this.angleDeg,
      length: this.length,
      originX: this.origin.x,
      originY: this.origin.y,
      tipX: this.tip.x,
      tipY: this.tip.y,
      collisionX: this.collisionCenter.x,
      collisionY: this.collisionCenter.y,
      explosiveFxVisible: this.explosiveFxSprite.visible,
      explosiveFxX: this.explosiveFxSprite.x,
      explosiveFxY: this.explosiveFxSprite.y,
    };
  }

  destroy(): void {
    this.explosiveFxSprite.off(
      Phaser.Animations.Events.ANIMATION_COMPLETE,
      this.handleExplosiveFxComplete,
      this,
    );
    this.lineGraphics.destroy();
    this.hookSprite.destroy();
    this.explosiveFxSprite.destroy();
  }

  private updateSwing(deltaSec: number): void {
    if (Math.abs(this.angleDeg - HOOK_MAX_ANGLE) < 1) {
      this.rotateRight = true;
    }

    if (Math.abs(this.angleDeg - HOOK_MIN_ANGLE) < 1) {
      this.rotateRight = false;
    }

    if (this.rotateRight) {
      this.angleDeg -= deltaSec * HOOK_ROTATE_SPEED;
    } else {
      this.angleDeg += deltaSec * HOOK_ROTATE_SPEED;
    }
  }

  private updateExtending(deltaSec: number, entities: LevelEntity[]): void {
    this.length = Math.min(
      HOOK_MAX_LENGTH,
      this.length + deltaSec * HOOK_GRAB_SPEED,
    );
    this.syncVisuals();

    const hitEntity = entities.find((entity) => {
      if (!entity.isActive || entity.isCaught) {
        return false;
      }

      return areCirclesOverlapping(
        entity.collisionX,
        entity.collisionY,
        entity.collisionRadius,
        this.collisionCenter.x,
        this.collisionCenter.y,
        HOOK_COLLISION_RADIUS,
      );
    });

    if (hitEntity) {
      hitEntity.onHooked?.(entities);
      this.caughtEntity = hitEntity;
      this.state = 'returning-loaded';
      this.hookSprite.play(
        hitEntity.isTiny ? ANIMATION_KEYS.hookGrabMini : ANIMATION_KEYS.hookGrabNormal,
      );
      if (!this.silent) {
        this.scene.sound.play(BONUS_SOUND_BY_TIER[hitEntity.bonusTier]);
      }
      return;
    }

    if (this.length >= HOOK_MAX_LENGTH) {
      this.state = 'returning-empty';
    }
  }

  private updateReturningEmpty(deltaSec: number): void {
    this.length = Math.max(0, this.length - deltaSec * HOOK_EMPTY_RETURN_SPEED);

    if (this.length === 0) {
      this.resumeSwingFromCurrentAngle();
    }
  }

  private updateReturningLoaded(deltaSec: number): CatchResult | null {
    if (!this.caughtEntity) {
      this.resumeSwingFromCurrentAngle();
      return null;
    }

    this.length = Math.max(
      0,
      this.length -
        // 约束：重物回收速度由“抓钩力量倍率 / 实体质量”决定。
        // 商店力量药水和问号袋力量都必须最终收口到这个公式，避免出现两套不一致机制。
        (deltaSec * HOOK_GRAB_SPEED * this.strengthMultiplier) /
          this.caughtEntity.mass,
    );

    if (this.length === 0) {
      return this.finishCatchResolution();
    }

    return null;
  }

  private updateResolvingCatch(deltaSec: number): CatchResult | null {
    if (!this.caughtEntity) {
      this.resumeSwingFromCurrentAngle();
      return null;
    }

    this.resolveTimerSec = Math.max(0, this.resolveTimerSec - deltaSec);
    this.syncVisuals();

    if (this.resolveTimerSec > 0) {
      return null;
    }

    return this.finishCatchResolution();
  }

  private resetToInitialSwing(playResetSound = true): void {
    this.angleDeg = HOOK_MAX_ANGLE;
    this.rotateRight = true;
    this.enterSwingingState(playResetSound);
  }

  private resumeSwingFromCurrentAngle(): void {
    this.enterSwingingState(true);
  }

  private enterSwingingState(playResetSound: boolean): void {
    this.state = 'swinging';
    this.length = 0;
    this.resolveTimerSec = HOOK_RESOLVE_DURATION_SEC;
    this.caughtEntity = null;
    this.hookSprite.play(ANIMATION_KEYS.hookIdle);

    if (playResetSound && !this.silent) {
      this.scene.sound.play('hookReset');
    }

    this.syncVisuals();
  }

  private finishCatchResolution(): CatchResult | null {
    if (!this.caughtEntity) {
      this.resumeSwingFromCurrentAngle();
      return null;
    }

    const catchResult = this.caughtEntity.createCatchResult();

    this.caughtEntity.resolveCatch();
    if (!this.silent) {
      this.scene.sound.play(
        catchResult.rewardKind === 'money' ? 'money' : 'highValue',
      );
    }
    this.caughtEntity = null;
    this.resumeSwingFromCurrentAngle();

    return catchResult;
  }

  private playExplosiveFx(x: number, y: number): void {
    this.explosiveFxSprite.setPosition(x, y);
    this.explosiveFxSprite.setVisible(true);
    this.explosiveFxSprite.play(ANIMATION_KEYS.fxExplosive);
  }

  private playRankedSnapshotAudio(
    snapshot: RankedWasmRuntimeSnapshot,
    entities: LevelEntity[],
  ): void {
    if (this.silent) {
      this.lastRankedSnapshot = {
        ...snapshot,
        entities: snapshot.entities.map((entity) => ({ ...entity })),
      };
      return;
    }

    const previous = this.lastRankedSnapshot;

    if (!previous) {
      return;
    }
    const enteringCaughtEntity =
      snapshot.caughtEntityIndex !== null
        ? (entities[snapshot.caughtEntityIndex] ?? null)
        : null;
    const resolvingCaughtEntity =
      previous.caughtEntityIndex !== null
        ? (entities[previous.caughtEntityIndex] ?? null)
        : null;

    const sounds = deriveRankedHookAudioEvents({
      previous,
      next: snapshot,
      enteringCaughtEntity: enteringCaughtEntity
        ? {
            type: enteringCaughtEntity.type,
            bonusTier: enteringCaughtEntity.bonusTier,
            rewardKind: enteringCaughtEntity.createCatchResult().rewardKind,
          }
        : null,
      resolvingCaughtEntity: resolvingCaughtEntity
        ? {
            type: resolvingCaughtEntity.type,
            bonusTier: resolvingCaughtEntity.bonusTier,
            rewardKind: resolvingCaughtEntity.createCatchResult().rewardKind,
          }
        : null,
    });

    for (const sound of sounds) {
      this.scene.sound.play(sound);
    }
  }

  private handleExplosiveFxComplete(): void {
    this.explosiveFxSprite.setVisible(false);
  }

  private fromRankedHookState(
    state: RankedWasmRuntimeSnapshot['hookState'],
  ): HookState {
    switch (state) {
      case 'swinging':
        return 'swinging';
      case 'extending':
        return 'extending';
      case 'returningEmpty':
        return 'returning-empty';
      case 'returningLoaded':
        return 'returning-loaded';
      default:
        return 'swinging';
    }
  }

  private syncVisuals(): void {
    const direction = getHookDirection(this.angleDeg);

    this.tip.copy(this.origin).add(direction.clone().scale(this.length));
    this.collisionCenter
      .copy(this.origin)
      .add(direction.clone().scale(this.length + HOOK_COLLISION_OFFSET));

    this.lineGraphics.clear();
    // Match the thinner Love2D rope so the seam at the claw head stays clean.
    this.lineGraphics.lineStyle(1, 0x424242, 1);
    this.lineGraphics.beginPath();
    this.lineGraphics.moveTo(this.origin.x, this.origin.y);
    this.lineGraphics.lineTo(this.tip.x, this.tip.y);
    this.lineGraphics.strokePath();

    this.hookSprite.setPosition(this.tip.x, this.tip.y);
    this.hookSprite.setRotation(Phaser.Math.DegToRad(this.angleDeg));

    if (this.caughtEntity) {
      this.caughtEntity.setCaughtPose(
        this.collisionCenter.x,
        this.collisionCenter.y,
        this.angleDeg,
      );
    }
  }
}
