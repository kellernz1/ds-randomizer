import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generate } from "../src/core/generator.js";
import { presets } from "../src/core/config.js";

async function catalog() {
  return JSON.parse(await readFile("data/dsr-catalog.json", "utf8"));
}

function vanillaStartingIds(gameCatalog) {
  const weapons = new Set(
    gameCatalog.startingItemLots.flatMap((entry) =>
      Object.entries(entry.cells)
        .filter(([name, value]) => name.startsWith("lotItemId") && value > 0)
        .map(([, value]) => value),
    ),
  );
  const armor = new Set();
  for (const startingClass of gameCatalog.startingClasses) {
    for (const row of [startingClass.display, startingClass.start]) {
      for (const field of [
        "equip_Wep_Right",
        "equip_Subwep_Right",
        "equip_Wep_Left",
        "equip_Subwep_Left",
      ]) {
        if (row[field] >= 0) weapons.add(row[field]);
      }
      for (const field of [
        "equip_Helm",
        "equip_Armer",
        "equip_Gaunt",
        "equip_Leg",
      ]) {
        if (row[field] >= 0) armor.add(row[field]);
      }
    }
  }
  return { weapons, armor };
}

test("real catalog produces deterministic enemies with visibly different models", async () => {
  const gameCatalog = await catalog();
  const config = { ...presets.standard, seed: "real-catalog-01" };
  const first = generate(config, { gameCatalog });
  const second = generate(config, { gameCatalog });
  assert.equal(first.dataStatus, "extracted");
  assert.equal(first.placementHash, second.placementHash);
  assert.ok(first.placements.enemies.some((placement) => placement.changed));
  assert.ok(first.placements.enemies.length > 1_500);
  assert.ok(
    first.placements.enemies.filter((placement) => placement.entityId >= 0).length >
      1_000,
  );
  assert.ok(
    first.placements.enemies.some(
      (placement) => placement.targetModelName !== placement.modelName,
    ),
  );
  assert.equal(
    new Set(
      first.placements.enemies.map((placement) => placement.scaledNpcParamId),
    ).size,
    first.placements.enemies.length,
  );
  assert.ok(
    first.placements.enemies.every((placement) =>
      ["cross-map-loaded-model", "same-model-fallback"].includes(
        placement.compatibility,
      ),
    ),
  );
});

test("real catalog produces real boss and world-item placements", async () => {
  const gameCatalog = await catalog();
  const result = generate(
    { ...presets.standard, seed: "real-no-prototype" },
    { gameCatalog },
  );
  assert.equal(result.placements.bosses.length, gameCatalog.bossSlots.length);
  assert.equal(
    result.placements.items.length,
    gameCatalog.worldItemLots.filter((lot) => !lot.protectedProgression).length,
  );
  assert.ok(result.placements.bosses.every((entry) => entry.changed));
  assert.ok(result.placements.items.every((entry) => !entry.preserved));
  assert.ok(
    result.placements.items.every(
      (entry) => !entry.progression && entry.rowId !== entry.sourceRowId,
    ),
  );
});

test("classes use deterministic stats and general-catalog equipment", async () => {
  const gameCatalog = await catalog();
  const config = {
    ...presets.standard,
    seed: "starting-classes-01",
    randomizeStartingClass: true,
    randomizeStartingEquipment: true,
  };
  const result = generate(config, { gameCatalog });
  const classes = result.placements.startingClasses;
  assert.equal(classes.length, 10);
  assert.ok(classes.every((entry) => entry.statsFrom !== entry.slot));
  assert.ok(classes.every((entry) => entry.equipment));

  const poolWeaponIds = new Set(
    gameCatalog.startingEquipmentPools.weapons.map((entry) => entry.id),
  );
  const vanillaPickupIds = new Set(
    gameCatalog.startingItemLots.map((entry) => entry.cells.lotItemId01),
  );
  assert.ok(
    classes.every(
      (entry) =>
        poolWeaponIds.has(entry.equipment.pickupWeapon.id) &&
        poolWeaponIds.has(entry.equipment.pickupOffhand.id) &&
        !Object.hasOwn(entry.equipment, "rightWeapon"),
    ),
  );
  const classById = new Map(
    gameCatalog.startingClasses.map((entry) => [entry.id, entry]),
  );
  const canUse = (stats, weapon) =>
    weapon.strength <= stats.baseStr &&
    weapon.dexterity <= stats.baseDex &&
    weapon.intelligence <= stats.baseMag &&
    weapon.faith <= stats.baseFai;
  assert.ok(
    classes.every((entry) => {
      const stats = classById.get(entry.statsFrom).start;
      return (
        canUse(stats, entry.equipment.pickupWeapon) &&
        entry.equipment.pickupWeapon.isPrimaryWeapon === true &&
        canUse(stats, entry.equipment.pickupOffhand) &&
        (!entry.equipment.pickupSpecial ||
          canUse(stats, entry.equipment.pickupSpecial))
      );
    }),
  );
  assert.ok(
    classes.some(
      (entry) => !vanillaPickupIds.has(entry.equipment.pickupWeapon.id),
    ),
  );
  for (const [field, pool] of [
    ["helm", gameCatalog.startingEquipmentPools.helms],
    ["armor", gameCatalog.startingEquipmentPools.armors],
    ["gauntlets", gameCatalog.startingEquipmentPools.gauntlets],
    ["legs", gameCatalog.startingEquipmentPools.legs],
  ]) {
    const ids = new Set(pool.map((entry) => entry.id));
    assert.ok(classes.every((entry) => ids.has(entry.equipment[field].id)));
  }

  const statsOnly = generate(
    { ...config, randomizeStartingEquipment: false },
    { gameCatalog },
  );
  assert.deepEqual(
    classes.map((entry) => entry.statsFrom),
    statsOnly.placements.startingClasses.map((entry) => entry.statsFrom),
  );
  const repeated = generate(config, { gameCatalog });
  assert.deepEqual(classes, repeated.placements.startingClasses);
});

