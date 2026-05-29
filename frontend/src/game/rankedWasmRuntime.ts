/**
 * 这一层是前端与 WASM authoritative runtime 之间的最小桥接。
 *
 * facade 的职责不是重做一套本地 ranked 规则，而是把 TS 侧调用收口成稳定接口：
 * step / snapshot / finalize / advanceElapsedTicks。只要前端始终通过 facade 读取
 * authoritative 真值，就不会在 scene 层散落 wasm module 的初始化与错误细节。
 */
import type { RankedChallengeManifestEntry } from './rankedChallengeManifest';
import type { RankedRuntimeMode } from './types/index';
import { getRuntimeConfig } from '../web3/runtime/config';

export interface RankedWasmRuntimeSnapshot {
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
}

export interface RankedWasmRuntimeFinalized {
  logicTick: number;
  diamondsCaught: number;
  lastDiamondTick: number;
  finishedTick: number;
  durationMs: number;
}

export interface RankedRuntimeFacade {
  applyFireHook(tick: number): Promise<boolean>;
  step(): Promise<void>;
  advanceElapsedTicks(ticks: number): Promise<void>;
  snapshot(): Promise<RankedWasmRuntimeSnapshot>;
  finalize(): Promise<RankedWasmRuntimeFinalized>;
}

export interface RankedWasmAvailability {
  supported: boolean;
  reason: 'available' | 'module-missing' | 'init-failed';
}

interface WasmRankedRuntimeModule {
  default: (moduleOrPath?: string | URL | Request) => Promise<unknown>;
  WasmRankedRuntime: new (specJson: string) => {
    apply_fire_hook(tick: number): boolean;
    step(): void;
    advance_elapsed_ticks?(ticks: number): void;
    snapshot_json(): string;
    finalize_json(): string;
  };
}

class BoundRankedRuntimeFacade implements RankedRuntimeFacade {
  private readonly runtime: {
    apply_fire_hook(tick: number): boolean;
    step(): void;
    advance_elapsed_ticks?: (ticks: number) => void;
    snapshot_json(): string;
    finalize_json(): string;
  };

  constructor(runtime: {
    apply_fire_hook(tick: number): boolean;
    step(): void;
    advance_elapsed_ticks?: (ticks: number) => void;
    snapshot_json(): string;
    finalize_json(): string;
  }) {
    this.runtime = runtime;
  }

  async applyFireHook(tick: number): Promise<boolean> {
    return this.runtime.apply_fire_hook(tick);
  }

  async step(): Promise<void> {
    this.runtime.step();
  }

  async advanceElapsedTicks(ticks: number): Promise<void> {
    if (ticks <= 0) {
      return;
    }

    // 老版本 wasm 运行时可能还没导出批量 elapsed 推进接口。这里退回到逐 tick step，
    // 语义上仍然要和“无输入情况下推进若干 tick”保持一致，不能为了省事直接改时间字段。
    if (this.runtime.advance_elapsed_ticks) {
      this.runtime.advance_elapsed_ticks(ticks);
      return;
    }

    for (let index = 0; index < ticks; index += 1) {
      this.runtime.step();
    }
  }

  async snapshot(): Promise<RankedWasmRuntimeSnapshot> {
    return JSON.parse(this.runtime.snapshot_json()) as RankedWasmRuntimeSnapshot;
  }

  async finalize(): Promise<RankedWasmRuntimeFinalized> {
    return JSON.parse(this.runtime.finalize_json()) as RankedWasmRuntimeFinalized;
  }
}

let wasmModulePromise: Promise<WasmRankedRuntimeModule | null> | null = null;
let wasmAvailability: RankedWasmAvailability = {
  supported: false,
  reason: 'module-missing',
};

async function loadWasmModule(): Promise<WasmRankedRuntimeModule | null> {
  if (!wasmModulePromise) {
    // wasm 模块按需懒加载。这里的 availability 既服务功能开关，也服务 UI/测试判断：
    // “module-missing” 和 “init-failed” 都表示 authoritative 不可用，但原因不同。
    const modulePath = '/wasm/goldminer_core.js';
    const nativeImport = new Function(
      'modulePath',
      'return import(modulePath);',
    ) as (path: string) => Promise<unknown>;
    wasmModulePromise = nativeImport(modulePath)
      .then(async (module) => {
        const typedModule = module as WasmRankedRuntimeModule;
        await typedModule.default();
        wasmAvailability = {
          supported: true,
          reason: 'available',
        };
        return typedModule;
      })
      .catch(() => {
        wasmAvailability = {
          supported: false,
          reason: 'module-missing',
        };
        return null;
      });
  }

  return wasmModulePromise;
}

export async function preloadRankedWasmRuntime(): Promise<RankedWasmAvailability> {
  await loadWasmModule();
  return wasmAvailability;
}

export async function createRankedWasmRuntimeFacade(
  spec: RankedChallengeManifestEntry,
): Promise<RankedRuntimeFacade | null> {
  // facade 创建失败时必须显式回落到 null，由上层决定是否进入 shadow/local 模式。
  // 这里不能抛出未处理异常，否则排位启动会在场景初始化阶段直接崩掉。
  const module = await loadWasmModule();

  if (!module) {
    return null;
  }

  try {
    return new BoundRankedRuntimeFacade(
      new module.WasmRankedRuntime(JSON.stringify(spec)),
    );
  } catch {
    wasmAvailability = {
      supported: false,
      reason: 'init-failed',
    };
    return null;
  }
}

export function getRankedWasmAvailability(): RankedWasmAvailability {
  return wasmAvailability;
}

export async function isRankedWasmModuleReady(): Promise<boolean> {
  const module = await loadWasmModule();
  return module !== null;
}

export function getRankedRuntimeMode(): RankedRuntimeMode {
  return getRuntimeConfig().rankedRuntimeMode;
}

export function isAuthoritativeRankedRuntimeEnabled(): boolean {
  return getRankedRuntimeMode() === 'authoritative';
}
