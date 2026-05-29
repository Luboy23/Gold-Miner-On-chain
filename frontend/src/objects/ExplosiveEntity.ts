import Phaser from 'phaser';

import { ANIMATION_KEYS } from '../game/constants';
import { setLogicalTextureSize } from '../game/display';
import type {
  BonusTier,
  CatchAnchor,
  CatchResult,
  CatchRewardKind,
  EntityType,
} from '../game/types/index';
import { areCirclesOverlapping } from '../utils/geometry';
import type { LevelEntity } from './LevelEntity';

const DESTROYED_TNT_CATCH_ANCHOR: CatchAnchor = {
  xRatio: 1 / 3,
  yRatio: 0.1,
};

export interface ExplosiveEntityInit {
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
  destroyedTextureKey: string;
  explosionRadius: number;
}

export class ExplosiveEntity implements LevelEntity {
  readonly type: EntityType;
  readonly sprite: Phaser.GameObjects.Image;
  readonly mass: number;
  readonly bonus: number;
  readonly bonusTier: BonusTier;
  readonly collisionRadius: number;
  readonly rewardKind: CatchRewardKind;
  readonly feedbackText: string;

  isActive = true;
  isCaught = false;

  private readonly scene: Phaser.Scene;
  private readonly destroyedTextureKey: string;
  private readonly explosionRadius: number;
  private readonly fxSprite: Phaser.GameObjects.Sprite;
  private tiny: boolean;
  private catchAnchor: CatchAnchor;
  private hasExploded = false;
  private silent = false;

  constructor(scene: Phaser.Scene, init: ExplosiveEntityInit, hookRadius: number) {
    this.scene = scene;
    this.type = init.type;
    this.mass = init.mass;
    this.bonus = init.bonus;
    this.bonusTier = init.bonusTier;
    this.collisionRadius = init.collisionRadius;
    this.rewardKind = init.rewardKind;
    this.feedbackText = init.feedbackText;
    this.catchAnchor = init.catchAnchor;
    this.destroyedTextureKey = init.destroyedTextureKey;
    this.explosionRadius = init.explosionRadius;
    this.tiny = this.collisionRadius < hookRadius;

    this.sprite = setLogicalTextureSize(
      scene.add.image(0, 0, init.textureKey).setOrigin(0.5).setDepth(10),
      init.textureKey,
    );
    this.sprite.setPosition(
      init.x + this.sprite.displayWidth / 2,
      init.y + this.sprite.displayHeight / 2,
    );

    this.fxSprite = setLogicalTextureSize(
      scene.add
        .sprite(this.sprite.x, this.sprite.y, 'biggerExplosiveFx')
        .setOrigin(0.5)
        .setDepth(12)
        .setVisible(false),
      'biggerExplosiveFx',
    );
    this.fxSprite.on(
      Phaser.Animations.Events.ANIMATION_COMPLETE,
      this.handleFxComplete,
      this,
    );
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

  update(_deltaSec: number): void {}

  setSilent(silent: boolean): void {
    this.silent = silent;
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
    this.fxSprite.setPosition(snapshot.collisionX, snapshot.collisionY);
    if (!snapshot.active) {
      this.fxSprite.setVisible(false);
    }
  }

  onHooked(entities: LevelEntity[]): void {
    if (!this.isActive || this.hasExploded) {
      return;
    }

    this.hasExploded = true;
    this.tiny = true;
    this.catchAnchor = DESTROYED_TNT_CATCH_ANCHOR;
    if (!this.silent) {
      this.scene.sound.play('explosive');
    }

    const blastX = this.collisionX;
    const blastY = this.collisionY;

    this.sprite.setTexture(this.destroyedTextureKey);
    setLogicalTextureSize(this.sprite, this.destroyedTextureKey);

    this.fxSprite
      .setPosition(blastX, blastY)
      .setVisible(true)
      .play(ANIMATION_KEYS.fxExplosiveLarge, true);

    for (const entity of entities) {
      if (entity === this || !entity.isActive) {
        continue;
      }

      if (
        areCirclesOverlapping(
          blastX,
          blastY,
          this.explosionRadius,
          entity.collisionX,
          entity.collisionY,
          entity.collisionRadius,
        )
      ) {
        entity.destroyByExplosion();
      }
    }
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

    this.sprite.setPosition(catchX + worldOffsetX, catchY + worldOffsetY);
    this.fxSprite.setPosition(this.sprite.x, this.sprite.y);
  }

  resolveCatch(): void {
    this.isActive = false;
    this.isCaught = false;
    this.sprite.setVisible(false);
    this.fxSprite.setVisible(false);
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
    this.isActive = false;
    this.isCaught = false;
    this.sprite.setVisible(false);
    this.fxSprite.setVisible(false);
  }

  destroy(): void {
    this.fxSprite.off(
      Phaser.Animations.Events.ANIMATION_COMPLETE,
      this.handleFxComplete,
      this,
    );
    this.fxSprite.destroy();
    this.sprite.destroy();
  }

  private handleFxComplete(
    _animation: Phaser.Animations.Animation,
    _frame: Phaser.Animations.AnimationFrame,
    gameObject: Phaser.GameObjects.Sprite,
  ): void {
    if (gameObject === this.fxSprite) {
      this.fxSprite.setVisible(false);
    }
  }
}
