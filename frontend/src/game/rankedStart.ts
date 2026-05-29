/**
 * rankedStart.ts 负责把“开始排位挑战”的完整准备链路收口成阶段化流程。
 *
 * 这里同时串起了：
 * - 钱包/链前置条件
 * - ranked session 创建与激活
 * - 当前 challenge 指针确认
 * - 本地 canonical spec 校验
 * - authoritative wasm 可用性校验
 * - run 创建
 *
 * 关键约束是：只有所有 replay 关键字段都确认对齐后，才允许真正进入 GameplayScene。
 */
import { keccak256, stringToHex } from 'viem';

import {
  activateRankedSession,
  createRankedSession,
} from '../api/rankedApi';
import {
  ChallengeStartStageError,
  runChallengeStartStage,
  SIGN_TYPED_DATA_TIMEOUT_MS,
  type ChallengeStartProgress,
  type ChallengeStartStage,
  DEFAULT_STAGE_TIMEOUT_MS,
  BUILD_RUN_TIMEOUT_MS,
} from './challengeStart';
import { gameState } from './gameState';
import {
  assertRankedChallengeMatchesSpec,
  loadRankedChallengeSpec,
} from './rankedChallengeManifest';
import {
  getRankedRuntimeMode,
  preloadRankedWasmRuntime,
} from './rankedWasmRuntime';
import { web3State } from './web3State';
import { getRuntimeConfig } from '../web3/runtime/config';
import type { RunState } from './types/index';

export type RankedStartStage = ChallengeStartStage;

export const SESSION_CREATE_TIMEOUT_MS = DEFAULT_STAGE_TIMEOUT_MS;
export const SESSION_ACTIVATE_TIMEOUT_MS = DEFAULT_STAGE_TIMEOUT_MS;
export const RANKED_BUILD_TIMEOUT_MS = BUILD_RUN_TIMEOUT_MS;

export const RANKED_START_STAGE_MESSAGES: Record<RankedStartStage, string> = {
  'connecting-wallet': '正在连接钱包...',
  'switching-chain': '正在切换网络...',
  'creating-session': '正在准备本次挑战...',
  'awaiting-signature': '等待钱包签名...',
  'activating-session': '正在确认本次挑战...',
  'building-run': '正在进入钻石挑战...',
};

export const RANKED_START_BUTTON_LABELS: Record<RankedStartStage, string> = {
  'connecting-wallet': '连接中',
  'switching-chain': '切链中',
  'creating-session': '准备对局中',
  'awaiting-signature': '等待钱包签名',
  'activating-session': '准备中',
  'building-run': '进入挑战中',
};

export interface RankedStartProgress extends ChallengeStartProgress {}

