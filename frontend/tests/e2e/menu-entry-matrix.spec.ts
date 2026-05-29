import { expect, test, type Page } from '@playwright/test';

import {
  getNamedSceneBounds,
  getSceneTextEntries,
  installMockWallet,
  MOCK_RANKED_CHALLENGE,
  mockAdventureCenterApi,
  mockRankedStartApi,
  openGame,
  prepareCleanStorage,
  snapshot,
  waitForScene,
} from './helpers';

type WalletStateMode =
  | 'no-wallet'
  | 'wallet-idle'
  | 'wallet-connected-supported'
  | 'wallet-connected-unsupported';

type MenuEntry =
  | '试玩模式'
  | '开始冒险'
  | '冒险中心'
  | '开始排位'
  | '排位中心';

async function clickNamedBoundsEntry(
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

const SUPPORTED_CHALLENGE = MOCK_RANKED_CHALLENGE;

async function selectMenuEntry(page: Page, entry: MenuEntry): Promise<void> {
  if (entry === '试玩模式') {
    return;
  }

  if (entry === '开始冒险') {
    await page.keyboard.press('ArrowDown');
    return;
  }

  if (entry === '冒险中心') {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    return;
  }

  if (entry === '开始排位') {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    return;
  }

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
}

async function seedWalletState(page: Page, mode: WalletStateMode): Promise<void> {
  if (mode === 'no-wallet') {
    return;
  }

  await installMockWallet(page, 'success');

  if (mode === 'wallet-idle') {
    await page.evaluate(async () => {
      const { web3State } = await import('/src/game/web3State.ts');
      web3State.updateState({
        walletAvailable: true,
        connectionStatus: 'idle',
        address: null,
        chainId: null,
        isSupportedChain: false,
        playerProfile: null,
        rankedBoardState: null,
        inventory: null,
        lastError: null,
      });
    });
    return;
  }

  await page.evaluate(
    async ({ supported, challenge }) => {
      const { web3State } = await import('/src/game/web3State.ts');
      web3State.updateState({
        walletAvailable: true,
        connectionStatus: 'connected',
        address: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
        chainId: supported ? 31337 : 1,
        isSupportedChain: supported,
        playerProfile: {
          address: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
          bestDiamondsCaught: 4,
        },
        rankedBoardState: supported
          ? {
              chainId: 31337,
              currentChallenge: challenge,
            }
          : null,
        inventory: {
          consumables: [],
        },
        lastError: null,
      });
    },
    { supported: mode === 'wallet-connected-supported', challenge: SUPPORTED_CHALLENGE },
  );
}

test.beforeEach(async ({ page }) => {
  await prepareCleanStorage(page);
});

test('experience entry always opens the local confirmation modal first', async ({ page }) => {
  await openGame(page, '?muteAudio=1');
  await page.keyboard.press('Enter');

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['MenuScene']);

  const texts = await getSceneTextEntries(page, 'MenuScene');

  expect(texts.some((entry) => entry.visible && entry.text.includes('试玩模式不保存进度'))).toBe(
    true,
  );
  expect(texts.some((entry) => entry.visible && entry.text.includes('不保存进度'))).toBe(true);
});

test('mouse click on experience entry opens the local confirmation modal immediately', async ({
  page,
}) => {
  await openGame(page, '?muteAudio=1');
  await clickNamedBoundsEntry(page, 'MenuScene', 'menu.entry.experience.primary');

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['MenuScene']);

  const texts = await getSceneTextEntries(page, 'MenuScene');
  expect(texts.some((entry) => entry.visible && entry.text.includes('试玩模式不保存进度'))).toBe(
    true,
  );
});

test('mouse click on adventure center primary entry opens the scene directly', async ({
  page,
}) => {
  await mockAdventureCenterApi(page);
  await installMockWallet(page, 'success');
  await openGame(page, '?muteAudio=1');
  await seedWalletState(page, 'wallet-connected-supported');
  await clickNamedBoundsEntry(page, 'MenuScene', 'menu.entry.adventure-center.primary');
  await waitForScene(page, 'AdventureCenterScene');

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['AdventureCenterScene']);
});

test('mouse click on ranked center primary entry opens the scene directly', async ({
  page,
}) => {
  await mockRankedStartApi(page);
  await installMockWallet(page, 'success');
  await openGame(page, '?muteAudio=1');
  await seedWalletState(page, 'wallet-connected-supported');
  await clickNamedBoundsEntry(page, 'MenuScene', 'menu.entry.ranked-center.primary');
  await waitForScene(page, 'RankedScene');

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['RankedScene']);
});

