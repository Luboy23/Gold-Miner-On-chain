import { expect, test, type Page } from '@playwright/test';

import {
  callSceneMethod,
  clickNamedSceneEntry,
  configureRankedSceneLayoutFixture,
  focusGameCanvas,
  getNamedSceneBounds,
  getSceneTextEntries,
  installMockWallet,
  MOCK_RANKED_CHALLENGE,
  mockRankedStartApi,
  openGame,
  prepareCleanStorage,
  simulateBackgroundElapsed,
  snapshot,
  waitForScene,
} from './helpers';

async function openRankedSceneWithFixture(page: Page): Promise<void> {
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'RankedScene');
  await configureRankedSceneLayoutFixture(page);
  await focusGameCanvas(page);
}

async function openRankedBriefingScene(page: Page): Promise<void> {
  await page.evaluate(async (mockChallenge) => {
    const [{ gameState }, { SCENE_KEYS }] = await Promise.all([
      import('/src/game/gameState.ts'),
      import('/src/game/sceneKeys.ts'),
    ]);

    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: {
          getScene: (key: string) => {
            scene?: {
              start: (key: string, payload?: Record<string, unknown>) => void;
            };
          };
        };
      };
    }).__goldMinerGame;

    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }

    const run = {
      mode: 'ranked',
      seed: 'ranked-briefing-seed',
      levelGroup: 1,
      levelId: 'diamond_rush_60',
      goal: 0,
      score: 0,
      scoreView: 0,
      timeRemainingSec: 60,
      dynamiteCount: 0,
      caughtCount: 0,
      purchasedItems: [],
      temporaryBuffs: {
        strengthDrink: 0,
        luckyClover: 0,
        rockCollectorsBook: 0,
        gemPolish: 0,
      },
      currentShopOffers: null,
      status: 'goal',
      rankedContext: {
        sessionId:
          '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        challengeId: 'diamond_rush_60',
        challengeVersion: 1,
        challengeContentHash: mockChallenge.contentHash,
        challengeSeed: mockChallenge.challengeSeed,
        clientBuildHash:
          '0x3333333333333333333333333333333333333333333333333333333333333333',
        simulationVersion: 1,
        logicFps: 60,
        timeLimitTicks: 3600,
        logicTick: 0,
        actions: [],
        challenge: {
          ...mockChallenge,
        },
        lastDiamondTick: 0,
      },
      campaignContext: null,
    };

    gameState.setCurrentRun(run);
    const menuScene = game.scene.getScene(SCENE_KEYS.Menu);
    menuScene.scene?.start(SCENE_KEYS.Goal, {
      mode: 'next-goal',
      run,
    });
  }, MOCK_RANKED_CHALLENGE);

  await waitForScene(page, 'GoalScene');
  await focusGameCanvas(page);
}

test.beforeEach(async ({ page }) => {
  await prepareCleanStorage(page);
});

test('opening experience game from the menu shows a confirmation modal and starts only after choosing yes', async ({
  page,
}) => {
  await openGame(page, '?muteAudio=1');

  await page.keyboard.press('Enter');
  let state = await snapshot(page);
  expect(state.activeScenes).toEqual(['MenuScene']);

  let texts = await getSceneTextEntries(page, 'MenuScene');
  expect(
    texts.some((entry) => entry.visible && entry.text.includes('试玩模式不保存进度')),
  ).toBe(true);
  expect(
    texts.some((entry) => entry.visible && entry.text.includes('不保存进度')),
  ).toBe(true);

  const bounds = await getNamedSceneBounds(page, 'MenuScene');
  expect(bounds.some((entry) => entry.name === 'menu.experience.confirm.no')).toBe(true);
  expect(bounds.some((entry) => entry.name === 'menu.experience.confirm.yes')).toBe(true);

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'GoalScene');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');

  state = await snapshot(page);
  expect(state.activeScenes).toEqual(['GameplayScene']);
  expect(state.currentRunLevelId).toBe('L1');
  expect(state.menuRankedStartError).toBeNull();
});

