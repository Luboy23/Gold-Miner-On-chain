import type {
  RankedListRowViewModel,
  RankedResultViewModel,
  RunResult,
} from '../../game/types/index';
import type { CampaignHistoryEntry, RankedOverview } from '../../web3/types';
import type { ResultSyncSnapshot } from './ResultSyncFlowController';
import {
  deriveRankedResultState,
  type RankedDerivedResultState,
} from './rankedResultSelectors';

/**
 * buildResultViewModel 把 RunResult 和链上读模型状态映射成结果页 UI。
 *
 * 关键分流：
 * - ranked：右侧卡片是竞技诊断，主按钮偏向继续刷榜
 * - campaign：右侧卡片是历史记录，主按钮偏向返回冒险中心
 *
 * 约束：这里只负责展示语义组装，不负责修正 replay/evidence。
 * 一旦结果对象进入这一层，真值已经在 gameplay/finalize 阶段封存完成。
 */
function formatMsToSec(value: number | null | undefined): string {
  if (value == null) {
    return '--';
  }

  return `${(value / 1000).toFixed(1)} 秒`;
}

function buildRankedAnalysis(
  overview: RankedOverview | null,
  rankedState: RankedDerivedResultState,
): Extract<RankedResultViewModel['analysis'], { kind: 'diagnosis' }> {
  type DiagnosisModel = Extract<RankedResultViewModel['analysis'], { kind: 'diagnosis' }>;
  const personalBest = overview?.personalBest ?? null;
  const pbDiamonds = personalBest?.bestDiamondsCaught ?? 0;
  const pbTime = personalBest?.bestLastDiamondAtMs ?? null;
  const diamondsDelta = rankedState.diamondsCaught - pbDiamonds;

  let verdictLabel = '继续冲榜';
  let verdictTone: DiagnosisModel['verdictTone'] = 'info';
  let pbDeltaLabel = personalBest
    ? diamondsDelta >= 0
      ? `比当前挑战个人最佳多 ${diamondsDelta} 钻`
      : `比当前挑战个人最佳少 ${Math.abs(diamondsDelta)} 钻`
    : '当前挑战尚无个人最佳，正在建立第一条个人记录';
  let timeDeltaLabel = '当前无同钻时间对比';
  let retryHint = '建议直接重开。';

  if (
    rankedState.lastDiamondTick != null &&
    rankedState.logicFps != null &&
    pbTime != null &&
    rankedState.diamondsCaught === pbDiamonds
  ) {
    const currentTime = Math.round(
      rankedState.lastDiamondTick / Math.max(1, rankedState.logicFps) * 1000,
    );
    const timeDelta = currentTime - pbTime;
    timeDeltaLabel =
      timeDelta > 0
        ? `同钻比个人最佳慢 ${formatMsToSec(timeDelta)}`
        : timeDelta < 0
          ? `同钻比个人最佳快 ${formatMsToSec(Math.abs(timeDelta))}`
          : '同钻时间追平当前个人最佳';

    if (timeDelta > 0) {
      verdictLabel = '收尾偏慢';
      verdictTone = 'danger';
      retryHint = '建议重开压缩尾速。';
    } else if (timeDelta < 0) {
      verdictLabel = '时间刷新';
      verdictTone = 'success';
      retryHint = '建议继续冲更高钻数。';
    }
  } else if (!personalBest || diamondsDelta > 0) {
    verdictLabel = personalBest ? '刷新个人最佳' : '首条记录';
    verdictTone = 'success';
    retryHint = '建议继续冲更高成绩。';
  } else if (diamondsDelta < 0) {
    verdictLabel = '差最后一钻';
    verdictTone = 'danger';
    retryHint = '建议重开追回一钻。';
  }

  return {
    kind: 'diagnosis',
    title: '竞技诊断',
    verdictLabel,
    verdictTone,
    pbDeltaLabel,
    timeDeltaLabel,
    retryHint,
  };
}

function formatCampaignLevelLabel(level: number): string {
  return `第${level}关`;
}

function buildCampaignHistoryAnalysis(
  history: CampaignHistoryEntry[],
  hasConnectedWallet: boolean,
): Extract<RankedResultViewModel['analysis'], { kind: 'history' }> {
  const rows: RankedListRowViewModel[] = history.slice(0, 3).map((entry) => ({
    primary: `$${entry.result.finalScore} · ${formatCampaignLevelLabel(entry.result.reachedLevel)}`,
    secondary: entry.result.completed
      ? '已通关'
      : `到达${formatCampaignLevelLabel(entry.result.reachedLevel)}`,
  }));

  return {
    kind: 'history',
    title: '历史记录',
    rows,
    emptyState:
      rows.length > 0
        ? null
        : {
            primary: hasConnectedWallet ? '暂无链上冒险记录' : '连接钱包后查看历史记录',
            secondary: hasConnectedWallet
              ? '完成冒险后，这里会显示最近 3 次记录'
              : '连接钱包后同步你的冒险成绩',
            tone: 'muted',
          },
  };
}

