import test from "node:test";
import assert from "node:assert/strict";
import { generate } from "../src/core/generator.js";
import { defaultConfig, normalizeConfig } from "../src/core/config.js";

test("unknown configuration fields are discarded", () => {
  const config = normalizeConfig({
    unusedOption: true,
    randomizeBosses: false,
  });
  assert.equal(Object.hasOwn(config, "unusedOption"), false);
  assert.equal(config.randomizeBosses, false);
  assert.equal(config.randomizeStartingClass, defaultConfig.randomizeStartingClass);
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

test("key items remain vanilla when disabled", () => {
  const result = generate({ ...defaultConfig, seed: "keys-safe", randomizeKeyItems: false });
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
    randomizeKeyItems: true,
  });
  const locations = result.placements.items.map((placement) => placement.location);
  assert.equal(new Set(locations).size, locations.length);
});

test("key-item-only randomization preserves other items through swaps", () => {
  const result = generate({
    ...defaultConfig,
    seed: "key-only",
    randomizeItems: false,
    randomizeKeyItems: true,
  });
  assert.equal(result.placements.items.length, 8);
  assert.equal(
    result.placements.items.filter((placement) => placement.progression).length,
    2,
  );
});