test('experience confirmation defaults to no and closes back to menu on Enter or Esc', async ({
  page,
}) => {
  await openGame(page, '?muteAudio=1');

  await page.keyboard.press('Enter');
  let texts = await getSceneTextEntries(page, 'MenuScene');
  expect(texts.some((entry) => entry.visible && entry.text.includes('返回'))).toBe(true);

  await page.keyboard.press('Enter');
  let state = await snapshot(page);
  expect(state.activeScenes).toEqual(['MenuScene']);
  texts = await getSceneTextEntries(page, 'MenuScene');
  expect(texts.some((entry) => entry.visible && entry.text.includes('试玩模式不保存进度'))).toBe(false);

  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  state = await snapshot(page);
  expect(state.activeScenes).toEqual(['MenuScene']);
  texts = await getSceneTextEntries(page, 'MenuScene');
  expect(texts.some((entry) => entry.visible && entry.text.includes('试玩模式不保存进度'))).toBe(false);
});

test('experience confirmation keeps menu interactions frozen while the modal is open', async ({
  page,
}) => {
  await openGame(page, '?muteAudio=1');

  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['MenuScene']);

  const texts = await getSceneTextEntries(page, 'MenuScene');
  expect(texts.some((entry) => entry.visible && entry.text.includes('试玩模式不保存进度'))).toBe(false);
  expect(texts.some((entry) => entry.visible && entry.text.includes('未连接'))).toBe(false);
});

test('opening adventure challenge without a wallet rejection stays on MenuScene instead of falling back to experience mode', async ({
  page,
}) => {
  await installMockWallet(page, 'reject');
  await openGame(page, '?muteAudio=1');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  await page.waitForTimeout(1200);

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['MenuScene']);
  expect(state.currentRunLevelId).toBeNull();

  const texts = await getSceneTextEntries(page, 'MenuScene');
  expect(
    texts.some((entry) => entry.visible && entry.text.includes('User rejected the request')),
  ).toBe(true);
});

test('opening ranked challenge from the menu starts signing flow and enters gameplay directly', async ({
  page,
}) => {
  await installMockWallet(page, 'string-payload-only');
  await mockRankedStartApi(page);
  await openGame(page, '?muteAudio=1');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['GameplayScene']);
  expect(state.currentRunLevelId).toBe('diamond_rush_60');
  expect(state.menuRankedStartError).toBeNull();
});

test('opening ranked center from the menu still stays on RankedScene without auto-starting gameplay', async ({
  page,
}) => {
  await installMockWallet(page, 'string-payload-only');
  await mockRankedStartApi(page);
  await openGame(page, '?muteAudio=1');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'RankedScene');
  await configureRankedSceneLayoutFixture(page);

  await page.waitForTimeout(1500);

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['RankedScene']);
  expect(state.rankedStartStage).toBeNull();
  expect(state.rankedStartError).toBeNull();
});

test('menu ranked quick-start failures stay on MenuScene and surface the error in the wallet card', async ({
  page,
}) => {
  await installMockWallet(page, 'success');
  await mockRankedStartApi(page, {
    activateError: 'signature signer mismatch',
  });
  await openGame(page, '?muteAudio=1');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  await page.waitForFunction(
    () => {
      const dev = (window as typeof window & {
        __goldMinerDev?: {
          snapshot: () => { menuRankedStartError: string | null };
        };
      }).__goldMinerDev;
      return Boolean(dev?.snapshot().menuRankedStartError);
    },
    undefined,
    { timeout: 15_000 },
  );

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['MenuScene']);
  expect(state.menuRankedStartStage).toBeNull();
  expect(state.menuRankedStartError).toContain('signature signer mismatch');

  const texts = await getSceneTextEntries(page, 'MenuScene');
  expect(texts.some((entry) => entry.text.includes('signature signer mismatch'))).toBe(true);
});

test('starts ranked flow and enters GameplayScene after signing the session permit', async ({
  page,
}) => {
  await installMockWallet(page, 'string-payload-only');
  await mockRankedStartApi(page);
  await openGame(page, '?muteAudio=1');

  await openRankedSceneWithFixture(page);

  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['GameplayScene']);
  expect(state.currentRunLevelId).toBe('diamond_rush_60');
});

test('falls back to object-message typed-data signing for wallets that reject serialized JSON payloads', async ({
  page,
}) => {
  await installMockWallet(page, 'object-message-only');
  await mockRankedStartApi(page);
  await openGame(page, '?muteAudio=1');

  await openRankedSceneWithFixture(page);

  await page.keyboard.press('Enter');
  await waitForScene(page, 'GameplayScene');

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['GameplayScene']);
  expect(state.currentRunLevelId).toBe('diamond_rush_60');
});

