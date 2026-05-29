/**
 * gameState 是前端单机/排位/冒险运行期状态的集中真相源。
 *
 * 这里承载的是“当前游戏局”的可变状态，以及少量需要跨 scene 保留的结果缓存。
 * 关键约束是：
 * - gameplay scene/controller 可以写 currentRun
 * - 结果组装层只消费已经封存好的 run/result 数据
 * - campaign completedLevels 只能存 finalized snapshot，而不是再次从当前 run 反推
 */
import { DEFAULT_DEBUG_FLAGS } from './debug';
import {
  DEFAULT_SAVE_DATA,
  DEFAULT_TEMPORARY_BUFFS,
  DEFAULT_TIME_LIMIT_SEC,
  FINAL_LEVEL_GROUP,
  GOAL_BY_LEVEL,
} from './constants';
import { saveSystem } from '../systems/SaveSystem';
import { levelSystem } from '../systems/LevelSystem';
import type { RankedWasmRuntimeFinalized } from './rankedWasmRuntime';
import {
  getLatestRankedRuntimeFinalized as readLatestRankedRuntimeFinalized,
  setLatestRankedRuntimeFinalized as writeLatestRankedRuntimeFinalized,
} from './rankedRuntimeCache';
import {
  advanceCampaignRunState,
  createCampaignRun,
  recordCampaignLevelResult,
  recordCampaignPurchaseResult,
} from './campaignProgression';
import type { AdventureLevelRef, RankedChallengeRef } from '../web3/types';
import type {
  AssetManifest,
  CampaignLevelFinalizedSnapshot,
  CampaignShopPurchaseEvidence,
  DebugFlags,
  GameStateShape,
  RankedActionKind,
  RunResult,
  RunState,
  SaveData,
  TemporaryBuffs,
} from './types/index';

function cloneTemporaryBuffs(buffs: TemporaryBuffs): TemporaryBuffs {
  return { ...buffs };
}

function cloneRunState(run: RunState): RunState {
  // 对外暴露 run 时一律返回深拷贝，避免 scene/controller 持有内部引用后绕过 store 直接改状态。
  return {
    ...run,
    purchasedItems: [...run.purchasedItems],
    temporaryBuffs: cloneTemporaryBuffs(run.temporaryBuffs),
    currentShopOffers: run.currentShopOffers
      ? run.currentShopOffers.map((offer) => ({ ...offer }))
      : null,
    rankedContext: run.rankedContext
      ? {
          ...run.rankedContext,
          actions: run.rankedContext.actions.map((action) => ({ ...action })),
          challenge: { ...run.rankedContext.challenge },
        }
      : null,
    campaignContext: run.campaignContext
      ? {
          ...run.campaignContext,
          challengeByLevel: Object.fromEntries(
            Object.entries(run.campaignContext.challengeByLevel).map(
              ([levelId, challenge]) => [levelId, { ...challenge }],
            ),
          ),
          completedLevels: run.campaignContext.completedLevels.map((level) => ({
            ...level,
            actions: level.actions.map((action) => ({ ...action })),
          })),
          purchases: run.campaignContext.purchases.map((purchase) => ({
            ...purchase,
          })),
        }
      : null,
  };
}

function cloneSaveData(save: SaveData): SaveData {
  return { ...save };
}

function createInitialState(): GameStateShape {
  return {
    save: cloneSaveData(DEFAULT_SAVE_DATA),
    debug: { ...DEFAULT_DEBUG_FLAGS },
    settings: {
      muted: false,
    },
    manifest: null,
    currentRun: null,
    latestRankedRuntimeFinalized: readLatestRankedRuntimeFinalized(),
  };
}

class GameStateStore {
  private state: GameStateShape = createInitialState();

  get snapshot(): Readonly<GameStateShape> {
    return this.state;
  }

  bootstrap(): void {
    // bootstrap 只负责把持久化 save 装回内存，不恢复上一局 currentRun。
    // 每次进入菜单后的新 run 必须由明确的 start*Run 流程创建。
    this.state = {
      ...createInitialState(),
      save: saveSystem.load(),
    };
  }

  setManifest(manifest: AssetManifest): void {
    this.state = {
      ...this.state,
      manifest,
    };
  }

