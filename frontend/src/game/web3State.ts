/**
 * web3State 把钱包连接状态、链上读模型和库存状态组合成前端唯一的 web3 视图。
 *
 * 这里的核心约束是：钱包 session、read model 和 inventory 仍然分别维护，
 * 但对 UI 暴露时必须合成为一个稳定快照，避免 scene 同时订阅三套子状态导致竞态更新。
 */
import type { Address, Hex } from 'viem';

import { isSupportedChainId } from '../web3/config/chains';
import { InventoryState } from './web3/inventoryState';
import { ReadModelState } from './web3/readModelState';
import {
  WalletSessionState,
  type WalletSessionSnapshot,
} from './web3/walletSessionState';
import type {
  PlayerInventory,
  PlayerProfile,
  RankedBoardState,
  SessionPermitTypedData,
  SupportedChainId,
  WalletConnectionStatus,
} from '../web3/types';

export interface Web3StateShape {
  walletAvailable: boolean;
  connectionStatus: WalletConnectionStatus;
  address: Address | null;
  chainId: number | null;
  isSupportedChain: boolean;
  playerProfile: PlayerProfile | null;
  rankedBoardState: RankedBoardState | null;
  inventory: PlayerInventory | null;
  lastError: string | null;
}

type Web3StateListener = (state: Readonly<Web3StateShape>) => void;

type DependentStateRequest = {
  sessionId: number;
  address: Address | null;
  chainId: SupportedChainId | null;
};

function cloneState(state: Web3StateShape): Web3StateShape {
  return {
    ...state,
    playerProfile: state.playerProfile ? { ...state.playerProfile } : null,
    rankedBoardState: state.rankedBoardState
      ? {
          ...state.rankedBoardState,
          currentChallenge: state.rankedBoardState.currentChallenge
            ? { ...state.rankedBoardState.currentChallenge }
            : null,
        }
      : null,
    inventory: state.inventory
      ? {
          consumables: state.inventory.consumables.map((entry) => ({ ...entry })),
        }
      : null,
  };
}

export class Web3StateStore {
  private readonly listeners = new Set<Web3StateListener>();
  private isBootstrapped = false;
  private dependentStateSessionId = 0;
  private readonly walletSessionState = new WalletSessionState(() => {
    this.emitChange();
  });
  private readonly readModelState = new ReadModelState(() => {
    this.emitChange();
  });
  private readonly inventoryState = new InventoryState(() => {
    this.emitChange();
  });

  get snapshot(): Readonly<Web3StateShape> {
    return this.composeState();
  }

  async bootstrap(): Promise<void> {
    if (this.isBootstrapped) {
      return;
    }

    // bootstrap 只做一次，避免 provider 事件和远程刷新被重复绑定成多份订阅。
    this.isBootstrapped = true;
    this.walletSessionState.bootstrap(() => {
      void this.refreshWallet();
    });
    await this.refreshWallet();
  }

  subscribe(listener: Web3StateListener): () => void {
    this.listeners.add(listener);
    listener(cloneState(this.composeState()));

    return () => {
      this.listeners.delete(listener);
    };
  }

  async connectWallet(): Promise<void> {
    await this.walletSessionState.connectWallet();
    await this.refreshWallet();
  }

  async disconnectWallet(): Promise<void> {
    await this.walletSessionState.disconnectWallet();
    this.dependentStateSessionId += 1;
    // 钱包断开后，依赖地址的读模型和库存必须一起清空，避免 UI 继续显示旧地址的数据。
    this.readModelState.reset();
    this.inventoryState.reset();
    this.emitChange();
  }

  async refreshWallet(): Promise<void> {
    await this.walletSessionState.refreshWallet();
    await this.syncDependentState();
  }

  async refreshReadModels(): Promise<void> {
    await this.syncDependentState();
  }

  async switchToDefaultChain(): Promise<void> {
    await this.walletSessionState.switchToDefaultChain();
    await this.refreshWallet();
  }

  clearError(): void {
    this.walletSessionState.clearError();
  }

  async signTypedData(typedData: SessionPermitTypedData): Promise<Hex> {
    return this.walletSessionState.signTypedData(typedData);
  }