test('clicking the ranked start button enters GameplayScene on mainstream injected wallets', async ({
  page,
}) => {
  test.setTimeout(30_000);

  await installMockWallet(page, 'string-payload-only');
  await mockRankedStartApi(page);
  await openGame(page, '?muteAudio=1');

  await openRankedSceneWithFixture(page);

  const canvas = page.locator('canvas');
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();

  const bounds = await getNamedSceneBounds(page, 'RankedScene');
  const startButton = bounds.find((entry) => entry.name === 'ranked.actions.start');
  expect(startButton).toBeDefined();

  const scaleX = (canvasBox?.width ?? 0) / 320;
  const scaleY = (canvasBox?.height ?? 0) / 240;
  await canvas.click({
    position: {
      x: (startButton!.x + startButton!.width / 2) * scaleX,
      y: (startButton!.y + startButton!.height / 2) * scaleY,
    },
  });
  await waitForScene(page, 'GameplayScene');

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['GameplayScene']);
  expect(state.currentRunLevelId).toBe('diamond_rush_60');
});

test('clicking the ranked briefing start button enters GameplayScene like Enter', async ({
  page,
}) => {
  await openGame(page, '?muteAudio=1');
  await openRankedBriefingScene(page);

  const bounds = await getNamedSceneBounds(page, 'GoalScene');
  expect(bounds.some((entry) => entry.name === 'goal.ranked.actions.start')).toBe(true);
  expect(bounds.some((entry) => entry.name === 'goal.ranked.actions.back')).toBe(true);

  await clickNamedSceneEntry(page, 'GoalScene', 'goal.ranked.actions.start');
  await waitForScene(page, 'GameplayScene');

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['GameplayScene']);
  expect(state.currentRunLevelId).toBe('diamond_rush_60');
});

test('starts ranked flow with wasm runtime artifacts available', async ({
  page,
}) => {
  test.setTimeout(30_000);

  await installMockWallet(page, 'string-payload-only');
  await mockRankedStartApi(page);
  await openGame(page, '?muteAudio=1');

  await page.evaluate(async () => {
    const [{ prepareRankedRun }, { SCENE_KEYS }] = await Promise.all([
      import('/src/game/rankedStart.ts'),
      import('/src/game/sceneKeys.ts'),
    ]);

    const run = await prepareRankedRun();
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: {
          getScene: (key: string) => {
            scene?: {
              start: (key: string, payload?: Record<string, unknown>) => void;
            };
          };
        };
      };
    }).__goldMinerGame;

    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }

    const menuScene = game.scene.getScene(SCENE_KEYS.Menu);
    menuScene.scene?.start(SCENE_KEYS.Gameplay, { run });
  });

  await page.waitForFunction(() => {
    const devtools = (window as typeof window & {
      __goldMinerDev?: {
        snapshot: () => {
          rankedWasm: {
            supported: boolean;
          };
        };
      };
    }).__goldMinerDev;

    return devtools?.snapshot().rankedWasm.supported === true;
  });

  await waitForScene(page, 'GameplayScene');

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['GameplayScene']);
  expect(state.currentRunLevelId).toBe('diamond_rush_60');
  expect(state.rankedWasm.supported).toBe(true);
  expect(state.rankedWasm.reason).toBe('available');
});

test('enters GameplayScene with authoritative ranked runtime enabled', async ({
  page,
}) => {
  test.setTimeout(30_000);

  await installMockWallet(page, 'string-payload-only');
  await mockRankedStartApi(page);
  await openGame(page, '?muteAudio=1');

  await page.evaluate(async () => {
    const [{ prepareRankedRun }, { SCENE_KEYS }] = await Promise.all([
      import('/src/game/rankedStart.ts'),
      import('/src/game/sceneKeys.ts'),
    ]);

    const run = await prepareRankedRun();
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: {
          getScene: (key: string) => {
            scene?: {
              start: (key: string, payload?: Record<string, unknown>) => void;
            };
          };
        };
      };
    }).__goldMinerGame;

    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }

    const menuScene = game.scene.getScene(SCENE_KEYS.Menu);
    menuScene.scene?.start(SCENE_KEYS.Gameplay, { run });
  });

  await waitForScene(page, 'GameplayScene');
  await focusGameCanvas(page);

  await page.waitForFunction(() => {
    const devtools = (window as typeof window & {
      __goldMinerDev?: {
        snapshot: () => {
          rankedRuntimeMode: 'shadow' | 'authoritative';
          rankedWasm: {
            supported: boolean;
          };
          currentRunLevelId: string | null;
        };
      };
    }).__goldMinerDev;

    const snapshot = devtools?.snapshot();
    return Boolean(
      snapshot?.rankedRuntimeMode === 'authoritative' &&
        snapshot.rankedWasm.supported &&
        snapshot.currentRunLevelId === 'diamond_rush_60',
    );
  });

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['GameplayScene']);
  expect(state.currentRunLevelId).toBe('diamond_rush_60');
  expect(state.rankedRuntimeMode).toBe('authoritative');
  expect(state.rankedWasm.supported).toBe(true);
});

