import { expect, type Page } from '@playwright/test';
import type { RankedChallengeRef } from '../../src/web3/types';

const SAVE_STORAGE_KEY = 'gold-miner-onchain.save.v1';

export interface GoldMinerDevSnapshot {
  activeScenes: string[];
  visibleScenes: string[];
  playingSoundKeys: string[];
  soundCount: number;
  currentRunLevelGroup: number | null;
  currentRunLevelId: string | null;
  currentRunTimeRemainingSec: number | null;
  highScore: number;
  highLevel: number;
  entityCount: number | null;
  gameObjectCount: number | null;
  debugOverlayVisible: boolean | null;
  gameplayLayout: {
    hudRects: {
      score: {
        x: number;
        y: number;
        width: number;
        height: number;
      } | null;
      status: {
        x: number;
        y: number;
        width: number;
        height: number;
      } | null;
    };
    minerRect: {
      x: number;
      y: number;
      width: number;
      height: number;
    } | null;
    hookOrigin: {
      x: number;
      y: number;
    } | null;
    hookTip: {
      x: number;
      y: number;
    } | null;
  } | null;
  rankedStartStage: string | null;
  rankedStartError: string | null;
  menuRankedStartStage: string | null;
  menuRankedStartError: string | null;
  adventureCenterStage: string | null;
  rankedWasm: {
    supported: boolean;
    reason: 'available' | 'module-missing' | 'init-failed';
  };
  rankedRuntimeMode: 'shadow' | 'authoritative';
  rankedRuntime: {
    logicTick: number;
    diamondsCaught: number;
    lastDiamondTick: number;
    finishedTick: number | null;
    durationMs: number | null;
    entityCount: number;
  } | null;
  rankedRuntimeFinalized: {
    logicTick: number;
    diamondsCaught: number;
    lastDiamondTick: number;
    finishedTick: number;
    durationMs: number;
  } | null;
  rankedShadowParity: {
    ready: boolean;
    initializationAttempted: boolean;
    mismatchReported: boolean;
    recentSteps: Array<{
      mismatch: boolean;
      runtime: {
        logicTick: number;
        hookState: 'swinging' | 'extending' | 'returningEmpty' | 'returningLoaded';
        hookAngleDeg: number;
        hookLength: number;
        caughtEntityIndex: number | null;
        diamondsCaught: number;
        lastDiamondTick: number;
        spawnCursor: number;
        entities: Array<{
          active: boolean;
          caught: boolean;
          collisionX: number;
          collisionY: number;
          collisionRadius: number;
        }>;
      };
      local: {
        logicTick: number;
        hook: {
          state: string | null;
          angleDeg: number;
          length: number;
        };
        caughtCount: number;
        lastDiamondTick: number;
        entities: Array<{
          active: boolean;
          isCaught: boolean;
          collisionX: number;
          collisionY: number;
          collisionRadius: number;
        }>;
      };
    }>;
  } | null;
  gameplayPauseMenuVisible: boolean;
  shopPauseMenuVisible: boolean;
  debug: {
    showHitCircles: boolean;
    forceGoalReached: boolean;
    infiniteTime: boolean;
    forcedLevelId: string | null;
    muteAudio: boolean;
  };
}

export interface SceneTextEntry {
  text: string;
  fontFamily: string;
  testString: string;
  padding: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  visible: boolean;
  alpha: number;
}

export interface NamedSceneBoundsEntry {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  alpha: number;
}

export interface GoalSceneCountdownState {
  remainingSec: number | null;
  hintText: string | null;
}

const MIXED_TEST_STRING = '回国田Ag|Éqgyjp';
const LATIN_TEST_STRING = '|MÉqgyjp';
const MOCK_WALLET_ADDRESS = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const MOCK_SESSION_ID =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

