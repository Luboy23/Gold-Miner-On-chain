import { web3State } from '../../game/web3State';

type MenuWalletActionCallbacks = {
  showError: (message: string) => void;
};

export class MenuWalletActionController {
  private readonly callbacks: MenuWalletActionCallbacks;

  constructor(callbacks: MenuWalletActionCallbacks) {
    this.callbacks = callbacks;
  }

  async handleAction(modalVisible: boolean): Promise<void> {
    if (modalVisible) {
      return;
    }

    const state = web3State.snapshot;

    if (!state.walletAvailable) {
      this.callbacks.showError('请安装兼容 EIP-1193 的浏览器钱包');
      return;
    }

    try {
      if (!state.address) {
        await web3State.connectWallet();
      } else {
        await web3State.disconnectWallet();
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '钱包操作失败';
      this.callbacks.showError(message);
    }
  }
}
