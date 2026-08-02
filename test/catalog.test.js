import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generate } from "../src/core/generator.js";
import { defaultConfig } from "../src/core/config.js";

async function catalog() {
  const data = JSON.parse(await readFile("data/dsr-catalog.json", "utf8"));
  // The locally ignored fixture may have been extracted by an older tool;
  // generator tests exercise the current catalog contract.
  return { ...data, schemaVersion: 15 };
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
    first.placements.enemies.filter(
      (placement) =>
        placement.changed || placement.initialTeamType !== undefined,
    ).length,
  );
  const vanillaScaling = generate(
    { ...config, enemyScaling: "vanilla" },
    { gameCatalog },
  );
  assert.ok(
    vanillaScaling.placements.enemies.every(
      (placement) =>
        placement.scaledNpcParamId === null ||
        placement.makeTangible === true ||
        placement.initialTeamType !== undefined,
    ),
  );
  assert.ok(
    vanillaScaling.placements.enemies
      .filter((placement) => placement.makeTangible === true)
      .every((placement) => placement.scaledNpcParamId !== null),
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
        "passive-asylum-source-ai-permutation",
        "passive-new-londo-entrance-permutation",
        "grounded-new-londo-ghost-slot-permutation",
        "dragon-only-group-permutation",
        "static-bridge-dragon-permutation",
        "disabled-hellkite-flight-auxiliary",
        "linked-dragon-part-permutation",
        "portable-hydra-dragon-permutation",
        "synthetic-linked-hydra-head",
        "linked-hydra-dragon-permutation",
        "disabled-native-hydra-head",
        "linked-mass-of-souls-group-permutation",
        "grounded-linked-boss-auxiliary",
        "linked-boss-part-permutation",
        "vanilla-preserved-linked-bed-of-chaos-part",
      ].includes(placement.compatibility),
    ),
  );

  const slots = new Map(gameCatalog.enemySlots.map((slot) => [slot.id, slot]));
  const activeReplacementThinkParams = new Map([
    ["c2670", 267000],
    ["c2680", 268000],
    ["c3330", 333000],
    ["c2280", 228000],
    ["c2300", 230000],
  ]);
  const ordinaryPlacements = first.placements.enemies.filter(
    (placement) =>
      !placement.linkedDragonGroup && !placement.linkedEnemyGroup,
  );
  assert.equal(
    new Set(ordinaryPlacements.map((placement) => placement.sourceSlot)).size,
    ordinaryPlacements.length,
  );
  const newLondoSolidGhostSlotReplacements = ordinaryPlacements.filter(
    (placement) => {
      const target = slots.get(placement.slot);
      return target?.mapId === "m16_00_00_00" &&
        ["c2670", "c2680"].includes(target.modelName) &&
        !["c2670", "c2680"].includes(placement.targetModelName);
    },
  );
  assert.ok(newLondoSolidGhostSlotReplacements.length > 0);
  assert.ok(newLondoSolidGhostSlotReplacements.every((placement) =>
    placement.compatibility === "grounded-new-londo-ghost-slot-permutation" &&
    Number.isFinite(placement.groundX) &&
    Number.isFinite(placement.groundY) &&
    Number.isFinite(placement.groundZ) &&
    typeof placement.targetCollisionName === "string"));
  assert.ok(
    ordinaryPlacements.every(
      (placement) =>
        !["c3501", "c3510", "c3511"].includes(placement.modelName) &&
        !["c3501", "c3510", "c3511"].includes(placement.targetModelName) &&
        slots.get(placement.slot).npcParamId > 0 &&
        slots.get(placement.sourceSlot).npcParamId > 0 &&
        slots.get(placement.slot).thinkParamId > 0 &&
        slots.get(placement.sourceSlot).thinkParamId > 0,
    ),
  );
  for (const map of gameCatalog.maps) {
    const finalModelBySlot = new Map(
      [...first.placements.enemies, ...first.placements.bosses]
        .filter((placement) => placement.map === map.id)
        .map((placement) => [placement.slot, placement.targetModelName]),
    );
    const declaredModels = new Set(
      gameCatalog.enemySlots
        .filter((slot) => slot.mapId === map.id)
        .map((slot) => finalModelBySlot.get(slot.id) ?? slot.modelName),
    );
    assert.ok(
      declaredModels.size <= 30,
      `${map.id} exceeded the Remastered model declaration budget: ` +
        declaredModels.size,
    );
  }
  const placementsBySlot = new Map(
    ordinaryPlacements.map((placement) => [placement.slot, placement]),
  );
  const massPlacements = first.placements.enemies.filter(
    (placement) => placement.linkedEnemyGroup?.startsWith("mass-of-souls-"),
  );
  assert.equal(massPlacements.length, 14);
  assert.equal(
    new Set(massPlacements.map((placement) => placement.sourceSlot)).size,
    massPlacements.length,
  );
  assert.ok(
    massPlacements.every(
      (placement) =>
        placement.compatibility ===
          "linked-mass-of-souls-group-permutation" &&
        placement.targetModelName === placement.modelName &&
        placement.sourceSlot !== placement.slot,
    ),
  );
  assert.equal(
    massPlacements.find(
      (placement) => placement.slot === "m16_00_00_00:c3500_0001",
    )?.targetModelName,
    "c3500",
  );
  assert.ok(
    first.placements.enemies
      .filter(
        (placement) =>
          ["c2670", "c2680"].includes(placement.targetModelName),
      )
      .every(
        (placement) =>
          placement.makeTangible === true &&
          placement.scaledNpcParamId !== null,
      ),
  );
  const hellkiteBridge = first.placements.enemies.find(
    (placement) => placement.slot === "m10_01_00_00:c3430_0000",
  );
  assert.ok(hellkiteBridge);
  assert.notEqual(hellkiteBridge.targetModelName, "c3430");
  assert.ok(["c3420", "c3520"].includes(hellkiteBridge.targetModelName));
  assert.equal(hellkiteBridge.staticBridgeDragon, true);
  assert.deepEqual(
    [hellkiteBridge.groundX, hellkiteBridge.groundY, hellkiteBridge.groundZ],
    [9.144, 9.55, -48.007],
  );
  assert.equal(hellkiteBridge.targetCollisionName, "h1113B1");
  const bridgeCombatSources = {
    c3420: ["m16_00_00_00:c3420_0000", 342002, 342002],
    c3520: ["m16_00_00_00:c3520_0007", 352002, 352002],
  };
  assert.deepEqual(
    [
      hellkiteBridge.sourceSlot,
      hellkiteBridge.targetNpcParamId,
      hellkiteBridge.targetThinkParamId,
    ],
    bridgeCombatSources[hellkiteBridge.targetModelName],
  );
  const disabledHellkiteAuxiliaries = first.placements.enemies.filter(
    (placement) =>
      placement.compatibility === "disabled-hellkite-flight-auxiliary",
  );
  assert.equal(disabledHellkiteAuxiliaries.length, 2);
  assert.ok(
    disabledHellkiteAuxiliaries.every(
      (placement) => placement.disableEntity && placement.groundY === -1000,
    ),
  );
  const randomizedDrakes = first.placements.enemies.filter(
    (placement) => placement.targetModelName === "c3520",
  );
  assert.ok(randomizedDrakes.length > 10);
  assert.ok(
    randomizedDrakes.every(
      (placement) =>
        placement.sourceSlot === "m16_00_00_00:c3520_0007" &&
        placement.targetNpcParamId === 352002 &&
        placement.targetThinkParamId === 352002 &&
        placement.targetBattleGoalId === 352002,
    ),
  );
  for (const slotId of [
    "m18_01_00_00:c2500_0000",
    "m18_01_00_00:c2500_0001",
    "m18_01_00_00:c2500_0002",
  ]) {
    const placement = placementsBySlot.get(slotId);
    const source = slots.get(placement.sourceSlot);
    assert.equal(
      placement.baseThinkParamId,
      activeReplacementThinkParams.get(source.modelName) ?? source.thinkParamId,
    );
    assert.ok(placement.targetThinkParamId >= 9_600_000);
    assert.equal(placement.passiveUntilAttacked, true);
    assert.equal(placement.initialTeamType, 2);
    assert.ok(placement.scaledNpcParamId !== null);
    assert.equal(
      placement.compatibility,
      "passive-asylum-source-ai-permutation",
    );
  }
  const newLondoPassive = ordinaryPlacements.filter((placement) =>
    placement.slot.startsWith("m16_00_00_00:c2500_"),
  );
  assert.equal(newLondoPassive.length, 15);
  assert.ok(
    newLondoPassive.every(
      (placement) =>
        placement.passiveUntilAttacked === true &&
        placement.initialTeamType === 2 &&
        placement.scaledNpcParamId !== null &&
        placement.entityId >= 16_099_000 &&
        placement.compatibility ===
          "passive-new-londo-entrance-permutation",
    ),
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
    assert.equal(slot.teamType, 0);
    assert.notEqual(slot.modelName, "c0000");
    assert.equal(placement.targetModelName, source.modelName);
    assert.equal(placement.targetNpcParamId, source.npcParamId);
    assert.equal(
      placement.baseThinkParamId,
      activeReplacementThinkParams.get(source.modelName) ?? source.thinkParamId,
    );
    assert.equal(placement.destinationThinkParamId, slot.thinkParamId);
    assert.equal(placement.preserveDestinationPerception, true);
    assert.ok(placement.targetThinkParamId >= 9_600_000);
    if (placement.passiveUntilAttacked) {
      assert.equal(placement.passiveUntilAttacked, true);
      assert.ok(
        [
          "passive-asylum-source-ai-permutation",
          "passive-new-londo-entrance-permutation",
        ].includes(placement.compatibility),
      );
    } else {
      assert.equal(placement.passiveUntilAttacked, undefined);
    }
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
    "c3520", "c3530", "c3531", "c4510", "c4511", "c5260", "c5261",
    "c5290", "c5291",
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
  assert.ok(
    ordinaryPlacements.every(
      (placement) =>
        placement.sourceSlot !== "m15_01_00_00:c2360_0001" &&
        placement.targetModelName !== "c2360",
    ),
    "Super Smough must never enter the regular-enemy pool",
  );
  const portableHydraBodies = first.placements.enemies.filter(
    (placement) => placement.compatibility ===
      "portable-hydra-dragon-permutation",
  );
  assert.ok(portableHydraBodies.length > 0);
  for (const body of portableHydraBodies) {
    const heads = first.placements.enemies.filter(
      (placement) =>
        placement.linkedDragonGroup === body.linkedDragonGroup &&
        placement.compatibility === "synthetic-linked-hydra-head",
    );
    assert.equal(heads.length, 7);
    assert.ok(heads.every((head) =>
      head.syntheticEnemy === true &&
      head.portableHydraGroup === true &&
      head.map === body.map &&
      head.targetModelName === "c3531" &&
      head.targetCollisionName === body.targetCollisionName));
    assert.deepEqual(
      heads.map((head) => head.entityId).sort((a, b) => a - b),
      Array.from({ length: 7 }, (_, index) => body.entityId + index + 1),
    );
  }
  const nativeHydraTargets = first.placements.enemies.filter(
    (placement) => placement.modelName === "c3530",
  );
  assert.equal(nativeHydraTargets.length, 3);
  assert.ok(nativeHydraTargets.every((body) =>
    first.placements.enemies.filter((placement) =>
      placement.linkedDragonGroup === body.linkedDragonGroup &&
      placement.modelName === "c3531").length === 7));
  assert.ok(
    ordinaryPlacements
      .filter(
        (placement) =>
          ["c2280", "c2300"].includes(placement.targetModelName) &&
          placement.entityId >= 0 &&
          !placement.passiveUntilAttacked,
      )
      .every((placement) => placement.forceCombatActivation === true),
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
  assert.equal(gameCatalog.schemaVersion, 15);
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
  const blueTearstoneLot = gameCatalog.worldItemLots.find(
    (lot) => lot.rowId === 1_010_160,
  );
  assert.equal(blueTearstoneLot?.protectedProgression, false);
  assert.notEqual(
    result.placements.items.find((entry) => entry.rowId === 1_010_160)
      ?.sourceRowId,
    1_010_160,
  );
  const newlyRandomizedProgressionItems = new Set([
    "Large Ember",
    "Very Large Ember",
    "Crystal Ember",
    "Large Magic Ember",
    "Enchanted Ember",
    "Divine Ember",
    "Large Divine Ember",
    "Dark Ember",
    "Large Flame Ember",
    "Chaos Flame Ember",
    "Peculiar Doll",
    "Darkmoon Seance Ring",
  ]);
  const randomizedFormerProgressionLots = gameCatalog.worldItemLots.filter(
    (lot) => newlyRandomizedProgressionItems.has(lot.name),
  );
  assert.equal(randomizedFormerProgressionLots.length, 12);
  assert.ok(
    randomizedFormerProgressionLots.every(
      (lot) => !lot.protectedProgression,
    ),
  );
  assert.equal(
    gameCatalog.worldItemLots.filter((lot) => lot.protectedProgression).length,
    13,
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
  assert.ok(
    result.placements.bosses.every(
      (entry) =>
        Number.isFinite(entry.groundX) &&
        Number.isFinite(entry.groundY) &&
        Number.isFinite(entry.groundZ),
    ),
  );
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
  assert.equal(asylum.groundX, 3.41);
  assert.equal(asylum.groundY, 197.61);
  assert.equal(asylum.groundZ, -23.1);
  assert.equal(asylum.combatRegionId, 1812996);
  assert.equal(asylum.combatExitRegionId, 1812320);
  const stray = result.placements.bosses.find(
    (entry) => entry.slot === "m18_01_00_00:c2230_0000",
  );
  assert.ok(stray);
  assert.notEqual(stray.targetModelName, "c2230");
  assert.equal(stray.activationRegionId, 1812896);
  assert.equal(stray.activationWarpRegionId, 1812302);
  assert.deepEqual(
    [stray.groundX, stray.groundY, stray.groundZ],
    [3.31, 100, -19],
  );
  const gwyndolinReplacement = result.placements.bosses.find(
    (entry) => entry.targetModelName === "c5320",
  );
  assert.ok(gwyndolinReplacement);
  assert.ok(gwyndolinReplacement.scaledNpcParamId !== null);
  assert.ok([0, 1].includes(gwyndolinReplacement.initialTeamType));
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
  const trueBossModels = new Set(
    gameCatalog.bossSlots
      .filter((slot) => slot.mapId !== "m15_01_00_00" || slot.modelName !== "c5351")
      .map((slot) => slot.modelName),
  );
  assert.ok(
    result.placements.bosses.every(
      (placement) =>
        placement.linkedEnemyGroup === "bed-of-chaos" ||
        trueBossModels.has(placement.targetModelName),
    ),
    "boss encounters must only receive boss replacements",
  );
  assert.ok(
    result.placements.bosses.every(
      (placement) => placement.targetModelName !== "c5351",
    ),
    "ordinary Anor Londo gargoyles must not enter the boss pool",
  );
  assert.ok(
    result.placements.bosses.every(
      (placement) => placement.targetModelName !== "c3230",
    ),
    "Moonlight Butterfly must not leave its arena as a replacement boss",
  );
  assert.ok(
    result.placements.bosses
      .filter((placement) => placement.modelName === "c3230")
      .every((placement) => placement.targetModelName !== "c3230"),
    "the original Butterfly encounter must still be randomized",
  );
  const taurus = result.placements.bosses.find(
    (entry) => entry.slot === "m10_01_00_00:c2250_0000",
  );
  assert.equal(taurus.activationRegionId, 1012701);
  assert.deepEqual(
    [taurus.groundX, taurus.groundY, taurus.groundZ],
    [1.16, 15.82, -114.34],
  );
  for (const [slot, expected] of new Map([
    ["m12_00_00_00:c3230_0000", [196.12, 8.09, 62.25]],
    ["m12_00_00_01:c3230_0000", [196.12, 8.09, 62.25]],
    ["m14_01_00_00:c5250_0000", [396.14, -278.14, 74.56]],
    ["m10_01_00_00:c5350_0002", [6.14, 48.92, 124.35]],
  ])) {
    const placement = result.placements.bosses.find((entry) => entry.slot === slot);
    assert.deepEqual(
      [placement.groundX, placement.groundY, placement.groundZ],
      expected,
      `${slot} must use its playable-arena spawn`,
    );
    if (slot.includes(":c3230_0000"))
      assert.equal(placement.activationRegionId, 1202896);
  }
  const stagedGargoyle = result.placements.enemies.find(
    (entry) => entry.slot === "m10_01_00_00:c5350_0001",
  );
  assert.deepEqual(
    [
      stagedGargoyle.groundX,
      stagedGargoyle.groundY,
      stagedGargoyle.groundZ,
    ],
    [10.69, 48.92, 124.35],
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

test("protected world items join the global pool except both Asylum keys", async () => {
  const gameCatalog = await catalog();
  const eastKeyRowId = 1_020_220;
  const catalogWithEastKey = {
    ...gameCatalog,
    worldItemLots: [
      ...gameCatalog.worldItemLots,
      {
        rowId: eastKeyRowId,
        name: "Undead Asylum F2 East Key",
        mapId: "m10_02_00_00",
        protectedProgression: true,
        entries: [
          { itemId: 2015, category: 0x40000000, quantity: 1 },
        ],
      },
    ],
  };
  const result = generate(
    {
      ...defaultConfig,
      seed: "all-world-items-except-asylum-keys",
      randomizeItems: true,
      randomizeProtectedItems: true,
    },
    { gameCatalog: catalogWithEastKey },
  );
  const fixedRowIds = new Set([1_810_000, eastKeyRowId]);
  assert.ok(
    result.placements.items.every(
      (entry) =>
        !fixedRowIds.has(entry.rowId) &&
        !fixedRowIds.has(entry.sourceRowId),
    ),
  );
  assert.equal(
    result.placements.items.length,
    catalogWithEastKey.worldItemLots.length - fixedRowIds.size,
  );
  const protectedRowIds = new Set(
    gameCatalog.worldItemLots
      .filter(
        (lot) => lot.protectedProgression && !fixedRowIds.has(lot.rowId),
      )
      .map((lot) => lot.rowId),
  );
  assert.ok(protectedRowIds.size > 0);
  assert.ok(
    [...protectedRowIds].every((rowId) =>
      result.placements.items.some(
        (entry) => entry.rowId === rowId || entry.sourceRowId === rowId,
      )),
  );
  assert.ok(
    result.placements.items.some(
      (entry) =>
        protectedRowIds.has(entry.sourceRowId) &&
        !protectedRowIds.has(entry.rowId),
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
          entry.equipment.pickupWeapon.name !== "Fists" &&
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
    assert.ok(allWeapons.every((id) => id % 1_000 === 0));
    assert.ok(allWeapons.every((id) => !vanilla.weapons.has(id)));
    for (const field of ["helm", "armor", "gauntlets", "legs"]) {
      const armorIds = result.placements.startingClasses.map(
        (entry) => entry.equipment[field].id,
      );
      assert.equal(new Set(armorIds).size, armorIds.length);
      assert.ok(armorIds.every((id) => !vanilla.armor.has(id)));
    }
    const allArmor = result.placements.startingClasses.flatMap((entry) => [
      entry.equipment.helm.id,
      entry.equipment.armor.id,
      entry.equipment.gauntlets.id,
      entry.equipment.legs.id,
    ]);
    assert.equal(new Set(allArmor).size, allArmor.length);
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
  for (const bossDropRowId of [33_006_000, 34_310_000, 53_520_000]) {
    assert.ok(
      first.placements.enemyDrops.some(
        (entry) => entry.rowId === bossDropRowId,
      ),
    );
  }
  for (const protectedRowId of [1090, 2670, 26_900_100, 27_100_200]) {
    assert.ok(
      first.placements.enemyDrops.every(
        (entry) =>
          entry.rowId !== protectedRowId &&
          entry.sourceRowId !== protectedRowId,
      ),
    );
  }
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
