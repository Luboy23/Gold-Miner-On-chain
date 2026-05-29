/**
 * InventoryState 只负责玩家库存快照。
 *
 * 虽然它看起来比 ReadModelState 更简单，但仍然单独拆出一层，目的是让库存刷新失败、
 * 地址切换和 UI patch 语义与排行榜/玩家资料解耦。
 */
import type { Address } from 'viem';

import { blockchainService } from '../../web3/services/BlockchainService';
import type {
  PlayerInventory,
  SupportedChainId,
} from '../../web3/types';

export interface InventorySnapshot {
  inventory: PlayerInventory | null;
}

function createInitialInventoryState(): InventorySnapshot {
  return {
    inventory: null,
  };
}

export class InventoryState {
  private state: InventorySnapshot = createInitialInventoryState();
  private readonly handleChange: () => void;

  constructor(handleChange: () => void) {
    this.handleChange = handleChange;
  }

  get snapshot(): Readonly<InventorySnapshot> {
    return this.state;
  }

  async refreshForAddress(
    address: Address,
    chainId: SupportedChainId,
    shouldCommit: () => boolean = () => true,
  ): Promise<void> {
    // 库存必须与当前地址/链一一对应，不能复用旧地址的 consumables 快照。
    const inventory = await blockchainService.fetchInventory(address, chainId);

    if (!shouldCommit()) {
      return;
    }

    this.state = { inventory };
    this.handleChange();
  }

  reset(): void {
    // 断开钱包、切到不支持链或读取失败时必须清空库存，避免继续显示过期 consumables。
    this.state = createInitialInventoryState();
    this.handleChange();
  }

  applyPatch(nextState: Partial<InventorySnapshot>): void {
    this.state = {
      ...this.state,
      ...nextState,
    };
    this.handleChange();
  }
}