export const MOCK_RANKED_CHALLENGE: RankedChallengeRef = {
  challengeId: 'diamond_rush_60',
  version: 1,
  contentHash:
    '0xe7d521dc6cb84b4e36bfed3e7efbe6a7a23e580791555cf1f8b72fe28635d424',
  challengeSeed:
    '0xf5887cca5abd7f768e0448f4e07527a74b5e39203c38299225c386cf1236dc82',
  simulationVersion: 1,
  logicFps: 60,
  timeLimitTicks: 3600,
  isCurrent: true,
};

export type MockWalletMode =
  | 'success'
  | 'reject'
  | 'hang'
  | 'string-payload-only'
  | 'object-message-only';

export async function installMockWallet(
  page: Page,
  mode: MockWalletMode = 'success',
): Promise<void> {
  await page.addInitScript(
    ({ initialMode, account }) => {
      type Listener = (...args: unknown[]) => void;

      let walletMode = initialMode;
      const listeners = new Map<string, Set<Listener>>();

      const emit = (event: string, payload: unknown): void => {
        const eventListeners = listeners.get(event);

        if (!eventListeners) {
          return;
        }

        eventListeners.forEach((listener) => {
          listener(payload);
        });
      };

      (window as typeof window & {
        __setGoldMinerWalletMode?: (nextMode: MockWalletMode) => void;
      }).__setGoldMinerWalletMode = (nextMode: MockWalletMode) => {
        walletMode = nextMode;
      };

      window.ethereum = {
        request: async ({ method, params }) => {
          switch (method) {
            case 'eth_requestAccounts':
            case 'eth_accounts':
              return [account];
            case 'eth_chainId':
              return '0x7a69';
            case 'wallet_switchEthereumChain':
            case 'wallet_addEthereumChain':
              emit('chainChanged', '0x7a69');
              return null;
            case 'eth_signTypedData_v4':
              const usesArrayPayload =
                Array.isArray(params) &&
                params.length === 2 &&
                typeof params[0] === 'string';
              const usesStringPayload =
                usesArrayPayload && typeof params[1] === 'string';
              const usesObjectMessagePayload =
                usesArrayPayload &&
                params[1] !== null &&
                typeof params[1] === 'object';

              if (walletMode === 'hang') {
                return await new Promise(() => {
                  // Intentionally never resolves.
                });
              }

              if (walletMode === 'reject') {
                const error = new Error('User rejected the request.');
                (error as Error & { code?: number }).code = 4001;
                throw error;
              }

              if (walletMode === 'string-payload-only' && !usesStringPayload) {
                return await new Promise(() => {
                  // Simulate mainstream wallets that never surface a prompt for non-standard payloads.
                });
              }

              if (walletMode === 'object-message-only' && !usesObjectMessagePayload) {
                const error = new Error(
                  'Invalid params: expected typed-data object payload for signing.',
                );
                (error as Error & { code?: number }).code = -32602;
                throw error;
              }

              if (!usesArrayPayload) {
                return await new Promise(() => {
                  // Non-standard payload shapes can stall some injected wallets without throwing.
                });
              }

              if (!usesStringPayload && !usesObjectMessagePayload) {
                return await new Promise(() => {
                  // Unsupported message encoding variant.
                });
              }

              return `0x${'11'.repeat(65)}`;
            default:
              throw new Error(`Unsupported mock wallet method: ${method}`);
          }
        },
        on: (event: string, listener: Listener) => {
          const eventListeners = listeners.get(event) ?? new Set<Listener>();
          eventListeners.add(listener);
          listeners.set(event, eventListeners);
        },
        removeListener: (event: string, listener: Listener) => {
          listeners.get(event)?.delete(listener);
        },
      };
    },
    {
      initialMode: mode,
      account: MOCK_WALLET_ADDRESS,
    },
  );
}

