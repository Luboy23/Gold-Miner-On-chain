/**
 * Legacy ranked simulation reference.
 *
 * This module exists only as a fixture/golden/reference implementation while
 * the authoritative Rust/WASM runtime migration completes. It is intentionally
 * retained for parity tests and deterministic fixture validation, but it is not
 * part of the official ranked runtime path and must not be promoted back into
 * production gameplay as the source of truth.
 */
import { RunRng } from '../systems/RunRng';

export interface RankedSimulationOutcome {
  score: number;
  dynamiteUsed: number;
  caughtCount: number;
  cleared: boolean;
  finishedTick: number;
  durationMs: number;
}

export interface RankedSimulationFixture {
  name: string;
  spec: RankedManifestLevel;
  evidence: RankedRunEvidence;
  expected: RankedSimulationOutcome & {
    questionBags: RankedQuestionBagExpectation[];
  };
}

export interface RankedQuestionBagExpectation {
  index: number;
  mass: number;
  bonus: number;
  rewardKind: CatchRewardKind;
  dynamiteDelta: number;
  grantsStrengthBoost: boolean;
}

export interface RankedManifestLevel {
  levelId: string;
  version: number;
  order: number;
  contentHash: `0x${string}`;
  challengeSeed: `0x${string}`;
  simulationVersion: number;
  logicFps: number;
  timeLimitTicks: number;
  goal: number;
  canonical: RankedLevelCanonical;
}

export interface RankedLevelCanonical {
  simulationVersion: number;
  logicFps: number;
  timeLimitTicks: number;
  goal: number;
  constants: RankedSimulationConstants;
  entityConfigs: Record<string, RankedEntityConfig>;
  levelDefinition: RankedLevelDefinition;
}

export interface RankedSimulationConstants {
  hookOrigin: RankedPoint;
  hookCollisionOffset: number;
  hookMinAngle: number;
  hookMaxAngle: number;
  hookRotateSpeed: number;
  hookMaxLength: number;
  hookGrabSpeed: number;
  hookEmptyReturnSpeed: number;
  hookCollisionRadius: number;
  hookResolveDurationSec: number;
  questionBagExtraDynamiteChance: number;
  maxDynamiteCount: number;
  defaultStrengthMultiplier: number;
  maxStrengthMultiplier: number;
  movingEntityIdleDurationSec: number;
  movingEntityPixelsPerSecond: number;
  movingEntityTurnThreshold: number;
}

export interface RankedPoint {
  x: number;
  y: number;
}

export interface RankedEntityConfig {
  id: string;
  family: RankedEntityFamily;
  mass: number;
  baseBonus: number;
  bonusTier: string;
  collisionRadius: number;
  catchAnchor: {
    xRatio: number;
    yRatio: number;
  };
  displaySize: {
    width: number;
    height: number;
  };
  randomBag: RankedRandomBagConfig | null;
  moving: RankedMovingEntityConfig | null;
  explosive: RankedExplosiveEntityConfig | null;
}

export type RankedEntityFamily =
  | 'static'
  | 'random-bag'
  | 'moving'
  | 'explosive';

export interface RankedRandomBagConfig {
  massMin: number;
  massMax: number;
  bonusBase: number;
  bonusRatioMin: number;
  bonusRatioMax: number;
  extraEffectChance: number;
}

export interface RankedMovingEntityConfig {
  speed: number;
  moveRange: number;
}

export interface RankedExplosiveEntityConfig {
  explosionRadius: number;
}

export interface RankedLevelDefinition {
  id: string;
  group: number;
  theme: string;
  entities: RankedLevelEntitySpawn[];
}

export interface RankedLevelEntitySpawn {
  type: string;
  x: number;
  y: number;
  dir: 'Left' | 'Right' | null;
}

export interface RankedRunEvidence {
  protocolVersion: number;
  simulationVersion: number;
  sessionId: `0x${string}`;
  seasonId: number;
  levelId: string;
  levelVersion: number;
  levelContentHash: `0x${string}`;
  challengeSeed: `0x${string}`;
  clientBuildHash: `0x${string}`;
  logicFps: number;
  finishedTick: number;
  actions: RankedRunAction[];
  summary: {
    score: number;
    dynamiteUsed: number;
    caughtCount: number;
    cleared: boolean;
  };
}

