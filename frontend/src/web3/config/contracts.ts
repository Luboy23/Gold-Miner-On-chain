import { zeroAddress } from 'viem';

import { getRuntimeConfig } from '../runtime/config';
import type { ChainContracts, SupportedChainId } from '../types';

const FALLBACK_CONTRACTS: ChainContracts = {
  levelCatalog: zeroAddress,
  scoreboard: zeroAddress,
};

export function getContractAddresses(_chainId: SupportedChainId): ChainContracts {
  const runtimeConfig = getRuntimeConfig();

  return {
    levelCatalog:
      runtimeConfig.goldMinerLevelCatalogAddress ?? FALLBACK_CONTRACTS.levelCatalog,
    scoreboard:
      runtimeConfig.goldMinerScoreboardAddress ?? FALLBACK_CONTRACTS.scoreboard,
  };
}
