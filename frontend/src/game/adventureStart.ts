/**
 * adventureStart.ts 负责把“进入冒险挑战”的准备流程收口成可观测阶段。
 *
 * 阶段顺序固定为：
 * 1. 连接钱包
 * 2. 切到支持链
 * 3. 创建 campaign session
 * 4. 请求钱包签名
 * 5. 激活 campaign
 * 6. 生成第一关 run
 *
 * 这里的约束是：scene 只消费阶段结果与错误文案，不在 scene 层重复编排 API / 签名顺序。
 */
import { keccak256, stringToHex } from 'viem';

import {
  activateCampaign,
  createCampaign,
  type AdventureCampaignPreparation,
} from '../api/rankedApi';
import {
  BUILD_RUN_TIMEOUT_MS,
  ChallengeStartStageError,
  DEFAULT_STAGE_TIMEOUT_MS,
  runChallengeStartStage,
  SIGN_TYPED_DATA_TIMEOUT_MS,
  type ChallengeStartProgress,
  type ChallengeStartStage,
} from './challengeStart';
import { gameState } from './gameState';
import { web3State } from './web3State';
import { getRuntimeConfig } from '../web3/runtime/config';
import type { RunState } from './types/index';

export type AdventureStartStage = ChallengeStartStage;

export const ADVENTURE_START_STAGE_MESSAGES: Record<AdventureStartStage, string> = {
  'connecting-wallet': '正在连接钱包...',
  'switching-chain': '正在切换网络...',
  'creating-session': '正在准备本次冒险...',
  'awaiting-signature': '等待钱包签名...',
  'activating-session': '正在确认本次冒险...',
  'building-run': '正在进入第一关...',
};

const SESSION_CREATE_TIMEOUT_MS = DEFAULT_STAGE_TIMEOUT_MS;
const SESSION_ACTIVATE_TIMEOUT_MS = DEFAULT_STAGE_TIMEOUT_MS;
const ADVENTURE_BUILD_TIMEOUT_MS = BUILD_RUN_TIMEOUT_MS;

export interface AdventureStartProgress extends ChallengeStartProgress {}

export function formatAdventureStartError(error: unknown): string {
  if (error instanceof ChallengeStartStageError) {
    if (error.kind === 'timeout') {
      switch (error.stage) {
        case 'awaiting-signature':
          return '钱包签名超时，请重试。';
        case 'creating-session':
          return '冒险准备超时，请稍后重试。';
        case 'activating-session':
          return '冒险准备超时，请稍后重试。';
        case 'building-run':
          return '进入第一关超时，请重试。';
        default:
          return `${ADVENTURE_START_STAGE_MESSAGES[error.stage]}超时，请重试。`;
      }
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return '冒险启动失败';
}

export async function prepareAdventureCampaign(
  progress?: AdventureStartProgress,
): Promise<AdventureCampaignPreparation> {
  const initialState = web3State.snapshot;

  // 钱包与链准备属于挑战开始前置条件；只有前置条件满足后，才允许向后端申请 campaign session。
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
        timeoutMessage: `${ADVENTURE_START_STAGE_MESSAGES['connecting-wallet']}超时`,
        failureMessage: '冒险启动失败',
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
        timeoutMessage: `${ADVENTURE_START_STAGE_MESSAGES['switching-chain']}超时`,
        failureMessage: '冒险启动失败',
      },
    );
  }

  if (!web3State.snapshot.isSupportedChain) {
    throw new Error(web3State.snapshot.lastError ?? '请切换到目标网络。');
  }

  const state = web3State.snapshot;
  const campaign = await runChallengeStartStage(
    'creating-session',
    () => createCampaign(state.address!),
    progress,
    {
      timeoutMs: SESSION_CREATE_TIMEOUT_MS,
      timeoutMessage: `${ADVENTURE_START_STAGE_MESSAGES['creating-session']}超时`,
      failureMessage: '冒险启动失败',
    },
  );
  const signature = await runChallengeStartStage(
    'awaiting-signature',
    () => web3State.signTypedData(campaign.typedData),
    progress,
    {
      timeoutMs: SIGN_TYPED_DATA_TIMEOUT_MS,
      timeoutMessage: `${ADVENTURE_START_STAGE_MESSAGES['awaiting-signature']}超时`,
      failureMessage: '冒险启动失败',
    },
  );
  await runChallengeStartStage(
    'activating-session',
    () =>
      activateCampaign(
        state.address!,
        campaign.campaignId,
        campaign.sessionId,
        signature,
      ),
    progress,
    {
      timeoutMs: SESSION_ACTIVATE_TIMEOUT_MS,
      timeoutMessage: `${ADVENTURE_START_STAGE_MESSAGES['activating-session']}超时`,
      failureMessage: '冒险启动失败',
    },
  );

  return {
    campaignId: campaign.campaignId,
    sessionId: campaign.sessionId,
    campaignSeed: campaign.campaignSeed,
    levels: campaign.levels,
  };
}

export async function prepareAdventureRun(
  progress?: AdventureStartProgress,
): Promise<RunState> {
  const campaign = await prepareAdventureCampaign(progress);

  // client build hash 是前端本次 campaign 运行时身份的一部分；它必须在生成 run 前固定下来，
  // 避免后续 replay / 结果校验混入不同构建来源。
  const clientBuildHash = keccak256(
    stringToHex(`${getRuntimeConfig().deploymentId}:frontend:campaign:v2`),
  );

  return runChallengeStartStage(
    'building-run',
    async () => {
      // 冒险 run 的真正结构由 gameState.startCampaignRun 统一生成；这里只校验生成结果是否与 session 对齐。
      const nextRun = gameState.startCampaignRun(campaign.levels, {
        campaignId: campaign.campaignId,
        sessionId: campaign.sessionId,
        campaignSeed: campaign.campaignSeed,
        clientBuildHash,
      });

      if (
        nextRun.mode !== 'campaign' ||
        !nextRun.campaignContext ||
        nextRun.campaignContext.campaignId !== campaign.campaignId
      ) {
        throw new Error('冒险启动失败');
      }

      return nextRun;
    },
    progress,
    {
      timeoutMs: ADVENTURE_BUILD_TIMEOUT_MS,
      timeoutMessage: `${ADVENTURE_START_STAGE_MESSAGES['building-run']}超时`,
      failureMessage: '冒险启动失败',
    },
  );
}