  get manifest(): AssetManifest | null {
    return this.state.manifest;
  }

  get save(): SaveData {
    return cloneSaveData(this.state.save);
  }

  get debug(): DebugFlags {
    return { ...this.state.debug };
  }

  get currentRun(): RunState | null {
    return this.state.currentRun ? cloneRunState(this.state.currentRun) : null;
  }

  get latestRankedRuntimeFinalized(): RankedWasmRuntimeFinalized | null {
    return readLatestRankedRuntimeFinalized();
  }

  updateDebugFlags(nextDebug: Partial<DebugFlags>): void {
    this.state = {
      ...this.state,
      debug: {
        ...this.state.debug,
        ...nextDebug,
      },
    };
  }

  startNewRun(): RunState {
    return this.startCasualRun();
  }

  startCasualRun(): RunState {
    const seed = this.createSeed();
    const forcedLevel = this.state.debug.forcedLevelId
      ? levelSystem.getLevelDefinition(this.state.debug.forcedLevelId)
      : null;
    const levelGroup = forcedLevel?.group ?? 1;
    const levelId =
      forcedLevel?.id ??
      levelSystem.resolveLevelId(seed, 1, this.state.debug.forcedLevelId) ??
      'L1';

    const run: RunState = {
      mode: 'casual',
      seed,
      levelGroup,
      levelId,
      goal: GOAL_BY_LEVEL[levelGroup],
      score: 0,
      scoreView: 0,
      timeRemainingSec: DEFAULT_TIME_LIMIT_SEC,
      dynamiteCount: 0,
      caughtCount: 0,
      purchasedItems: [],
      temporaryBuffs: cloneTemporaryBuffs(DEFAULT_TEMPORARY_BUFFS),
      currentShopOffers: null,
      status: 'goal',
      rankedContext: null,
      campaignContext: null,
    };

    this.state = {
      ...this.state,
      currentRun: cloneRunState(run),
    };

    return cloneRunState(run);
  }

  startRankedRun(
    challenge: RankedChallengeRef,
    context: {
      sessionId: `0x${string}`;
      clientBuildHash: `0x${string}`;
    },
  ): RunState {
    // ranked run 的初始值必须与 authoritative/shadow runtime 的起点一致；
    // 这里不能沿用 casual/campaign 的 goal/shop 语义。
    const run: RunState = {
      mode: 'ranked',
      seed: challenge.challengeSeed,
      levelGroup: 1,
      levelId: challenge.challengeId,
      goal: 0,
      score: 0,
      scoreView: 0,
      timeRemainingSec:
        challenge.timeLimitTicks > 0 && challenge.logicFps > 0
          ? challenge.timeLimitTicks / challenge.logicFps
          : 60,
      dynamiteCount: 0,
      caughtCount: 0,
      purchasedItems: [],
      temporaryBuffs: cloneTemporaryBuffs(DEFAULT_TEMPORARY_BUFFS),
      currentShopOffers: null,
      status: 'playing',
      rankedContext: {
        sessionId: context.sessionId,
        challengeId: challenge.challengeId,
        challengeVersion: challenge.version,
        challengeContentHash: challenge.contentHash,
        challengeSeed: challenge.challengeSeed,
        clientBuildHash: context.clientBuildHash,
        simulationVersion: challenge.simulationVersion,
        logicFps: challenge.logicFps,
        timeLimitTicks: challenge.timeLimitTicks,
        logicTick: 0,
        actions: [],
        challenge: { ...challenge },
        lastDiamondTick: 0,
      },
      campaignContext: null,
    };

    this.state = {
      ...this.state,
      currentRun: cloneRunState(run),
    };

    return cloneRunState(run);
  }

  startCampaignRun(
    challenges: AdventureLevelRef[],
    context: {
      campaignId: `0x${string}`;
      sessionId: `0x${string}`;
      campaignSeed: `0x${string}`;
      clientBuildHash: `0x${string}`;
    },
  ): RunState {
    // campaign run 的具体结构由 createCampaignRun 统一生成，避免 scene 层重复拼接
    // baseline、challengeByLevel 和 replay 账本窗口。
    const run = createCampaignRun(challenges, context);

    this.state = {
      ...this.state,
      currentRun: cloneRunState(run),
    };

    return cloneRunState(run);
  }

