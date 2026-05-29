/**
 * BlockchainService 是前端读取链上/链下读模型的轻量服务门面。
 *
 * 当前它刻意保持很薄：
 * - 玩家档案走 ranked overview 的轻量聚合
 * - 当前排位挑战走 ranked current
 * - 库存先返回空实现
 *
 * 这样 web3State/readModelState 可以依赖稳定接口，而不会直接知道 API 端点细节。
 */
import type { Address } from 'viem';

import {
  fetchRankedOverview,
  fetchRankedCurrent,
} from '../../api/rankedApi';
import type {
  BlockchainService,
  PlayerInventory,
  PlayerProfile,
  RankedBoardState,
  SupportedChainId,
} from '../types';

function formatReadError(error: unknown, fallback: string): Error {
  if (error instanceof Error && error.message) {
    return new Error(`${fallback}: ${error.message}`);
  }

  return new Error(fallback);
}

class GoldMinerBlockchainService implements BlockchainService {
  async fetchPlayerProfile(
    address: Address,
    _chainId: SupportedChainId,
  ): Promise<PlayerProfile> {
    try {
      // 玩家档案优先复用 ranked overview 的聚合结果；失败时回落到轻量空档案，
      // 让菜单和 hub 仍然可渲染。
      const overview = await fetchRankedOverview(address);
      return {
        address,
        bestDiamondsCaught: overview.personalBest?.bestDiamondsCaught ?? 0,
      };
    } catch {
      // Keep the existing lightweight fallback so menu and hub still render.
    }

    return {
      address,
      bestDiamondsCaught: 0,
    };
  }

  async fetchRankedBoardState(chainId: SupportedChainId): Promise<RankedBoardState> {
    try {
      // 当前排位 challenge 是 UI 的只读展示状态，不在这里做任何本地缓存修正。
      const summary = await fetchRankedCurrent();

      return {
        chainId,
        currentChallenge: summary.currentChallenge,
      };
    } catch (error) {
      throw formatReadError(error, '读取排位状态失败');
    }
  }

  async fetchInventory(
    _address: Address,
    _chainId: SupportedChainId,
  ): Promise<PlayerInventory> {
    // 库存接口暂时保留稳定形状，但不引入假数据；上层看到的是“空 consumables”而不是错误。
    return {
      consumables: [],
    };
  }
}

export const blockchainService = new GoldMinerBlockchainService();