export async function mockRankedStartApi(
  page: Page,
  options?: {
    activateError?: string;
  },
): Promise<void> {
  await page.route('http://127.0.0.1:4174/contract-config.json', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        chainId: 31337,
        deploymentId: 'local-goldminer-diamond-rush',
        apiBaseUrl: 'http://127.0.0.1:8788/api',
        rpcUrl: 'http://127.0.0.1:8545',
        goldMinerLevelCatalogAddress: '0x0000000000000000000000000000000000000000',
        goldMinerScoreboardAddress: '0x0000000000000000000000000000000000000000',
        rankedRuntimeMode: 'authoritative',
      }),
    });
  });

  await page.route('http://127.0.0.1:8788/api/ranked/current', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        boardId: 'diamond_rush_60',
        currentChallenge: {
          ...MOCK_RANKED_CHALLENGE,
        },
      }),
    });
  });

  await page.route('http://127.0.0.1:8788/api/ranked/sessions', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId: MOCK_SESSION_ID,
        deadline: 4_000_000_000,
        maxRuns: 10,
        permit: {
          player: MOCK_WALLET_ADDRESS,
          delegate: '0x2222222222222222222222222222222222222222',
          sessionId: MOCK_SESSION_ID,
          deploymentIdHash:
            '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          issuedAt: 1,
          deadline: 4_000_000_000,
          nonce: 1,
          maxRuns: 10,
        },
        typedData: {
          domain: {
            name: 'GoldMinerSessionPermit',
            version: '1',
            chainId: 31337,
            verifyingContract: '0x3333333333333333333333333333333333333333',
          },
          primaryType: 'SessionPermit',
          types: {
            EIP712Domain: [
              { name: 'name', type: 'string' },
              { name: 'version', type: 'string' },
              { name: 'chainId', type: 'uint256' },
              { name: 'verifyingContract', type: 'address' },
            ],
            SessionPermit: [
              { name: 'player', type: 'address' },
              { name: 'delegate', type: 'address' },
              { name: 'sessionId', type: 'bytes32' },
              { name: 'deploymentIdHash', type: 'bytes32' },
              { name: 'issuedAt', type: 'uint64' },
              { name: 'deadline', type: 'uint64' },
              { name: 'nonce', type: 'uint32' },
              { name: 'maxRuns', type: 'uint16' },
            ],
          },
          message: {
            player: MOCK_WALLET_ADDRESS,
            delegate: '0x2222222222222222222222222222222222222222',
            sessionId: MOCK_SESSION_ID,
            deploymentIdHash:
              '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            issuedAt: 1,
            deadline: 4_000_000_000,
            nonce: 1,
            maxRuns: 10,
          },
        },
      }),
    });
  });

  await page.route('http://127.0.0.1:8788/api/ranked/sessions/activate', async (route) => {
    if (options?.activateError) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: options.activateError,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.route('http://127.0.0.1:8788/api/ranked/leaderboard**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route('http://127.0.0.1:8788/api/ranked/history/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
}

export async function mockAdventureCenterApi(
  page: Page,
  options?: {
    activateError?: string;
    history?: Array<{
      player?: string;
      result: {
        campaignId: string;
        reachedLevel: number;
        completed: boolean;
        finalScore: number;
        totalDurationMs: number;
        purchasedItemCount: number;
        evidenceHash: string;
        submittedAt: number;
      };
    }>;
  },
): Promise<void> {
  await page.route('http://127.0.0.1:8788/api/campaigns', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        campaignId:
          '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa11',
        sessionId:
          '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb11',
        campaignSeed:
          '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        deadline: 4_000_000_000,
        maxRuns: 10,
        permit: {
          player: MOCK_WALLET_ADDRESS,
          delegate: '0x2222222222222222222222222222222222222222',
          sessionId:
            '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb11',
          deploymentIdHash:
            '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          issuedAt: 1,
          deadline: 4_000_000_000,
          nonce: 1,
          maxRuns: 10,
        },
        typedData: {
          domain: {
            name: 'GoldMinerSessionPermit',
            version: '1',
            chainId: 31337,
            verifyingContract: '0x3333333333333333333333333333333333333333',
          },
          primaryType: 'SessionPermit',
          types: {
            EIP712Domain: [
              { name: 'name', type: 'string' },
              { name: 'version', type: 'string' },
              { name: 'chainId', type: 'uint256' },
              { name: 'verifyingContract', type: 'address' },
            ],
            SessionPermit: [
              { name: 'player', type: 'address' },
              { name: 'delegate', type: 'address' },
              { name: 'sessionId', type: 'bytes32' },
              { name: 'deploymentIdHash', type: 'bytes32' },
              { name: 'issuedAt', type: 'uint64' },
              { name: 'deadline', type: 'uint64' },
              { name: 'nonce', type: 'uint32' },
              { name: 'maxRuns', type: 'uint16' },
            ],
          },
          message: {
            player: MOCK_WALLET_ADDRESS,
            delegate: '0x2222222222222222222222222222222222222222',
            sessionId:
              '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb11',
            deploymentIdHash:
              '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            issuedAt: 1,
            deadline: 4_000_000_000,
            nonce: 1,
            maxRuns: 10,
          },
        },
        levels: Array.from({ length: 10 }, (_, index) => ({
          levelId: `L${index + 1}`,
          version: 1,
          order: index + 1,
          contentHash: `0x${String(index + 1).padStart(64, String(index + 1))}`,
          challengeSeed: `0x${String(index + 2).padStart(64, String(index + 2))}`,
          simulationVersion: 1,
          logicFps: 60,
          timeLimitTicks: 3600,
        })),
      }),
    });
  });

  await page.route('http://127.0.0.1:8788/api/campaigns/activate', async (route) => {
    if (options?.activateError) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: options.activateError,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.route('http://127.0.0.1:8788/api/campaigns/history/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        options?.history ?? [],
      ),
    });
  });
}