test("every class receives a primary weapon as its first pickup", async () => {
  const gameCatalog = await catalog();
  const vanilla = vanillaStartingIds(gameCatalog);
  for (let seed = 1; seed <= 100; seed += 1) {
    const result = generate(
      {
        ...presets.standard,
        seed: `primary-weapon-${seed}`,
        randomizeStartingClass: true,
        randomizeStartingEquipment: true,
      },
      { gameCatalog },
    );
    assert.ok(
      result.placements.startingClasses.every(
        (entry) =>
          entry.equipment.pickupWeapon.isPrimaryWeapon === true &&
          entry.equipment.pickupWeapon.id < 1_200_000,
      ),
    );
    const allWeapons = result.placements.startingClasses.flatMap((entry) => [
      entry.equipment.pickupWeapon.id,
      entry.equipment.pickupOffhand.id,
      ...(entry.equipment.pickupSpecial
        ? [entry.equipment.pickupSpecial.id]
        : []),
    ]);
    assert.equal(new Set(allWeapons).size, allWeapons.length);
    assert.ok(allWeapons.every((id) => !vanilla.weapons.has(id)));
    for (const field of ["helm", "armor", "gauntlets", "legs"]) {
      const armorIds = result.placements.startingClasses.map(
        (entry) => entry.equipment[field].id,
      );
      assert.equal(new Set(armorIds).size, armorIds.length);
      assert.ok(armorIds.every((id) => !vanilla.armor.has(id)));
    }
  }
});

test("real gifts, drops, and shops are independent and deterministic", async () => {
  const gameCatalog = await catalog();
  const config = {
    ...presets.standard,
    seed: "economy-01",
    randomizeGifts: true,
    randomizeEnemyDrops: true,
    randomizeShops: true,
  };
  const first = generate(config, { gameCatalog });
  const second = generate(config, { gameCatalog });
  assert.equal(first.placementHash, second.placementHash);
  assert.equal(first.placements.gifts.length, 18);
  assert.equal(first.placements.enemyDrops.length, gameCatalog.enemyDropLots.length);
  assert.ok(first.placements.shops.length > 200);
  assert.ok(first.placements.gifts.every((entry) => entry.rowId !== entry.sourceRowId));
  assert.ok(first.placements.enemyDrops.every((entry) => entry.rowId !== entry.sourceRowId));
  assert.ok(first.placements.shops.every((entry) => entry.rowId !== entry.sourceRowId));
});

test("progression protection fixes Lordvessel and Key to the Seal", async () => {
  const gameCatalog = await catalog();
  const protectedResult = generate(
    {
      ...presets.standard,
      seed: "gifts-protected",
      randomizeGifts: true,
      progressionLogic: true,
    },
    { gameCatalog },
  );
  const chaosResult = generate(
    {
      ...presets.standard,
      seed: "gifts-protected",
      randomizeGifts: true,
      progressionLogic: false,
    },
    { gameCatalog },
  );
  const rows = new Set(protectedResult.placements.gifts.map((entry) => entry.rowId));
  assert.ok(!rows.has(1090));
  assert.ok(!rows.has(1100));
  assert.equal(chaosResult.placements.gifts.length, 20);
});

test("progression protection excludes finite and event-bound shop goods", async () => {
  const gameCatalog = await catalog();
  const protectedResult = generate(
    {
      ...presets.standard,
      seed: "shops-protected",
      randomizeShops: true,
      progressionLogic: true,
    },
    { gameCatalog },
  );
  const unprotectedResult = generate(
    {
      ...presets.standard,
      seed: "shops-protected",
      randomizeShops: true,
      progressionLogic: false,
    },
    { gameCatalog },
  );
  const protectedRows = new Set(protectedResult.placements.shops.map((entry) => entry.rowId));
  const finiteGoods = gameCatalog.shopEntries.filter(
    (entry) => entry.equipType === 3 && entry.eventFlag >= 0,
  );
  assert.ok(finiteGoods.length > 0);
  assert.ok(finiteGoods.every((entry) => !protectedRows.has(entry.rowId)));
  assert.ok(unprotectedResult.placements.shops.length > protectedResult.placements.shops.length);
});
