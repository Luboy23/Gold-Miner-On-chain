/**
 * ReadModelState 只缓存依赖地址/链的链上读模型：
 * - 玩家档案
 * - 排位榜状态
 *
 * 这里不维护钱包连接状态，也不直接处理库存；它的职责是把多个只读远程请求
 * 合并成一个 UI 可消费的只读快照。
 */
import type { Address } from 'viem';

import { blockchainService } from '../../web3/services/BlockchainService';
import type {
  PlayerProfile,
  RankedBoardState,
  SupportedChainId,
} from '../../web3/types';

export interface ReadModelSnapshot {
  playerProfile: PlayerProfile | null;
  rankedBoardState: RankedBoardState | null;
}

function createInitialReadModelState(): ReadModelSnapshot {
  return {
    playerProfile: null,
    rankedBoardState: null,
  };
}

export class ReadModelState {
  private state: ReadModelSnapshot = createInitialReadModelState();
  private readonly handleChange: () => void;

  constructor(handleChange: () => void) {
    this.handleChange = handleChange;
  }

  get snapshot(): Readonly<ReadModelSnapshot> {
    return this.state;
  }

  async refreshForAddress(
    address: Address,
    chainId: SupportedChainId,
    shouldCommit: () => boolean = () => true,
  ): Promise<void> {
    // 玩家档案和排位榜状态始终按同一个地址/链批量刷新，避免 UI 混用不同刷新批次的数据。
    const [playerProfile, rankedBoardState] = await Promise.all([
      blockchainService.fetchPlayerProfile(address, chainId),
      blockchainService.fetchRankedBoardState(chainId),
    ]);

    if (!shouldCommit()) {
      return;
    }

    this.state = {
      playerProfile,
      rankedBoardState,
    };
    this.handleChange();
  }

  reset(): void {
    // 地址缺失、链不受支持或远程读取失败时都必须回到空读模型，不能保留旧快照。
    this.state = createInitialReadModelState();
    this.handleChange();
  }

  applyPatch(nextState: Partial<ReadModelSnapshot>): void {
    this.state = {
      ...this.state,
      ...nextState,
    };
    this.handleChange();
  }
}
