import { randomBytes } from "node:crypto";

export const RANDOMIZER_VERSION = "0.5.9";

export const presets = Object.freeze({
  beginner: {
    randomizeEnemies: true,
    randomizeBosses: false,
    randomizeItems: true,
    randomizeKeyItems: false,
    progressionLogic: true,
    enemyScaling: "area",
    guaranteeEarlyWeapon: true,
    balancedEarlyLoot: true,
    randomizeStartingClass: false,
    randomizeStartingEquipment: false,
    randomizeGifts: false,
    randomizeEnemyDrops: false,
    randomizeShops: false,
  },
  standard: {
    randomizeEnemies: true,
    randomizeBosses: true,
    randomizeItems: true,
    randomizeKeyItems: false,
    progressionLogic: true,
    enemyScaling: "area",
    guaranteeEarlyWeapon: true,
    balancedEarlyLoot: true,
    randomizeStartingClass: false,
    randomizeStartingEquipment: false,
    randomizeGifts: false,
    randomizeEnemyDrops: false,
    randomizeShops: false,
  },
  chaos: {
    randomizeEnemies: true,
    randomizeBosses: true,
    randomizeItems: true,
    randomizeKeyItems: true,
    progressionLogic: true,
    enemyScaling: "vanilla",
    guaranteeEarlyWeapon: false,
    balancedEarlyLoot: false,
    randomizeStartingClass: true,
    randomizeStartingEquipment: true,
    randomizeGifts: true,
    randomizeEnemyDrops: true,
    randomizeShops: true,
  },
});

export const defaultConfig = Object.freeze({
  version: RANDOMIZER_VERSION,
  seed: "817293615",
  preset: "standard",
  gameDirectory: "",
  outputDirectory: "output",
  lastPackageDirectory: "",
  randomizeEnemies: true,
  randomizeBosses: true,
  randomizeItems: true,
  randomizeKeyItems: false,
  progressionLogic: true,
  enemyScaling: "area",
  guaranteeEarlyWeapon: true,
  balancedEarlyLoot: true,
  randomizeStartingClass: false,
  randomizeStartingEquipment: false,
  randomizeGifts: false,
  randomizeEnemyDrops: false,
  randomizeShops: false,
  includeDlc: true,
  generateSpoilerLog: true,
  useExtractedData: true,
  offlineAcknowledged: false,
  dryRun: true,
});

const booleanKeys = [
  "randomizeEnemies",
  "randomizeBosses",
  "randomizeItems",
  "randomizeKeyItems",
  "progressionLogic",
  "guaranteeEarlyWeapon",
  "balancedEarlyLoot",
  "randomizeStartingClass",
  "randomizeStartingEquipment",
  "randomizeGifts",
  "randomizeEnemyDrops",
  "randomizeShops",
  "includeDlc",
  "generateSpoilerLog",
  "useExtractedData",
  "offlineAcknowledged",
  "dryRun",
];

export function generateSeed() {
  return randomBytes(8).readBigUInt64LE().toString();
}

export function normalizeConfig(input = {}) {
  const selectedPreset =
    input.preset === "custom" || Object.hasOwn(presets, input.preset)
      ? input.preset
      : defaultConfig.preset;
  const base = input.applyPreset
    ? { ...defaultConfig, ...(presets[selectedPreset] || {}) }
    : { ...defaultConfig };
  const config = { ...base, ...input, preset: selectedPreset };

  config.seed = String(config.seed || generateSeed()).trim();
  config.version = RANDOMIZER_VERSION;
  config.gameDirectory = String(config.gameDirectory || "").trim();
  config.outputDirectory = String(config.outputDirectory || "output").trim();
  config.lastPackageDirectory = String(config.lastPackageDirectory || "").trim();
  config.enemyScaling = ["vanilla", "area", "progressive"].includes(config.enemyScaling)
    ? config.enemyScaling
    : defaultConfig.enemyScaling;

  for (const key of booleanKeys) {
    config[key] = Boolean(config[key]);
  }

  delete config.applyPreset;
  return config;
}

export function validateConfig(config, { requireGame = false } = {}) {
  const errors = [];
  if (!/^[\w.-]{1,64}$/u.test(config.seed)) {
    errors.push("The seed must contain 1-64 characters (letters, numbers, dot, hyphen, or underscore).");
  }
  if (config.randomizeKeyItems && !config.progressionLogic) {
    errors.push("Key items require progression protection.");
  }
  if (requireGame && !config.gameDirectory) {
    errors.push("Select the Dark Souls Remastered game directory.");
  }
  if (!config.dryRun && !config.offlineAcknowledged) {
    errors.push("Confirm that you will play offline before installing files.");
  }
  if (
    !config.randomizeEnemies &&
    !config.randomizeBosses &&
    !config.randomizeItems &&
    !config.randomizeKeyItems &&
    !config.randomizeStartingClass &&
    !config.randomizeStartingEquipment &&
    !config.randomizeGifts &&
    !config.randomizeEnemyDrops &&
    !config.randomizeShops
  ) {
    errors.push("Enable at least one category to randomize.");
  }
  return errors;
}
