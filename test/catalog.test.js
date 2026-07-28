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
      950,
  );
  assert.ok(
    first.placements.enemies.some(
      (placement) => placement.targetModelName !== placement.modelName,
    ),
  );
  assert.ok(
    first.placements.enemies.filter(
      (placement) =>
        placement.map === "m18_01_00_00" &&
        placement.targetModelName !== placement.modelName,
    ).length > 15,
  );
  const scaled = first.placements.enemies
    .map((placement) => placement.scaledNpcParamId)
    .filter((id) => id !== null);
  assert.equal(new Set(scaled).size, scaled.length);
  assert.ok(
    first.placements.enemies.every((placement) =>
      [
        "movement-size-and-ai-compatible",
        "event-model-locked-source-ai",
        "same-model-compatible-fallback",
        "vanilla-preserved-no-compatible-replacement",
      ].includes(placement.compatibility),
    ),
  );

  const slots = new Map(gameCatalog.enemySlots.map((slot) => [slot.id, slot]));
  const archetypes = new Map(
    gameCatalog.enemyArchetypes.map((entry) => [
      `${entry.modelName}:${entry.npcParamId}:${entry.thinkParamId}`,
      entry,
    ]),
  );
  const hitYOffsetByArchetype = new Map(
    gameCatalog.enemySlots.map((slot) => [
      `${slot.modelName}:${slot.npcParamId}:${slot.thinkParamId}`,
      slot.hitYOffset,
    ]),
  );
  for (const placement of first.placements.enemies.filter(
    (entry) => entry.changed,
  )) {
    const slot = slots.get(placement.slot);
    const target =
      archetypes.get(
        `${placement.targetModelName}:${placement.targetNpcParamId}:${placement.targetThinkParamId}`,
      ) ||
      gameCatalog.enemyArchetypes.find(
        (entry) =>
          entry.modelName === placement.targetModelName &&
          entry.npcParamId === placement.targetNpcParamId,
      );
    assert.equal(slot.teamType, 0);
    assert.notEqual(slot.modelName, "c0000");
    assert.equal(target.teamType, 0);
    assert.equal(target.npcType, slot.npcType);
    assert.equal(target.moveType, slot.moveType);
    assert.equal(target.disablePathMove, slot.disablePathMove);
    assert.ok(
      target.hitRadius <= Math.max(slot.hitRadius * 1.35, slot.hitRadius + 0.15),
    );
    assert.ok(
      target.hitHeight <= Math.max(slot.hitHeight * 1.35, slot.hitHeight + 0.4),
    );
    assert.ok(
      Math.abs(
        hitYOffsetByArchetype.get(
          `${target.modelName}:${target.npcParamId}:${target.thinkParamId}`,
        ) - slot.hitYOffset,
      ) <= Math.max(0.35, slot.hitHeight * 0.35),
    );
    assert.ok(target.battleStartDistance > 0);
    assert.ok(target.eyeDistance > 0 || target.earDistance > 0);
    if (slot.eventModelLocked) {
      assert.equal(placement.targetModelName, placement.modelName);
      assert.equal(placement.targetThinkParamId, placement.sourceThinkParamId);
    }
  }
});

test("friendly NPC and human-character slots are never randomized", async () => {
  const gameCatalog = await catalog();
  assert.equal(gameCatalog.schemaVersion, 9);
  const protectedSlots = gameCatalog.enemySlots.filter(
    (slot) => slot.teamType >= 2 || slot.modelName === "c0000",
  );
  assert.ok(protectedSlots.length > 150);
  assert.ok(protectedSlots.every((slot) => slot.safeCandidate === false));
  const result = generate(
    { ...presets.standard, seed: "npc-protection-01" },
    { gameCatalog },
  );
  const randomizedIds = new Set(
    result.placements.enemies.map((placement) => placement.slot),
  );
  assert.ok(protectedSlots.every((slot) => !randomizedIds.has(slot.id)));
});

test("obsolete catalogs require a fresh import", async () => {
  const gameCatalog = await catalog();
  assert.throws(
    () =>
      generate(
        { ...presets.standard, seed: "obsolete-catalog" },
        { gameCatalog: { ...gameCatalog, schemaVersion: 5 } },
      ),
    /import its data again/u,
  );
});

test("real catalog produces real boss and world-item placements", async () => {
  const gameCatalog = await catalog();
  const result = generate(
    { ...presets.standard, seed: "real-no-prototype" },
    { gameCatalog },
  );
  assert.ok(result.placements.bosses.length > 20);
  assert.equal(
    result.placements.items.length,
    gameCatalog.worldItemLots.filter((lot) => !lot.protectedProgression).length,
  );
  assert.ok(result.placements.bosses.filter((entry) => entry.changed).length > 20);
  assert.ok(
    result.placements.bosses.filter((entry) => entry.changed).every(
      (entry) => !["c5200", "c5271", "c5290", "c5351", "c5390"].includes(
        entry.targetModelName,
      ) && !["c3471", "c4510"].includes(entry.targetModelName),
    ),
  );
  const asylum = result.placements.bosses.find(
    (entry) => entry.slot === "m18_01_00_00:c2232_0000",
  );
  assert.ok(asylum);
  assert.notEqual(asylum.targetModelName, "c2232");
  assert.equal(asylum.compatibility, "asylum-floor-spawn");
  const stray = result.placements.bosses.find(
    (entry) => entry.slot === "m18_01_00_00:c2230_0000",
  );
  assert.ok(stray);
  assert.equal(stray.targetModelName, "c2230");
  assert.equal(stray.changed, false);
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