test('accepts fire input in authoritative ranked runtime without crashing', async ({
  page,
}) => {
  test.setTimeout(30_000);

  await installMockWallet(page, 'string-payload-only');
  await mockRankedStartApi(page);
  await openGame(page, '?muteAudio=1');

  await page.evaluate(async () => {
    const [{ prepareRankedRun }, { SCENE_KEYS }] = await Promise.all([
      import('/src/game/rankedStart.ts'),
      import('/src/game/sceneKeys.ts'),
    ]);

    const run = await prepareRankedRun();
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: {
          getScene: (key: string) => {
            scene?: {
              start: (key: string, payload?: Record<string, unknown>) => void;
            };
          };
        };
      };
    }).__goldMinerGame;

    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }

    const menuScene = game.scene.getScene(SCENE_KEYS.Menu);
    menuScene.scene?.start(SCENE_KEYS.Gameplay, { run });
  });

  await waitForScene(page, 'GameplayScene');
  await focusGameCanvas(page);
  await page.keyboard.press('ArrowDown');

  const postInputState = await page.evaluate(() => {
    const devtools = (window as typeof window & {
      __goldMinerDev?: {
        snapshot: () => {
          activeScenes: string[];
          rankedRuntimeMode: 'shadow' | 'authoritative';
          rankedWasm: {
            supported: boolean;
          };
        };
      };
    }).__goldMinerDev;

    return devtools?.snapshot() ?? null;
  });

  expect(postInputState).not.toBeNull();
  expect(postInputState?.activeScenes).toEqual(['GameplayScene']);
  expect(postInputState?.rankedRuntimeMode).toBe('authoritative');
  expect(postInputState?.rankedWasm.supported).toBe(true);
});

test('reaches the ranked result scene under authoritative runtime', async ({
  page,
}) => {
  test.setTimeout(30_000);

  await installMockWallet(page, 'string-payload-only');
  await mockRankedStartApi(page);
  await openGame(page, '?muteAudio=1&forceGoalReached=1');

  await page.evaluate(async () => {
    const [{ prepareRankedRun }, { SCENE_KEYS }] = await Promise.all([
      import('/src/game/rankedStart.ts'),
      import('/src/game/sceneKeys.ts'),
    ]);

    const run = await prepareRankedRun();
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: {
          getScene: (key: string) => {
            scene?: {
              start: (key: string, payload?: Record<string, unknown>) => void;
            };
          };
        };
      };
    }).__goldMinerGame;

    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }

    const menuScene = game.scene.getScene(SCENE_KEYS.Menu);
    menuScene.scene?.start(SCENE_KEYS.Gameplay, { run });
  });

  await waitForScene(page, 'ResultScene', 20_000);
  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['ResultScene']);
  expect(state.rankedRuntimeMode).toBe('authoritative');
  expect(state.rankedWasm.supported).toBe(true);
});

