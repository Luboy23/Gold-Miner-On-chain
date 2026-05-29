import type { Address, Hex } from 'viem';

import type {
  AdventureLevelRef,
  RankedOverview,
  CampaignHistoryEntry,
  LevelLeaderboardEntry,
  PlayerHistoryEntry,
  RankedChallengeRef,
  SessionPermitTypedData,
} from '../web3/types';
import { getRuntimeConfig } from '../web3/runtime/config';
import type { CampaignEvidenceV2, RankedRunEvidenceV3 } from '../game/types/index';

export interface RankedSessionPermitPayload {
  player: Address;
  delegate: Address;
  sessionId: Hex;
  deploymentIdHash: Hex;
  issuedAt: number;
  deadline: number;
  nonce: number;
  maxRuns: number;
}

export interface RankedSessionCreateResponse {
  sessionId: Hex;
  deadline: number;
  maxRuns: number;
  permit: RankedSessionPermitPayload;
  typedData: SessionPermitTypedData;
}

export interface RankedSessionStatusResponse {
  sessionId: Hex;
  status: string;
  validatedRuns: number;
  submittedRuns: number;
  confirmedRuns: number;
  failedRuns: number;
  txHashes: string[];
  lastError: string | null;
}

export interface RankedCurrentResponse {
  boardId: string;
  currentChallenge: RankedChallengeRef | null;
}

export interface CampaignCreateResponse {
  campaignId: Hex;
  sessionId: Hex;
  campaignSeed: Hex;
  deadline: number;
  maxRuns: number;
  permit: RankedSessionPermitPayload;
  typedData: SessionPermitTypedData;
  levels: AdventureLevelRef[];
}

export interface CampaignStatusResponse {
  campaignId: Hex;
  sessionId: Hex;
  status: string;
  txHash: Hex | null;
  lastError: string | null;
}

export interface CampaignLeaderboardEntry {
  player: Address;
  result: {
    campaignId: Hex;
    reachedLevel: number;
    completed: boolean;
    finalScore: number;
    totalDurationMs: number;
    purchasedItemCount: number;
    evidenceHash: Hex;
    submittedAt: number;
  };
}

export interface AdventureCampaignPreparation {
  campaignId: Hex;
  sessionId: Hex;
  campaignSeed: Hex;
  levels: AdventureLevelRef[];
}

function buildApiUrl(pathname: string): string {
  const baseUrl = getRuntimeConfig().apiBaseUrl.replace(/\/$/, '');
  return `${baseUrl}${pathname}`;
}

async function readJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(pathname), {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    let detail = `${response.status}`;

    try {
      const json = (await response.json()) as { error?: string };
      if (typeof json.error === 'string' && json.error.length > 0) {
        detail = `${detail} ${json.error}`;
      }
    } catch {
      // Ignore invalid error payloads.
    }

    throw new Error(`API request failed: ${detail}`);
  }

  return (await response.json()) as T;
}

export async function fetchRankedCurrent(): Promise<RankedCurrentResponse> {
  return readJson<RankedCurrentResponse>('/ranked/current');
}

export async function fetchLeaderboard(
  challengeId: string,
  challengeVersion: number,
  limit = 20,
): Promise<LevelLeaderboardEntry[]> {
  const params = new URLSearchParams({
    challengeId,
    challengeVersion: String(challengeVersion),
    limit: String(limit),
  });

  return readJson<LevelLeaderboardEntry[]>(`/ranked/leaderboard?${params.toString()}`);
}

export async function fetchPlayerHistory(
  player: Address,
  limit = 8,
): Promise<PlayerHistoryEntry[]> {
  const params = new URLSearchParams({
    limit: String(limit),
  });

  return readJson<PlayerHistoryEntry[]>(
    `/ranked/history/${player}?${params.toString()}`,
  );
}

export async function fetchRankedOverview(
  player: Address,
  challengeId?: string,
  challengeVersion?: number,
): Promise<RankedOverview> {
  const params = new URLSearchParams();

  if (challengeId) {
    params.set('challengeId', challengeId);
  }

  if (typeof challengeVersion === 'number') {
    params.set('challengeVersion', String(challengeVersion));
  }

  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return readJson<RankedOverview>(`/ranked/overview/${player}${suffix}`);
}

export async function createRankedSession(
  player: Address,
): Promise<RankedSessionCreateResponse> {
  return readJson<RankedSessionCreateResponse>('/ranked/sessions', {
    method: 'POST',
    body: JSON.stringify({ player }),
  });
}

export async function activateRankedSession(
  player: Address,
  sessionId: Hex,
  signature: Hex,
): Promise<void> {
  await readJson<{ ok: boolean }>('/ranked/sessions/activate', {
    method: 'POST',
    body: JSON.stringify({
      player,
      sessionId,
      signature,
    }),
  });
}

export async function uploadRankedRun(
  player: Address,
  sessionId: Hex,
  evidence: RankedRunEvidenceV3,
): Promise<void> {
  await readJson<{ status: string }>('/ranked/runs', {
    method: 'POST',
    body: JSON.stringify({
      player,
      sessionId,
      evidence,
    }),
  });
}

export async function finalizeRankedSession(sessionId: Hex): Promise<void> {
  await readJson<{ ok: boolean }>(`/ranked/sessions/${sessionId}/finalize`, {
    method: 'POST',
  });
}

export async function fetchRankedSessionStatus(
  sessionId: Hex,
): Promise<RankedSessionStatusResponse> {
  return readJson<RankedSessionStatusResponse>(`/ranked/sessions/${sessionId}/status`);
}

export async function createCampaign(
  player: Address,
): Promise<CampaignCreateResponse> {
  return readJson<CampaignCreateResponse>('/campaigns', {
    method: 'POST',
    body: JSON.stringify({ player }),
  });
}

export async function activateCampaign(
  player: Address,
  campaignId: Hex,
  sessionId: Hex,
  signature: Hex,
): Promise<void> {
  await readJson<{ ok: boolean }>('/campaigns/activate', {
    method: 'POST',
    body: JSON.stringify({
      player,
      campaignId,
      sessionId,
      signature,
    }),
  });
}

export async function uploadCampaignEvidence(
  player: Address,
  campaignId: Hex,
  evidence: CampaignEvidenceV2,
): Promise<void> {
  await readJson<{ status: string }>(`/campaigns/${campaignId}/evidence`, {
    method: 'POST',
    body: JSON.stringify({
      player,
      evidence,
    }),
  });
}

export async function fetchCampaignStatus(
  campaignId: Hex,
): Promise<CampaignStatusResponse> {
  return readJson<CampaignStatusResponse>(`/campaigns/${campaignId}/status`);
}

export async function fetchCampaignLeaderboard(
  limit = 20,
): Promise<CampaignLeaderboardEntry[]> {
  const params = new URLSearchParams({
    limit: String(limit),
  });

  return readJson<CampaignLeaderboardEntry[]>(
    `/campaigns/leaderboard?${params.toString()}`,
  );
}

export async function fetchCampaignHistory(
  player: Address,
  limit = 8,
): Promise<CampaignHistoryEntry[]> {
  const params = new URLSearchParams({
    limit: String(limit),
  });

  return readJson<CampaignHistoryEntry[]>(
    `/campaigns/history/${player}?${params.toString()}`,
  );
}
