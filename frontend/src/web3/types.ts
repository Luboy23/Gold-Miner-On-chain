import type { Address, Chain, Hex } from 'viem';

export type SupportedChainId = number;

export type SupportedChainConfig = Chain & {
  id: SupportedChainId;
};

export interface ChainContracts {
  levelCatalog: Address;
  scoreboard: Address;
}

export interface RuntimeContractConfig {
  chainId: SupportedChainId;
  deploymentId: string;
  apiBaseUrl: string;
  rpcUrl: string;
  goldMinerLevelCatalogAddress: Address;
  goldMinerScoreboardAddress: Address;
  rankedRuntimeMode: 'shadow' | 'authoritative';
}

export interface WalletSendTransactionRequest {
  to: Address;
  data?: Hex;
  value?: bigint;
  gas?: bigint;
  nonce?: number;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

export interface ConsumableBalance {
  itemId: string;
  balance: bigint;
}

export interface RankedChallengeRef {
  challengeId: string;
  version: number;
  contentHash: Hex;
  challengeSeed: Hex;
  simulationVersion: number;
  logicFps: number;
  timeLimitTicks: number;
  isCurrent: boolean;
}

export interface AdventureLevelRef {
  levelId: string;
  version: number;
  order: number;
  contentHash: Hex;
  challengeSeed: Hex;
  simulationVersion: number;
  logicFps: number;
  timeLimitTicks: number;
}

export interface PlayerProfile {
  address: Address;
  bestDiamondsCaught: number;
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

export interface RankedOverview {
  challengeId: string;
  challengeVersion: number;
  personalBest: ChallengePersonalBest | null;
  latestRun: ChallengeRecentRunSummary | null;
  runCount: number;
  currentBestRank: number | null;
  leaderGap: RankedGapSummary | null;
  nextBeatGap: RankedGapSummary | null;
}

export interface RankedBoardState {
  chainId: SupportedChainId;
  currentChallenge: RankedChallengeRef | null;
}

export interface PlayerInventory {
  consumables: ConsumableBalance[];
}

export interface RankedReadModelResult {
  challengeId: string;
  challengeVersion: number;
  diamondsCaught: number;
  lastDiamondAtMs: number;
  evidenceHash: Hex;
  submittedAt: number;
}

export interface LevelLeaderboardEntry {
  player: Address;
  result: RankedReadModelResult;
}

export interface PlayerHistoryEntry {
  player: Address;
  result: RankedReadModelResult;
}

export interface CampaignHistoryEntry {
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

export interface TypedDataField {
  name: string;
  type: string;
}

export interface SessionPermitMessage {
  player: Address;
  delegate: Address;
  sessionId: Hex;
  deploymentIdHash: Hex;
  issuedAt: number;
  deadline: number;
  nonce: number;
  maxRuns: number;
}

export interface SessionPermitTypedData {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: Address;
  };
  primaryType: 'SessionPermit';
  types: Record<string, TypedDataField[]>;
  message: SessionPermitMessage;
}

export interface BlockchainService {
  fetchPlayerProfile(
    address: Address,
    chainId: SupportedChainId,
  ): Promise<PlayerProfile>;
  fetchRankedBoardState(chainId: SupportedChainId): Promise<RankedBoardState>;
  fetchInventory(
    address: Address,
    chainId: SupportedChainId,
  ): Promise<PlayerInventory>;
}

export interface Eip1193RequestArguments {
  method: string;
  params?: readonly unknown[] | object;
}

export interface Eip1193Provider {
  request(args: Eip1193RequestArguments): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface ProviderRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type WalletConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'error';

export type WalletAdapterEvent =
  | 'accountsChanged'
  | 'chainChanged'
  | 'disconnect';

export type WalletAdapterListener = (payload: Address | number | null) => void;

export interface WalletAdapter {
  isAvailable(): boolean;
  connect(): Promise<Address>;
  disconnect(): Promise<void>;
  getAddress(): Promise<Address | null>;
  getChainId(): Promise<number | null>;
  switchChain(chainId: number): Promise<void>;
  signMessage(message: string): Promise<Hex>;
  signTypedData(typedData: SessionPermitTypedData): Promise<Hex>;
  sendTransaction(request: WalletSendTransactionRequest): Promise<Hex>;
  subscribe(
    event: WalletAdapterEvent,
    listener: WalletAdapterListener,
  ): () => void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export {};