export async function prepareCleanStorage(page: Page): Promise<void> {
  await page.addInitScript((storageKey: string) => {
    if (!globalThis.sessionStorage?.getItem('__gm_save_cleared_once')) {
      globalThis.localStorage?.removeItem(storageKey);
      globalThis.sessionStorage?.setItem('__gm_save_cleared_once', '1');
    }
  }, SAVE_STORAGE_KEY);
}

export async function openGame(page: Page, search = ''): Promise<void> {
  const target = search ? `/${search}` : '/';
  await page.goto(target, { waitUntil: 'networkidle' });
  await page.locator('canvas').waitFor();
  await waitForScene(page, 'MenuScene', 30_000);
  await focusGameCanvas(page);
}

export async function snapshot(page: Page): Promise<GoldMinerDevSnapshot> {
  return page.evaluate(() => {
    const devtools = (window as typeof window & {
      __goldMinerDev?: { snapshot: () => GoldMinerDevSnapshot };
    }).__goldMinerDev;

    if (!devtools) {
      throw new Error('Missing window.__goldMinerDev in DEV mode.');
    }

    return devtools.snapshot();
  });
}

export async function readCurrentRun(page: Page): Promise<unknown | null> {
  return page.evaluate(async () => {
    const [{ gameState }] = await Promise.all([import('/src/game/gameState.ts')]);
    return gameState.currentRun ?? null;
  });
}

export async function waitForScene(
  page: Page,
  sceneKey: string,
  timeoutMs = 15_000,
): Promise<void> {
  await page.waitForFunction(
    (targetScene) => {
      const devtools = (window as typeof window & {
        __goldMinerDev?: { snapshot: () => GoldMinerDevSnapshot };
      }).__goldMinerDev;

      return Boolean(
        devtools?.snapshot().activeScenes.includes(targetScene as string),
      );
    },
    sceneKey,
    { timeout: timeoutMs },
  );
}

export async function waitForSceneExit(
  page: Page,
  sceneKey: string,
): Promise<void> {
  await page.waitForFunction(
    (targetScene) => {
      const devtools = (window as typeof window & {
        __goldMinerDev?: { snapshot: () => GoldMinerDevSnapshot };
      }).__goldMinerDev;

      return Boolean(
        devtools &&
          !devtools.snapshot().activeScenes.includes(targetScene as string),
      );
    },
    sceneKey,
    { timeout: 15_000 },
  );
}

