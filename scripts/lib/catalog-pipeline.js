const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

const rootDir = path.resolve(__dirname, "..", "..");
const frontendDir = path.join(rootDir, "frontend");
const ts = require(path.join(frontendDir, "node_modules", "typescript"));

const rankedManifestOutputPath = path.join(
  rootDir,
  "frontend",
  "public",
  "ranked-challenge-manifest.json",
);
const adventureManifestOutputPath = path.join(
  rootDir,
  "frontend",
  "public",
  "adventure-level-manifest.json",
);
const registryOutputPath = path.join(
  rootDir,
  "contracts",
  "config",
  "ranked-levels.json",
);

const moduleCache = new Map();
const RANKED_CHALLENGE_ID = "diamond_rush_60";
const RANKED_CHALLENGE_VERSION = 1;
const RANKED_CHALLENGE_THEME = "LevelD";
const RANKED_SPAWN_POINTS = [
  { x: 56, y: 72 },
  { x: 106, y: 86 },
  { x: 214, y: 78 },
  { x: 276, y: 96 },
  { x: 74, y: 120 },
  { x: 160, y: 112 },
  { x: 244, y: 128 },
  { x: 108, y: 156 },
  { x: 206, y: 164 },
  { x: 58, y: 186 },
  { x: 156, y: 198 },
  { x: 268, y: 208 },
];

function sortObjectDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortObjectDeep);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortObjectDeep(value[key])]),
  );
}

function digestHex(value) {
  return `0x${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function resolveTsModule(fromFile, specifier) {
  const candidateBase = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    candidateBase,
    `${candidateBase}.ts`,
    `${candidateBase}.js`,
    path.join(candidateBase, "index.ts"),
    path.join(candidateBase, "index.js"),
    `${candidateBase}.json`,
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Cannot resolve ${specifier} from ${fromFile}`);
}

function loadTsModule(filePath) {
  const resolvedPath = path.resolve(filePath);

  if (moduleCache.has(resolvedPath)) {
    return moduleCache.get(resolvedPath);
  }

  if (resolvedPath.endsWith(".json")) {
    const json = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    moduleCache.set(resolvedPath, json);
    return json;
  }

  const source = fs.readFileSync(resolvedPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      resolveJsonModule: true,
    },
    fileName: resolvedPath,
  });

  const module = { exports: {} };
  moduleCache.set(resolvedPath, module.exports);

  const localRequire = (specifier) => {
    if (specifier.startsWith(".")) {
      return loadTsModule(resolveTsModule(resolvedPath, specifier));
    }

    return require(require.resolve(specifier, { paths: [frontendDir, rootDir] }));
  };

  const wrapped = `(function (exports, require, module, __filename, __dirname) {${outputText}\n})`;
  const runner = vm.runInThisContext(wrapped, { filename: resolvedPath });
  runner(module.exports, localRequire, module, resolvedPath, path.dirname(resolvedPath));
  moduleCache.set(resolvedPath, module.exports);
  return module.exports;
}

function compareLevelIds(left, right) {
  const [, leftGroup] = left.match(/^L(\d+)$/) || [];
  const [, rightGroup] = right.match(/^L(\d+)$/) || [];

  return Number(leftGroup) - Number(rightGroup);
}

function normalizeEntityConfigs(entityConfigs, displaySizes) {
  return Object.fromEntries(
    Object.keys(entityConfigs)
      .sort()
      .map((entityType) => {
        const config = entityConfigs[entityType];
        return [
          entityType,
          {
            id: config.id,
            family: config.family,
            mass: config.mass,
            baseBonus: config.baseBonus,
            bonusTier: config.bonusTier,
            collisionRadius: config.collisionRadius,
            catchAnchor: {
              xRatio: config.catchAnchor.xRatio,
              yRatio: config.catchAnchor.yRatio,
            },
            displaySize: {
              width: displaySizes[config.textureKey].width,
              height: displaySizes[config.textureKey].height,
            },
            randomBag: config.randomBag
              ? {
                  massMin: config.randomBag.massMin,
                  massMax: config.randomBag.massMax,
                  bonusBase: config.randomBag.bonusBase,
                  bonusRatioMin: config.randomBag.bonusRatioMin,
                  bonusRatioMax: config.randomBag.bonusRatioMax,
                  extraEffectChance: config.randomBag.extraEffectChance,
                }
              : null,
            moving: config.moving
              ? {
                  speed: config.moving.speed,
                  moveRange: config.moving.moveRange,
                }
              : null,
            explosive: config.explosive
              ? {
                  explosionRadius: config.explosive.explosionRadius,
                }
              : null,
          },
        ];
      }),
  );
}

