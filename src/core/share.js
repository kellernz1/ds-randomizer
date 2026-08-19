import { createHash } from "node:crypto";
import {
  RANDOMIZER_VERSION,
  normalizeConfig,
  validateConfig,
} from "./config.js";
import { generate } from "./generator.js";

export const SHARED_SEED_FORMAT = "dsr-randomizer-seed";
export const SHARED_SEED_SCHEMA = 1;

const sharedKeys = Object.freeze([
  "randomizeEnemies",
  "randomizeBosses",
  "randomizeItems",
  "randomizeProtectedItems",
  "progressionLogic",
  "enemyScaling",
  "guaranteeEarlyWeapon",
  "balancedEarlyLoot",
  "randomizeStartingClass",
  "randomizeStartingEquipment",
  "randomizeGifts",
  "randomizeEnemyDrops",
  "guaranteedEnemyDrops",
  "randomizeShops",
  "includeDlc",
  "generateSpoilerLog",
  "useExtractedData",
]);

export function fingerprintCatalog(catalog) {
  if (!catalog?.sourceFiles?.length) return "";
  const sourceState = catalog.sourceFiles
    .map((source) => `${source.path}\0${source.sha256}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(sourceState).digest("hex");
}

export function createSharedSeed(inputConfig, catalog) {
  const config = normalizeConfig(inputConfig);
  const errors = validateConfig(config);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  if (config.useExtractedData && !catalog) {
    throw new Error("Import clean game data before exporting this seed.");
  }

  const result = generate(config, {
    gameCatalog: config.useExtractedData ? catalog : null,
  });
  return {
    format: SHARED_SEED_FORMAT,
    schemaVersion: SHARED_SEED_SCHEMA,
    randomizerVersion: RANDOMIZER_VERSION,
    seed: config.seed,
    catalogFingerprint: config.useExtractedData
      ? fingerprintCatalog(catalog)
      : "",
    placementHash: result.placementHash,
    options: Object.fromEntries(sharedKeys.map((key) => [key, config[key]])),
  };
}

export function readSharedSeed(payload, catalog) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid shared seed file.");
  }
  if (
    payload.format !== SHARED_SEED_FORMAT ||
    payload.schemaVersion !== SHARED_SEED_SCHEMA
  ) {
    throw new Error("Unsupported shared seed file.");
  }
  if (payload.randomizerVersion !== RANDOMIZER_VERSION) {
    throw new Error(
      `This seed requires randomizer ${payload.randomizerVersion}; ` +
      `the installed version is ${RANDOMIZER_VERSION}.`,
    );
  }
  if (!payload.options || typeof payload.options !== "object") {
    throw new Error("The shared seed has no options.");
  }

  const imported = Object.fromEntries(
    sharedKeys
      .filter((key) => Object.hasOwn(payload.options, key))
      .map((key) => [key, payload.options[key]]),
  );
  imported.seed = payload.seed;
  const config = normalizeConfig(imported);
  const errors = validateConfig(config);
  if (errors.length > 0) throw new Error(errors.join("\n"));

  if (config.useExtractedData) {
    if (!catalog) {
      throw new Error(
        "Import clean game data before importing this shared seed.",
      );
    }
    const localFingerprint = fingerprintCatalog(catalog);
    if (
      !payload.catalogFingerprint ||
      payload.catalogFingerprint !== localFingerprint
    ) {
      throw new Error(
        "This seed was exported from different game data. " +
        "Verify the clean installation and import it again.",
      );
    }
  }
  const result = generate(config, {
    gameCatalog: config.useExtractedData ? catalog : null,
  });
  if (
    typeof payload.placementHash !== "string" ||
    payload.placementHash !== result.placementHash
  ) {
    throw new Error(
      "The shared seed does not reproduce its expected placement hash.",
    );
  }

  return {
    seed: config.seed,
    ...Object.fromEntries(sharedKeys.map((key) => [key, config[key]])),
  };
}