export async function expectOnlyActiveScene(
  page: Page,
  sceneKey: string,
): Promise<void> {
  const state = await snapshot(page);
  expect(state.activeScenes).toEqual([sceneKey]);
}

export async function expectNoGoalMusic(page: Page): Promise<void> {
  const state = await snapshot(page);
  expect(state.playingSoundKeys).not.toContain('goal');
  expect(state.playingSoundKeys).not.toContain('madeGoal');
}

export async function readSaveData(
  page: Page,
): Promise<{ version: 1; highScore: number; highLevel: number } | null> {
  return page.evaluate((storageKey: string) => {
    const raw = globalThis.localStorage?.getItem(storageKey) ?? null;
    return raw ? JSON.parse(raw) : null;
  }, SAVE_STORAGE_KEY);
}

export async function focusGameCanvas(page: Page): Promise<void> {
  await page.locator('canvas').click({ position: { x: 32, y: 32 } });
}

export async function simulateBackgroundElapsed(
  page: Page,
  elapsedMs: number,
): Promise<void> {
  await page.evaluate(async (nextElapsedMs: number) => {
    const [{ gameState }] = await Promise.all([import('/src/game/gameState.ts')]);
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: {
          getScene: (key: string) => Record<string, unknown>;
        };
      };
    }).__goldMinerGame;

    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }

    const scene = game.scene.getScene('GameplayScene') as {
      run?: { mode?: string } | null;
      backgroundTiming?: {
        beginBackgroundWindow?: () => void;
        endBackgroundWindow?: () => void;
      };
      advanceBackgroundElapsedForTests?: (elapsedSec: number) => Promise<void>;
      applyBackgroundElapsed?: () => void;
      applyVerifiedBackgroundElapsed?: (elapsedSec: number) => Promise<void>;
      advanceClassicBackgroundElapsed?: (
        elapsedSec: number,
        rankedFixedStep: boolean,
      ) => void;
      applyingBackgroundElapsed?: boolean;
      rankedDiamondRushController?: {
        isAuthoritative?: boolean;
      } | null;
    };
    const tracker = scene.backgroundTiming;

    if (!tracker?.beginBackgroundWindow || !tracker?.endBackgroundWindow) {
      throw new Error('Missing GameplayScene background timing tracker.');
    }

    const originalNow = performance.now.bind(performance);
    const baseNow = originalNow();
    let currentNow = baseNow;

    const restoreNow = (): void => {
      Object.defineProperty(performance, 'now', {
        configurable: true,
        value: originalNow,
      });
    };

    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => currentNow,
    });

    try {
      if (scene.advanceBackgroundElapsedForTests) {
        await scene.advanceBackgroundElapsedForTests(nextElapsedMs / 1000);
      } else if (scene.advanceClassicBackgroundElapsed) {
        scene.advanceClassicBackgroundElapsed(
          nextElapsedMs / 1000,
          scene.run?.mode === 'campaign' || scene.run?.mode === 'ranked',
        );
      } else {
        tracker.beginBackgroundWindow();
        currentNow = baseNow + nextElapsedMs;
        tracker.endBackgroundWindow();
        scene.applyBackgroundElapsed?.();

        if (scene.applyingBackgroundElapsed) {
          const timeoutAt = originalNow() + 2_000;
          while (scene.applyingBackgroundElapsed) {
            if (originalNow() >= timeoutAt) {
              throw new Error('Timed out waiting for background elapsed flush.');
            }
            await new Promise((resolve) => window.setTimeout(resolve, 16));
          }
        }
      }

      if (
        !gameState.currentRun &&
        scene.run &&
        scene.run.mode !== 'campaign'
      ) {
        throw new Error('Missing current run after background elapsed simulation.');
      }
    } finally {
      restoreNow();
    }
  }, elapsedMs);
}