  updateState(nextState: Partial<Web3StateShape>): void {
    const {
      walletAvailable,
      connectionStatus,
      address,
      chainId,
      isSupportedChain,
      lastError,
      playerProfile,
      rankedBoardState,
      inventory,
    } = nextState;

    const walletPatch: Partial<Parameters<typeof this.walletSessionState.applyPatch>[0]> = {};
    const readModelPatch: Partial<Parameters<typeof this.readModelState.applyPatch>[0]> = {};
    const inventoryPatch: Partial<Parameters<typeof this.inventoryState.applyPatch>[0]> = {};

    if (walletAvailable !== undefined) {
      walletPatch.walletAvailable = walletAvailable;
    }
    if (connectionStatus !== undefined) {
      walletPatch.connectionStatus = connectionStatus;
    }
    if (address !== undefined) {
      walletPatch.address = address;
    }
    if (chainId !== undefined) {
      walletPatch.chainId = chainId;
    }
    if (isSupportedChain !== undefined) {
      walletPatch.isSupportedChain = isSupportedChain;
    }
    if (lastError !== undefined) {
      walletPatch.lastError = lastError;
    }
    if (playerProfile !== undefined) {
      readModelPatch.playerProfile = playerProfile;
    }
    if (rankedBoardState !== undefined) {
      readModelPatch.rankedBoardState = rankedBoardState;
    }
    if (inventory !== undefined) {
      inventoryPatch.inventory = inventory;
    }

    this.walletSessionState.applyPatch(walletPatch);
    this.readModelState.applyPatch(readModelPatch);
    this.inventoryState.applyPatch(inventoryPatch);
  }

  private async syncDependentState(): Promise<void> {
    const request = this.createDependentStateRequest(this.walletSessionState.snapshot);

    // 链上资料刷新始终挂在当前钱包地址和受支持链之下；链不受支持时只能整体回落为空状态。
    await this.loadReadModels(request);
  }

  private async loadReadModels(request: DependentStateRequest): Promise<void> {
    const { address, chainId } = request;

    if (!address || !chainId) {
      if (!this.isCurrentDependentStateRequest(request)) {
        return;
      }

      // 只要地址缺失或链不受支持，就不能保留旧的 profile/board/inventory 快照。
      this.readModelState.reset();
      this.inventoryState.reset();
      this.walletSessionState.clearError();
      return;
    }

    try {
      const shouldCommit = () => this.isCurrentDependentStateRequest(request);
      await Promise.all([
        this.readModelState.refreshForAddress(address, chainId, shouldCommit),
        this.inventoryState.refreshForAddress(address, chainId, shouldCommit),
      ]);

      if (!shouldCommit()) {
        return;
      }

      this.walletSessionState.clearError();
    } catch (error) {
      if (!this.isCurrentDependentStateRequest(request)) {
        return;
      }

      // 读模型读取失败时，错误留给钱包层统一对外展示，但数据面必须回到空状态，避免混合旧快照。
      this.readModelState.reset();
      this.inventoryState.reset();
      this.walletSessionState.setLastError(
        this.getErrorMessage(error, '读取链上资料失败'),
      );
    }
  }

  private composeState(): Web3StateShape {
    const session = this.walletSessionState.snapshot;
    const readModel = this.readModelState.snapshot;
    const inventory = this.inventoryState.snapshot;

    return {
      walletAvailable: session.walletAvailable,
      connectionStatus: session.connectionStatus,
      address: session.address,
      chainId: session.chainId,
      isSupportedChain: session.isSupportedChain,
      lastError: session.lastError,
      playerProfile: readModel.playerProfile,
      rankedBoardState: readModel.rankedBoardState,
      inventory: inventory.inventory,
    };
  }

  private emitChange(): void {
    const snapshot = cloneState(this.composeState());

    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return fallback;
  }

  private createDependentStateRequest(
    session: Readonly<WalletSessionSnapshot>,
  ): DependentStateRequest {
    this.dependentStateSessionId += 1;

    return {
      sessionId: this.dependentStateSessionId,
      address: session.address,
      chainId:
        session.chainId !== null && isSupportedChainId(session.chainId)
          ? session.chainId
          : null,
    };
  }

  private isCurrentDependentStateRequest(request: DependentStateRequest): boolean {
    const session = this.walletSessionState.snapshot;
    const chainId =
      session.chainId !== null && isSupportedChainId(session.chainId)
        ? session.chainId
        : null;

    return request.sessionId === this.dependentStateSessionId
      && session.address === request.address
      && chainId === request.chainId;
  }
}

export const web3State = new Web3StateStore();
