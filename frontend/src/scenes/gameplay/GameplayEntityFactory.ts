import type Phaser from 'phaser';

import {
  ANIMATION_KEYS,
  HOOK_COLLISION_RADIUS,
  QUESTION_BAG_EXTRA_DYNAMITE_CHANCE,
} from '../../game/constants';
import type {
  CatchResult,
  EntityType,
  LevelDefinition,
  LevelEntitySpawn,
  RunState,
} from '../../game/types/index';
import { ENTITY_CONFIGS } from '../../data/entities';
import { ExplosiveEntity } from '../../objects/ExplosiveEntity';
import type { LevelEntity } from '../../objects/LevelEntity';
import { MovingEntity } from '../../objects/MovingEntity';
import { StaticEntity } from '../../objects/StaticEntity';
import { RunRng } from '../../systems/RunRng';
import type { RankedDiamondRushController } from './RankedDiamondRushController';

/**
 * Gameplay 实体工厂。
 *
 * 这个文件的职责是把关卡静态定义、临时 buff、以及 verified run 的额外约束，
 * 统一折叠成真正进入场景的实体实例。它是“配置 -> 实例”的唯一入口，
 * 因此问号袋随机性、移动体参数和爆炸体参数都必须在这里确定下来。
 */
function isRockEntity(type: EntityType): boolean {
  return type === 'MiniRock' || type === 'NormalRock' || type === 'BigRock';
}

function formatMoney(value: number): string {
  return `+$${value}`;
}

function isVerifiedRun(run: RunState | null): boolean {
  return run?.mode === 'ranked' || run?.mode === 'campaign';
}

export class GameplayEntityFactory {
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  createInitialEntities(
    run: RunState,
    level: LevelDefinition,
    rankedDiamondRushController: RankedDiamondRushController | null,
  ): LevelEntity[] {
    if (run.mode === 'ranked') {
      // ranked 的初始钻石由 controller 决定生成窗口；工厂只负责把 controller
      // 选中的 spawn 转成实体实例，不自行决定“何时出现下一颗钻石”。
      return (
        rankedDiamondRushController?.spawnInitialDiamond(
          run,
          level,
          [],
          (spawn, nextRun, nextLevel, bagIndex) =>
            this.createEntity(spawn, nextRun, nextLevel, bagIndex),
        ) ?? []
      );
    }

    let bagIndex = 0;
    return level.entities.map((spawn) => {
      const currentBagIndex = spawn.type === 'QuestionBag' ? bagIndex++ : null;
      return this.createEntity(spawn, run, level, currentBagIndex);
    });
  }

  spawnNextRankedDiamond(
    run: RunState,
    level: LevelDefinition,
    entities: LevelEntity[],
    rankedDiamondRushController: RankedDiamondRushController | null,
  ): LevelEntity[] {
    return (
      rankedDiamondRushController?.spawnNextDiamond(
        run,
        level,
        entities,
        (spawn, rankedRun, nextLevel, bagIndex) =>
          this.createEntity(spawn, rankedRun, nextLevel, bagIndex),
      ) ?? entities
    );
  }

