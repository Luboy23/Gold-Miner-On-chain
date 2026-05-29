import type { RankedOverview } from '../../web3/types';

export type RankedUiTone =
  | 'default'
  | 'accent'
  | 'success'
  | 'info'
  | 'danger'
  | 'muted';

export interface RankedListRowViewModel {
  leading?: string;
  primary: string;
  secondary?: string;
  tone?: RankedUiTone;
}

export interface RankedEmptyStateViewModel {
  primary: string;
  secondary?: string;
  tone?: RankedUiTone;
}

export interface RankedBoardSectionViewModel {
  title: string;
  rows: RankedListRowViewModel[];
  emptyState: RankedEmptyStateViewModel | null;
}

export interface MenuModeActionViewModel {
  id: string;
  label: string;
  hotkey?: string;
}

export interface MenuModeCardViewModel {
  id: string;
  primaryAction: MenuModeActionViewModel;
}

export interface ChallengePersonalBest {
  bestDiamondsCaught: number;
  bestLastDiamondAtMs: number | null;
}

export interface ChallengeRecentRunSummary {
  diamondsCaught: number;
  lastDiamondAtMs: number;
  submittedAt: number;
}

export interface RankedGapSummary {
  diamondsDelta: number;
  timeDeltaMs: number | null;
}

export { type RankedOverview };

export interface RankedDashboardModel {
  header: {
    title: string;
    bestLabel: string;
    sublabel: string;
  };
  overview: {
    challengeLabel: string;
    rulesLabel: string;
    leaderLabel: string;
  };
  progress: RankedBoardSectionViewModel;
  leaderboard: RankedBoardSectionViewModel;
  history: RankedBoardSectionViewModel;
  statusBanner: {
    text: string;
    tone: RankedUiTone;
  };
  actions: {
    startLabel: string;
    startHotkey?: string;
    canStart: boolean;
    backLabel: string;
    backHotkey?: string;
  };
}

export type RankedSyncStage =
  | 'idle'
  | 'uploading'
  | 'finalizing'
  | 'confirmed'
  | 'failed'
  | 'ineligible';

export interface RankedResultViewModel {
  header: {
    title: string;
    syncBadgeLabel: string;
    syncBadgeTone: RankedUiTone;
    challengeLabel: string;
  };
  summary: {
    title: string;
    primaryValue: string;
    levelLabel: string;
    outcomeLabel: string;
    outcomeTone: RankedUiTone;
    summaryText: string;
  };
  analysis:
    | {
        kind: 'diagnosis';
        title: string;
        verdictLabel: string;
        verdictTone: RankedUiTone;
        pbDeltaLabel: string;
        timeDeltaLabel: string;
        retryHint: string;
      }
    | {
        kind: 'history';
        title: string;
        rows: RankedListRowViewModel[];
        emptyState: RankedEmptyStateViewModel | null;
      };
  sync: {
    title: string;
    stage: RankedSyncStage;
    progressValue: number;
    progressMax: number;
    progressTone: RankedUiTone;
    statusText: string;
    detailText: string | null;
    detailTone: RankedUiTone;
  };
  actions: {
    primaryLabel: string;
    primaryHotkey?: string;
    primaryKind: 'retry-sync' | 'go-menu' | 'go-adventure' | 'retry-run' | 'none';
    secondaryLabel: string;
    secondaryHotkey?: string;
    secondaryKind?: 'retry-run' | 'go-adventure' | 'go-menu' | 'none';
  };
}
