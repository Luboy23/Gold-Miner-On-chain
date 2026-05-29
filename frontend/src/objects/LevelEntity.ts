import type { BonusTier, CatchResult, EntityType } from '../game/types/index';

export interface LevelEntity {
  readonly type: EntityType;
  readonly mass: number;
  readonly bonusTier: BonusTier;
  readonly collisionRadius: number;
  readonly isTiny: boolean;

  isActive: boolean;
  isCaught: boolean;

  get collisionX(): number;
  get collisionY(): number;

  update(deltaSec: number): void;
  syncSnapshot?(snapshot: {
    active: boolean;
    caught: boolean;
    collisionX: number;
    collisionY: number;
  }): void;
  setCaughtPose(catchX: number, catchY: number, angleDeg: number): void;
  resolveCatch(): void;
  createCatchResult(): CatchResult;
  destroyByExplosion(): void;
  setSilent?(silent: boolean): void;
  destroy(): void;
  onHooked?(entities: LevelEntity[]): void;
}
