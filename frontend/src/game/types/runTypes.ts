import type { Hex } from 'viem';

import type {
  AdventureLevelRef,
  RankedChallengeRef,
} from '../../web3/types';
import type {
  AssetManifest,
  LevelGroup,
  ShopItemId,
  ShopOffer,
  TemporaryBuffs,
  EntityType,
  BonusTier,
} from './contentTypes';

export interface SaveData {
  version: 1;
  highScore: number;
  highLevel: number;
  acknowledgedExperienceMode: boolean;
}

export type RunMode = 'casual' | 'ranked' | 'campaign';
export type RunStatus = 'goal' | 'playing' | 'shopping' | 'result' | 'failed';
export type RankedActionKind = 'fireHook' | 'useDynamite';
export type RankedRuntimeMode = 'shadow' | 'authoritative';

export interface RankedRunAction {
  kind: RankedActionKind;
  tick: number;
}

export interface RankedRunSummaryV3 {
  diamondsCaught: number;
  lastDiamondTick: number;
}

export interface CampaignRunSummaryV2 {
  score: number;
  dynamiteUsed: number;
  caughtCount: number;
  cleared: boolean;
}

export interface RankedRunEvidenceV3 {
  protocolVersion: number;
  simulationVersion: number;
  sessionId: Hex;
  challengeId: string;
  challengeVersion: number;
  challengeContentHash: Hex;
  challengeSeed: Hex;
  clientBuildHash: Hex;
  logicFps: number;
  finishedTick: number;
  actions: RankedRunAction[];
  summary: RankedRunSummaryV3;
}

export interface RankedRunContext {
  sessionId: Hex;
  challengeId: string;
  challengeVersion: number;
  challengeContentHash: Hex;
  challengeSeed: Hex;
  clientBuildHash: Hex;
  simulationVersion: number;
  logicFps: number;
  timeLimitTicks: number;
  logicTick: number;
  actions: RankedRunAction[];
  challenge: RankedChallengeRef;
  lastDiamondTick: number;
}

export interface CampaignLevelEvidenceV2 {
  levelGroup: LevelGroup;
  levelId: string;
  levelVersion: number;
  levelContentHash: Hex;
  challengeSeed: Hex;
  goal: number;
  logicFps: number;
  finishedTick: number;
  actions: RankedRunAction[];
  summary: CampaignRunSummaryV2;
}

export interface CampaignLevelFinalizedSnapshot {
  levelGroup: LevelGroup;
  levelId: string;
  levelVersion: number;
  levelContentHash: Hex;
  challengeSeed: Hex;
  goal: number;
  logicFps: number;
  finishedTick: number;
  actions: RankedRunAction[];
  scoreDelta: number;
  caughtCountDelta: number;
  dynamiteUsed: number;
  cleared: boolean;
}

export interface CampaignShopPurchaseEvidence {
  shopLevelGroup: LevelGroup;
  itemId: ShopItemId;
  price: number;
}

export interface CampaignEvidenceV2 {
  protocolVersion: number;
  simulationVersion: number;
  campaignId: Hex;
  sessionId: Hex;
  campaignSeed: Hex;
  clientBuildHash: Hex;
  levels: CampaignLevelEvidenceV2[];
  purchases: CampaignShopPurchaseEvidence[];
  finalScore: number;
}

export interface CampaignRunContext {
  campaignId: Hex;
  sessionId: Hex;
  campaignSeed: Hex;
  clientBuildHash: Hex;
  simulationVersion: number;
  logicFps: number;
  challengeByLevel: Record<string, AdventureLevelRef>;
  completedLevels: CampaignLevelFinalizedSnapshot[];
  purchases: CampaignShopPurchaseEvidence[];
  levelStartScore: number;
  levelStartCaughtCount: number;
  levelStartDynamiteUsed: number;
}

export interface RunState {
  mode: RunMode;
  seed: string;
  levelGroup: LevelGroup;
  levelId: string;
  goal: number;
  score: number;
  scoreView: number;
  timeRemainingSec: number;
  dynamiteCount: number;
  caughtCount: number;
  purchasedItems: ShopItemId[];
  temporaryBuffs: TemporaryBuffs;
  currentShopOffers: ShopOffer[] | null;
  status: RunStatus;
  rankedContext: RankedRunContext | null;
  campaignContext: CampaignRunContext | null;
}

export interface RunRestartSnapshot {
  mode: RunMode;
  seed: string;
  levelGroup: LevelGroup;
  levelId: string;
  goal: number;
  score: number;
  scoreView: number;
  timeRemainingSec: number;
  dynamiteCount: number;
  caughtCount: number;
  purchasedItems: ShopItemId[];
  temporaryBuffs: TemporaryBuffs;
  rankedContext: RankedRunContext | null;
  campaignContext: CampaignRunContext | null;
}

export interface RunResult {
  mode: RunMode;
  levelGroup: LevelGroup;
  levelId: string;
  goal: number;
  score: number;
  reachedGoal: boolean;
  endedAtFinalLevel: boolean;
  elapsedSec: number;
  purchasedItems: ShopItemId[];
  seed: string;
  caughtCount: number;
  rankedEvidence: RankedRunEvidenceV3 | null;
  rankedRuntimeSummary: {
    logicTick: number;
    diamondsCaught: number;
    lastDiamondTick: number;
    finishedTick: number;
    durationMs: number;
  } | null;
  campaignEvidence: CampaignEvidenceV2 | null;
}

export type GoalSceneMode = 'next-goal' | 'level-clear';
export type HookState =
  | 'swinging'
  | 'extending'
  | 'returning-empty'
  | 'returning-loaded'
  | 'resolving-catch';

export type CatchRewardKind = 'money' | 'dynamite' | 'strength';

export interface CatchResult {
  entityType: EntityType;
  bonus: number;
  bonusTier: BonusTier;
  rewardKind: CatchRewardKind;
  feedbackText: string;
  dynamiteDelta: number;
  grantsStrengthBoost: boolean;
}

export interface DebugFlags {
  showHitCircles: boolean;
  forceGoalReached: boolean;
  infiniteTime: boolean;
  forcedLevelId: string | null;
  muteAudio: boolean;
}

export interface GameStateShape {
  save: SaveData;
  debug: DebugFlags;
  settings: {
    muted: boolean;
  };
  manifest: AssetManifest | null;
  currentRun: RunState | null;
  latestRankedRuntimeFinalized: {
    logicTick: number;
    diamondsCaught: number;
    lastDiamondTick: number;
    finishedTick: number;
    durationMs: number;
  } | null;
}

export interface ShopPurchaseResult {
  run: RunState;
  status: 'purchased' | 'insufficient-funds' | 'already-sold' | 'not-found';
  offer: ShopOffer | null;
}
