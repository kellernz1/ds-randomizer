import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generate } from "../src/core/generator.js";
import { defaultConfig } from "../src/core/config.js";

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
  const config = { ...defaultConfig, seed: "real-catalog-01" };
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
  assert.equal(
    scaled.length,
    first.placements.enemies.filter((placement) => placement.changed).length,
  );
  const vanillaScaling = generate(
    { ...config, enemyScaling: "vanilla" },
    { gameCatalog },
  );
  assert.ok(
    vanillaScaling.placements.enemies.every(
      (placement) => placement.scaledNpcParamId === null,
    ),
  );
  assert.deepEqual(
    vanillaScaling.placements.enemies.map((placement) => placement.sourceSlot),
    first.placements.enemies.map((placement) => placement.sourceSlot),
  );
  assert.ok(
    first.placements.enemies.every((placement) =>
      [
        "count-preserving-unrestricted-permutation",
        "count-preserving-identical-source-permutation",
        "count-preserving-fixed-point",
        "dragon-only-group-permutation",
        "linked-dragon-part-permutation",
        "linked-hydra-group-permutation",
        "linked-hydra-part-permutation",
        "grounded-linked-boss-auxiliary",
        "linked-boss-part-permutation",
        "vanilla-preserved-linked-bed-of-chaos-part",
      ].includes(placement.compatibility),
    ),
  );

  const slots = new Map(gameCatalog.enemySlots.map((slot) => [slot.id, slot]));
  const ordinaryPlacements = first.placements.enemies.filter(
    (placement) =>
      !placement.linkedDragonGroup && !placement.linkedEnemyGroup,
  );
  assert.equal(
    new Set(ordinaryPlacements.map((placement) => placement.sourceSlot)).size,
    ordinaryPlacements.length,
  );
  const placementsBySlot = new Map(
    ordinaryPlacements.map((placement) => [placement.slot, placement]),
  );
  let longestCycle = 0;
  for (const placement of ordinaryPlacements) {
    const visited = new Set();
    let current = placement.slot;
    while (!visited.has(current)) {
      visited.add(current);
      current = placementsBySlot.get(current).sourceSlot;
    }
    if (current === placement.slot) {
      longestCycle = Math.max(longestCycle, visited.size);
    }
  }
  assert.ok(longestCycle > 2);
  let ignoresMovementCompatibility = false;
  let ignoresSizeCompatibility = false;
  let ignoresDifficultyCompatibility = false;
  for (const placement of ordinaryPlacements.filter(
    (entry) => entry.changed,
  )) {
    const slot = slots.get(placement.slot);
    const source = slots.get(placement.sourceSlot);
    assert.ok(slot.teamType === 0 || slot.modelName === "c3501");
    assert.notEqual(slot.modelName, "c0000");
    assert.equal(placement.targetModelName, source.modelName);
    assert.equal(placement.targetNpcParamId, source.npcParamId);
    assert.equal(placement.targetThinkParamId, source.thinkParamId);
    ignoresMovementCompatibility ||= (
      source.npcType !== slot.npcType ||
      source.moveType !== slot.moveType ||
      source.disablePathMove !== slot.disablePathMove
    );
    ignoresSizeCompatibility ||= (
      source.hitRadius >
        Math.max(slot.hitRadius * 1.35, slot.hitRadius + 0.15) ||
      source.hitHeight >
        Math.max(slot.hitHeight * 1.35, slot.hitHeight + 0.4)
    );
    ignoresDifficultyCompatibility ||= (
      source.baseHp > Math.max(slot.baseHp * 2, slot.baseHp + 100) ||
      (slot.soulReward > 0 &&
        source.soulReward >
          Math.max(slot.soulReward * 3, slot.soulReward + 200))
    );
  }
  assert.ok(ignoresMovementCompatibility);
  assert.ok(ignoresSizeCompatibility);
  assert.ok(ignoresDifficultyCompatibility);
  assert.ok(
    ordinaryPlacements.every(
      (placement) =>
        !["c2731", "c3422", "c3431", "c3451", "c4511", "c5261",
        ].includes(placement.targetModelName),
    ),
  );
  assert.ok(
    first.placements.enemies.filter(
      (placement) => slots.get(placement.slot)?.dummy,
    ).length > 150,
  );
  assert.ok(
    first.placements.enemies.filter(
      (placement) => slots.get(placement.slot)?.eventModelLocked,
    ).length > 50,
  );
  const dragonModels = new Set([
    "c2730", "c2731", "c3420", "c3421", "c3422", "c3430", "c3431",
    "c3520", "c4510", "c4511", "c5260", "c5261", "c5290", "c5291",
  ]);
  assert.ok(
    first.placements.enemies
      .filter((placement) => placement.linkedDragonGroup)
      .every(
        (placement) =>
          dragonModels.has(placement.modelName) &&
          dragonModels.has(placement.targetModelName),
      ),
  );
  const hydraPlacements = first.placements.enemies.filter(
    (placement) => placement.linkedEnemyGroup?.startsWith("hydra-"),
  );
  assert.equal(hydraPlacements.length, 24);
  assert.ok(
    hydraPlacements.every(
      (placement) =>
        ["c3530", "c3531"].includes(placement.modelName) &&
        ["c3530", "c3531"].includes(placement.targetModelName),
    ),
  );
  assert.ok(
    first.placements.enemies.filter(
      (placement) =>
        placement.map === "m10_02_00_00" &&
        placement.targetModelName !== placement.modelName,
    ).length > 10,
  );
  const humanityModels = new Set(["c4170", "c4171", "c4172"]);
  const humanitySlots = gameCatalog.enemySlots.filter((slot) =>
    humanityModels.has(slot.modelName),
  );
  assert.equal(humanitySlots.length, 45);
  assert.ok(
    humanitySlots.every((slot) => placementsBySlot.has(slot.id)),
  );
});