export interface RankedRunAction {
  kind: 'fireHook' | 'useDynamite';
  tick: number;
}

export type CatchRewardKind = 'money' | 'dynamite' | 'strength';

type HookState =
  | 'swinging'
  | 'extending'
  | 'returning-empty'
  | 'returning-loaded';

interface CatchOutcome {
  bonus: number;
  rewardKind: CatchRewardKind;
  dynamiteDelta: number;
  grantsStrengthBoost: boolean;
}

interface HookRuntime {
  state: HookState;
  angleDeg: number;
  length: number;
  rotateRight: boolean;
  caughtEntity: number | null;
}

export interface RankedEntityRuntime {
  active: boolean;
  caught: boolean;
  collisionX: number;
  collisionY: number;
  collisionRadius: number;
  mass: number;
  bonus: number;
  rewardKind: CatchRewardKind;
  dynamiteDelta: number;
  grantsStrengthBoost: boolean;
  kind: RankedEntityRuntimeKind;
}

export type RankedEntityRuntimeKind =
  | { type: 'static' }
  | {
      type: 'moving';
      directionSign: number;
      destinationX: number;
      idleTicksRemaining: number;
      idleTicksPerTurn: number;
      isMoving: boolean;
      moveSpeed: number;
      moveRange: number;
    }
  | {
      type: 'explosive';
      explosionRadius: number;
      hasExploded: boolean;
    };

export function simulateRankedRun(
  evidence: RankedRunEvidence,
  spec: RankedManifestLevel,
): RankedSimulationOutcome {
  assertSupportedEvidence(evidence, spec);

  const runtime = {
    hook: createHook(spec.canonical.constants),
    entities: materializeRankedEntities(spec),
    score: 0,
    dynamiteCount: 0,
    dynamiteUsed: 0,
    caughtCount: 0,
    strengthMultiplier:
      spec.canonical.constants.defaultStrengthMultiplier,
    logicTick: 0,
  };
  const frameSec = 1 / Math.max(1, spec.logicFps);
  let actionIndex = 0;
  let previousTick: number | null = null;

  for (const action of evidence.actions) {
    if (previousTick !== null && action.tick <= previousTick) {
      throw new Error('action ticks must be strictly increasing');
    }
    if (action.tick >= evidence.finishedTick) {
      throw new Error('action tick must be inside the run window');
    }
    previousTick = action.tick;
  }

  while (runtime.logicTick < evidence.finishedTick) {
    if (actionIndex < evidence.actions.length) {
      const action = evidence.actions[actionIndex];

      if (action.tick === runtime.logicTick) {
        if (action.kind === 'fireHook') {
          if (runtime.hook.state !== 'swinging') {
            throw new Error('fireHook is only legal while the hook is swinging');
          }
          runtime.hook.state = 'extending';
        } else {
          if (runtime.dynamiteCount === 0) {
            throw new Error('useDynamite requires available dynamite');
          }
          if (
            runtime.hook.caughtEntity === null ||
            runtime.hook.state !== 'returning-loaded'
          ) {
            throw new Error('useDynamite requires a caught entity');
          }
          runtime.dynamiteCount = Math.max(0, runtime.dynamiteCount - 1);
          runtime.dynamiteUsed += 1;
          useDynamite(runtime.hook, runtime.entities);
        }
        actionIndex += 1;
      }
    }

    const catchOutcome = updateHook(
      runtime.hook,
      frameSec,
      spec,
      runtime.entities,
      runtime.strengthMultiplier,
    );

    for (const entity of runtime.entities) {
      updateEntity(entity, frameSec, spec.canonical.constants);
    }

    if (catchOutcome) {
      runtime.score += catchOutcome.bonus;
      runtime.caughtCount += 1;

      if (catchOutcome.dynamiteDelta > 0) {
        runtime.dynamiteCount = Math.min(
          spec.canonical.constants.maxDynamiteCount,
          runtime.dynamiteCount + catchOutcome.dynamiteDelta,
        );
      }

      if (catchOutcome.grantsStrengthBoost) {
        runtime.strengthMultiplier = Math.min(
          spec.canonical.constants.maxStrengthMultiplier,
          runtime.strengthMultiplier * 1.5 + 1,
        );
      }
    }

    runtime.logicTick += 1;
  }

  return {
    score: runtime.score,
    dynamiteUsed: runtime.dynamiteUsed,
    caughtCount: runtime.caughtCount,
    cleared:
      runtime.logicTick === spec.timeLimitTicks && runtime.score >= spec.goal,
    finishedTick: evidence.finishedTick,
    durationMs: durationMsFromTicks(evidence.finishedTick, spec.logicFps),
  };
}