test('keeps authoritative ranked summary stable from input through result', async ({
  page,
}) => {
  test.setTimeout(30_000);

  await installMockWallet(page, 'string-payload-only');
  await mockRankedStartApi(page);
  await openGame(page, '?muteAudio=1');

  await page.evaluate(async () => {
    const [{ prepareRankedRun }, { SCENE_KEYS }] = await Promise.all([
      import('/src/game/rankedStart.ts'),
      import('/src/game/sceneKeys.ts'),
    ]);

    const run = await prepareRankedRun();
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: {
          getScene: (key: string) => {
            scene?: {
              start: (key: string, payload?: Record<string, unknown>) => void;
            };
          };
        };
      };
    }).__goldMinerGame;

    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }

    const menuScene = game.scene.getScene(SCENE_KEYS.Menu);
    menuScene.scene?.start(SCENE_KEYS.Gameplay, { run });
  });

  await waitForScene(page, 'GameplayScene');
  await focusGameCanvas(page);
  await page.keyboard.press('ArrowDown');

  await page.evaluate(async () => {
    const [{ gameState }] = await Promise.all([import('/src/game/gameState.ts')]);
    gameState.updateDebugFlags({ forceGoalReached: true });
  });

  await waitForScene(page, 'ResultScene', 20_000);

  const runtimeSnapshot = await page.evaluate(() => {
    const devtools = (window as typeof window & {
      __goldMinerDev?: {
        snapshot: () => {
          rankedRuntimeMode: 'shadow' | 'authoritative';
          rankedRuntimeFinalized: {
            logicTick: number;
            diamondsCaught: number;
            lastDiamondTick: number;
            finishedTick: number;
            durationMs: number;
          } | null;
        };
      };
      __goldMinerResultPayload?: Record<string, unknown>;
    }).__goldMinerDev;

    return devtools?.snapshot() ?? null;
  });

  const resultPayload = await page.evaluate(() => {
    return (window as typeof window & {
      __goldMinerResultPayload?: {
        rankedEvidence?: {
          finishedTick: number;
          summary: {
            diamondsCaught: number;
            lastDiamondTick: number;
          };
        } | null;
        rankedRuntimeSummary?: {
          logicTick: number;
          diamondsCaught: number;
          lastDiamondTick: number;
          finishedTick: number;
          durationMs: number;
        } | null;
      };
    }).__goldMinerResultPayload ?? null;
  });

  expect(runtimeSnapshot).not.toBeNull();
  expect(runtimeSnapshot?.rankedRuntimeMode).toBe('authoritative');
  expect(runtimeSnapshot?.rankedRuntimeFinalized).not.toBeNull();
  expect(runtimeSnapshot?.rankedRuntimeFinalized?.logicTick).toBeGreaterThan(0);
  expect(resultPayload?.rankedEvidence).not.toBeNull();
  expect(resultPayload?.rankedRuntimeSummary).not.toBeNull();
  expect(resultPayload?.rankedEvidence?.finishedTick).toBe(
    runtimeSnapshot?.rankedRuntimeFinalized?.finishedTick,
  );
  expect(resultPayload?.rankedEvidence?.summary.diamondsCaught).toBe(
    runtimeSnapshot?.rankedRuntimeFinalized?.diamondsCaught,
  );
  expect(resultPayload?.rankedEvidence?.summary.lastDiamondTick).toBe(
    runtimeSnapshot?.rankedRuntimeFinalized?.lastDiamondTick,
  );
  expect(resultPayload?.rankedRuntimeSummary?.logicTick).toBe(
    runtimeSnapshot?.rankedRuntimeFinalized?.logicTick,
  );
  expect(resultPayload?.rankedRuntimeSummary?.finishedTick).toBe(
    runtimeSnapshot?.rankedRuntimeFinalized?.finishedTick,
  );
});

