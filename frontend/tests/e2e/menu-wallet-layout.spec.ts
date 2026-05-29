import { expect, test } from '@playwright/test';

import {
  getNamedSceneBounds,
  getSceneTextEntries,
  installMockWallet,
  MOCK_RANKED_CHALLENGE,
  openGame,
  prepareCleanStorage,
} from './helpers';

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function right(bounds: Bounds): number {
  return bounds.x + bounds.width;
}

function bottom(bounds: Bounds): number {
  return bounds.y + bounds.height;
}

function centerX(bounds: Bounds): number {
  return bounds.x + bounds.width / 2;
}

function centerY(bounds: Bounds): number {
  return bounds.y + bounds.height / 2;
}

function toBoundsMap(
  entries: Array<Bounds & { name: string }>,
): Record<string, Bounds> {
  return Object.fromEntries(
    entries.map((entry) => [
      entry.name,
      {
        x: entry.x,
        y: entry.y,
        width: entry.width,
        height: entry.height,
      },
    ]),
  );
}

async function clickNamedBoundsEntry(
  page: import('@playwright/test').Page,
  sceneKey: string,
  entryName: string,
): Promise<void> {
  const canvas = page.locator('canvas');
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();

  const bounds = (await getNamedSceneBounds(page, sceneKey)).find(
    (entry) => entry.name === entryName,
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

test.beforeEach(async ({ page }) => {
  await prepareCleanStorage(page);
});

test('keeps the homepage menu compact in the lower-left area with five aligned primary buttons', async ({
  page,
}) => {
  await openGame(page, '?muteAudio=1');

  const bounds = toBoundsMap(
    (await getNamedSceneBounds(page, 'MenuScene')).filter(
      (entry) => entry.visible && entry.alpha > 0,
    ),
  );

  const experiencePrimary = bounds['menu.entry.experience.primary'];
  const adventurePrimary = bounds['menu.entry.adventure.primary'];
  const adventureCenterPrimary = bounds['menu.entry.adventure-center.primary'];
  const rankedPrimary = bounds['menu.entry.ranked.primary'];
  const rankedCenterPrimary = bounds['menu.entry.ranked-center.primary'];

  expect(experiencePrimary).toBeDefined();
  expect(adventurePrimary).toBeDefined();
  expect(adventureCenterPrimary).toBeDefined();
  expect(rankedPrimary).toBeDefined();
  expect(rankedCenterPrimary).toBeDefined();
  expect(bounds['menu.home.controls']).toBeUndefined();

  expect(experiencePrimary.width).toBeLessThanOrEqual(98);
  expect(experiencePrimary.x).toBeGreaterThanOrEqual(21);
  expect(experiencePrimary.x).toBeLessThanOrEqual(25);
  expect(experiencePrimary.y).toBeGreaterThanOrEqual(128);
  expect(experiencePrimary.y).toBeLessThanOrEqual(134);
  expect(right(experiencePrimary)).toBeLessThanOrEqual(124);
  expect(right(adventurePrimary)).toBeLessThanOrEqual(124);
  expect(right(adventureCenterPrimary)).toBeLessThanOrEqual(124);
  expect(right(rankedPrimary)).toBeLessThanOrEqual(124);
  expect(right(rankedCenterPrimary)).toBeLessThanOrEqual(124);

  expect(adventurePrimary.y).toBeGreaterThan(experiencePrimary.y);
  expect(adventureCenterPrimary.y).toBeGreaterThan(adventurePrimary.y);
  expect(rankedPrimary.y).toBeGreaterThan(adventurePrimary.y);
  expect(rankedCenterPrimary.y).toBeGreaterThan(rankedPrimary.y);
  expect(bottom(rankedCenterPrimary)).toBeLessThanOrEqual(220);
});

test('keeps the menu wallet status card compact and anchored in the top-right corner', async ({
  page,
}) => {
  await openGame(page, '?muteAudio=1');

  const bounds = toBoundsMap(
    (await getNamedSceneBounds(page, 'MenuScene')).filter(
      (entry) => entry.visible && entry.alpha > 0,
    ),
  );

  const requiredNames = [
    'menu.wallet.panel',
    'menu.wallet.badge',
    'menu.wallet.status',
    'menu.wallet.action',
  ];

  requiredNames.forEach((name) => {
    expect(bounds[name], `missing bounds for ${name}`).toBeDefined();
  });

  const panel = bounds['menu.wallet.panel'];
  const button = bounds['menu.wallet.action'];
  const badge = bounds['menu.wallet.badge'];
  const status = bounds['menu.wallet.status'];

  expect(panel.width).toBeGreaterThanOrEqual(94);
  expect(panel.width).toBeLessThanOrEqual(98);
  expect(panel.height).toBeGreaterThanOrEqual(17);
  expect(panel.height).toBeLessThanOrEqual(19);
  expect(right(panel)).toBeGreaterThanOrEqual(315);
  expect(right(panel)).toBeLessThanOrEqual(318);
  expect(panel.y).toBeGreaterThanOrEqual(4);
  expect(panel.y).toBeLessThanOrEqual(6);

  expect(button.x).toBeGreaterThanOrEqual(panel.x + 70);
  expect(button.y).toBeGreaterThanOrEqual(panel.y + 3);
  expect(button.y).toBeLessThanOrEqual(panel.y + 6);
  expect(right(button)).toBeLessThanOrEqual(right(panel) - 4);
  expect(bottom(button)).toBeLessThanOrEqual(bottom(panel) - 4);

  expect(badge.x).toBeGreaterThanOrEqual(panel.x + 4);
  expect(status.x).toBeGreaterThan(badge.x);
  expect(Math.abs(status.y - badge.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(centerY(status) - centerY(button))).toBeLessThanOrEqual(3);
  expect(button.x).toBeGreaterThan(right(status) + 2);
});

test('only grows the menu wallet card by one line when a wallet error is shown', async ({
  page,
}) => {
  await openGame(page, '?muteAudio=1');

  const compactBounds = toBoundsMap(
    (await getNamedSceneBounds(page, 'MenuScene')).filter(
      (entry) => entry.visible && entry.alpha > 0,
    ),
  );

  const compactPanel = compactBounds['menu.wallet.panel'];

  await page.evaluate(async () => {
    const { web3State } = await import('/src/game/web3State.ts');
    (
      web3State as unknown as {
        updateState?: (nextState: unknown) => void;
        state?: unknown;
      }
    ).updateState?.call(web3State, {
      walletAvailable: true,
      connectionStatus: 'error',
      address: null,
      chainId: null,
      isSupportedChain: false,
      playerProfile: null,
      rankedBoardState: null,
      inventory: null,
      lastError: '请安装兼容钱包',
    });
  });

  const errorBounds = toBoundsMap(
    (await getNamedSceneBounds(page, 'MenuScene')).filter(
      (entry) => entry.visible && entry.alpha > 0,
    ),
  );

  const errorPanel = errorBounds['menu.wallet.panel'];
  const errorText = errorBounds['menu.wallet.error'];

  expect(errorText).toBeDefined();
  expect(errorPanel.x).toBe(compactPanel.x);
  expect(errorPanel.y).toBe(compactPanel.y);
  expect(errorPanel.height).toBeGreaterThan(compactPanel.height);
  expect(errorPanel.height).toBeLessThanOrEqual(compactPanel.height + 16);
  expect(bottom(errorText)).toBeLessThanOrEqual(bottom(errorPanel) - 2);
  expect(errorBounds['menu.wallet.action'].x).toBeGreaterThanOrEqual(errorPanel.x + 70);
  expect(bottom(errorBounds['menu.wallet.action'])).toBeLessThanOrEqual(bottom(errorPanel) - 4);
});

test('shows disconnect for connected wallets even when the current chain is unsupported', async ({
  page,
}) => {
  await openGame(page, '?muteAudio=1');

  await page.evaluate(async () => {
    const { web3State } = await import('/src/game/web3State.ts');
    (
      web3State as unknown as {
        updateState?: (nextState: unknown) => void;
      }
    ).updateState?.call(web3State, {
      walletAvailable: true,
      connectionStatus: 'connected',
      address: '0x15d3A7a8c3D68a3C0A0F0d6Da3C0a0F08A85A85A',
      chainId: 1,
      isSupportedChain: false,
      playerProfile: null,
      rankedBoardState: null,
      inventory: null,
      lastError: null,
    });
  });

  const texts = await getSceneTextEntries(page, 'MenuScene');

  expect(texts.some((entry) => entry.visible && entry.text === '断开')).toBe(true);
  expect(texts.some((entry) => entry.visible && entry.text === '切链')).toBe(false);
  expect(texts.some((entry) => entry.visible && entry.text === '无钱包')).toBe(false);
});

test('disconnect button clears local wallet state and reconnect button can connect again', async ({
  page,
}) => {
  await installMockWallet(page, 'success');
  await openGame(page, '?muteAudio=1');

  await page.evaluate(async ({ challenge }) => {
    const { web3State } = await import('/src/game/web3State.ts');
    (
      web3State as unknown as {
        updateState?: (nextState: unknown) => void;
      }
    ).updateState?.call(web3State, {
      walletAvailable: true,
      connectionStatus: 'connected',
      address: '0x15d3A7a8c3D68a3C0A0F0d6Da3C0a0F08A85A85A',
      chainId: 31337,
      isSupportedChain: true,
      playerProfile: {
        address: '0x15d3A7a8c3D68a3C0A0F0d6Da3C0a0F08A85A85A',
        bestDiamondsCaught: 4,
      },
      rankedBoardState: {
        chainId: 31337,
        currentChallenge: {
          ...challenge,
        },
      },
      inventory: {
        consumables: [],
      },
      lastError: null,
    });
  }, { challenge: MOCK_RANKED_CHALLENGE });

  await clickNamedBoundsEntry(page, 'MenuScene', 'menu.wallet.action');

  await page.waitForFunction(async () => {
    const { web3State } = await import('/src/game/web3State.ts');
    return web3State.snapshot.address === null;
  });

  const disconnectedSnapshot = await page.evaluate(async () => {
    const { web3State } = await import('/src/game/web3State.ts');
    return web3State.snapshot;
  });

  expect(disconnectedSnapshot.address).toBeNull();
  expect(disconnectedSnapshot.chainId).toBeNull();
  expect(disconnectedSnapshot.isSupportedChain).toBe(false);
  expect(disconnectedSnapshot.playerProfile).toBeNull();
  expect(disconnectedSnapshot.rankedBoardState).toBeNull();
  expect(disconnectedSnapshot.inventory).toBeNull();
  expect(disconnectedSnapshot.lastError).toBeNull();

  let texts = await getSceneTextEntries(page, 'MenuScene');
  expect(texts.some((entry) => entry.visible && entry.text === '连接')).toBe(true);
  expect(texts.some((entry) => entry.visible && entry.text === '断开')).toBe(false);

  await clickNamedBoundsEntry(page, 'MenuScene', 'menu.wallet.action');

  await page.waitForFunction(async () => {
    const { web3State } = await import('/src/game/web3State.ts');
    return Boolean(web3State.snapshot.address);
  });

  const reconnectedSnapshot = await page.evaluate(async () => {
    const { web3State } = await import('/src/game/web3State.ts');
    return web3State.snapshot;
  });

  expect(reconnectedSnapshot.address).toBeTruthy();
  texts = await getSceneTextEntries(page, 'MenuScene');
  expect(texts.some((entry) => entry.visible && entry.text === '断开')).toBe(true);
});
