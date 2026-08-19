import test from "node:test";
import assert from "node:assert/strict";
import { generate } from "../src/core/generator.js";
import {
  defaultConfig,
  normalizeConfig,
  validateConfig,
} from "../src/core/config.js";

test("unknown configuration fields are discarded", () => {
  const config = normalizeConfig({
    unusedOption: true,
    offlineAcknowledged: true,
    randomizeBosses: false,
  });
  assert.equal(Object.hasOwn(config, "unusedOption"), false);
  assert.equal(Object.hasOwn(config, "offlineAcknowledged"), false);
  assert.equal(config.randomizeBosses, false);
  assert.equal(config.guaranteedEnemyDrops, false);
  assert.equal(config.randomizeStartingClass, defaultConfig.randomizeStartingClass);
});

test("100% enemy drops are an independent package option", () => {
  const disabledCategories = Object.fromEntries(
    Object.keys(defaultConfig)
      .filter((key) => key.startsWith("randomize"))
      .map((key) => [key, false]),
  );
  const config = normalizeConfig({
    ...defaultConfig,
    ...disabledCategories,
    guaranteedEnemyDrops: true,
  });
  assert.deepEqual(validateConfig(config), []);
  const ordinary = generate({ ...defaultConfig, seed: "guaranteed-drops-hash" });
  const guaranteed = generate({
    ...defaultConfig,
    seed: "guaranteed-drops-hash",
    guaranteedEnemyDrops: true,
  });
  assert.notEqual(guaranteed.placementHash, ordinary.placementHash);
});

test("installable packages do not require an offline confirmation field", () => {
  const config = normalizeConfig({
    ...defaultConfig,
    dryRun: false,
    offlineAcknowledged: false,
  });
  assert.equal(Object.hasOwn(config, "offlineAcknowledged"), false);
  assert.deepEqual(validateConfig(config), []);
});

test("the same seed and configuration produce the same hash", () => {
  const config = { ...defaultConfig, seed: "123456" };
  assert.equal(generate(config).placementHash, generate(config).placementHash);
});

test("independent streams isolate items from enemy options", () => {
  const base = { ...defaultConfig, seed: "streams-01" };
  const enabled = generate(base);
  const disabled = generate({ ...base, randomizeEnemies: false, randomizeBosses: false });
  assert.deepEqual(enabled.placements.items, disabled.placements.items);
});

test("key items remain vanilla when protected-item randomization is disabled", () => {
  const result = generate({
    ...defaultConfig,
    seed: "keys-safe",
    randomizeProtectedItems: false,
  });
  const keys = result.placements.items.filter((placement) => placement.progression);
  assert.ok(keys.length > 0);
  assert.ok(keys.every((placement) => placement.preserved && placement.from === placement.to));
});

test("does not place a large enemy in a small slot", () => {
  for (let seed = 1; seed <= 100; seed += 1) {
    const result = generate({ ...defaultConfig, seed: String(seed) });
    const depths = result.placements.enemies.find((entry) => entry.slot === "depths_001");
    assert.notEqual(depths.to, "Giant Skeleton");
  }
});

test("each location receives exactly one item", () => {
  const result = generate({
    ...defaultConfig,
    seed: "unique-locations",
    randomizeProtectedItems: true,
  });
  const locations = result.placements.items.map((placement) => placement.location);
  assert.equal(new Set(locations).size, locations.length);
});

test("protected-item-only randomization preserves ordinary items", () => {
  const result = generate({
    ...defaultConfig,
    seed: "key-only",
    randomizeItems: false,
    randomizeProtectedItems: true,
  });
  assert.equal(result.placements.items.length, 8);
  assert.equal(
    result.placements.items.filter((placement) => placement.progression).length,
    2,
  );
});