test('keeps ranked authoritative time moving while the window is unfocused', async ({
  page,
}) => {
  test.setTimeout(30_000);

  await installMockWallet(page, 'string-payload-only');
  await mockRankedStartApi(page);
  await openGame(page, '?muteAudio=1');

  await page.evaluate(async () => {
    const [{ prepareRankedRun }, { SCENE_KEYS }] = await Promise.all([
      import('/src/game/rankedStart.ts'),
      import('/src/game/sceneKeys.ts'),
    ]);

    const run = await prepareRankedRun();
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: {
          getScene: (key: string) => {
            scene?: {
              start: (key: string, payload?: Record<string, unknown>) => void;
            };
          };
        };
      };
    }).__goldMinerGame;

    if (!game) {
      throw new Error('Missing window.__goldMinerGame in DEV mode.');
    }

    const menuScene = game.scene.getScene(SCENE_KEYS.Menu);
    menuScene.scene?.start(SCENE_KEYS.Gameplay, { run });
  });

  await waitForScene(page, 'GameplayScene');
  await focusGameCanvas(page);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(120);

  const before = await snapshot(page);
  await simulateBackgroundElapsed(page, 1_000);
  await page.waitForTimeout(50);
  const after = await snapshot(page);
  const runtimeProbe = await page.evaluate(() => {
    const game = (window as typeof window & {
      __goldMinerGame?: {
        scene: {
          getScene: (key: string) => Record<string, unknown>;
        };
      };
    }).__goldMinerGame;

    if (!game) {
      return null;
    }

    const scene = game.scene.getScene('GameplayScene') as {
      run?: { timeRemainingSec?: number; rankedContext?: { logicTick?: number } } | null;
      scoreTimerSystem?: {
        snapshot?: {
          timeRemainingSec?: number;
        };
      } | null;
      rankedDiamondRushController?: {
        getAuthoritativeDebugState?: () => {
          logicTick: number;
        } | null;
      } | null;
    };

    return {
      runTimeRemainingSec: scene.run?.timeRemainingSec ?? null,
      runLogicTick: scene.run?.rankedContext?.logicTick ?? null,
      timerTimeRemainingSec: scene.scoreTimerSystem?.snapshot?.timeRemainingSec ?? null,
      authoritativeLogicTick:
        scene.rankedDiamondRushController?.getAuthoritativeDebugState?.()?.logicTick ?? null,
    };
  });

  expect(after.currentRunTimeRemainingSec).not.toBeNull();
  expect(before.currentRunTimeRemainingSec).not.toBeNull();
  expect(
    after.currentRunTimeRemainingSec!,
    JSON.stringify({
      beforeTime: before.currentRunTimeRemainingSec,
      afterTime: after.currentRunTimeRemainingSec,
      beforeLogicTick: before.rankedRuntime?.logicTick ?? null,
      afterLogicTick: after.rankedRuntime?.logicTick ?? null,
      runtimeProbe,
    }),
  ).toBeLessThan(before.currentRunTimeRemainingSec!);
  expect(before.gameplayLayout?.hookTip).not.toBeNull();
  expect(after.gameplayLayout?.hookTip).not.toBeNull();
  expect(after.gameplayLayout?.hookTip).not.toEqual(before.gameplayLayout?.hookTip);
  expect(after.rankedRuntime?.logicTick ?? 0).toBeGreaterThan(
    before.rankedRuntime?.logicTick ?? 0,
  );
  expect(runtimeProbe).not.toBeNull();
});

test('recovers from activate session failures and surfaces backend error details', async ({
  page,
}) => {
  await installMockWallet(page, 'success');
  await mockRankedStartApi(page, {
    activateError: 'signature signer mismatch',
  });
  await openGame(page, '?muteAudio=1');

  await openRankedSceneWithFixture(page);

  await page.keyboard.press('Enter');

  await page.waitForFunction(
    () => {
      const dev = (window as typeof window & {
        __goldMinerDev?: { snapshot: () => { rankedStartError: string | null } };
      }).__goldMinerDev;
      return Boolean(dev?.snapshot().rankedStartError);
    },
    undefined,
    { timeout: 15_000 },
  );

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['RankedScene']);
  expect(state.rankedStartStage).toBeNull();
  expect(state.rankedStartError).toContain('signature signer mismatch');

  const texts = await getSceneTextEntries(page, 'RankedScene');
  expect(texts.some((entry) => entry.text.includes('再来一局'))).toBe(true);
});

test('times out a hanging typed-data signature and restores the start button', async ({
  page,
}) => {
  test.setTimeout(70_000);

  await installMockWallet(page, 'hang');
  await mockRankedStartApi(page);
  await openGame(page, '?muteAudio=1');

  await openRankedSceneWithFixture(page);

  await page.keyboard.press('Enter');

  await page.waitForFunction(
    () => {
      const dev = (window as typeof window & {
        __goldMinerDev?: { snapshot: () => { rankedStartError: string | null } };
      }).__goldMinerDev;
      const error = dev?.snapshot().rankedStartError ?? '';
      return error.includes('钱包签名超时');
    },
    undefined,
    { timeout: 40_000 },
  );

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['RankedScene']);
  expect(state.rankedStartStage).toBeNull();
  expect(state.rankedStartError).toContain('钱包签名超时');

  const texts = await getSceneTextEntries(page, 'RankedScene');
  expect(texts.some((entry) => entry.text.includes('再来一局'))).toBe(true);
});