  createEntity(
    spawn: LevelEntitySpawn,
    run: RunState,
    level: LevelDefinition,
    bagIndex: number | null,
  ): LevelEntity {
    const { type, x, y } = spawn;
    const config = ENTITY_CONFIGS[type];

    if (type === 'QuestionBag' && config.family === 'random-bag' && config.randomBag) {
      // 问号袋的随机结果必须是可复现的：同一个 seed、关卡和袋子索引，前后端都
      // 应该得出同一份奖励形态。这里不能使用场景级随机源。
      const bagSeedBase =
        isVerifiedRun(run) && run.rankedContext
          ? run.rankedContext.challengeSeed
          : run.seed;
      const bagRng = new RunRng(`${bagSeedBase}:bag:${level.id}:${bagIndex ?? 0}`);
      const massBase = bagRng.nextInt(
        config.randomBag.massMin,
        config.randomBag.massMax,
      );
      const bonusBase =
        bagRng.nextInt(
          config.randomBag.bonusRatioMin,
          config.randomBag.bonusRatioMax,
        ) * config.randomBag.bonusBase;
      const extraEffectChance =
        config.randomBag.extraEffectChance *
        (run.temporaryBuffs.luckyClover === 1 ? 2 : 1);
      const hasExtraEffect = bagRng.next() <= Math.min(1, extraEffectChance);

      let bonus = bonusBase;
      let rewardKind: CatchResult['rewardKind'] = 'money';
      let feedbackText = formatMoney(bonusBase);
      let dynamiteDelta = 0;
      let grantsStrengthBoost = false;

      if (hasExtraEffect) {
        bonus = 0;
        if (bagRng.next() <= QUESTION_BAG_EXTRA_DYNAMITE_CHANCE) {
          rewardKind = 'dynamite';
          feedbackText = '+1 炸药';
          dynamiteDelta = 1;
        } else {
          rewardKind = 'strength';
          feedbackText = '力量提升';
          grantsStrengthBoost = true;
        }
      }

      return new StaticEntity(
        this.scene,
        {
          type: config.id,
          textureKey: config.textureKey,
          x,
          y,
          mass: massBase,
          bonus,
          bonusTier: config.bonusTier,
          collisionRadius: config.collisionRadius,
          catchAnchor: config.catchAnchor,
          rewardKind,
          feedbackText,
          dynamiteDelta,
          grantsStrengthBoost,
        },
        HOOK_COLLISION_RADIUS,
      );
    }

    let mass = config.mass;
    let bonus = config.baseBonus;

    if (run.temporaryBuffs.rockCollectorsBook === 1 && isRockEntity(type)) {
      bonus = bonus * 3;
    }

    if (run.temporaryBuffs.gemPolish === 1 && type === 'Diamond') {
      bonus = Math.round(bonus * 1.5);
    }

    if (run.temporaryBuffs.gemPolish === 1 && type === 'MoleWithDiamond') {
      bonus = Math.round(
        (bonus - ENTITY_CONFIGS.Mole.baseBonus) * 1.5 +
          ENTITY_CONFIGS.Mole.baseBonus,
      );
    }

    if (config.family === 'moving' && config.moving) {
      // 移动物体的动画键和行为参数在实例化时一次性固定，后续 update 只消费这些
      // 参数，不再回头依赖配置表。
      const isDiamondMole = type === 'MoleWithDiamond';
      return new MovingEntity(
        this.scene,
        {
          type: config.id,
          textureKey: config.textureKey,
          x,
          y,
          dir: spawn.dir ?? 'Left',
          mass,
          bonus,
          bonusTier: config.bonusTier,
          collisionRadius: config.collisionRadius,
          rewardKind: 'money',
          feedbackText: formatMoney(bonus),
          moveSpeed: config.moving.speed,
          moveRange: config.moving.moveRange,
          idleAnimationKey: isDiamondMole
            ? ANIMATION_KEYS.moleDiamondIdle
            : ANIMATION_KEYS.moleIdle,
          moveAnimationKey: isDiamondMole
            ? ANIMATION_KEYS.moleDiamondMove
            : ANIMATION_KEYS.moleMove,
        },
        HOOK_COLLISION_RADIUS,
      );
    }

    if (config.family === 'explosive' && config.explosive) {
      // 炸药桶一旦实例化，爆炸半径和 destroyed 贴图就成为实体自身状态的一部分，
      // 不再由外部系统二次推导。
      return new ExplosiveEntity(
        this.scene,
        {
          type: config.id,
          textureKey: config.textureKey,
          x,
          y,
          mass,
          bonus,
          bonusTier: config.bonusTier,
          collisionRadius: config.collisionRadius,
          catchAnchor: config.catchAnchor,
          rewardKind: 'money',
          feedbackText: formatMoney(bonus),
          destroyedTextureKey: config.explosive.destroyedTextureKey,
          explosionRadius: config.explosive.explosionRadius,
        },
        HOOK_COLLISION_RADIUS,
      );
    }

    return new StaticEntity(
      this.scene,
      {
        type: config.id,
        textureKey: config.textureKey,
        x,
        y,
        mass,
        bonus,
        bonusTier: config.bonusTier,
        collisionRadius: config.collisionRadius,
        catchAnchor: config.catchAnchor,
        rewardKind: 'money',
        feedbackText: formatMoney(bonus),
      },
      HOOK_COLLISION_RADIUS,
    );
  }
}
