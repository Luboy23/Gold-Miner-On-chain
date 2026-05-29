/**
 * Eip1193WalletAdapter 是前端钱包层的兼容边界。
 *
 * 它负责把注入式 EIP-1193 provider 的不稳定输入/输出形状，统一整理成项目内
 * 固定的 WalletAdapter 接口。scene、controller 和同步链路不应该直接理解
 * provider 差异、错误码差异或 typed-data 参数兼容细节。
 */
import {
  createWalletClient,
  custom,
  getAddress,
  isAddress,
  serializeTypedData,
  validateTypedData,
  type Address,
  type Hex,
} from 'viem';

import {
  buildAddEthereumChainParameter,
  getChainConfig,
  isSupportedChainId,
} from '../config/chains';
import type {
  Eip1193Provider,
  ProviderRpcError,
  SessionPermitTypedData,
  TypedDataField,
  WalletAdapter,
  WalletAdapterEvent,
  WalletAdapterListener,
  WalletSendTransactionRequest,
} from '../types';

function getInjectedProvider(): Eip1193Provider | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.ethereum ?? null;
}

function normalizeAddress(value: unknown): Address | null {
  if (!value || typeof value !== 'string' || !isAddress(value)) {
    return null;
  }

  return getAddress(value);
}

function normalizeAccounts(value: unknown): Address[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeAddress(entry))
    .filter((entry): entry is Address => entry !== null);
}

function normalizeChainId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = value.startsWith('0x')
      ? Number.parseInt(value, 16)
      : Number.parseInt(value, 10);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function asProviderRpcError(error: unknown): ProviderRpcError | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const candidate = error as Partial<ProviderRpcError>;

  if (
    typeof candidate.code === 'number' &&
    typeof candidate.message === 'string'
  ) {
    return {
      code: candidate.code,
      message: candidate.message,
      data: candidate.data,
    };
  }

  return null;
}

export class MissingWalletProviderError extends Error {
  constructor() {
    super('No injected wallet provider was found.');
    this.name = 'MissingWalletProviderError';
  }
}

export class WalletAdapterError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WalletAdapterError';
  }
}

type ViemSessionPermitTypes = {
  EIP712Domain: readonly TypedDataField[];
  SessionPermit: readonly TypedDataField[];
};

function normalizeSessionPermitTypedData(
  typedData: SessionPermitTypedData,
): {
  domain: SessionPermitTypedData['domain'];
  primaryType: 'SessionPermit';
  types: ViemSessionPermitTypes;
  message: SessionPermitTypedData['message'];
} {
  const domainFields = typedData.types.EIP712Domain;
  const permitFields = typedData.types.SessionPermit;

  if (!Array.isArray(domainFields) || domainFields.length === 0) {
    throw new WalletAdapterError(
      'Session permit typed data is missing EIP712Domain fields.',
    );
  }

  if (!Array.isArray(permitFields) || permitFields.length === 0) {
    throw new WalletAdapterError(
      'Session permit typed data is missing SessionPermit fields.',
    );
  }

  if (typedData.primaryType !== 'SessionPermit') {
    throw new WalletAdapterError(
      `Unsupported primary type: ${typedData.primaryType}.`,
    );
  }

  const domainFieldNames = domainFields.map((field) => field.name);
  const expectedDomainFields = [
    'name',
    'version',
    'chainId',
    'verifyingContract',
  ];

  for (const fieldName of expectedDomainFields) {
    if (!domainFieldNames.includes(fieldName)) {
      throw new WalletAdapterError(
        `Session permit typed data is missing ${fieldName} in EIP712Domain.`,
      );
    }
  }

  return {
    domain: typedData.domain,
    primaryType: typedData.primaryType,
    types: {
      EIP712Domain: domainFields,
      SessionPermit: permitFields,
    },
    message: typedData.message,
  };
}