export async function callSceneMethod(
  page: Page,
  sceneKey: string,
  methodName: string,
): Promise<void> {
  await page.evaluate(
    ({ targetScene, targetMethod }) => {
      const game = (window as typeof window & {
        __goldMinerGame?: {
          scene: { getScene: (key: string) => Record<string, unknown> };
        };
      }).__goldMinerGame;

      if (!game) {
        throw new Error('Missing window.__goldMinerGame in DEV mode.');
      }

      const scene = game.scene.getScene(targetScene);
      const method = scene[targetMethod];

      if (typeof method !== 'function') {
        throw new Error(`Missing ${targetMethod} on ${targetScene}.`);
      }

      method.call(scene);
    },
    { targetScene: sceneKey, targetMethod: methodName },
  );
}

export async function configureRankedSceneLayoutFixture(page: Page): Promise<void> {
  await page.evaluate(async (mockChallenge) => {
    const { web3State } = await import('/src/game/web3State.ts');
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: { getScene: (key: string) => Record<string, unknown> };
      };
    }).__goldMinerGame;

    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }

    const rankedScene = game.scene.getScene('RankedScene') as Record<string, unknown>;

    rankedScene.refreshing = false;
    rankedScene.actionInFlight = false;
    rankedScene.rankedStartStage = null;
    rankedScene.rankedStartError = null;
    rankedScene.localMessage = '准备好了，请确认挑战后开始。';
    rankedScene.localTone = 'info';
    rankedScene.leaderboard = [];
    rankedScene.history = [];

    const fixtureState = {
      walletAvailable: true,
      connectionStatus: 'connected',
      address: '0x15d3A7a8c3D68a3C0A0F0d6Da3C0a0F08A85A85A',
      chainId: 31337,
      isSupportedChain: true,
      playerProfile: {
        address: '0x15d3A7a8c3D68a3C0A0F0d6Da3C0a0F08A85A85A',
        bestDiamondsCaught: 9,
      },
      rankedBoardState: {
        chainId: 31337,
        currentChallenge: {
          ...mockChallenge,
        },
      },
      inventory: null,
      lastError: null,
    };

    const updateState = (
      web3State as unknown as {
        updateState?: (nextState: unknown) => void;
        state?: unknown;
      }
    ).updateState;

    if (typeof updateState === 'function') {
      updateState.call(web3State, fixtureState);
    } else {
      (
        web3State as unknown as {
          state?: unknown;
        }
      ).state = fixtureState;
    }

    const refreshView = rankedScene.refreshView as ((state: unknown) => void) | undefined;

    if (typeof refreshView !== 'function') {
      throw new Error('Missing refreshView on RankedScene.');
    }

    refreshView.call(rankedScene, fixtureState);
  }, MOCK_RANKED_CHALLENGE);
}

export async function startGameplayFromGoalScene(page: Page): Promise<void> {
  await page.evaluate(() => {
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: {
          getScene: (key: string) => {
            scene: { start: (key: string, data?: unknown) => void };
            run?: unknown;
            restartSnapshot?: unknown;
          };
        };
      };
    }).__goldMinerGame;

    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }

    const goalScene = game.scene.getScene('GoalScene');

    goalScene.scene.start('GameplayScene', {
      run: goalScene.run,
      restartSnapshot: goalScene.restartSnapshot,
    });
  });
}