function buildRankedConstants(constantsModule) {
  return {
    hookOrigin: constantsModule.HOOK_ORIGIN,
    hookCollisionOffset: constantsModule.HOOK_COLLISION_OFFSET,
    hookMinAngle: constantsModule.HOOK_MIN_ANGLE,
    hookMaxAngle: constantsModule.HOOK_MAX_ANGLE,
    hookRotateSpeed: constantsModule.HOOK_ROTATE_SPEED,
    hookMaxLength: constantsModule.HOOK_MAX_LENGTH,
    hookGrabSpeed: constantsModule.HOOK_GRAB_SPEED,
    hookEmptyReturnSpeed: constantsModule.HOOK_EMPTY_RETURN_SPEED,
    hookCollisionRadius: constantsModule.HOOK_COLLISION_RADIUS,
    hookResolveDurationSec: constantsModule.HOOK_RESOLVE_DURATION_SEC,
    questionBagExtraDynamiteChance:
      constantsModule.QUESTION_BAG_EXTRA_DYNAMITE_CHANCE,
    maxDynamiteCount: constantsModule.MAX_DYNAMITE_COUNT,
    defaultStrengthMultiplier: constantsModule.DEFAULT_STRENGTH_MULTIPLIER,
    maxStrengthMultiplier: constantsModule.MAX_STRENGTH_MULTIPLIER,
    movingEntityIdleDurationSec: constantsModule.MOVING_ENTITY_IDLE_DURATION_SEC,
    movingEntityPixelsPerSecond:
      constantsModule.MOVING_ENTITY_PIXELS_PER_SECOND,
    movingEntityTurnThreshold: constantsModule.MOVING_ENTITY_TURN_THRESHOLD,
  };
}

function buildAdventureLevels({
  levelDefinitions,
  entityConfigs,
  constantsModule,
  displaySizes,
}) {
  const simulationVersion = Number(constantsModule.RANKED_SIMULATION_VERSION ?? 1);
  const logicFps = Number(constantsModule.RANKED_LOGIC_FPS ?? 60);
  const rankedConstants = buildRankedConstants(constantsModule);
  const normalizedEntityConfigs = normalizeEntityConfigs(
    entityConfigs,
    displaySizes,
  );

  return Object.values(levelDefinitions)
    .sort((left, right) => compareLevelIds(left.id, right.id))
    .map((level, index) => {
      const timeLimitTicks = Math.round(level.timeLimitSec * logicFps);
      const canonicalPayload = sortObjectDeep({
        simulationVersion,
        logicFps,
        timeLimitTicks,
        goal: constantsModule.GOAL_BY_LEVEL[level.group],
        constants: rankedConstants,
        entityConfigs: normalizedEntityConfigs,
        levelDefinition: {
          id: level.id,
          group: level.group,
          theme: level.theme,
          entities: level.entities.map((entity) => ({
            type: entity.type,
            x: entity.x,
            y: entity.y,
            dir: entity.dir ?? null,
          })),
        },
      });
      const contentHash = digestHex(JSON.stringify(canonicalPayload));
      const challengeSeed = digestHex(
        `goldminer:${level.id}:challenge-seed:sim-v${simulationVersion}`,
      );

      return {
        boardKind: "campaign",
        levelId: level.id,
        version: 1,
        order: index + 1,
        contentHash,
        challengeSeed,
        simulationVersion,
        logicFps,
        timeLimitTicks,
        goal: constantsModule.GOAL_BY_LEVEL[level.group],
        canonical: canonicalPayload,
        enabled: true,
      };
    });
}