export function formatRankedStartError(error: unknown): string {
  if (error instanceof ChallengeStartStageError) {
    if (error.kind === 'timeout') {
      switch (error.stage) {
        case 'awaiting-signature':
          return '钱包签名超时，请重试。';
        case 'creating-session':
          return '挑战准备超时，请稍后重试。';
        case 'activating-session':
          return '挑战准备超时，请稍后重试。';
        case 'building-run':
          return '排位挑战启动超时，请重试。';
        default:
          return `${RANKED_START_STAGE_MESSAGES[error.stage]}超时，请重试。`;
      }
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return '排位挑战启动失败';
}

export async function prepareRankedRun(
  progress?: RankedStartProgress,
): Promise<RunState> {
  const challenge = web3State.snapshot.rankedBoardState?.currentChallenge ?? null;
  return prepareRankedRunForChallenge(
    challenge
      ? {
          challengeId: challenge.challengeId,
          version: challenge.version,
        }
      : null,
    progress,
  );
}

export async function prepareRankedRunForChallenge(
  targetChallenge:
    | {
        challengeId: string;
        version: number;
      }
    | null,
  progress?: RankedStartProgress,
): Promise<RunState> {
  const initialState = web3State.snapshot;

  // 排位挑战的前置条件比 casual 更严格：钱包、支持链、当前 challenge pointer 都必须稳定。
  if (!initialState.walletAvailable || !initialState.address) {
    await runChallengeStartStage(
      'connecting-wallet',
      async () => {
        await web3State.connectWallet();

        if (!web3State.snapshot.address) {
          throw new Error(web3State.snapshot.lastError ?? '请先连接钱包。');
        }
      },
      progress,
      {
        timeoutMessage: `${RANKED_START_STAGE_MESSAGES['connecting-wallet']}超时`,
        failureMessage: '排位挑战启动失败',
      },
    );
  }

  if (!web3State.snapshot.address) {
    throw new Error(web3State.snapshot.lastError ?? '请先连接钱包。');
  }

  if (!web3State.snapshot.isSupportedChain) {
    await runChallengeStartStage(
      'switching-chain',
      async () => {
        await web3State.switchToDefaultChain();

        if (!web3State.snapshot.isSupportedChain) {
          throw new Error(web3State.snapshot.lastError ?? '请切换到目标网络。');
        }
      },
      progress,
      {
        timeoutMessage: `${RANKED_START_STAGE_MESSAGES['switching-chain']}超时`,
        failureMessage: '排位挑战启动失败',
      },
    );
  }

  if (!web3State.snapshot.isSupportedChain) {
    throw new Error(web3State.snapshot.lastError ?? '请切换到目标网络。');
  }

  let state = web3State.snapshot;
  const challenge = state.rankedBoardState?.currentChallenge ?? null;

  if (!challenge) {
    throw new Error('当前暂无可挑战的排位版本。');
  }

  if (
    targetChallenge &&
    (challenge.challengeId !== targetChallenge.challengeId ||
      challenge.version !== targetChallenge.version)
  ) {
    throw new Error('当前挑战版本已变化，请先返回排位中心刷新。');
  }

  const session = await runChallengeStartStage(
    'creating-session',
    () => createRankedSession(state.address!),
    progress,
    {
      timeoutMs: SESSION_CREATE_TIMEOUT_MS,
      timeoutMessage: `${RANKED_START_STAGE_MESSAGES['creating-session']}超时`,
      failureMessage: '排位挑战启动失败',
    },
  );
  const signature = await runChallengeStartStage(
    'awaiting-signature',
    () => web3State.signTypedData(session.typedData),
    progress,
    {
      timeoutMs: SIGN_TYPED_DATA_TIMEOUT_MS,
      timeoutMessage: `${RANKED_START_STAGE_MESSAGES['awaiting-signature']}超时`,
      failureMessage: '排位挑战启动失败',
    },
  );
  await runChallengeStartStage(
    'activating-session',
    () => activateRankedSession(state.address!, session.sessionId, signature),
    progress,
    {
      timeoutMs: SESSION_ACTIVATE_TIMEOUT_MS,
      timeoutMessage: `${RANKED_START_STAGE_MESSAGES['activating-session']}超时`,
      failureMessage: '排位挑战启动失败',
    },
  );

  state = web3State.snapshot;
  const confirmedChallenge = state.rankedBoardState?.currentChallenge ?? null;

  // 创建/激活 session 期间，当前排位 challenge 有可能已经被后台刷新更新。
  // 因此在真正 build run 前必须再次确认 challenge pointer 仍然与最初目标一致。
  if (
    !confirmedChallenge ||
    confirmedChallenge.challengeId !== challenge.challengeId ||
    confirmedChallenge.version !== challenge.version
  ) {
    throw new Error('排位挑战启动失败：当前挑战版本已变化，请重试。');
  }

  const clientBuildHash = keccak256(
    stringToHex(`${getRuntimeConfig().deploymentId}:frontend:diamond-rush:v1`),
  );

  return runChallengeStartStage(
    'building-run',
    async () => {
      // spec 与链上 challenge 指针对齐、authoritative wasm 可用性确认，都属于 build run 的硬前置条件。
      const [spec, wasmAvailability] = await Promise.all([
        loadRankedChallengeSpec(confirmedChallenge.challengeId, confirmedChallenge.version),
        preloadRankedWasmRuntime(),
      ]);
      assertRankedChallengeMatchesSpec(confirmedChallenge, spec);
      if (
        getRankedRuntimeMode() === 'authoritative' &&
        !wasmAvailability.supported
      ) {
        throw new Error('排位挑战启动失败，请稍后重试。');
      }
      const nextRun = gameState.startRankedRun(confirmedChallenge, {
        sessionId: session.sessionId,
        clientBuildHash,
      });

      // startRankedRun 一旦返回的 sessionId 与刚才激活的 session 不一致，说明状态流已经失真，必须失败。
      if (
        nextRun.mode !== 'ranked' ||
        !nextRun.rankedContext ||
        nextRun.rankedContext.sessionId !== session.sessionId
      ) {
        throw new Error('排位挑战启动失败');
      }

      return nextRun;
    },
    progress,
    {
      timeoutMs: RANKED_BUILD_TIMEOUT_MS,
      timeoutMessage: `${RANKED_START_STAGE_MESSAGES['building-run']}超时`,
      failureMessage: '排位挑战启动失败',
    },
  );
}