test("friendly NPC and human-character slots are never randomized", async () => {
  const gameCatalog = await catalog();
  assert.equal(gameCatalog.schemaVersion, 12);
  const protectedSlots = gameCatalog.enemySlots.filter(
    (slot) =>
      (slot.teamType >= 2 && slot.modelName !== "c5291") ||
      slot.modelName === "c0000",
  );
  assert.ok(protectedSlots.length > 150);
  assert.ok(protectedSlots.every((slot) => slot.safeCandidate === false));
  const result = generate(
    { ...defaultConfig, seed: "npc-protection-01" },
    { gameCatalog },
  );
  const randomizedIds = new Set(
    result.placements.enemies.map((placement) => placement.slot),
  );
  assert.ok(protectedSlots.every((slot) => !randomizedIds.has(slot.id)));
});

test("all report-facing item names come from English message tables", async () => {
  const gameCatalog = await catalog();
  const reportEntries = [
    ...gameCatalog.gifts,
    ...gameCatalog.enemyDropLots,
    ...gameCatalog.shopEntries,
    ...Object.values(gameCatalog.startingEquipmentPools).flat(),
  ];
  const japaneseText = /[\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/u;
  assert.ok(reportEntries.length > 500);
  assert.ok(
    reportEntries.every(
      (entry) =>
        typeof entry.name === "string" &&
        entry.name.length > 0 &&
        !japaneseText.test(entry.name),
    ),
  );
});

test("obsolete catalogs require a fresh import", async () => {
  const gameCatalog = await catalog();
  assert.throws(
    () =>
      generate(
        { ...defaultConfig, seed: "obsolete-catalog" },
        { gameCatalog: { ...gameCatalog, schemaVersion: 5 } },
      ),
    /import its data again/u,
  );
});

test("real catalog produces real boss and world-item placements", async () => {
  const gameCatalog = await catalog();
  const result = generate(
    { ...defaultConfig, seed: "real-no-prototype" },
    { gameCatalog },
  );
  assert.ok(result.placements.bosses.length > 20);
  assert.equal(
    result.placements.items.length,
    gameCatalog.worldItemLots.filter((lot) => !lot.protectedProgression).length,
  );
  assert.deepEqual(
    result.placements.items.map((entry) => entry.sourceRowId).sort((a, b) => a - b),
    result.placements.items.map((entry) => entry.rowId).sort((a, b) => a - b),
  );
  assert.ok(
    result.placements.bosses.every(
      (entry) =>
        entry.changed || entry.linkedEnemyGroup === "bed-of-chaos",
    ),
  );
  assert.ok(
    result.placements.bosses.every(
      (entry) =>
        entry.targetModelName !== entry.modelName ||
        entry.linkedEnemyGroup === "bed-of-chaos",
    ),
  );
  assert.ok(result.placements.bosses.every((entry) => Number.isFinite(entry.groundY)));
  for (const modelName of ["c3230", "c5250", "c5320"]) {
    assert.ok(
      result.placements.bosses.some((entry) => entry.modelName === modelName),
      `${modelName} must be included in the boss permutation`,
    );
  }
  const asylum = result.placements.bosses.find(
    (entry) => entry.slot === "m18_01_00_00:c2232_0000",
  );
  assert.ok(asylum);
  assert.notEqual(asylum.targetModelName, "c2232");
  assert.equal(asylum.groundY, 182.11);
  const stray = result.placements.bosses.find(
    (entry) => entry.slot === "m18_01_00_00:c2230_0000",
  );
  assert.ok(stray);
  assert.notEqual(stray.targetModelName, "c2230");
  const assignmentsByVanillaModel = new Map();
  for (const entry of result.placements.bosses.filter(
    (placement) =>
      !placement.linkedDragonGroup && !placement.linkedEnemyGroup,
  )) {
    const previous = assignmentsByVanillaModel.get(entry.modelName);
    if (previous) {
      assert.equal(entry.targetModelName, previous.targetModelName);
      assert.equal(entry.targetThinkParamId, previous.targetThinkParamId);
    } else {
      assignmentsByVanillaModel.set(entry.modelName, entry);
    }
  }
  const dragonModels = new Set([
    "c2730", "c3420", "c3421", "c3430", "c3520",
    "c4510", "c5260", "c5290",
  ]);
  assert.ok(
    result.placements.bosses
      .filter((placement) => placement.linkedDragonGroup)
      .every((placement) => dragonModels.has(placement.targetModelName)),
  );
  for (const [primary, linked] of [["c5270", "c5271"]]) {
    assert.equal(
      assignmentsByVanillaModel.get(linked).targetModelName,
      assignmentsByVanillaModel.get(primary).targetModelName,
    );
  }
  const linkedBossFamilies = new Map([
    ["sanctuary-guardian", new Set(["c3471", "c3472"])],
    ["bell-gargoyles", new Set(["c5350", "c5352"])],
    ["anor-londo-gargoyles", new Set(["c5351", "c5353"])],
    ["centipede-demon", new Set(["c5200", "c5201", "c5202"])],
  ]);
  for (const [group, targetFamily] of linkedBossFamilies) {
    const body = result.placements.bosses.find(
      (entry) => entry.linkedEnemyGroup === group,
    );
    const parts = result.placements.enemies.filter(
      (entry) => entry.linkedEnemyGroup === group,
    );
    assert.ok(body?.changed);
    assert.ok(parts.length > 0);
    const sourceFamily = [...linkedBossFamilies.values()].find((family) =>
      family.has(body.targetModelName),
    );
    assert.ok(sourceFamily);
    assert.ok(parts.every((entry) => sourceFamily.has(entry.targetModelName)));
    assert.ok(
      [...targetFamily].some((modelName) =>
        [body, ...parts].some((entry) => entry.modelName === modelName),
      ),
    );
  }
  const bed = result.placements.bosses.find(
    (entry) => entry.linkedEnemyGroup === "bed-of-chaos",
  );
  assert.equal(bed?.changed, false);
  assert.equal(
    result.placements.enemies.filter(
      (entry) => entry.linkedEnemyGroup === "bed-of-chaos",
    ).length,
    2,
  );
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
    ...defaultConfig,
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
        ...defaultConfig,
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
    ...defaultConfig,
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
  for (const placements of [
    first.placements.gifts,
    first.placements.enemyDrops,
  ]) {
    assert.deepEqual(
      placements.map((entry) => entry.sourceRowId).sort((a, b) => a - b),
      placements.map((entry) => entry.rowId).sort((a, b) => a - b),
    );
  }
  for (const equipType of new Set(
    first.placements.shops.map((entry) => entry.equipType),
  )) {
    const placements = first.placements.shops.filter(
      (entry) => entry.equipType === equipType,
    );
    assert.deepEqual(
      placements.map((entry) => entry.sourceRowId).sort((a, b) => a - b),
      placements.map((entry) => entry.rowId).sort((a, b) => a - b),
    );
  }
});

test("progression protection fixes Lordvessel and Key to the Seal", async () => {
  const gameCatalog = await catalog();
  const protectedResult = generate(
    {
      ...defaultConfig,
      seed: "gifts-protected",
      randomizeGifts: true,
      progressionLogic: true,
    },
    { gameCatalog },
  );
  const chaosResult = generate(
    {
      ...defaultConfig,
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
      ...defaultConfig,
      seed: "shops-protected",
      randomizeShops: true,
      progressionLogic: true,
    },
    { gameCatalog },
  );
  const unprotectedResult = generate(
    {
      ...defaultConfig,
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
