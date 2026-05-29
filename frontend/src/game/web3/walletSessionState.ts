/**
 * WalletSessionState 只负责钱包连接层的最小状态机：
 * - 是否有注入钱包
 * - 当前连接状态
 * - 地址 / 链
 * - 最近一次钱包相关错误
 *
 * 它不负责读取排行榜、库存或其他链上资料；这些依赖钱包地址的读取由上层 web3State
 * 在钱包状态稳定后再触发，避免把 provider 事件和远程读模型刷新耦合在一起。
 */
import type { Address, Hex } from 'viem';

import { Eip1193WalletAdapter } from '../../web3/adapters/Eip1193WalletAdapter';
import {
  getChainConfig,
  getDefaultChainConfig,
} from '../../web3/config/chains';
import type {
  SessionPermitTypedData,
  WalletConnectionStatus,
} from '../../web3/types';

export interface WalletSessionSnapshot {
  walletAvailable: boolean;
  connectionStatus: WalletConnectionStatus;
  address: Address | null;
  chainId: number | null;
  isSupportedChain: boolean;
  lastError: string | null;
}

function createInitialWalletSessionState(): WalletSessionSnapshot {
  return {
    walletAvailable: false,
    connectionStatus: 'idle',
    address: null,
    chainId: null,
    isSupportedChain: false,
    lastError: null,
  };
}

export class WalletSessionState {
  private state: WalletSessionSnapshot = createInitialWalletSessionState();
  private readonly walletAdapter = new Eip1193WalletAdapter();
  private readonly handleChange: () => void;
  private isBootstrapped = false;
  private isRefreshing = false;
  private manuallyDisconnected = false;
  constructor(handleChange: () => void) {
    this.handleChange = handleChange;
  }

  get snapshot(): Readonly<WalletSessionSnapshot> {
    return this.state;
  }

  bootstrap(onWalletEvent: () => void): void {
    if (this.isBootstrapped) {
      return;
    }

    // 钱包 provider 事件只能注册一次；重复订阅会把一次账户/链变化放大成多次刷新。
    this.isBootstrapped = true;
    this.walletAdapter.subscribe('accountsChanged', onWalletEvent);
    this.walletAdapter.subscribe('chainChanged', onWalletEvent);
    this.walletAdapter.subscribe('disconnect', onWalletEvent);
  }

  async connectWallet(): Promise<void> {
    if (!this.walletAdapter.isAvailable()) {
      this.updateState({
        walletAvailable: false,
        connectionStatus: 'error',
        lastError: '未检测到浏览器钱包',
      });
      return;
    }

    // 一旦用户主动发起连接，本轮不再把“手动断开”标记当作阻止自动恢复的理由。
    this.manuallyDisconnected = false;
    this.updateState({
      walletAvailable: true,
      connectionStatus: 'connecting',
      lastError: null,
    });

    try {
      await this.walletAdapter.connect();
    } catch (error) {
      this.updateState({
        walletAvailable: true,
        connectionStatus: 'error',
        lastError: this.getErrorMessage(error, '钱包连接失败'),
      });
    }
  }

  async disconnectWallet(): Promise<void> {
    this.manuallyDisconnected = true;

    try {
      await this.walletAdapter.disconnect();
    } finally {
      this.updateState({
        walletAvailable: this.walletAdapter.isAvailable(),
        connectionStatus: 'idle',
        address: null,
        chainId: null,
        isSupportedChain: false,
        lastError: null,
      });
    }
  }

  async refreshWallet(): Promise<void> {
    if (this.isRefreshing) {
      return;
    }

    // refresh 可能同时由 bootstrap、provider 事件和用户操作触发；这里用互斥位
    // 避免并发刷新把连接状态来回覆盖。
    this.isRefreshing = true;

    try {
      const walletAvailable = this.walletAdapter.isAvailable();

      if (!walletAvailable) {
        // 没有注入钱包时必须整体回到 idle/null 状态，不能保留旧地址或旧链信息。
        this.manuallyDisconnected = false;
        this.updateState({
          walletAvailable: false,
          connectionStatus: 'idle',
          address: null,
          chainId: null,
          isSupportedChain: false,
          lastError: null,
        });
        return;
      }

      if (this.manuallyDisconnected) {
        // 用户主动断开后，provider 即使仍存在，也不自动恢复到 connected。
        this.updateState({
          walletAvailable: true,
          connectionStatus: 'idle',
          address: null,
          chainId: null,
          isSupportedChain: false,
          lastError: null,
        });
        return;
      }

      const [address, chainId] = await Promise.all([
        this.walletAdapter.getAddress(),
        this.walletAdapter.getChainId(),
      ]);
      const chain = chainId !== null ? getChainConfig(chainId) : null;

      this.updateState({
        walletAvailable: true,
        connectionStatus: address ? 'connected' : 'idle',
        address,
        chainId,
        isSupportedChain: chain !== null,
        lastError: null,
      });
    } catch (error) {
      this.updateState({
        walletAvailable: this.walletAdapter.isAvailable(),
        connectionStatus: 'error',
        lastError: this.getErrorMessage(error, '读取钱包状态失败'),
      });
    } finally {
      this.isRefreshing = false;
    }
  }

  async switchToDefaultChain(): Promise<void> {
    const defaultChain = getDefaultChainConfig();

    // 切链过程中沿用 connecting 态，避免 UI 同时显示“已连接”与“链不受支持”的混合状态。
    this.updateState({
      walletAvailable: this.walletAdapter.isAvailable(),
      connectionStatus: 'connecting',
      lastError: null,
    });

    try {
      await this.walletAdapter.switchChain(defaultChain.id);
    } catch (error) {
      this.updateState({
        walletAvailable: this.walletAdapter.isAvailable(),
        connectionStatus: 'error',
        lastError: this.getErrorMessage(error, '切换支持链失败'),
      });
    }
  }

  clearError(): void {
    if (!this.state.lastError) {
      return;
    }

    this.updateState({ lastError: null });
  }

  setLastError(message: string | null): void {
    this.updateState({ lastError: message });
  }

  async signTypedData(typedData: SessionPermitTypedData): Promise<Hex> {
    // 签名错误需要同步写入 wallet 层 lastError，这样菜单/结果页等只订阅 web3State 的界面
    // 也能直接看到签名失败原因。
    try {
      return await this.walletAdapter.signTypedData(typedData);
    } catch (error) {
      const message = this.getErrorMessage(error, '签名失败');
      this.updateState({ lastError: message });
      throw new Error(message);
    }
  }

  applyPatch(nextState: Partial<WalletSessionSnapshot>): void {
    this.updateState(nextState);
  }

  private updateState(nextState: Partial<WalletSessionSnapshot>): void {
    this.state = {
      ...this.state,
      ...nextState,
    };
    this.handleChange();
  }

  private getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return fallback;
  }
}