function normalizeHexSignature(value: unknown): Hex | null {
  if (typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value)) {
    return value as Hex;
  }

  if (value && typeof value === 'object') {
    const candidate = value as {
      signature?: unknown;
      result?: unknown;
    };

    return (
      normalizeHexSignature(candidate.signature) ??
      normalizeHexSignature(candidate.result)
    );
  }

  return null;
}

function shouldRetryTypedDataRequest(error: unknown): boolean {
  const rpcError = asProviderRpcError(error);
  const message = rpcError?.message ?? (error instanceof Error ? error.message : '');
  const normalized = message.toLowerCase();

  return (
    normalized.includes('invalid params') ||
    normalized.includes('invalid argument') ||
    normalized.includes('expected object') ||
    normalized.includes('missing value for required argument') ||
    normalized.includes('expected typed-data object') ||
    normalized.includes('expected string')
  );
}

export class Eip1193WalletAdapter implements WalletAdapter {
  private readonly provider: Eip1193Provider | null;
  private readonly listeners = new Map<
    WalletAdapterEvent,
    Set<WalletAdapterListener>
  >();
  private isBound = false;

  constructor(provider: Eip1193Provider | null = getInjectedProvider()) {
    this.provider = provider;
    this.bindProviderEvents();
  }

  isAvailable(): boolean {
    return this.provider !== null;
  }

  async connect(): Promise<Address> {
    const provider = this.requireProvider();

    try {
      const accounts = normalizeAccounts(
        await provider.request({
          method: 'eth_requestAccounts',
        }),
      );
      const account = accounts[0] ?? null;

      if (!account) {
        throw new WalletAdapterError(
          'The wallet connected but did not return an account.',
        );
      }

      this.emit('accountsChanged', account);
      return account;
    } catch (error) {
      throw this.wrapRpcError('Failed to connect wallet.', error);
    }
  }

  async disconnect(): Promise<void> {
    this.emit('disconnect', null);
  }

  async getAddress(): Promise<Address | null> {
    const provider = this.requireProvider();

    try {
      const accounts = normalizeAccounts(
        await provider.request({
          method: 'eth_accounts',
        }),
      );

      return accounts[0] ?? null;
    } catch (error) {
      throw this.wrapRpcError('Failed to read wallet account.', error);
    }
  }

  async getChainId(): Promise<number | null> {
    const provider = this.requireProvider();

    try {
      return normalizeChainId(
        await provider.request({
          method: 'eth_chainId',
        }),
      );
    } catch (error) {
      throw this.wrapRpcError('Failed to read current chain ID.', error);
    }
  }

