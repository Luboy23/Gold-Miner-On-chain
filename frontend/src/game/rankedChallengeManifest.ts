/**
 * rankedChallengeManifest.ts 负责把前端本地的 ranked challenge manifest 暴露成
 * 可按 challengeId/version 查询的规范入口。
 *
 * 这里的核心约束是：本地 manifest 只是前端可读配置与 canonical spec 的承载体，
 * 真正启用与否仍以后端/链上 catalog 为准。前端在本地读取 spec 后，只能做一致性校验，
 * 不能把本地 manifest 当成单方面真相源。
 */
import type { Hex } from 'viem';
import type { RankedChallengeRef } from '../web3/types';

export interface RankedChallengeManifestEntry {
  challengeId: string;
  displayName?: string;
  shortName?: string;
  version: number;
  order: number;
  contentHash: Hex;
  challengeSeed: Hex;
  simulationVersion: number;
  logicFps: number;
  timeLimitTicks: number;
  enabled: boolean;
  isCurrent: boolean;
  canonical: {
    challengeId: string;
    challengeVersion: number;
    simulationVersion: number;
    logicFps: number;
    timeLimitTicks: number;
    boardKind: string;
    theme: string;
    constants: {
      hookOrigin: { x: number; y: number };
      hookCollisionOffset: number;
      hookMinAngle: number;
      hookMaxAngle: number;
      hookRotateSpeed: number;
      hookMaxLength: number;
      hookGrabSpeed: number;
      hookEmptyReturnSpeed: number;
      hookCollisionRadius: number;
      hookResolveDurationSec: number;
      questionBagExtraDynamiteChance: number;
      maxDynamiteCount: number;
      defaultStrengthMultiplier: number;
      maxStrengthMultiplier: number;
      movingEntityIdleDurationSec: number;
      movingEntityPixelsPerSecond: number;
      movingEntityTurnThreshold: number;
    };
    entityConfigs: Record<
      string,
      {
        id: string;
        family: 'static' | 'random-bag' | 'moving' | 'explosive';
        mass: number;
        baseBonus: number;
        bonusTier: string;
        collisionRadius: number;
        catchAnchor: { xRatio: number; yRatio: number };
        displaySize: { width: number; height: number };
        randomBag: null;
        moving: null;
        explosive: null;
      }
    >;
    spawnPoints: Array<{ x: number; y: number }>;
    spawnPolicy: {
      cycleSize: number;
      shuffleAlgorithm: string;
      entityType: string;
      allowItems: boolean;
      allowDynamiteAction: boolean;
    };
  };
}

interface RankedChallengeManifestDocument {
  version: number;
  generatedAt: string;
  boardId: string;
  simulationVersion: number;
  logicFps: number;
  challenges: RankedChallengeManifestEntry[];
}

function normalizeEntry(raw: RankedChallengeManifestEntry & { levelId?: string }): RankedChallengeManifestEntry {
  // 历史数据里可能仍残留 levelId 字段；这里统一规范成 challengeId，避免调用方分支兼容两套命名。
  return {
    ...raw,
    challengeId: raw.challengeId ?? raw.levelId ?? '',
  };
}

let manifestPromise: Promise<RankedChallengeManifestDocument> | null = null;

async function loadManifest(): Promise<RankedChallengeManifestDocument> {
  if (!manifestPromise) {
    // manifest 按需加载并缓存，避免每次准备排位挑战都重复请求静态 JSON。
    manifestPromise = fetch('/ranked-challenge-manifest.json', {
      headers: {
        Accept: 'application/json',
      },
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error('无法加载排位挑战数据。');
      }
      return (await response.json()) as RankedChallengeManifestDocument;
    });
  }

  return manifestPromise;
}

export async function loadRankedChallengeSpec(
  challengeId: string,
  version: number,
): Promise<RankedChallengeManifestEntry> {
  const manifest = await loadManifest();
  const entry =
    manifest.challenges.find(
      (challenge) =>
        (challenge.challengeId ?? (challenge as RankedChallengeManifestEntry & { levelId?: string }).levelId) === challengeId
          && challenge.version === version,
    ) ?? null;

  if (!entry) {
    throw new Error('当前排位挑战数据缺失，请稍后重试。');
  }

  return normalizeEntry(entry as RankedChallengeManifestEntry & { levelId?: string });
}

export function assertRankedChallengeMatchesSpec(
  challenge: RankedChallengeRef,
  spec: RankedChallengeManifestEntry,
): void {
  // 这里校验的是“前端当前读到的链上 challenge 指针”与“本地 canonical spec”是否对齐。
  // 一旦任何 replay 关键字段不一致，就必须立刻失败，不能带着错 spec 进入 run。
  const mismatch =
    challenge.challengeId !== spec.challengeId ||
    challenge.version !== spec.version ||
    challenge.contentHash.toLowerCase() !== spec.contentHash.toLowerCase() ||
    challenge.challengeSeed.toLowerCase() !== spec.challengeSeed.toLowerCase() ||
    challenge.simulationVersion !== spec.simulationVersion ||
    challenge.logicFps !== spec.logicFps ||
    challenge.timeLimitTicks !== spec.timeLimitTicks;

  if (!mismatch) {
    return;
  }

  throw new Error('当前排位挑战数据异常，请稍后重试。');
}