function buildRankedChallenge({ entityConfigs, constantsModule, displaySizes }) {
  const simulationVersion = Number(constantsModule.RANKED_SIMULATION_VERSION ?? 1);
  const logicFps = Number(constantsModule.RANKED_LOGIC_FPS ?? 60);
  const timeLimitTicks = 60 * logicFps;
  const rankedConstants = buildRankedConstants(constantsModule);
  const normalizedEntityConfigs = normalizeEntityConfigs(
    { Diamond: entityConfigs.Diamond },
    displaySizes,
  );

  const canonicalPayload = sortObjectDeep({
    challengeId: RANKED_CHALLENGE_ID,
    challengeVersion: RANKED_CHALLENGE_VERSION,
    simulationVersion,
    logicFps,
    timeLimitTicks,
    boardKind: "ranked",
    theme: RANKED_CHALLENGE_THEME,
    constants: rankedConstants,
    entityConfigs: normalizedEntityConfigs,
    spawnPoints: RANKED_SPAWN_POINTS,
    spawnPolicy: {
      cycleSize: RANKED_SPAWN_POINTS.length,
      shuffleAlgorithm: "seeded-cycle-no-repeat",
      entityType: "Diamond",
      allowItems: false,
      allowDynamiteAction: false,
    },
  });
  const contentHash = digestHex(JSON.stringify(canonicalPayload));
  const challengeSeed = digestHex(
    `goldminer:${RANKED_CHALLENGE_ID}:challenge-seed:v${RANKED_CHALLENGE_VERSION}`,
  );

  return {
    boardKind: "ranked",
    levelId: RANKED_CHALLENGE_ID,
    version: RANKED_CHALLENGE_VERSION,
    order: 1,
    contentHash,
    challengeSeed,
    simulationVersion,
    logicFps,
    timeLimitTicks,
    canonical: canonicalPayload,
    enabled: true,
    isCurrent: true,
  };
}

function loadCatalogSources() {
  const { LEVEL_DEFINITIONS } = loadTsModule(
    path.join(frontendDir, "src", "data", "levels.ts"),
  );
  const { ENTITY_CONFIGS } = loadTsModule(
    path.join(frontendDir, "src", "data", "entities.ts"),
  );
  const constantsModule = loadTsModule(
    path.join(frontendDir, "src", "game", "constants.ts"),
  );
  const displaySizes = loadTsModule(
    path.join(frontendDir, "src", "game", "display.ts"),
  ).LOGICAL_TEXTURE_DISPLAY_SIZES;

  return {
    levelDefinitions: LEVEL_DEFINITIONS,
    entityConfigs: ENTITY_CONFIGS,
    constantsModule,
    displaySizes,
  };
}

function buildCatalog(sources = loadCatalogSources()) {
  const adventureLevels = buildAdventureLevels(sources);
  const rankedChallenge = buildRankedChallenge(sources);

  return {
    adventureLevels,
    rankedChallenge,
    registryLevels: [...adventureLevels, rankedChallenge].map((entry) => ({
      boardKind: entry.boardKind,
      levelId: entry.levelId,
      version: entry.version,
      order: entry.order,
      contentHash: entry.contentHash,
      challengeSeed: entry.challengeSeed,
      enabled: entry.enabled,
      isCurrent: entry.isCurrent ?? false,
    })),
  };
}

