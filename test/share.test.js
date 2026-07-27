import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generate } from "../src/core/generator.js";
import { presets, RANDOMIZER_VERSION } from "../src/core/config.js";
import {
  createSharedSeed,
  readSharedSeed,
  SHARED_SEED_FORMAT,
} from "../src/core/share.js";

async function catalog() {
  return JSON.parse(await readFile("data/dsr-catalog.json", "utf8"));
}

test("shared seed reproduces placements without leaking local paths", async () => {
  const gameCatalog = await catalog();
  const source = {
    ...presets.standard,
    seed: "share-me-01",
    gameDirectory: "C:\\private\\game",
    outputDirectory: "C:\\private\\output",
    lastPackageDirectory: "C:\\private\\package",
    randomizeStartingClass: true,
    randomizeStartingEquipment: true,
    randomizeGifts: true,
    randomizeEnemyDrops: true,
    randomizeShops: true,
    useExtractedData: true,
  };
  const shared = createSharedSeed(source, gameCatalog);
  assert.equal(shared.format, SHARED_SEED_FORMAT);
  assert.equal(shared.randomizerVersion, RANDOMIZER_VERSION);
  assert.match(shared.placementHash, /^[a-f0-9]{64}$/u);
  const serialized = JSON.stringify(shared);
  assert.doesNotMatch(serialized, /private/u);
  assert.ok(shared.catalogFingerprint);

  const imported = readSharedSeed(shared, gameCatalog);
  const originalResult = generate(source, { gameCatalog });
  const importedResult = generate(imported, { gameCatalog });
  assert.equal(importedResult.seed, source.seed);
  assert.equal(importedResult.placementHash, originalResult.placementHash);
});

test("shared seed rejects incompatible versions and catalogs", async () => {
  const gameCatalog = await catalog();
  const shared = createSharedSeed(
    { ...presets.standard, seed: "share-guard", useExtractedData: true },
    gameCatalog,
  );
  assert.throws(
    () => readSharedSeed({ ...shared, randomizerVersion: "0.0.0" }, gameCatalog),
    /requires randomizer/u,
  );
  assert.throws(
    () =>
      readSharedSeed(
        { ...shared, catalogFingerprint: "different" },
        gameCatalog,
      ),
    /different game data/u,
  );
  assert.throws(
    () =>
      readSharedSeed(
        {
          ...shared,
          options: {
            ...shared.options,
            randomizeEnemies: !shared.options.randomizeEnemies,
          },
        },
        gameCatalog,
      ),
    /placement hash/u,
  );
});