test('mouse click on adventure primary entry matches Enter behavior', async ({ page }) => {
  await mockAdventureCenterApi(page);
  await installMockWallet(page, 'success');
  await openGame(page, '?muteAudio=1');
  await seedWalletState(page, 'wallet-connected-supported');
  await clickNamedBoundsEntry(page, 'MenuScene', 'menu.entry.adventure.primary');
  await waitForScene(page, 'GoalScene');

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['GoalScene']);
});

test('mouse click on ranked primary entry matches Enter behavior', async ({ page }) => {
  await mockRankedStartApi(page);
  await installMockWallet(page, 'string-payload-only');
  await openGame(page, '?muteAudio=1');
  await seedWalletState(page, 'wallet-connected-supported');
  await clickNamedBoundsEntry(page, 'MenuScene', 'menu.entry.ranked.primary');
  await waitForScene(page, 'GameplayScene');

  const state = await snapshot(page);
  expect(state.activeScenes).toEqual(['GameplayScene']);
});

for (const mode of [
  'no-wallet',
  'wallet-idle',
  'wallet-connected-supported',
  'wallet-connected-unsupported',
] as const) {
  test(`开始冒险 in ${mode} uses direct chain-backed start semantics`, async ({ page }) => {
    await mockAdventureCenterApi(page);
    if (mode !== 'no-wallet') {
      await installMockWallet(page, 'success');
    }
    await openGame(page, '?muteAudio=1');
    await seedWalletState(page, mode);
    await selectMenuEntry(page, '开始冒险');
    await page.keyboard.press('Enter');

    if (
      mode === 'wallet-idle' ||
      mode === 'wallet-connected-supported' ||
      mode === 'wallet-connected-unsupported'
    ) {
      await waitForScene(page, 'GoalScene');
      const state = await snapshot(page);
      expect(state.activeScenes).toEqual(['GoalScene']);
      return;
    }

    await page.waitForTimeout(1200);
    const state = await snapshot(page);
    expect(state.activeScenes).toEqual(['MenuScene']);
  });
}

for (const mode of [
  'no-wallet',
  'wallet-idle',
  'wallet-connected-supported',
  'wallet-connected-unsupported',
] as const) {
  test(`开始排位 in ${mode} keeps quick-start behavior on the menu`, async ({ page }) => {
    await mockRankedStartApi(page);
    if (mode !== 'no-wallet') {
      await installMockWallet(page, 'string-payload-only');
    }
    await openGame(page, '?muteAudio=1');
    await seedWalletState(page, mode);
    await selectMenuEntry(page, '开始排位');
    await page.keyboard.press('Enter');

    if (
      mode === 'wallet-idle' ||
      mode === 'wallet-connected-supported' ||
      mode === 'wallet-connected-unsupported'
    ) {
      await waitForScene(page, 'GameplayScene');
      const state = await snapshot(page);
      expect(state.activeScenes).toEqual(['GameplayScene']);
      return;
    }

    await page.waitForTimeout(1200);
    const state = await snapshot(page);
    expect(state.activeScenes).toEqual(['MenuScene']);
  });
}

for (const mode of [
  'no-wallet',
  'wallet-idle',
  'wallet-connected-supported',
  'wallet-connected-unsupported',
] as const) {
  test(`冒险中心 in ${mode} only opens the center after a usable wallet path`, async ({ page }) => {
    await mockAdventureCenterApi(page);
    await openGame(page, '?muteAudio=1');
    await seedWalletState(page, mode);
    await selectMenuEntry(page, '冒险中心');
    await page.keyboard.press('Enter');

    if (
      mode === 'wallet-connected-supported' ||
      mode === 'wallet-connected-unsupported'
    ) {
      await waitForScene(page, 'AdventureCenterScene');
      const state = await snapshot(page);
      expect(state.activeScenes).toEqual(['AdventureCenterScene']);
      return;
    }

    await page.waitForTimeout(1200);
    const state = await snapshot(page);
    expect(state.activeScenes).toEqual(['MenuScene']);
  });
}

for (const mode of [
  'no-wallet',
  'wallet-idle',
  'wallet-connected-supported',
  'wallet-connected-unsupported',
] as const) {
  test(`排位中心 in ${mode} always opens the center scene without direct signing`, async ({
    page,
  }) => {
    await mockRankedStartApi(page);
    if (mode !== 'no-wallet') {
      await installMockWallet(page, 'success');
    }
    await openGame(page, '?muteAudio=1');
    await seedWalletState(page, mode);
    await selectMenuEntry(page, '排位中心');
    await page.keyboard.press('Enter');
    await waitForScene(page, 'RankedScene');

    const state = await snapshot(page);
    expect(state.activeScenes).toEqual(['RankedScene']);
    expect(state.rankedStartStage).toBeNull();
  });
}