export function materializeRankedEntities(
  spec: RankedManifestLevel,
): RankedEntityRuntime[] {
  let bagIndex = 0;
  const idleTicksPerTurn = Math.round(
    spec.canonical.constants.movingEntityIdleDurationSec * spec.logicFps,
  );

  return spec.canonical.levelDefinition.entities.map((spawn) => {
    const config = spec.canonical.entityConfigs[spawn.type];

    if (!config) {
      throw new Error(`missing entity config for ${spawn.type}`);
    }

    let mass = config.mass;
    let bonus = config.baseBonus;
    let rewardKind: CatchRewardKind = 'money';
    let dynamiteDelta = 0;
    let grantsStrengthBoost = false;

    if (config.family === 'random-bag') {
      if (!config.randomBag) {
        throw new Error(`missing randomBag config for ${config.id}`);
      }

      const rng = new RunRng(
        `${spec.challengeSeed}:bag:${spec.levelId}:${bagIndex}`,
      );
      bagIndex += 1;
      mass = rng.nextInt(config.randomBag.massMin, config.randomBag.massMax);
      bonus =
        rng.nextInt(
          config.randomBag.bonusRatioMin,
          config.randomBag.bonusRatioMax,
        ) * config.randomBag.bonusBase;

      if (rng.next() <= Math.min(1, config.randomBag.extraEffectChance)) {
        bonus = 0;
        if (
          rng.next() <=
          spec.canonical.constants.questionBagExtraDynamiteChance
        ) {
          rewardKind = 'dynamite';
          dynamiteDelta = 1;
        } else {
          rewardKind = 'strength';
          grantsStrengthBoost = true;
        }
      }
    }

    const collisionPoint =
      config.family === 'moving'
        ? { x: spawn.x, y: spawn.y }
        : {
            x: spawn.x + config.displaySize.width / 2,
            y: spawn.y + config.displaySize.height / 2,
          };

    return {
      active: true,
      caught: false,
      collisionX: collisionPoint.x,
      collisionY: collisionPoint.y,
      collisionRadius: config.collisionRadius,
      mass,
      bonus,
      rewardKind,
      dynamiteDelta,
      grantsStrengthBoost,
      kind: createEntityRuntimeKind(config, spawn, idleTicksPerTurn),
    };
  });
}

function assertSupportedEvidence(
  evidence: RankedRunEvidence,
  spec: RankedManifestLevel,
): void {
  if (evidence.simulationVersion !== spec.simulationVersion) {
    throw new Error('simulationVersion does not match ranked manifest');
  }
  if (evidence.logicFps !== spec.logicFps) {
    throw new Error('logicFps does not match ranked manifest');
  }
  if (
    evidence.levelId !== spec.levelId ||
    evidence.levelVersion !== spec.version
  ) {
    throw new Error('level identity does not match ranked manifest');
  }
  if (evidence.levelContentHash !== spec.contentHash) {
    throw new Error('levelContentHash does not match ranked manifest');
  }
  if (evidence.challengeSeed !== spec.challengeSeed) {
    throw new Error('challengeSeed does not match ranked manifest');
  }
  if (evidence.finishedTick > spec.timeLimitTicks) {
    throw new Error('finishedTick exceeds timeLimitTicks');
  }
}

