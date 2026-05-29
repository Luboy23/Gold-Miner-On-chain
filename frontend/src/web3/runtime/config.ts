/**
 * runtime/config.ts 负责把前端运行时依赖的部署配置规范化成单一对象。
 *
 * 配置来源有两层：
 * - 默认本地开发配置
 * - /contract-config.json 动态覆盖
 *
 * 这里的约束是：缺字段或字段非法时一律回退到稳定默认值，而不是把半合法配置继续向上传播。
 */
import { getAddress, isAddress, type Address } from 'viem';

import type { RuntimeContractConfig } from '../types';

const DEFAULT_RUNTIME_CONFIG: RuntimeContractConfig = {
  chainId: 31337,
  deploymentId: 'local-goldminer-diamond-rush',
  apiBaseUrl: 'http://127.0.0.1:8788/api',
  rpcUrl: 'http://127.0.0.1:8545',
  goldMinerLevelCatalogAddress: getAddress(
    '0x0000000000000000000000000000000000000000',
  ),
  goldMinerScoreboardAddress: getAddress(
    '0x0000000000000000000000000000000000000000',
  ),
  rankedRuntimeMode: 'authoritative',
};

let runtimeConfig = DEFAULT_RUNTIME_CONFIG;
let runtimeConfigPromise: Promise<RuntimeContractConfig> | null = null;

function normalizeAddress(
  value: unknown,
  fallback: Address,
): Address {
  if (typeof value !== 'string' || !isAddress(value)) {
    return fallback;
  }

  return getAddress(value);
}

function normalizeRuntimeConfig(
  value: unknown,
  fallback: RuntimeContractConfig,
): RuntimeContractConfig {
  if (!value || typeof value !== 'object') {
    return fallback;
  }

  const candidate = value as Partial<Record<keyof RuntimeContractConfig, unknown>>;

  // normalize 的目标是“宁可回退默认值，也不要留下半有效配置”。
  return {
    chainId: candidate.chainId === 31337 ? 31337 : fallback.chainId,
    deploymentId:
      typeof candidate.deploymentId === 'string' && candidate.deploymentId.length > 0
        ? candidate.deploymentId
        : fallback.deploymentId,
    apiBaseUrl:
      typeof candidate.apiBaseUrl === 'string' && candidate.apiBaseUrl.length > 0
        ? candidate.apiBaseUrl
        : fallback.apiBaseUrl,
    rpcUrl:
      typeof candidate.rpcUrl === 'string' && candidate.rpcUrl.length > 0
        ? candidate.rpcUrl
        : fallback.rpcUrl,
    goldMinerLevelCatalogAddress: normalizeAddress(
      candidate.goldMinerLevelCatalogAddress,
      fallback.goldMinerLevelCatalogAddress,
    ),
    goldMinerScoreboardAddress: normalizeAddress(
      candidate.goldMinerScoreboardAddress,
      fallback.goldMinerScoreboardAddress,
    ),
    rankedRuntimeMode:
      candidate.rankedRuntimeMode === 'authoritative'
        ? 'authoritative'
        : candidate.rankedRuntimeMode === 'shadow'
          ? 'shadow'
          : fallback.rankedRuntimeMode,
  };
}

export async function loadRuntimeConfig(): Promise<RuntimeContractConfig> {
  if (runtimeConfigPromise) {
    return runtimeConfigPromise;
  }

  // 运行时配置按需懒加载，并在首次成功/失败后缓存结果。
  // 这样 scene/adapter 不会在同一次启动中反复请求 contract-config.json。
  runtimeConfigPromise = fetch('/contract-config.json', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Runtime config request failed: ${response.status}`);
      }

      return response.json() as Promise<unknown>;
    })
    .then((json) => {
      runtimeConfig = normalizeRuntimeConfig(json, DEFAULT_RUNTIME_CONFIG);
      return runtimeConfig;
    })
    .catch((error) => {
      // 配置加载失败时必须回退到默认值；这里的 warn 是诊断信号，不应阻断前端继续启动。
      console.warn('Failed to load contract-config.json, using defaults.', error);
      runtimeConfig = DEFAULT_RUNTIME_CONFIG;
      return runtimeConfig;
    });

  return runtimeConfigPromise;
}

export function getRuntimeConfig(): RuntimeContractConfig {
  return runtimeConfig;
}