  async switchChain(chainId: number): Promise<void> {
    const provider = this.requireProvider();

    if (!isSupportedChainId(chainId)) {
      throw new WalletAdapterError(
        `Unsupported chain ${chainId}. Add it to the supported chain config first.`,
      );
    }

    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: buildAddEthereumChainParameter(chainId).chainId }],
      });
    } catch (error) {
      // 切链失败并不总是“钱包不支持目标链”。主流注入钱包通常会先抛出
      // unknown chain 错误，再要求 dapp 走 add-chain fallback；因此这里不能
      // 直接把第一次失败当成最终失败。
      const rpcError = asProviderRpcError(error);

      if (rpcError?.code === 4902) {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [buildAddEthereumChainParameter(chainId)],
        });
      } else {
        throw this.wrapRpcError('Failed to switch wallet chain.', error);
      }
    }

    this.emit('chainChanged', chainId);
  }

  async signMessage(message: string): Promise<Hex> {
    const client = await this.getWalletClient();
    const account = await this.requireAddress();

    try {
      return await client.signMessage({
        account,
        message,
      });
    } catch (error) {
      throw this.wrapRpcError('Failed to sign wallet message.', error);
    }
  }

  async signTypedData(typedData: SessionPermitTypedData): Promise<Hex> {
    const provider = this.requireProvider();
    const account = await this.requireAddress();
    const normalizedTypedData = normalizeSessionPermitTypedData(typedData);
    validateTypedData(normalizedTypedData as never);
    const serializedTypedData = serializeTypedData(normalizedTypedData as never);

    // typed-data 是注入钱包兼容性最差的区域之一。我们固定 address 作为首参数，
    // 只在 payload 形状之间做回退：有些钱包要求 JSON 字符串，有些要求原始对象。
    // 这里的重试是在同一语义请求下做参数兼容，不是重复提示用户再次签名。
    const requestVariants = [
      {
        method: 'eth_signTypedData_v4',
        params: [account, serializedTypedData] as const,
      },
      {
        method: 'eth_signTypedData_v4',
        params: [account, normalizedTypedData] as const,
      },
    ];

    let lastError: unknown = null;

    for (let index = 0; index < requestVariants.length; index += 1) {
      const request = requestVariants[index];

      try {
        const result = await provider.request(request);
        const signature = normalizeHexSignature(result);

        if (!signature) {
          throw new WalletAdapterError(
            'Wallet returned an invalid typed-data signature response.',
          );
        }

        return signature;
      } catch (error) {
        lastError = error;

        if (index < requestVariants.length - 1 && shouldRetryTypedDataRequest(error)) {
          continue;
        }

        throw this.wrapRpcError('Failed to sign typed data.', error);
      }
    }

    throw this.wrapRpcError('Failed to sign typed data.', lastError);
  }

  async sendTransaction(request: WalletSendTransactionRequest): Promise<Hex> {
    const client = await this.getWalletClient();
    const account = await this.requireAddress();
    const chainId = await this.getChainId();
    const chain = chainId !== null ? getChainConfig(chainId) : null;

    try {
      return await client.sendTransaction({
        account,
        chain: chain ?? undefined,
        ...request,
      });
    } catch (error) {
      throw this.wrapRpcError('Failed to send wallet transaction.', error);
    }
  }

  subscribe(
    event: WalletAdapterEvent,
    listener: WalletAdapterListener,
  ): () => void {
    const listeners = this.listeners.get(event) ?? new Set<WalletAdapterListener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);

    return () => {
      listeners.delete(listener);

      if (listeners.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  private requireProvider(): Eip1193Provider {
    if (!this.provider) {
      throw new MissingWalletProviderError();
    }

    return this.provider;
  }

  private async requireAddress(): Promise<Address> {
    const address = (await this.getAddress()) ?? (await this.connect());

    if (!address) {
      throw new WalletAdapterError('No wallet account is currently connected.');
    }

    return address;
  }

  private async getWalletClient() {
    const provider = this.requireProvider();
    const chainId = await this.getChainId();
    const chain = chainId !== null ? getChainConfig(chainId) : null;

    return createWalletClient({
      chain: chain ?? undefined,
      transport: custom(provider),
    });
  }

  private bindProviderEvents(): void {
    if (this.isBound || !this.provider?.on) {
      return;
    }

    // provider 事件在项目里只能被绑定一次；重复绑定会把一次账户/链切换放大成
    // 多次 UI 刷新和多次状态写回。
    this.provider.on('accountsChanged', (accounts: unknown) => {
      const account = normalizeAccounts(accounts)[0] ?? null;
      this.emit('accountsChanged', account);
    });

    this.provider.on('chainChanged', (chainId: unknown) => {
      this.emit('chainChanged', normalizeChainId(chainId));
    });

    this.provider.on('disconnect', () => {
      this.emit('disconnect', null);
    });

    this.isBound = true;
  }

  private emit(
    event: WalletAdapterEvent,
    payload: Address | number | null,
  ): void {
    const listeners = this.listeners.get(event);

    if (!listeners) {
      return;
    }

    for (const listener of listeners) {
      listener(payload);
    }
  }

  private wrapRpcError(message: string, error: unknown): WalletAdapterError {
    const rpcError = asProviderRpcError(error);

    if (rpcError) {
      return new WalletAdapterError(
        `${message} [${rpcError.code}] ${rpcError.message}`,
        { cause: error },
      );
    }

    if (error instanceof Error) {
      return new WalletAdapterError(`${message} ${error.message}`, {
        cause: error,
      });
    }

    return new WalletAdapterError(message, { cause: error });
  }
}
