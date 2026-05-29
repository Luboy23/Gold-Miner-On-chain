import {
  fetchCampaignStatus,
  fetchRankedSessionStatus,
  finalizeRankedSession,
  uploadCampaignEvidence,
  uploadRankedRun,
} from '../../api/rankedApi';
import { web3State } from '../../game/web3State';
import type { RankedSyncStage, RunResult } from '../../game/types/index';
import { getRankedSyncEnvelope } from './rankedResultSelectors';

const POLL_DELAY_MS = 1200;
const POLL_ATTEMPTS = 12;

/**
 * ResultSyncTransport 负责结果页的“上传 -> 轮询确认 -> 回写状态”。
 *
 * 职责边界：
 * - transport 只负责把 evidence 发给后端并轮询链上确认
 * - transport 不负责修正 replay 字段
 * - 一旦后端返回 400，通常意味着更早的 gameplay/evidence 封存已经出错
 */
export interface ResultSyncTransportUpdate {
  syncing?: boolean;
  stage: RankedSyncStage;
  message: string;
}

export interface ResultSyncTransportState {
  syncing: boolean;
  stage: RankedSyncStage;
  message: string;
}

export interface ResultSyncTransport {
  initialize(result: RunResult): ResultSyncTransportState;
  sync(
    result: RunResult,
    onUpdate: (update: ResultSyncTransportUpdate) => void,
    wait: (delayMs: number) => Promise<void>,
  ): Promise<void>;
}

export function createResultSyncTransport(): ResultSyncTransport {
  return {
    initialize(result) {
      if (result.mode === 'campaign') {
        return {
          syncing: false,
          stage: result.campaignEvidence ? 'idle' : 'ineligible',
          message: result.campaignEvidence
            ? '本次冒险成绩待提交。'
            : '本次冒险成绩不会计入通关榜。',
        };
      }

      const isRankedEligible = getRankedSyncEnvelope(result) !== null;
      return {
        syncing: false,
        stage: isRankedEligible ? 'idle' : 'ineligible',
        message: isRankedEligible
          ? '本局成绩待提交。'
          : '本局成绩不计入排行榜。',
      };
    },

    async sync(result, onUpdate, wait) {
      if (result.mode === 'campaign') {
        await syncCampaignResult(result, onUpdate, wait);
        return;
      }

      await syncRankedResult(result, onUpdate, wait);
    },
  };
}

async function syncRankedResult(
  result: RunResult,
  onUpdate: (update: ResultSyncTransportUpdate) => void,
  wait: (delayMs: number) => Promise<void>,
): Promise<void> {
  const rankedSync = getRankedSyncEnvelope(result);

  if (!rankedSync || !result.rankedEvidence) {
    return;
  }

  const player = web3State.snapshot.address;

  if (!player) {
    onUpdate({
      syncing: false,
      stage: 'failed',
      message: '未连接钱包，无法提交本次排位成绩。',
    });
    return;
  }

  onUpdate({
    syncing: true,
    stage: 'uploading',
    message: '正在提交本局成绩...',
  });

  try {
    await uploadRankedRun(player, rankedSync.sessionId, result.rankedEvidence);

    onUpdate({
      syncing: true,
      stage: 'finalizing',
      message: '提交成功，正在处理成绩...',
    });

    await finalizeRankedSession(rankedSync.sessionId);
    const finalStatus = await pollRankedStatus(rankedSync.sessionId, wait);

    if (finalStatus === 'confirmed') {
      onUpdate({
        syncing: false,
        stage: 'confirmed',
        message: '排位成绩已上榜。',
      });
    } else if (finalStatus === 'failed') {
      onUpdate({
        syncing: false,
        stage: 'failed',
        message: '成绩提交失败，可重试提交。',
      });
    } else {
      onUpdate({
        syncing: false,
        stage: 'finalizing',
        message: '成绩已提交，仍在处理，可重试提交。',
      });
    }

    await web3State.refreshReadModels();
  } catch (error) {
    onUpdate({
      syncing: false,
      stage: 'failed',
      message: error instanceof Error ? error.message : '提交排位成绩失败',
    });
  }
}

async function syncCampaignResult(
  result: RunResult,
  onUpdate: (update: ResultSyncTransportUpdate) => void,
  wait: (delayMs: number) => Promise<void>,
): Promise<void> {
  if (!result.campaignEvidence) {
    return;
  }

  const player = web3State.snapshot.address;

  if (!player) {
    onUpdate({
      syncing: false,
      stage: 'failed',
      message: '未连接钱包，无法提交本次冒险成绩。',
    });
    return;
  }

  onUpdate({
    syncing: true,
    stage: 'uploading',
    message: '正在提交本次冒险成绩...',
  });

  try {
    // campaign 上传的是多关 evidence 真值。
    // 如果这里收到 400，根因一般不在 transport，而在 finalized snapshot 或 evidence 组装。
    await uploadCampaignEvidence(
      player,
      result.campaignEvidence.campaignId,
      result.campaignEvidence,
    );

    onUpdate({
      syncing: true,
      stage: 'finalizing',
      message: '提交成功，正在处理成绩...',
    });

    const finalStatus = await pollCampaignStatus(
      result.campaignEvidence.campaignId,
      wait,
    );

    if (finalStatus === 'confirmed') {
      onUpdate({
        syncing: false,
        stage: 'confirmed',
        message: '冒险成绩已记录。',
      });
    } else if (finalStatus === 'failed') {
      onUpdate({
        syncing: false,
        stage: 'failed',
        message: '冒险成绩提交失败，可重试提交。',
      });
    } else {
      onUpdate({
        syncing: false,
        stage: 'finalizing',
        message: '成绩已提交，仍在处理，可重试提交。',
      });
    }

    await web3State.refreshReadModels();
  } catch (error) {
    onUpdate({
      syncing: false,
      stage: 'failed',
      message: error instanceof Error ? error.message : '提交冒险成绩失败',
    });
  }
}

async function pollRankedStatus(
  sessionId: `0x${string}`,
  wait: (delayMs: number) => Promise<void>,
): Promise<string> {
  // 轮询超时不等于失败，只表示前端当前没有等到最终链上状态。
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const status = await fetchRankedSessionStatus(sessionId);

    if (status.status === 'confirmed' || status.confirmedRuns > 0) {
      return 'confirmed';
    }

    if (status.status === 'failed' || status.failedRuns > 0) {
      return 'failed';
    }

    await wait(POLL_DELAY_MS);
  }

  return 'submitted';
}

async function pollCampaignStatus(
  campaignId: `0x${string}`,
  wait: (delayMs: number) => Promise<void>,
): Promise<string> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const status = await fetchCampaignStatus(campaignId);

    if (status.status === 'confirmed') {
      return 'confirmed';
    }

    if (status.status === 'failed') {
      return 'failed';
    }

    await wait(POLL_DELAY_MS);
  }

  return 'submitted';
}
