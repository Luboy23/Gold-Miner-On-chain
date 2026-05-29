import type { Abi } from 'viem';

import goldMinerLevelCatalogJson from './GoldMinerLevelCatalog.json';
import goldMinerScoreboardJson from './GoldMinerScoreboard.json';

export const goldMinerLevelCatalogAbi = goldMinerLevelCatalogJson as Abi;
export const goldMinerScoreboardAbi = goldMinerScoreboardJson as Abi;