function createHook(constants: RankedSimulationConstants): HookRuntime {
  return {
    state: 'swinging',
    angleDeg: constants.hookMaxAngle,
    length: 0,
    rotateRight: true,
    caughtEntity: null,
  };
}

function updateHook(
  hook: HookRuntime,
  frameSec: number,
  spec: RankedManifestLevel,
  entities: RankedEntityRuntime[],
  strengthMultiplier: number,
): CatchOutcome | null {
  const constants = spec.canonical.constants;

  if (hook.state === 'swinging') {
    if (Math.abs(hook.angleDeg - constants.hookMaxAngle) < 1) {
      hook.rotateRight = true;
    }
    if (Math.abs(hook.angleDeg - constants.hookMinAngle) < 1) {
      hook.rotateRight = false;
    }

    hook.angleDeg +=
      (hook.rotateRight ? -1 : 1) * frameSec * constants.hookRotateSpeed;
    return null;
  }

  if (hook.state === 'extending') {
    hook.length = Math.min(
      constants.hookMaxLength,
      hook.length + frameSec * constants.hookGrabSpeed,
    );
    const collisionCenter = hookCollisionCenter(hook, constants);
    const hitIndex = entities.findIndex((entity) => {
      if (!entity.active || entity.caught) {
        return false;
      }

      return areCirclesOverlapping(
        entity.collisionX,
        entity.collisionY,
        entity.collisionRadius,
        collisionCenter.x,
        collisionCenter.y,
        constants.hookCollisionRadius,
      );
    });

    if (hitIndex >= 0) {
      const blast = markExplodedIfNeeded(entities[hitIndex]);
      if (blast) {
        applyExplosion(hitIndex, entities, blast.x, blast.y, blast.radius);
      }

      entities[hitIndex].caught = true;
      hook.caughtEntity = hitIndex;
      hook.state = 'returning-loaded';
      return null;
    }

    if (hook.length >= constants.hookMaxLength) {
      hook.state = 'returning-empty';
    }
    return null;
  }

  if (hook.state === 'returning-empty') {
    hook.length = Math.max(
      0,
      hook.length - frameSec * constants.hookEmptyReturnSpeed,
    );
    if (hook.length === 0) {
      hook.state = 'swinging';
      hook.caughtEntity = null;
    }
    return null;
  }

  if (hook.caughtEntity === null) {
    hook.state = 'swinging';
    hook.length = 0;
    return null;
  }

  const caughtEntity = entities[hook.caughtEntity];
  hook.length = Math.max(
    0,
    hook.length -
      (frameSec * constants.hookGrabSpeed * strengthMultiplier) /
        caughtEntity.mass,
  );

  if (hook.length !== 0) {
    return null;
  }

  const outcome = catchOutcome(caughtEntity);
  caughtEntity.active = false;
  caughtEntity.caught = false;
  hook.caughtEntity = null;
  hook.state = 'swinging';
  return outcome;
}

function updateEntity(
  entity: RankedEntityRuntime,
  frameSec: number,
  constants: RankedSimulationConstants,
): void {
  if (!entity.active || entity.caught || entity.kind.type !== 'moving') {
    return;
  }

  if (!entity.kind.isMoving) {
    if (entity.kind.idleTicksRemaining > 0) {
      entity.kind.idleTicksRemaining -= 1;
    }
    if (entity.kind.idleTicksRemaining === 0) {
      entity.kind.isMoving = true;
      entity.kind.idleTicksRemaining = entity.kind.idleTicksPerTurn;
    }
    return;
  }

  const velocity =
    entity.kind.moveSpeed *
    constants.movingEntityPixelsPerSecond *
    frameSec;
  const nextX = entity.collisionX + entity.kind.directionSign * velocity;
  const reachedDestination =
    Math.abs(nextX - entity.kind.destinationX) <=
      constants.movingEntityTurnThreshold ||
    (entity.kind.directionSign < 0 && nextX <= entity.kind.destinationX) ||
    (entity.kind.directionSign > 0 && nextX >= entity.kind.destinationX);

  if (reachedDestination) {
    entity.collisionX = entity.kind.destinationX;
    entity.kind.isMoving = false;
    entity.kind.directionSign *= -1;
    entity.kind.destinationX =
      entity.collisionX + entity.kind.directionSign * entity.kind.moveRange;
    entity.kind.idleTicksRemaining = entity.kind.idleTicksPerTurn;
    return;
  }

  entity.collisionX = nextX;
}

