import Phaser from 'phaser';

import {
  MOVING_ENTITY_IDLE_DURATION_SEC,
  MOVING_ENTITY_PIXELS_PER_SECOND,
  MOVING_ENTITY_TURN_THRESHOLD,
} from '../game/constants';
import { setLogicalTextureSize } from '../game/display';
import type {
  BonusTier,
  CatchResult,
  CatchRewardKind,
  EntityType,
  MoveDirection,
} from '../game/types/index';
import type { LevelEntity } from './LevelEntity';

export interface MovingEntityInit {
  type: EntityType;
  textureKey: string;
  x: number;
  y: number;
  dir: MoveDirection;
  mass: number;
  bonus: number;
  bonusTier: BonusTier;
  collisionRadius: number;
  rewardKind: CatchRewardKind;
  feedbackText: string;
  moveSpeed: number;
  moveRange: number;
  idleAnimationKey: string;
  moveAnimationKey: string;
}

export class MovingEntity implements LevelEntity {
  readonly type: EntityType;
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly mass: number;
  readonly bonus: number;
  readonly bonusTier: BonusTier;
  readonly collisionRadius: number;
  readonly rewardKind: CatchRewardKind;
  readonly feedbackText: string;

  isActive = true;
  isCaught = false;

  private readonly moveSpeed: number;
  private readonly moveRange: number;
  private readonly idleAnimationKey: string;
  private readonly moveAnimationKey: string;
  private readonly tiny: boolean;

  private directionSign: number;
  private destinationX: number;
  private idleTimerSec = MOVING_ENTITY_IDLE_DURATION_SEC;
  private isMoving = true;

  constructor(scene: Phaser.Scene, init: MovingEntityInit, hookRadius: number) {
    this.type = init.type;
    this.mass = init.mass;
    this.bonus = init.bonus;
    this.bonusTier = init.bonusTier;
    this.collisionRadius = init.collisionRadius;
    this.rewardKind = init.rewardKind;
    this.feedbackText = init.feedbackText;
    this.moveSpeed = init.moveSpeed;
    this.moveRange = init.moveRange;
    this.idleAnimationKey = init.idleAnimationKey;
    this.moveAnimationKey = init.moveAnimationKey;
    this.tiny = this.collisionRadius < hookRadius;
    this.directionSign = init.dir === 'Left' ? -1 : 1;
    this.destinationX = init.x + this.directionSign * this.moveRange;

    this.sprite = setLogicalTextureSize(
      scene.add
        .sprite(init.x, init.y, init.textureKey)
        .setOrigin(0.5)
        .setDepth(10)
        .play(this.moveAnimationKey),
      init.textureKey,
    );
    this.sprite.setFlipX(this.directionSign > 0);
  }

  get isTiny(): boolean {
    return this.tiny;
  }

  get collisionX(): number {
    return this.sprite.x;
  }

  get collisionY(): number {
    return this.sprite.y;
  }

  update(deltaSec: number): void {
    if (!this.isActive || this.isCaught) {
      return;
    }

    if (!this.isMoving) {
      if (this.sprite.anims.getName() !== this.idleAnimationKey) {
        this.sprite.play(this.idleAnimationKey);
      }

      this.idleTimerSec = Math.max(0, this.idleTimerSec - deltaSec);

      if (this.idleTimerSec <= 0) {
        this.isMoving = true;
        this.idleTimerSec = MOVING_ENTITY_IDLE_DURATION_SEC;
        this.sprite.play(this.moveAnimationKey);
      }

      return;
    }

    if (this.sprite.anims.getName() !== this.moveAnimationKey) {
      this.sprite.play(this.moveAnimationKey);
    }

    const velocity =
      this.moveSpeed * MOVING_ENTITY_PIXELS_PER_SECOND * deltaSec;
    const nextX = this.sprite.x + this.directionSign * velocity;
    const reachedDestination =
      Math.abs(nextX - this.destinationX) <= MOVING_ENTITY_TURN_THRESHOLD ||
      (this.directionSign < 0 && nextX <= this.destinationX) ||
      (this.directionSign > 0 && nextX >= this.destinationX);

    if (reachedDestination) {
      this.sprite.x = this.destinationX;
      this.isMoving = false;
      this.directionSign *= -1;
      this.sprite.setFlipX(this.directionSign > 0);
      this.destinationX = this.sprite.x + this.directionSign * this.moveRange;
      return;
    }

    this.sprite.x = nextX;
  }

  syncSnapshot(snapshot: {
    active: boolean;
    caught: boolean;
    collisionX: number;
    collisionY: number;
  }): void {
    this.isActive = snapshot.active;
    this.isCaught = snapshot.caught;
    this.sprite.setVisible(snapshot.active);
    this.sprite.setPosition(snapshot.collisionX, snapshot.collisionY);
  }

  setCaughtPose(catchX: number, catchY: number, angleDeg: number): void {
    this.isCaught = true;
    this.sprite.setPosition(catchX, catchY);
    this.sprite.setRotation(Phaser.Math.DegToRad(angleDeg));

    if (this.sprite.anims.getName() !== this.moveAnimationKey) {
      this.sprite.play(this.moveAnimationKey);
    }
  }

  resolveCatch(): void {
    this.isActive = false;
    this.isCaught = false;
    this.sprite.setVisible(false);
  }

  createCatchResult(): CatchResult {
    return {
      entityType: this.type,
      bonus: this.bonus,
      bonusTier: this.bonusTier,
      rewardKind: this.rewardKind,
      feedbackText: this.feedbackText,
      dynamiteDelta: 0,
      grantsStrengthBoost: false,
    };
  }

  destroyByExplosion(): void {
    this.resolveCatch();
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