export async function getSceneTextEntries(
  page: Page,
  sceneKey: string,
): Promise<SceneTextEntry[]> {
  return page.evaluate((targetScene) => {
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: {
          getScene: (key: string) => {
            children: { list: Array<Record<string, unknown>> };
          };
        };
      };
    }).__goldMinerGame;

    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }

    const scene = game.scene.getScene(targetScene as string);

    const entries: SceneTextEntry[] = [];

    const visit = (
      gameObject: Record<string, unknown>,
      inheritedVisible = true,
      inheritedAlpha = 1,
    ): void => {
      const nextVisible =
        inheritedVisible && (gameObject.visible as boolean | undefined) !== false;
      const nextAlpha =
        inheritedAlpha *
        (typeof gameObject.alpha === 'number' ? (gameObject.alpha as number) : 1);

      if (gameObject.type === 'Text') {
        const textObject = gameObject as {
          text?: string;
          _text?: string;
          padding?: {
            left?: number;
            top?: number;
            right?: number;
            bottom?: number;
          };
          style?: {
            fontFamily?: string;
            testString?: string;
          };
          toJSON?: () => {
            data?: {
              text?: string;
            };
          };
        };
        const serializedText =
          typeof textObject.toJSON === 'function'
            ? textObject.toJSON()?.data?.text
            : undefined;
        const resolvedText =
          serializedText ??
          textObject._text ??
          textObject.text ??
          '';

        entries.push({
          text: resolvedText,
          fontFamily: textObject.style?.fontFamily ?? '',
          testString: textObject.style?.testString ?? '',
          padding: {
            left: textObject.padding?.left ?? 0,
            top: textObject.padding?.top ?? 0,
            right: textObject.padding?.right ?? 0,
            bottom: textObject.padding?.bottom ?? 0,
          },
          visible: nextVisible,
          alpha: nextAlpha,
        });
      }

      const childList = (gameObject.list as Array<Record<string, unknown>> | undefined) ?? [];
      childList.forEach((child) => {
        visit(child, nextVisible, nextAlpha);
      });
    };

    scene.children.list.forEach((gameObject) => {
      visit(gameObject as Record<string, unknown>);
    });

    return entries;
  }, sceneKey);
}

export async function getNamedSceneBounds(
  page: Page,
  sceneKey: string,
): Promise<NamedSceneBoundsEntry[]> {
  return page.evaluate((targetScene) => {
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: {
          getScene: (key: string) => {
            children: { list: Array<Record<string, unknown>> };
          };
        };
      };
    }).__goldMinerGame;

    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }

    const scene = game.scene.getScene(targetScene as string);
    const entries: NamedSceneBoundsEntry[] = [];

    const visit = (
      gameObject: Record<string, unknown>,
      inheritedVisible = true,
      inheritedAlpha = 1,
    ): void => {
      const nextVisible =
        inheritedVisible && (gameObject.visible as boolean | undefined) !== false;
      const nextAlpha =
        inheritedAlpha *
        (typeof gameObject.alpha === 'number' ? (gameObject.alpha as number) : 1);

      if (
        typeof gameObject.name === 'string' &&
        gameObject.name.length > 0 &&
        typeof gameObject.getBounds === 'function'
      ) {
        const bounds = (gameObject.getBounds as () => {
          x: number;
          y: number;
          width: number;
          height: number;
        })();
        const measuredWidth =
          typeof gameObject.displayWidth === 'number' && gameObject.displayWidth > 0
            ? (gameObject.displayWidth as number)
            : typeof gameObject.width === 'number' && gameObject.width > 0
              ? (gameObject.width as number)
              : 0;
        const measuredHeight =
          typeof gameObject.displayHeight === 'number' && gameObject.displayHeight > 0
            ? (gameObject.displayHeight as number)
            : typeof gameObject.height === 'number' && gameObject.height > 0
              ? (gameObject.height as number)
              : 0;
        const needsMeasuredFallback =
          (bounds.width <= 0 || bounds.height <= 0) &&
          measuredWidth > 0 &&
          measuredHeight > 0;
        const fallbackX =
          typeof gameObject.x === 'number' ? (gameObject.x as number) : bounds.x;
        const fallbackY =
          typeof gameObject.y === 'number' ? (gameObject.y as number) : bounds.y;

        entries.push({
          name: gameObject.name,
          x: needsMeasuredFallback ? fallbackX : bounds.x,
          y: needsMeasuredFallback ? fallbackY : bounds.y,
          width: needsMeasuredFallback ? measuredWidth : bounds.width,
          height: needsMeasuredFallback ? measuredHeight : bounds.height,
          visible: nextVisible,
          alpha: nextAlpha,
        });
      }

      const childList = (gameObject.list as Array<Record<string, unknown>> | undefined) ?? [];
      childList.forEach((child) => {
        visit(child, nextVisible, nextAlpha);
      });
    };

    scene.children.list.forEach((gameObject) => {
      visit(gameObject as Record<string, unknown>);
    });

    return entries;
  }, sceneKey);
}