function validateCatalog(catalog) {
  const errors = [];
  const seen = new Set();
  const campaignEntries = [];
  const rankedEntries = [];

  for (const entry of catalog.registryLevels) {
    const key = `${entry.boardKind}:${entry.levelId}:${entry.version}`;
    if (seen.has(key)) {
      errors.push(`duplicate catalog entry: ${key}`);
    }
    seen.add(key);

    if (!entry.levelId) {
      errors.push(`catalog entry is missing levelId for ${key}`);
    }
    if (!Number.isInteger(entry.version) || entry.version < 1) {
      errors.push(`catalog entry has invalid version for ${key}`);
    }
    if (!Number.isInteger(entry.order) || entry.order < 1) {
      errors.push(`catalog entry has invalid order for ${key}`);
    }
    if (!entry.contentHash?.startsWith("0x")) {
      errors.push(`catalog entry has invalid contentHash for ${key}`);
    }
    if (!entry.challengeSeed?.startsWith("0x")) {
      errors.push(`catalog entry has invalid challengeSeed for ${key}`);
    }
    if (entry.boardKind === "campaign") {
      campaignEntries.push(entry);
    } else if (entry.boardKind === "ranked") {
      rankedEntries.push(entry);
    } else {
      errors.push(`catalog entry has invalid boardKind for ${key}`);
    }
  }

  const currentRanked = catalog.registryLevels.filter(
    (entry) => entry.boardKind === "ranked" && entry.isCurrent,
  );
  if (currentRanked.length !== 1) {
    errors.push(
      `expected exactly one current ranked challenge, found ${currentRanked.length}`,
    );
  }

  const expectedAdventureIds = Array.from({ length: 10 }, (_value, index) => `L${index + 1}`);
  const orderedCampaignEntries = [...campaignEntries].sort(
    (left, right) => left.order - right.order,
  );
  const actualAdventureIds = orderedCampaignEntries.map((entry) => entry.levelId);
  if (actualAdventureIds.length !== expectedAdventureIds.length) {
    errors.push(
      `expected exactly ${expectedAdventureIds.length} campaign levels, found ${actualAdventureIds.length}`,
    );
  } else {
    expectedAdventureIds.forEach((levelId, index) => {
      if (actualAdventureIds[index] !== levelId) {
        errors.push(
          `expected campaign order ${index + 1} to be ${levelId}, found ${actualAdventureIds[index]}`,
        );
      }
    });
  }

  const campaignOrders = new Set();
  for (const entry of campaignEntries) {
    if (campaignOrders.has(entry.order)) {
      errors.push(`duplicate campaign order detected at ${entry.order}`);
    }
    campaignOrders.add(entry.order);
  }

  const currentPointer = currentRanked[0];
  if (currentPointer) {
    const matchingRanked = rankedEntries.filter(
      (entry) =>
        entry.levelId === currentPointer.levelId &&
        entry.version === currentPointer.version,
    );
    if (matchingRanked.length !== 1) {
      errors.push(
        `current ranked pointer ${currentPointer.levelId} v${currentPointer.version} is not uniquely present in registry levels`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(`catalog validation failed:\n- ${errors.join("\n- ")}`);
  }

  return catalog;
}

function emitFrontendManifests(catalog) {
  const adventureManifest = {
    version: 3,
    generatedAt: new Date().toISOString(),
    boardId: "adventure_l10",
    simulationVersion: catalog.rankedChallenge.simulationVersion,
    logicFps: catalog.rankedChallenge.logicFps,
    levels: catalog.adventureLevels,
  };
  const rankedManifest = {
    version: 3,
    generatedAt: new Date().toISOString(),
    boardId: RANKED_CHALLENGE_ID,
    simulationVersion: catalog.rankedChallenge.simulationVersion,
    logicFps: catalog.rankedChallenge.logicFps,
    challenges: [catalog.rankedChallenge],
  };

  writeJson(adventureManifestOutputPath, adventureManifest);
  writeJson(rankedManifestOutputPath, rankedManifest);

  return {
    adventureManifest,
    rankedManifest,
    adventureManifestOutputPath,
    rankedManifestOutputPath,
  };
}

function emitContractConfig(catalog) {
  writeJson(registryOutputPath, catalog.registryLevels);
  return {
    registryOutputPath,
    registryLevels: catalog.registryLevels,
  };
}

function readCurrentRankedPointer(levels) {
  const current = levels.find((entry) => entry.boardKind === "ranked" && entry.isCurrent);
  if (!current) {
    throw new Error("Missing current ranked challenge in config");
  }

  return current;
}

function readBuiltCatalog(configPath = registryOutputPath) {
  const registryLevels = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return validateCatalog({
    adventureLevels: registryLevels.filter((entry) => entry.boardKind === "campaign"),
    rankedChallenge: readCurrentRankedPointer(registryLevels),
    registryLevels,
  });
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

module.exports = {
  rootDir,
  frontendDir,
  rankedManifestOutputPath,
  adventureManifestOutputPath,
  registryOutputPath,
  loadCatalogSources,
  buildCatalog,
  validateCatalog,
  emitFrontendManifests,
  emitContractConfig,
  readCurrentRankedPointer,
  readBuiltCatalog,
};
