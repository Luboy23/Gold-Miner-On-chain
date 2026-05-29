#!/usr/bin/env node

const {
  adventureManifestOutputPath,
  buildCatalog,
  emitContractConfig,
  emitFrontendManifests,
  rankedManifestOutputPath,
  registryOutputPath,
  validateCatalog,
} = require("./lib/catalog-pipeline");

function main() {
  let catalog;
  try {
    catalog = validateCatalog(buildCatalog());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[build-ranked-manifest] catalog validation failed');
    console.error(message);
    process.exitCode = 1;
    return;
  }
  emitFrontendManifests(catalog);
  emitContractConfig(catalog);

  console.log(
    `Wrote ${rankedManifestOutputPath}, ${adventureManifestOutputPath}, and ${registryOutputPath}`,
  );
}

main();