export async function clickNamedSceneEntry(
  page: Page,
  sceneKey: string,
  entryName: string,
): Promise<void> {
  const canvas = page.locator('canvas');
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();

  const bounds = (await getNamedSceneBounds(page, sceneKey)).find(
    (entry) => entry.name === entryName && entry.visible && entry.alpha > 0,
  );
  expect(bounds, `missing bounds for ${entryName}`).toBeDefined();

  const scaleX = (canvasBox?.width ?? 0) / 320;
  const scaleY = (canvasBox?.height ?? 0) / 240;

  await canvas.click({
    position: {
      x: (bounds!.x + bounds!.width / 2) * scaleX,
      y: (bounds!.y + bounds!.height / 2) * scaleY,
    },
  });
}

export async function getGoalSceneCountdownState(
  page: Page,
): Promise<GoalSceneCountdownState> {
  return page.evaluate(() => {
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: {
          getScene: (key: string) => {
            autoAdvanceRemainingSec?: number;
            autoAdvanceHintText?: {
              _text?: string;
              text?: string;
              toJSON?: () => {
                data?: {
                  text?: string;
                };
              };
            } | null;
          };
        };
      };
    }).__goldMinerGame;

    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }

    const scene = game.scene.getScene('GoalScene');
    const hintObject = scene.autoAdvanceHintText;
    const serializedText =
      typeof hintObject?.toJSON === 'function'
        ? hintObject.toJSON()?.data?.text
        : undefined;

    return {
      remainingSec:
        typeof scene.autoAdvanceRemainingSec === 'number'
          ? scene.autoAdvanceRemainingSec
          : null,
      hintText: serializedText ?? hintObject?._text ?? hintObject?.text ?? null,
    };
  });
}

export async function expectSceneTextMetrics(
  page: Page,
  sceneKey: string,
): Promise<void> {
  const entries = await getSceneTextEntries(page, sceneKey);
  const visibleEntries = entries.filter(
    (entry) => entry.visible && entry.alpha > 0 && entry.text.trim().length > 0,
  );

  expect(visibleEntries.length).toBeGreaterThan(0);

  for (const entry of visibleEntries) {
    expect([MIXED_TEST_STRING, LATIN_TEST_STRING]).toContain(entry.testString);
    expect(entry.padding.left).toBeGreaterThanOrEqual(1);
    expect(entry.padding.top).toBeGreaterThanOrEqual(3);
    expect(entry.padding.right).toBeGreaterThanOrEqual(1);
    expect(entry.padding.bottom).toBeGreaterThanOrEqual(2);

    if (/[\u3400-\u9fff]/.test(entry.text)) {
      expect(entry.testString).toBe(MIXED_TEST_STRING);
      expect(entry.fontFamily).toMatch(
        /PingFang SC|Hiragino Sans GB|Microsoft YaHei|Noto Sans CJK SC|Source Han Sans SC/,
      );
    }
  }
}

export async function expectUiFontsReady(page: Page): Promise<void> {
  const readiness = await page.evaluate(() => ({
    visitor: document.fonts.check('12px Visitor'),
    kurland: document.fonts.check('28px Kurland'),
    status: document.fonts.status,
  }));

  expect(readiness.visitor).toBe(true);
  expect(readiness.kurland).toBe(true);
  expect(readiness.status).toBe('loaded');
}
