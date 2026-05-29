import Phaser from 'phaser';

import { setLogicalTextureSize } from '../game/display';
import type {
  BonusTier,
  CatchAnchor,
  CatchResult,
  CatchRewardKind,
  EntityType,
} from '../game/types/index';
import type { LevelEntity } from './LevelEntity';

export interface StaticEntityInit {
  type: EntityType;
  textureKey: string;
  x: number;
  y: number;
  mass: number;
  bonus: number;
  bonusTier: BonusTier;
  collisionRadius: number;
  catchAnchor: CatchAnchor;
  rewardKind: CatchRewardKind;
  feedbackText: string;
  dynamiteDelta?: number;
  grantsStrengthBoost?: boolean;
}

export class StaticEntity implements LevelEntity {
  readonly type: EntityType;
  readonly sprite: Phaser.GameObjects.Image;
  readonly mass: number;
  readonly bonus: number;
  readonly bonusTier: BonusTier;
  readonly collisionRadius: number;
  readonly catchAnchor: CatchAnchor;
  readonly isTiny: boolean;
  readonly rewardKind: CatchRewardKind;
  readonly feedbackText: string;
  readonly dynamiteDelta: number;
  readonly grantsStrengthBoost: boolean;

  isActive = true;
  isCaught = false;

  constructor(scene: Phaser.Scene, init: StaticEntityInit, hookRadius: number) {
    this.type = init.type;
    this.mass = init.mass;
    this.bonus = init.bonus;
    this.bonusTier = init.bonusTier;
    this.collisionRadius = init.collisionRadius;
    this.catchAnchor = init.catchAnchor;
    this.rewardKind = init.rewardKind;
    this.feedbackText = init.feedbackText;
    this.dynamiteDelta = init.dynamiteDelta ?? 0;
    this.grantsStrengthBoost = init.grantsStrengthBoost ?? false;

    const sprite = setLogicalTextureSize(
      scene.add.image(0, 0, init.textureKey).setOrigin(0.5),
      init.textureKey,
    );
    sprite.setPosition(
      init.x + sprite.displayWidth / 2,
      init.y + sprite.displayHeight / 2,
    );

    this.sprite = sprite;
    this.isTiny = this.collisionRadius < hookRadius;
  }

  get collisionX(): number {
    return this.sprite.x;
  }

  get collisionY(): number {
    return this.sprite.y;
  }

  setCaughtPose(catchX: number, catchY: number, angleDeg: number): void {
    this.isCaught = true;
    this.sprite.setRotation(Phaser.Math.DegToRad(angleDeg));

    const angleRad = Phaser.Math.DegToRad(angleDeg);
    const localOffsetX =
      (0.5 - this.catchAnchor.xRatio) * this.sprite.displayWidth;
    const localOffsetY =
      (0.5 - this.catchAnchor.yRatio) * this.sprite.displayHeight;
    const worldOffsetX =
      localOffsetX * Math.cos(angleRad) - localOffsetY * Math.sin(angleRad);
    const worldOffsetY =
      localOffsetX * Math.sin(angleRad) + localOffsetY * Math.cos(angleRad);

    this.sprite.setPosition(
      catchX + worldOffsetX,
      catchY + worldOffsetY,
    );
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
      dynamiteDelta: this.dynamiteDelta,
      grantsStrengthBoost: this.grantsStrengthBoost,
    };
  }

  update(_deltaSec: number): void {}

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

  destroyByExplosion(): void {
    this.resolveCatch();
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
