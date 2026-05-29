import type { ShopItemConfig, ShopItemId } from '../game/types/index';

export const SHOP_ITEM_CONFIGS: Record<ShopItemId, ShopItemConfig> = {
  dynamite: {
    id: 'dynamite',
    textureKey: 'dynamite',
    label: '炸药',
    description: '抓住物品时按上键可直接炸掉。',
  },
  strengthDrink: {
    id: 'strengthDrink',
    textureKey: 'strengthDrink',
    label: '力量饮料',
    description: '下一关抓钩更有劲。',
  },
  luckyClover: {
    id: 'luckyClover',
    textureKey: 'luckyClover',
    label: '幸运草',
    description: '下一关问号袋更容易开出奖励。',
  },
  rockCollectorsBook: {
    id: 'rockCollectorsBook',
    textureKey: 'rockCollectorsBook',
    label: '岩石图鉴',
    description: '下一关石头卖价变为 3 倍。',
  },
  gemPolish: {
    id: 'gemPolish',
    textureKey: 'gemPolish',
    label: '宝石抛光',
    description: '下一关钻石更值钱。',
  },
};
