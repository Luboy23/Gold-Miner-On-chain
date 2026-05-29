#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const rootDir = path.resolve(__dirname, "..");
const contractsDir = path.join(rootDir, "contracts");
const frontendDir = path.join(rootDir, "frontend");

function parseArgs(argv) {
  const options = {
    chainId: 31337,
    apiBaseUrl: "http://127.0.0.1:8788/api",
    deploymentId: "local-goldminer-diamond-rush",
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--chain-id" && next) {
      options.chainId = Number(next);
      index += 1;
    } else if (arg === "--api-base-url" && next) {
      options.apiBaseUrl = next;
      index += 1;
    } else if (arg === "--deployment-id" && next) {
      options.deploymentId = next;
      index += 1;
    }
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadDeploymentOrFallback() {
  const deploymentPath = path.join(contractsDir, "out", "deployment.json");
  if (!fs.existsSync(deploymentPath)) {
    return {
      goldMinerLevelCatalog: ZERO_ADDRESS,
      goldMinerScoreboard: ZERO_ADDRESS,
    };
  }

  return readJson(deploymentPath);
}

function syncAbi(contractName) {
  const artifactPath = path.join(
    contractsDir,
    "out",
    `${contractName}.sol`,
    `${contractName}.json`,
  );
  const targetPath = path.join(
    frontendDir,
    "src",
    "web3",
    "abi",
    `${contractName}.json`,
  );

  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Missing contract artifact: ${artifactPath}`);
  }

  const artifact = readJson(artifactPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(artifact.abi, null, 2)}\n`);
}

function main() {
  const options = parseArgs(process.argv);
  const deployment = loadDeploymentOrFallback();

  ["GoldMinerLevelCatalog", "GoldMinerScoreboard"].forEach(syncAbi);

  const runtimeConfig = {
    chainId: options.chainId,
    deploymentId: options.deploymentId,
    apiBaseUrl: options.apiBaseUrl,
    rpcUrl: "http://127.0.0.1:8545",
    goldMinerLevelCatalogAddress:
      deployment.goldMinerLevelCatalog || ZERO_ADDRESS,
    goldMinerScoreboardAddress:
      deployment.goldMinerScoreboard || ZERO_ADDRESS,
  };

  const runtimeConfigPath = path.join(
    frontendDir,
    "public",
    "contract-config.json",
  );
  fs.mkdirSync(path.dirname(runtimeConfigPath), { recursive: true });
  fs.writeFileSync(
    runtimeConfigPath,
    `${JSON.stringify(runtimeConfig, null, 2)}\n`,
  );
  console.log(`Synced runtime config to ${runtimeConfigPath}`);
}

main();