function createEntityRuntimeKind(
  config: RankedEntityConfig,
  spawn: RankedLevelEntitySpawn,
  idleTicksPerTurn: number,
): RankedEntityRuntimeKind {
  if (config.family === 'moving') {
    if (!config.moving || !spawn.dir) {
      throw new Error(`missing moving config for ${config.id}`);
    }

    const directionSign = spawn.dir === 'Left' ? -1 : 1;
    return {
      type: 'moving',
      directionSign,
      destinationX: spawn.x + directionSign * config.moving.moveRange,
      idleTicksRemaining: idleTicksPerTurn,
      idleTicksPerTurn,
      isMoving: true,
      moveSpeed: config.moving.speed,
      moveRange: config.moving.moveRange,
    };
  }

  if (config.family === 'explosive') {
    if (!config.explosive) {
      throw new Error(`missing explosive config for ${config.id}`);
    }

    return {
      type: 'explosive',
      explosionRadius: config.explosive.explosionRadius,
      hasExploded: false,
    };
  }

  return { type: 'static' };
}

function useDynamite(
  hook: HookRuntime,
  entities: RankedEntityRuntime[],
): void {
  if (hook.caughtEntity !== null) {
    const entity = entities[hook.caughtEntity];
    entity.active = false;
    entity.caught = false;
  }

  hook.caughtEntity = null;
  hook.state = 'returning-empty';
}

function markExplodedIfNeeded(
  entity: RankedEntityRuntime,
): { x: number; y: number; radius: number } | null {
  if (
    !entity.active ||
    entity.kind.type !== 'explosive' ||
    entity.kind.hasExploded
  ) {
    return null;
  }

  entity.kind.hasExploded = true;
  return {
    x: entity.collisionX,
    y: entity.collisionY,
    radius: entity.kind.explosionRadius,
  };
}

function applyExplosion(
  index: number,
  entities: RankedEntityRuntime[],
  blastX: number,
  blastY: number,
  radius: number,
): void {
  entities.forEach((entity, otherIndex) => {
    if (otherIndex === index || !entity.active) {
      return;
    }

    if (
      areCirclesOverlapping(
        blastX,
        blastY,
        radius,
        entity.collisionX,
        entity.collisionY,
        entity.collisionRadius,
      )
    ) {
      entity.active = false;
      entity.caught = false;
    }
  });
}

function catchOutcome(entity: RankedEntityRuntime): CatchOutcome {
  return {
    bonus: entity.bonus,
    rewardKind: entity.rewardKind,
    dynamiteDelta: entity.dynamiteDelta,
    grantsStrengthBoost: entity.grantsStrengthBoost,
  };
}

function hookCollisionCenter(
  hook: HookRuntime,
  constants: RankedSimulationConstants,
): RankedPoint {
  const angleRad = (hook.angleDeg * Math.PI) / 180;
  const directionX = -Math.sin(angleRad);
  const directionY = Math.cos(angleRad);

  return {
    x:
      constants.hookOrigin.x +
      directionX * (hook.length + constants.hookCollisionOffset),
    y:
      constants.hookOrigin.y +
      directionY * (hook.length + constants.hookCollisionOffset),
  };
}

function areCirclesOverlapping(
  leftX: number,
  leftY: number,
  leftRadius: number,
  rightX: number,
  rightY: number,
  rightRadius: number,
): boolean {
  const radius = leftRadius + rightRadius;
  const dx = leftX - rightX;
  const dy = leftY - rightY;
  return dx * dx + dy * dy <= radius * radius;
}

function durationMsFromTicks(finishedTick: number, logicFps: number): number {
  return Math.floor((finishedTick * 1000) / Math.max(1, logicFps));
}