  recordRankedAction(kind: RankedActionKind, tick: number): void {
    const run = this.state.currentRun;

    if (!run || run.mode === 'casual' || !run.rankedContext || tick < 0) {
      return;
    }

    // 同一 tick 只允许记录一次动作；否则 replay 会把单次输入解释成多次合法操作。
    const lastTick = run.rankedContext.actions.at(-1)?.tick;
    if (lastTick === tick) {
      return;
    }

    const nextRun: RunState = {
      ...run,
      rankedContext: {
        ...run.rankedContext,
        actions: [...run.rankedContext.actions, { kind, tick }],
      },
    };

    this.state = {
      ...this.state,
      currentRun: nextRun,
    };
  }

  setRankedLastDiamondTick(tick: number): void {
    const run = this.state.currentRun;

    if (!run || run.mode !== 'ranked' || !run.rankedContext) {
      return;
    }

    const nextRun: RunState = {
      ...run,
      rankedContext: {
        ...run.rankedContext,
        lastDiamondTick: Math.max(run.rankedContext.lastDiamondTick, tick),
      },
    };

    this.state = {
      ...this.state,
      currentRun: nextRun,
    };
  }

  recordCampaignLevel(
    run: RunState,
    snapshot: CampaignLevelFinalizedSnapshot | null,
  ): RunState {
    // campaign level 录证只能消费 finalized snapshot，不允许回头从 mutable run 现算本关 evidence。
    const nextRun = recordCampaignLevelResult(run, snapshot);

    this.setCurrentRun(nextRun);
    return cloneRunState(nextRun);
  }

  recordCampaignPurchase(
    run: RunState,
    purchase: CampaignShopPurchaseEvidence,
  ): RunState {
    // 购买会重置下一关的 score/dynamite baseline；这一步必须经由 campaignProgression 收口。
    const nextRun = recordCampaignPurchaseResult(run, purchase);

    this.setCurrentRun(nextRun);
    return cloneRunState(nextRun);
  }

  setCurrentRun(run: RunState): void {
    this.state = {
      ...this.state,
      currentRun: cloneRunState(run),
    };
  }

  setLatestRankedRuntimeFinalized(
    finalized: RankedWasmRuntimeFinalized | null,
  ): void {
    writeLatestRankedRuntimeFinalized(finalized);
    this.state = {
      ...this.state,
      latestRankedRuntimeFinalized: readLatestRankedRuntimeFinalized(),
    };
  }

  clearCurrentRun(): void {
    this.state = {
      ...this.state,
      currentRun: null,
    };
  }

  acknowledgeExperienceMode(): void {
    if (this.state.save.acknowledgedExperienceMode) {
      return;
    }

    const nextSave = {
      ...this.state.save,
      acknowledgedExperienceMode: true,
    };
    saveSystem.save(nextSave);
    this.state = {
      ...this.state,
      save: nextSave,
    };
  }

  advanceCampaignRun(run: RunState): RunState {
    if (run.levelGroup >= FINAL_LEVEL_GROUP) {
      this.setCurrentRun(run);
      return cloneRunState(run);
    }
    // 进入下一关时要同时刷新 levelStart* 基线并重置 rankedContext 的 tick/action 窗口。
    const nextRun = advanceCampaignRunState(run);

    this.setCurrentRun(nextRun);
    return cloneRunState(nextRun);
  }

  applyRunResult(result: RunResult): {
    save: SaveData;
    isNewHighScore: boolean;
    isNewHighLevel: boolean;
  } {
    if (result.mode !== 'casual') {
      this.state = {
        ...this.state,
        currentRun: null,
      };

      return {
        save: cloneSaveData(this.state.save),
        isNewHighScore: false,
        isNewHighLevel: false,
      };
    }

    this.state = {
      ...this.state,
      currentRun: null,
    };

    return {
      save: cloneSaveData(this.state.save),
      isNewHighScore: false,
      isNewHighLevel: false,
    };
  }

  resetForMenu(): void {
    this.state = {
      ...this.state,
      currentRun: null,
    };
  }

  private createSeed(): string {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      return crypto.randomUUID();
    }

    return `run-${Date.now().toString(36)}`;
  }
}

export const gameState = new GameStateStore();
