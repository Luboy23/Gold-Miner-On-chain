import { afterEach, describe, expect, it, vi } from 'vitest';

import { Web3StateStore } from './web3State';
import { blockchainService } from '../web3/services/BlockchainService';

const CHAIN_ID = 31337 as const;
const ADDRESS_A = `0x${'11'.repeat(20)}` as const;
const ADDRESS_B = `0x${'22'.repeat(20)}` as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Web3StateStore dependent state freshness', () => {
  it('commits only the latest overlapping address refresh', async () => {
    const staleProfile = deferred<Awaited<ReturnType<typeof blockchainService.fetchPlayerProfile>>>();
    const staleBoard = deferred<Awaited<ReturnType<typeof blockchainService.fetchRankedBoardState>>>();
    const staleInventory = deferred<Awaited<ReturnType<typeof blockchainService.fetchInventory>>>();
    let boardRequestCount = 0;

    vi.spyOn(blockchainService, 'fetchPlayerProfile').mockImplementation((address) => {
      if (address === ADDRESS_A) {
        return staleProfile.promise;
      }

      return Promise.resolve({
        address: ADDRESS_B,
        bestDiamondsCaught: 9,
      });
    });
    vi.spyOn(blockchainService, 'fetchRankedBoardState').mockImplementation(() => {
      boardRequestCount += 1;
      if (boardRequestCount === 1) {
        return staleBoard.promise;
      }

      return Promise.resolve({
        chainId: CHAIN_ID,
        currentChallenge: null,
      });
    });
    vi.spyOn(blockchainService, 'fetchInventory').mockImplementation((address) => {
      if (address === ADDRESS_A) {
        return staleInventory.promise;
      }

      return Promise.resolve({
        consumables: [
          {
            itemId: 'dynamite',
            balance: 1n,
          },
        ],
      });
    });

    const store = new Web3StateStore();
    store.updateState({
      address: ADDRESS_A,
      chainId: CHAIN_ID,
      isSupportedChain: true,
    });
    const staleRefresh = store.refreshReadModels();
    await Promise.resolve();

    store.updateState({
      address: ADDRESS_B,
      chainId: CHAIN_ID,
      isSupportedChain: true,
    });
    await store.refreshReadModels();

    expect(store.snapshot.address).toBe(ADDRESS_B);
    expect(store.snapshot.playerProfile?.address).toBe(ADDRESS_B);
    expect(store.snapshot.playerProfile?.bestDiamondsCaught).toBe(9);
    expect(store.snapshot.inventory?.consumables).toEqual([
      {
        itemId: 'dynamite',
        balance: 1n,
      },
    ]);

    staleProfile.resolve({
      address: ADDRESS_A,
      bestDiamondsCaught: 2,
    });
    staleBoard.resolve({
      chainId: CHAIN_ID,
      currentChallenge: null,
    });
    staleInventory.resolve({
      consumables: [],
    });
    await staleRefresh;

    expect(store.snapshot.address).toBe(ADDRESS_B);
    expect(store.snapshot.playerProfile?.address).toBe(ADDRESS_B);
    expect(store.snapshot.playerProfile?.bestDiamondsCaught).toBe(9);
    expect(store.snapshot.inventory?.consumables).toEqual([
      {
        itemId: 'dynamite',
        balance: 1n,
      },
    ]);
    expect(store.snapshot.lastError).toBeNull();
  });

  it('ignores stale failures after a newer refresh has already succeeded', async () => {
    const staleBoard = deferred<Awaited<ReturnType<typeof blockchainService.fetchRankedBoardState>>>();
    let boardRequestCount = 0;

    vi.spyOn(blockchainService, 'fetchPlayerProfile').mockImplementation((address) => {
      if (address === ADDRESS_A) {
        return Promise.resolve({
          address: ADDRESS_A,
          bestDiamondsCaught: 1,
        });
      }

      return Promise.resolve({
        address: ADDRESS_B,
        bestDiamondsCaught: 7,
      });
    });
    vi.spyOn(blockchainService, 'fetchRankedBoardState').mockImplementation(() => {
      boardRequestCount += 1;
      if (boardRequestCount === 1) {
        return staleBoard.promise;
      }

      return Promise.resolve({
        chainId: CHAIN_ID,
        currentChallenge: null,
      });
    });
    vi.spyOn(blockchainService, 'fetchInventory').mockImplementation((address) => {
      if (address === ADDRESS_A) {
        return Promise.resolve({
          consumables: [],
        });
      }

      return Promise.resolve({
        consumables: [
          {
            itemId: 'rope',
            balance: 2n,
          },
        ],
      });
    });

    const store = new Web3StateStore();
    store.updateState({
      address: ADDRESS_A,
      chainId: CHAIN_ID,
      isSupportedChain: true,
    });
    const staleRefresh = store.refreshReadModels();
    await Promise.resolve();

    store.updateState({
      address: ADDRESS_B,
      chainId: CHAIN_ID,
      isSupportedChain: true,
    });
    await store.refreshReadModels();

    staleBoard.reject(new Error('stale ranked board error'));
    await staleRefresh;

    expect(store.snapshot.address).toBe(ADDRESS_B);
    expect(store.snapshot.playerProfile?.address).toBe(ADDRESS_B);
    expect(store.snapshot.playerProfile?.bestDiamondsCaught).toBe(7);
    expect(store.snapshot.inventory?.consumables).toEqual([
      {
        itemId: 'rope',
        balance: 2n,
      },
    ]);
    expect(store.snapshot.lastError).toBeNull();
  });
});
