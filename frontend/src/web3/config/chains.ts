import { numberToHex } from 'viem';
import { foundry } from 'viem/chains';

import { getRuntimeConfig } from '../runtime/config';
import type { SupportedChainConfig, SupportedChainId } from '../types';

const DEFAULT_LOCAL_RPC_URL = 'http://127.0.0.1:8545';

function buildLocalChain(): SupportedChainConfig {
  const runtimeConfig = getRuntimeConfig();

  return {
    ...foundry,
    id: 31337,
    name: 'Anvil Local',
    rpcUrls: {
      default: {
        http: [runtimeConfig.rpcUrl || DEFAULT_LOCAL_RPC_URL],
      },
      public: {
        http: [runtimeConfig.rpcUrl || DEFAULT_LOCAL_RPC_URL],
      },
    },
  } as SupportedChainConfig;
}

export const DEFAULT_CHAIN_ID: SupportedChainId = 31337;

export const SUPPORTED_CHAIN_IDS: readonly SupportedChainId[] = Object.freeze([
  31337,
]);

export interface AddEthereumChainParameter {
  chainId: `0x${string}`;
  chainName: string;
  nativeCurrency: SupportedChainConfig['nativeCurrency'];
  rpcUrls: readonly string[];
  blockExplorerUrls?: readonly string[];
}

export function isSupportedChainId(
  chainId: number,
): chainId is SupportedChainId {
  return chainId === 31337;
}

export function getChainConfig(chainId: number): SupportedChainConfig | null {
  return chainId === 31337 ? buildLocalChain() : null;
}

export function getDefaultChainConfig(): SupportedChainConfig {
  return buildLocalChain();
}

export function buildAddEthereumChainParameter(
  chainId: SupportedChainId,
): AddEthereumChainParameter {
  const chain = getChainConfig(chainId);

  if (!chain) {
    throw new Error(`Unsupported chain ${chainId}.`);
  }

  return {
    chainId: numberToHex(chain.id),
    chainName: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: chain.rpcUrls.default.http,
    blockExplorerUrls: chain.blockExplorers?.default?.url
      ? [chain.blockExplorers.default.url]
      : undefined,
  };
}