export function buildResultViewModel(
  result: RunResult,
  overview: RankedOverview | null,
  campaignHistory: CampaignHistoryEntry[],
  hasConnectedWallet: boolean,
  syncSnapshot: Readonly<ResultSyncSnapshot>,
): RankedResultViewModel {
  const isCampaign = result.mode === 'campaign';
  const rankedState = deriveRankedResultState(result);
  const challengeLabel = isCampaign
    ? formatCampaignLevelLabel(result.levelGroup)
    : rankedState.challengeLabel;
  const secondaryActionLabel = '返回主菜单';
  const secondaryActionHotkey = 'Esc';
  const retryableSync = isRetryableSyncState(syncSnapshot);

  if (isCampaign) {
    // campaign 结果页不再展示“推进建议”，而是展示链上历史。
    // 这样右侧卡片语义与冒险中心保持一致，也避免把 replay 问题误导成策略问题。
    const isConfirmed = syncSnapshot.stage === 'confirmed';
    const isFailed = syncSnapshot.stage === 'failed';
    const campaignSyncCopy = buildCampaignSyncCopy(syncSnapshot);

    return {
      header: {
        title: '通关报告',
        challengeLabel,
        syncBadgeLabel: isConfirmed ? '已记录' : isFailed ? '提交失败' : '处理中',
        syncBadgeTone: isConfirmed ? 'success' : isFailed ? 'danger' : 'info',
      },
      summary: {
        title: '本局成绩',
        primaryValue: `$${result.score}`,
        levelLabel: formatCampaignLevelLabel(result.levelGroup),
        outcomeLabel: result.endedAtFinalLevel ? '通关' : `到达第${result.levelGroup}关`,
        outcomeTone: 'success',
        summaryText: result.endedAtFinalLevel ? '冒险挑战已通关。' : '这次冒险已闯到这一关。',
      },
      analysis: buildCampaignHistoryAnalysis(campaignHistory, hasConnectedWallet),
      sync: {
        title: '同步状态',
        stage: syncSnapshot.stage,
        progressValue: syncSnapshot.stage === 'confirmed' ? 3 : syncSnapshot.stage === 'finalizing' ? 2 : 1,
        progressMax: 3,
        progressTone: syncSnapshot.stage === 'failed' ? 'danger' : syncSnapshot.stage === 'confirmed' ? 'success' : 'info',
        statusText: campaignSyncCopy.statusText,
        detailText: campaignSyncCopy.detailText,
        detailTone: campaignSyncCopy.detailTone,
      },
      actions: {
        primaryLabel: retryableSync ? '重试提交' : '返回冒险中心',
        primaryHotkey: 'Enter',
        primaryKind: retryableSync ? 'retry-sync' : 'go-adventure',
        secondaryLabel: retryableSync ? '返回冒险中心' : secondaryActionLabel,
        secondaryHotkey: secondaryActionHotkey,
        secondaryKind: retryableSync ? 'go-adventure' : 'go-menu',
      },
    };
  }

  const analysis = buildRankedAnalysis(overview, rankedState);
  const rankedSyncCopy = buildRankedSyncCopy(syncSnapshot, rankedState.isEligible);

  return {
    header: {
      title: '排位结果',
      challengeLabel,
      syncBadgeLabel:
        syncSnapshot.stage === 'confirmed'
          ? '已上榜'
          : syncSnapshot.stage === 'failed'
            ? '提交失败'
            : syncSnapshot.stage === 'finalizing'
              ? '处理中'
              : syncSnapshot.stage === 'uploading'
                ? '处理中'
                : rankedState.isEligible
                  ? '待计入'
                  : '未上榜',
      syncBadgeTone:
        syncSnapshot.stage === 'confirmed'
          ? 'success'
          : syncSnapshot.stage === 'failed' || !rankedState.isEligible
            ? 'danger'
            : 'info',
    },
    summary: {
      title: '本局成绩',
      primaryValue: `${rankedState.diamondsCaught} 钻`,
      levelLabel: rankedState.levelLabel,
      outcomeLabel: rankedState.isEligible ? '可计入排行榜' : '还没打进榜单',
      outcomeTone: rankedState.isEligible ? 'success' : 'danger',
      summaryText: rankedState.isEligible
        ? '恭喜你！本局挑战已完成。'
        : '这局成绩还不够上榜。',
    },
    analysis,
    sync: {
      title: '同步状态',
      stage: syncSnapshot.stage,
      progressValue:
        syncSnapshot.stage === 'confirmed'
          ? 3
          : syncSnapshot.stage === 'finalizing' || syncSnapshot.stage === 'failed'
            ? 2
            : 1,
      progressMax: 3,
      progressTone:
        syncSnapshot.stage === 'confirmed'
          ? 'success'
          : syncSnapshot.stage === 'failed'
            ? 'danger'
            : 'info',
      statusText: rankedSyncCopy.statusText,
      detailText: rankedSyncCopy.detailText,
      detailTone: rankedSyncCopy.detailTone,
    },
    actions: {
      primaryLabel: retryableSync ? '重试提交' : '再来一局',
      primaryHotkey: 'Enter',
      primaryKind: retryableSync ? 'retry-sync' : 'retry-run',
      secondaryLabel: retryableSync ? '再来一局' : secondaryActionLabel,
      secondaryHotkey: retryableSync ? undefined : secondaryActionHotkey,
      secondaryKind: retryableSync ? 'retry-run' : 'go-menu',
    },
  };
}

