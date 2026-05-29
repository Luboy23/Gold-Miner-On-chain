import {
  MAX_DYNAMITE_COUNT,
} from '../game/constants';
import { RunRng } from './RunRng';
import type {
  RunState,
  ShopItemId,
  ShopOffer,
  ShopPurchaseResult,
} from '../game/types/index';

const SHOP_ITEM_IDS: ShopItemId[] = [
  'dynamite',
  'strengthDrink',
  'luckyClover',
  'rockCollectorsBook',
  'gemPolish',
];

function cloneOffers(offers: ShopOffer[] | null): ShopOffer[] | null {
  return offers ? offers.map((offer) => ({ ...offer })) : null;
}

export class ShopSystem {
  buildOffers(run: RunState): ShopOffer[] {
    const rng = new RunRng(`${run.seed}:shop:${run.levelGroup}`);
    const offers: ShopOffer[] = [];

    for (const itemId of SHOP_ITEM_IDS) {
      const shouldAdd = rng.nextInt(1, 3) >= 2;
      if (!shouldAdd) {
        continue;
      }

      offers.push({
        itemId,
        price: this.getPrice(itemId, run.levelGroup, rng),
        state: 'available',
      });
    }

    if (offers.length > 0) {
      return offers;
    }

    return [
      {
        itemId: 'dynamite',
        price: this.getPrice('dynamite', run.levelGroup, rng),
        state: 'available',
      },
    ];
  }

  purchase(run: RunState, offerId: ShopItemId): ShopPurchaseResult {
    const offers = cloneOffers(run.currentShopOffers) ?? this.buildOffers(run);
    const targetIndex = offers.findIndex((offer) => offer.itemId === offerId);

    if (targetIndex === -1) {
      return {
        run: {
          ...run,
          currentShopOffers: offers,
        },
        status: 'not-found',
        offer: null,
      };
    }

    const targetOffer = offers[targetIndex];

    if (targetOffer.state === 'sold') {
      return {
        run: {
          ...run,
          currentShopOffers: offers,
        },
        status: 'already-sold',
        offer: { ...targetOffer },
      };
    }

    if (run.score < targetOffer.price) {
      return {
        run: {
          ...run,
          currentShopOffers: offers,
        },
        status: 'insufficient-funds',
        offer: { ...targetOffer },
      };
    }

    offers.splice(targetIndex, 1);

    const nextRun: RunState = {
      ...run,
      score: run.score - targetOffer.price,
      scoreView: run.scoreView - targetOffer.price,
      purchasedItems: [...run.purchasedItems, offerId],
      temporaryBuffs: {
        ...run.temporaryBuffs,
      },
      currentShopOffers: offers,
    };

    if (offerId === 'dynamite') {
      nextRun.dynamiteCount = Math.min(
        run.dynamiteCount + 1,
        MAX_DYNAMITE_COUNT,
      );
    } else if (offerId === 'strengthDrink') {
      nextRun.temporaryBuffs.strengthDrink = 1;
    } else if (offerId === 'luckyClover') {
      nextRun.temporaryBuffs.luckyClover = 1;
    } else if (offerId === 'rockCollectorsBook') {
      nextRun.temporaryBuffs.rockCollectorsBook = 1;
    } else if (offerId === 'gemPolish') {
      nextRun.temporaryBuffs.gemPolish = 1;
    }

    return {
      run: nextRun,
      status: 'purchased',
      offer: { ...targetOffer, state: 'sold' },
    };
  }

  private getPrice(
    itemId: ShopItemId,
    levelGroup: RunState['levelGroup'],
    rng: RunRng,
  ): number {
    if (itemId === 'dynamite') {
      return rng.nextInt(1, 300) + levelGroup * 2;
    }

    if (itemId === 'strengthDrink') {
      return rng.nextInt(100, 399);
    }

    if (itemId === 'luckyClover') {
      return rng.nextInt(1, levelGroup * 50) + levelGroup * 2;
    }

    if (itemId === 'rockCollectorsBook') {
      return rng.nextInt(1, 150);
    }

    return rng.nextInt(201, 200 + levelGroup * 100);
  }
}

export const shopSystem = new ShopSystem();
