#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  validateCatalog,
  readBuiltCatalog,
  readCurrentRankedPointer,
} = require("./lib/catalog-pipeline");

const rootDir = path.resolve(__dirname, "..");
const defaultConfigPath = path.join(
  rootDir,
  "contracts",
  "config",
  "ranked-levels.json",
);

function encodeBytes32String(value) {
  const source = String(value ?? "");
  if (source.length === 0) {
    throw new Error("bytes32 string value must not be empty");
  }
  if (source.length > 32) {
    throw new Error(`bytes32 string value exceeds 32 bytes: ${source}`);
  }

  return `0x${Buffer.from(source, "utf8").toString("hex").padEnd(64, "0")}`;
}

function parseArgs(argv) {
  const options = {
    config: defaultConfigPath,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (!next) {
      continue;
    }

    if (arg === "--rpc-url") {
      options.rpcUrl = next;
      index += 1;
    } else if (arg === "--private-key") {
      options.privateKey = next;
      index += 1;
    } else if (arg === "--catalog") {
      options.catalog = next;
      index += 1;
    } else if (arg === "--scoreboard") {
      options.scoreboard = next;
      index += 1;
    } else if (arg === "--config") {
      options.config = next;
      index += 1;
    }
  }

  for (const required of ["rpcUrl", "privateKey", "catalog", "scoreboard"]) {
    if (!options[required]) {
      throw new Error(
        `Missing required argument --${required.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`,
      );
    }
  }

  return options;
}

function readLevels(configPath) {
  const builtCatalog = readBuiltCatalog(configPath);
  return validateCatalog(builtCatalog).registryLevels;
}

function castSend(options, target, signature, args) {
  execFileSync(
    "cast",
    [
      "send",
      target,
      signature,
      ...args,
      "--rpc-url",
      options.rpcUrl,
      "--private-key",
      options.privateKey,
    ],
    {
      stdio: "inherit",
    },
  );
}

function main() {
  const options = parseArgs(process.argv);
  const levels = readLevels(options.config);

  levels.forEach((level, index) => {
    console.log(
      `[register-ranked-levels] ${index + 1}/${levels.length} ${level.levelId} v${level.version} (${level.boardKind})`,
    );

    castSend(
      options,
      options.catalog,
      "upsertLevel((bytes32,uint32,bytes32,uint32,bool,bytes32))",
      [
        `(${encodeBytes32String(level.levelId)},${level.version},${level.contentHash},${level.order},${level.enabled},${level.challengeSeed})`,
      ],
    );
  });

  const currentRanked = readCurrentRankedPointer(levels);

  castSend(
    options,
    options.scoreboard,
    "setCurrentRankedChallenge(bytes32,uint32)",
    [encodeBytes32String(currentRanked.levelId), String(currentRanked.version)],
  );
}

main();