type ResultSyncCopy = {
  statusText: string;
  detailText: string | null;
  detailTone: 'muted' | 'danger';
};

function buildRankedSyncCopy(
  syncSnapshot: Readonly<ResultSyncSnapshot>,
  isEligible: boolean,
): ResultSyncCopy {
  if (syncSnapshot.stage === 'confirmed') {
    return {
      statusText: '排位成绩已上榜',
      detailText: '已计入排行榜。',
      detailTone: 'muted',
    };
  }

  if (syncSnapshot.stage === 'finalizing') {
    return {
      statusText: syncSnapshot.syncing
        ? '成绩处理中'
        : syncSnapshot.message || '成绩处理中，可重试提交。',
      detailText: syncSnapshot.syncing
        ? syncSnapshot.message || null
        : '主按钮可重试提交，次按钮仍可直接再来一局。',
      detailTone: syncSnapshot.syncing ? 'muted' : 'danger',
    };
  }

  if (syncSnapshot.stage === 'failed') {
    return {
      statusText: syncSnapshot.message || '提交失败，可重试',
      detailText: '主按钮可重试提交，次按钮仍可直接再来一局。',
      detailTone: 'danger',
    };
  }

  return {
    statusText:
      syncSnapshot.message ||
      (isEligible
        ? '本局成绩可计入排行榜。'
        : '本局成绩未达标，不能计入排行榜。'),
    detailText: null,
    detailTone: 'muted',
  };
}

function buildCampaignSyncCopy(
  syncSnapshot: Readonly<ResultSyncSnapshot>,
): ResultSyncCopy {
  if (syncSnapshot.stage === 'failed') {
    return {
      statusText: syncSnapshot.message || '提交失败，可重试',
      detailText: '主按钮可重试提交，次按钮仍可返回冒险中心。',
      detailTone: 'danger',
    };
  }

  if (syncSnapshot.stage === 'confirmed') {
    // 成功态文案拆成两段，是为了让同步状态卡片在窄宽度下仍能稳定排版，
    // 避免整句长文案把 detail 挤出卡片边界。
    return {
      statusText: '冒险成绩已记录',
      detailText: '已计入通关榜。',
      detailTone: 'muted',
    };
  }

  if (syncSnapshot.stage === 'finalizing') {
    return {
      statusText: syncSnapshot.syncing
        ? '成绩处理中'
        : syncSnapshot.message || '成绩处理中，可重试提交。',
      detailText: syncSnapshot.syncing
        ? syncSnapshot.message || null
        : '主按钮可重试提交，次按钮仍可返回冒险中心。',
      detailTone: syncSnapshot.syncing ? 'muted' : 'danger',
    };
  }

  return {
    statusText: '正在提交冒险成绩',
    detailText: syncSnapshot.message || null,
    detailTone: 'muted',
  };
}

function isRetryableSyncState(
  syncSnapshot: Readonly<ResultSyncSnapshot>,
): boolean {
  return syncSnapshot.stage === 'failed'
    || (syncSnapshot.stage === 'finalizing' && !syncSnapshot.syncing);
}
