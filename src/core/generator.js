import { createHash } from "node:crypto";
import { createStream } from "./rng.js";
import { normalizeConfig, validateConfig } from "./config.js";
import {
  enemies,
  enemySlots,
  bosses,
  bossSlots,
  items,
  itemLocations,
} from "../data/prototype-data.js";

const byId = (values) => new Map(values.map((value) => [value.id, value]));
const dragonBodyModels = new Set([
  "c2730", // Crossbreed Priscilla
  "c3420", // Undead Dragon
  "c3421", // Bounding Demon / Undead Dragon legs
  "c3430", // Hellkite Drake
  "c3520", // Drake
  "c4510", // Black Dragon Kalameet
  "c5260", // Gaping Dragon
  "c5290", // Seath the Scaleless
]);
const linkedPartModels = new Set([
  "c2731", // Priscilla's tail
  "c3422", // Undead Dragon wing
  "c3431", // Hellkite tail
  "c3451", // Everlasting Dragon tail; its friendly parent stays protected
  "c3472", // Sanctuary Guardian tail
  "c3531", // Hydra heads
  "c4511", // Kalameet tail
  "c5201", "c5202", // Centipede Demon limbs
  "c5261", // Gaping Dragon tail
  "c5291", // Seath's tail
  "c5352", "c5353", // Gargoyle tails
  "c5400", "c5401", // Bed of Chaos linked encounter parts
]);
const internalHelperModels = new Set([
  "c3510", // Asylum transport crow
]);
const dragonNames = new Map([
  ["c2730", "Crossbreed Priscilla"],
  ["c3420", "Undead Dragon"],
  ["c3421", "Bounding Demon"],
  ["c3430", "Hellkite Drake"],
  ["c3520", "Drake"],
  ["c4510", "Black Dragon Kalameet"],
  ["c5260", "Gaping Dragon"],
  ["c5290", "Seath the Scaleless"],
]);
const additionalBossNames = new Map([
  ["c3230", "Moonlight Butterfly"],
  ["c5230", "Bed of Chaos"],
  ["c5250", "Ceaseless Discharge"],
  ["c5320", "Dark Sun Gwyndolin"],
]);
const additionalBossModels = new Set(additionalBossNames.keys());

function effectiveBossSlots(catalog) {
  const result = new Map(
    (catalog.bossSlots || []).map((slot) => [slot.id, slot]),
  );
  for (const slot of catalog.enemySlots) {
    const modelId = Number(slot.modelName.slice(1));
    if (
      additionalBossModels.has(slot.modelName) &&
      !slot.dummy &&
      slot.npcParamId === modelId * 100 &&
      slot.thinkParamId > 1000
    ) {
      result.set(slot.id, slot);
    }
  }
  return [...result.values()];
}

function pickCompatibleEnemy(rng, slot, pool) {
  const sizeOrder = { small: 0, medium: 1, large: 2 };
  let candidates = pool.filter(
    (enemy) => sizeOrder[enemy.size] <= sizeOrder[slot.maxSize],
  );
  if (candidates.length === 0) candidates = pool;
  return candidates[rng.int(candidates.length)];
}

function randomizePrototypeEnemies(config) {
  if (!config.randomizeEnemies) return [];
  const rng = createStream(config.seed, "enemies", config.version);
  const enemyIndex = byId(enemies);
  return enemySlots.map((slot) => {
    const replacement = pickCompatibleEnemy(rng, slot, enemies);
    return {
      slot: slot.id,
      map: slot.map,
      from: enemyIndex.get(slot.original).name,
      to: replacement.name,
      scaling: config.enemyScaling,
      areaTier: slot.areaTier,
    };
  });
}

function groundYForBoss(slot, catalog) {
  if (slot.mapId === "m18_01_00_00" && slot.modelName === "c2232") {
    return catalog.enemySlots.find(
      (candidate) =>
        candidate.mapId === slot.mapId && candidate.modelName === "c2230",
    )?.position.y ?? slot.position.y;
  }
  return Math.min(
    ...catalog.enemySlots
      .filter(
        (candidate) =>
          candidate.mapId === slot.mapId &&
          candidate.modelName === slot.modelName &&
          !candidate.dummy,
      )
      .map((candidate) => candidate.position.y),
  );
}

function enemyPlacement(config, target, source, scaledNpcParamId, extra = {}) {
  const changed =
    source.modelName !== target.modelName ||
    source.npcParamId !== target.npcParamId ||
    source.thinkParamId !== target.thinkParamId;
  return {
    slot: target.id,
    sourceSlot: source.id,
    sourceMap: source.mapId,
    map: target.mapId,
    entityId: target.entityId,
    from: `${target.modelName} [NPC ${target.npcParamId} / AI ${target.thinkParamId}]`,
    to: `${source.modelName} [NPC ${source.npcParamId} / AI ${source.thinkParamId}]`,
    modelName: target.modelName,
    targetModelName: source.modelName,
    sourceNpcParamId: target.npcParamId,
    sourceThinkParamId: target.thinkParamId,
    targetNpcParamId: source.npcParamId,
    targetThinkParamId: source.thinkParamId,
    targetBattleGoalId: source.battleGoalId,
    scaledNpcParamId:
      config.enemyScaling === "vanilla" || !changed
        ? null
        : scaledNpcParamId,
    changed,
    scaling: config.enemyScaling,
    ...extra,
  };
}

function buildDragonPlan(config, catalog) {
  const bossSlotIds = new Set(effectiveBossSlots(catalog).map((slot) => slot.id));
  const slots = catalog.enemySlots;
  const byModel = (modelName, mapId = null) =>
    slots.filter(
      (slot) =>
        slot.modelName === modelName &&
        (!mapId || slot.mapId === mapId),
    );
  const unit = (id, bodies, parts = []) => ({ id, bodies, parts });
  const units = [
    unit(
      "priscilla",
      byModel("c2730", "m11_00_00_00"),
      byModel("c2731", "m11_00_00_00"),
    ),
    unit(
      "painted-undead-dragon",
      byModel("c3420", "m11_00_00_00"),
      [
        ...byModel("c3421", "m11_00_00_00"),
        ...byModel("c3422", "m11_00_00_00"),
      ],
    ),
    unit(
      "valley-undead-dragon",
      byModel("c3420", "m16_00_00_00"),
    ),
    unit(
      "hellkite",
      byModel("c3430", "m10_01_00_00"),
      byModel("c3431", "m10_01_00_00"),
    ),
    unit(
      "kalameet",
      byModel("c4510", "m12_01_00_00"),
      byModel("c4511", "m12_01_00_00"),
    ),
    unit(
      "gaping-dragon",
      byModel("c5260", "m10_00_00_00"),
      byModel("c5261", "m10_00_00_00"),
    ),
    unit(
      "seath",
      byModel("c5290", "m17_00_00_00"),
      byModel("c5291", "m17_00_00_00"),
    ),
    ...byModel("c3421", "m14_01_00_00").map((body) =>
      unit(`bounding-${body.id}`, [body])),
    ...byModel("c3520").map((body) => unit(`drake-${body.id}`, [body])),
  ].filter((entry) => entry.bodies.length > 0);

  const enabled = units.filter((entry) => {
    const boss = entry.bodies.some((body) => bossSlotIds.has(body.id));
    return boss ? config.randomizeBosses : config.randomizeEnemies;
  });
  const assignments = new Map();
  const rng = createStream(config.seed, "dragons", config.version);
  for (const partCount of new Set(enabled.map((entry) => entry.parts.length))) {
    const targets = enabled.filter((entry) => entry.parts.length === partCount);
    const sources = shuffledWithoutFixedPoints(rng, targets);
    targets.forEach((target, index) => assignments.set(target.id, sources[index]));
  }

  const areaNames = new Map(
    (catalog.maps || []).map((map) => [map.id, map.name]),
  );
  const bossNames = catalog.bossNames || {};
  const result = { enemies: [], bosses: [], reservedSlotIds: new Set() };
  let enemyIndex = 0;
  let bossIndex = 0;
  for (const target of enabled) {
    const source = assignments.get(target.id);
    [...target.bodies, ...target.parts].forEach((slot) =>
      result.reservedSlotIds.add(slot.id),
    );
    target.bodies.forEach((targetBody, index) => {
      const sourceBody = source.bodies[index % source.bodies.length];
      const isBoss = bossSlotIds.has(targetBody.id);
      const extra = isBoss
        ? {
            originalBossName:
              bossNames[targetBody.modelName] ||
              dragonNames.get(targetBody.modelName) ||
              targetBody.modelName,
            randomizedBossName:
              bossNames[sourceBody.modelName] ||
              dragonNames.get(sourceBody.modelName) ||
              sourceBody.modelName,
            encounterLocation: {
              area: areaNames.get(targetBody.mapId) || targetBody.mapId,
              map: targetBody.mapId,
              slot: targetBody.name,
            },
            compatibility: "grounded-dragon-group-permutation",
            groundY: groundYForBoss(targetBody, catalog),
            linkedDragonGroup: target.id,
          }
        : {
            compatibility: "dragon-only-group-permutation",
            linkedDragonGroup: target.id,
          };
      const placement = enemyPlacement(
        config,
        targetBody,
        sourceBody,
        isBoss ? 9_250_000 + bossIndex++ : 9_150_000 + enemyIndex++,
        extra,
      );
      (isBoss ? result.bosses : result.enemies).push(placement);
    });
    target.parts.forEach((targetPart, index) => {
      const sourcePart = source.parts[index];
      result.enemies.push(enemyPlacement(
        config,
        targetPart,
        sourcePart,
        9_150_000 + enemyIndex++,
        {
          compatibility: "linked-dragon-part-permutation",
          linkedDragonGroup: target.id,
        },
      ));
    });
  }

  if (config.randomizeEnemies) {
    const hydras = ["m12_00_00_00", "m12_00_00_01", "m13_02_00_00"]
      .map((mapId) =>
        unit(
          `hydra-${mapId}`,
          byModel("c3530", mapId),
          byModel("c3531", mapId),
        ))
      .filter((entry) => entry.bodies.length && entry.parts.length);
    const hydraSources = shuffledWithoutFixedPoints(rng, hydras);
    hydras.forEach((target, unitIndex) => {
      const source = hydraSources[unitIndex];
      [...target.bodies, ...target.parts].forEach((slot) =>
        result.reservedSlotIds.add(slot.id),
      );
      target.bodies.forEach((targetBody, index) => {
        result.enemies.push(enemyPlacement(
          config,
          targetBody,
          source.bodies[index],
          9_150_000 + enemyIndex++,
          {
            compatibility: "linked-hydra-group-permutation",
            linkedEnemyGroup: target.id,
          },
        ));
      });
      target.parts.forEach((targetPart, index) => {
        result.enemies.push(enemyPlacement(
          config,
          targetPart,
          source.parts[index],
          9_150_000 + enemyIndex++,
          {
            compatibility: "linked-hydra-part-permutation",
            linkedEnemyGroup: target.id,
          },
        ));
      });
    });
  }

  if (config.randomizeBosses) {
    const linkedBossRng = createStream(
      config.seed,
      "linked-bosses",
      config.version,
    );
    const linkedBosses = [
      unit(
        "sanctuary-guardian",
        byModel("c3471", "m12_01_00_00"),
        byModel("c3472", "m12_01_00_00"),
      ),
      unit(
        "bell-gargoyles",
        byModel("c5350", "m10_01_00_00"),
        byModel("c5352", "m10_01_00_00"),
      ),
      unit(
        "anor-londo-gargoyles",
        byModel("c5351", "m15_01_00_00"),
        byModel("c5353", "m15_01_00_00"),
      ),
      unit(
        "centipede-demon",
        byModel("c5200", "m14_01_00_00"),
        [
          ...byModel("c5201", "m14_01_00_00"),
          ...byModel("c5202", "m14_01_00_00"),
        ],
      ),
    ].filter((entry) => entry.bodies.length && entry.parts.length);
    const linkedBossSources = shuffledWithoutFixedPoints(
      linkedBossRng,
      linkedBosses,
    );
    linkedBosses.forEach((target, unitIndex) => {
      const source = linkedBossSources[unitIndex];
      [...target.bodies, ...target.parts].forEach((slot) =>
        result.reservedSlotIds.add(slot.id),
      );
      target.bodies.forEach((targetBody, index) => {
        const sourceBody = source.bodies[index % source.bodies.length];
        const isBossSlot = bossSlotIds.has(targetBody.id);
        const placement = enemyPlacement(
          config,
          targetBody,
          sourceBody,
          isBossSlot
            ? 9_300_000 + bossIndex++
            : 9_350_000 + enemyIndex++,
          isBossSlot
            ? {
                originalBossName:
                  bossNames[targetBody.modelName] || targetBody.modelName,
                randomizedBossName:
                  bossNames[sourceBody.modelName] || sourceBody.modelName,
                encounterLocation: {
                  area: areaNames.get(targetBody.mapId) || targetBody.mapId,
                  map: targetBody.mapId,
                  slot: targetBody.name,
                },
                compatibility: "grounded-linked-boss-group-permutation",
                groundY: groundYForBoss(targetBody, catalog),
                linkedEnemyGroup: target.id,
              }
            : {
                compatibility: "grounded-linked-boss-auxiliary",
                groundY: groundYForBoss(targetBody, catalog),
                linkedEnemyGroup: target.id,
              },
        );
        (isBossSlot ? result.bosses : result.enemies).push(placement);
      });
      target.parts.forEach((targetPart, index) => {
        const sourcePart = source.parts[index % source.parts.length];
        result.enemies.push(enemyPlacement(
          config,
          targetPart,
          sourcePart,
          9_350_000 + enemyIndex++,
          {
            compatibility: "linked-boss-part-permutation",
            linkedEnemyGroup: target.id,
          },
        ));
      });
    });

    const bedBodies = byModel("c5230", "m14_01_00_00");
    const bedParts = [
      ...byModel("c5400", "m14_01_00_00"),
      ...byModel("c5401", "m14_01_00_00"),
    ];
    [...bedBodies, ...bedParts].forEach((slot) =>
      result.reservedSlotIds.add(slot.id),
    );
    for (const body of bedBodies) {
      result.bosses.push(enemyPlacement(config, body, body, null, {
        originalBossName: "Bed of Chaos",
        randomizedBossName: "Bed of Chaos",
        encounterLocation: {
          area: areaNames.get(body.mapId) || body.mapId,
          map: body.mapId,
          slot: body.name,
        },
        compatibility: "vanilla-preserved-linked-bed-of-chaos",
        groundY: groundYForBoss(body, catalog),
        linkedEnemyGroup: "bed-of-chaos",
      }));
    }
    for (const part of bedParts) {
      result.enemies.push(enemyPlacement(config, part, part, null, {
        compatibility: "vanilla-preserved-linked-bed-of-chaos-part",
        linkedEnemyGroup: "bed-of-chaos",
      }));
    }
  }
  return result;
}

function randomizeExtractedEnemies(config, catalog, dragonPlan) {
  if (!config.randomizeEnemies) return dragonPlan.enemies;
  const rng = createStream(config.seed, "enemies", config.version);
  const bossSlotIds = new Set(effectiveBossSlots(catalog).map((slot) => slot.id));
  const slots = catalog.enemySlots.filter(
    (slot) =>
      /^m1[0-8]_/u.test(slot.mapId) &&
      !bossSlotIds.has(slot.id) &&
      !dragonPlan.reservedSlotIds.has(slot.id) &&
      (slot.teamType === 0 || slot.modelName === "c3501") &&
      slot.modelName !== "c0000" &&
      slot.modelName.startsWith("c") &&
      slot.npcParamId >= 0 &&
      slot.thinkParamId >= 0 &&
      slot.baseHp > 0 &&
      !dragonBodyModels.has(slot.modelName) &&
      !linkedPartModels.has(slot.modelName) &&
      !internalHelperModels.has(slot.modelName),
  );

  const shuffledSources = shuffledWithoutFixedPoints(rng, slots);
  const assignment = new Map(
    slots.map((target, index) => [target.id, shuffledSources[index]]),
  );

  return slots.map((slot, index) => {
    const replacement = assignment.get(slot.id) ?? slot;
    const changed =
      replacement.modelName !== slot.modelName ||
      replacement.npcParamId !== slot.npcParamId ||
      replacement.thinkParamId !== slot.thinkParamId;
    return enemyPlacement(config, slot, replacement, 9_100_000 + index, {
      compatibility: changed
        ? "count-preserving-unrestricted-permutation"
        : replacement.id !== slot.id
          ? "count-preserving-identical-source-permutation"
          : "count-preserving-fixed-point",
    });
  }).concat(dragonPlan.enemies);
}

const canonicalBossModel = new Map([
  ["c5271", "c5270"],
  ["c5351", "c5350"],
]);

function randomizeExtractedBosses(config, catalog, dragonPlan) {
  if (!config.randomizeBosses || !catalog?.bossSlots?.length) return [];
  const rng = createStream(config.seed, "bosses", config.version);
  const areaNames = new Map(
    (catalog.maps || []).map((map) => [map.id, map.name]),
  );
  const bossNames = catalog.bossNames || {};
  const sources = effectiveBossSlots(catalog).filter(
    (slot) =>
      !dragonPlan.reservedSlotIds.has(slot.id) &&
      slot.npcParamId >= 0 &&
      slot.thinkParamId >= 0,
  );
  const modelNames = [
    ...new Set(sources.map(
      (slot) => canonicalBossModel.get(slot.modelName) || slot.modelName,
    )),
  ];
  const archetypes = modelNames.map((modelName) =>
    sources.find(
      (slot) =>
        (canonicalBossModel.get(slot.modelName) || slot.modelName) ===
          modelName &&
        slot.modelName === modelName,
    ) ?? sources.find(
      (slot) =>
        (canonicalBossModel.get(slot.modelName) || slot.modelName) ===
        modelName,
    ),
  );
  const shuffled = shuffledWithoutFixedPoints(rng, archetypes);
  const replacementsByModel = new Map();
  modelNames.forEach((modelName, index) =>
    replacementsByModel.set(modelName, shuffled[index]),
  );
  const placements = sources.map((slot, index) => {
    const sourceModelName =
      canonicalBossModel.get(slot.modelName) || slot.modelName;
    const replacement = replacementsByModel.get(sourceModelName);
    const originalBossName =
      bossNames[sourceModelName] ||
      additionalBossNames.get(sourceModelName) ||
      `${sourceModelName} [NPC ${slot.npcParamId}]`;
    const randomizedBossName =
      bossNames[replacement.modelName] ||
      additionalBossNames.get(replacement.modelName) ||
      `${replacement.modelName} [NPC ${replacement.npcParamId}]`;
    return enemyPlacement(config, slot, replacement, 9_200_000 + index, {
      originalBossName,
      randomizedBossName,
      encounterLocation: {
        area: areaNames.get(slot.mapId) || slot.mapId,
        map: slot.mapId,
        slot: slot.name,
      },
      compatibility: canonicalBossModel.has(slot.modelName)
        ? "linked-boss-form"
        : "grounded-unrestricted-boss-permutation",
      groundY: groundYForBoss(slot, catalog),
    });
  });
  return placements.concat(dragonPlan.bosses);
}

function randomizeExtractedItems(config, catalog) {
  if (!catalog?.worldItemLots?.length) return [];
  const areaNames = new Map(
    (catalog.maps || []).map((map) => [map.id, map.name]),
  );
  const describeLocation = (lot) => ({
    area: areaNames.get(lot.mapId) || lot.mapId,
    map: lot.mapId,
    itemLot: lot.rowId,
  });
  const lots = catalog.worldItemLots.filter((lot) =>
    lot.protectedProgression
      ? config.randomizeKeyItems && !config.progressionLogic
      : config.randomizeItems,
  );
  if (lots.length < 2) return [];
  const rng = createStream(config.seed, "world-items", config.version);
  const ordinary = lots.filter((lot) => !lot.protectedProgression);
  const progression = lots.filter((lot) => lot.protectedProgression);
  const placements = [];
  for (const group of [ordinary, progression]) {
    if (group.length < 2) continue;
    const sources = shuffledWithoutFixedPoints(rng, group);
    group.forEach((target, index) => {
      const source = sources[index];
      placements.push({
        rowId: target.rowId,
        sourceRowId: source.rowId,
        location: `itemlot:${target.rowId}`,
        map: target.mapId,
        from: target.name,
        to: source.name,
        itemName: source.name,
        originalLocation: describeLocation(source),
        randomizedLocation: describeLocation(target),
        progression: source.protectedProgression,
        preserved: target.rowId === source.rowId,
      });
    });
  }
  return placements;
}

function shuffledWithoutFixedPoints(rng, values) {
  if (values.length < 2) return [...values];
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const shuffled = rng.shuffle(values);
    if (shuffled.every((value, index) => value !== values[index])) return shuffled;
  }
  return [...values.slice(1), values[0]];
}

function randomizeStartingClasses(config, catalog) {
  if (
    (!config.randomizeStartingClass && !config.randomizeStartingEquipment) ||
    !catalog?.startingClasses?.length
  ) {
    return [];
  }
  const classes = catalog.startingClasses;
  const statsRng = createStream(config.seed, "starting-classes", config.version);
  const equipmentRng = createStream(
    config.seed,
    "starting-equipment",
    config.version,
  );
  const statsSources = config.randomizeStartingClass
    ? shuffledWithoutFixedPoints(statsRng, classes)
    : classes;
  const equipmentPools = catalog.startingEquipmentPools;
  const hasGeneralEquipmentPools = Boolean(
    equipmentPools?.weapons?.length &&
      equipmentPools?.helms?.length &&
      equipmentPools?.armors?.length &&
      equipmentPools?.gauntlets?.length &&
      equipmentPools?.legs?.length,
  );
  const specialIds = new Set(["hunter", "sorcerer", "pyromancer", "cleric"]);
  const vanillaStartingWeaponIds = new Set();
  const vanillaStartingArmorIds = new Set();
  for (const itemLot of catalog.startingItemLots || []) {
    for (const [name, value] of Object.entries(itemLot.cells || {})) {
      if (name.startsWith("lotItemId") && Number(value) > 0) {
        vanillaStartingWeaponIds.add(Number(value));
      }
    }
  }
  for (const startingClass of classes) {
    for (const row of [startingClass.display, startingClass.start]) {
      for (const field of ["equip_Wep_Right", "equip_Subwep_Right", "equip_Wep_Left", "equip_Subwep_Left"]) {
        if (Number(row[field]) >= 0) vanillaStartingWeaponIds.add(Number(row[field]));
      }
      for (const field of ["equip_Helm", "equip_Armer", "equip_Gaunt", "equip_Leg"]) {
        if (Number(row[field]) >= 0) vanillaStartingArmorIds.add(Number(row[field]));
      }
    }
  }
  const randomArmorPools = {
    helms: (equipmentPools?.helms || []).filter(
      (item) => !vanillaStartingArmorIds.has(item.id),
    ),
    armors: (equipmentPools?.armors || []).filter(
      (item) => !vanillaStartingArmorIds.has(item.id),
    ),
    gauntlets: (equipmentPools?.gauntlets || []).filter(
      (item) => !vanillaStartingArmorIds.has(item.id),
    ),
    legs: (equipmentPools?.legs || []).filter(
      (item) => !vanillaStartingArmorIds.has(item.id),
    ),
  };
  const usedArmorIds = {
    helm: new Set(),
    armor: new Set(),
    gauntlets: new Set(),
    legs: new Set(),
  };
  const pickUnique = (pool, used, label) => {
    const available = pool.filter((item) => !used.has(item.id));
    if (available.length === 0) {
      throw new Error(`No unique options remain in the ${label} pool.`);
    }
    const selected = available[equipmentRng.int(available.length)];
    used.add(selected.id);
    return selected;
  };
  const weaponAssignments = new Map();
  if (config.randomizeStartingEquipment && hasGeneralEquipmentPools) {
    const requests = [];
    classes.forEach((target, index) => {
      const stats = statsSources[index].start;
      const usableWeapons = equipmentPools.weapons.filter(
        (weapon) =>
          weapon.strength <= Number(stats.baseStr) &&
          weapon.dexterity <= Number(stats.baseDex) &&
          weapon.intelligence <= Number(stats.baseMag) &&
          weapon.faith <= Number(stats.baseFai) &&
          !vanillaStartingWeaponIds.has(weapon.id) &&
          weapon.id < 2_000_000 &&
          !(weapon.id >= 1_200_000 && weapon.id < 1_300_000),
      );
      const roles = specialIds.has(target.id)
        ? ["primary", "offhand", "special"]
        : ["primary", "offhand"];
      for (const role of roles) {
        const candidates =
          role === "primary"
            ? usableWeapons.filter((weapon) => weapon.isPrimaryWeapon === true)
            : usableWeapons;
        if (candidates.length === 0) {
          throw new Error(
            `Not enough compatible equipment for ${target.name}:${role}.`,
          );
        }
        requests.push({
          key: `${target.id}:${role}`,
          candidates: equipmentRng.shuffle(candidates),
        });
      }
    });

    // Bipartite matching gives every slot a unique weapon and can reassign an
    // earlier choice when a class has fewer compatible alternatives.
    requests.sort(
      (left, right) =>
        left.candidates.length - right.candidates.length ||
        left.key.localeCompare(right.key),
    );
    const ownerByItemId = new Map();
    const requestByKey = new Map(requests.map((request) => [request.key, request]));
    const assign = (request, seenItems, seenRequests) => {
      if (seenRequests.has(request.key)) return false;
      seenRequests.add(request.key);
      for (const candidate of request.candidates) {
        if (seenItems.has(candidate.id)) continue;
        seenItems.add(candidate.id);
        const currentOwnerKey = ownerByItemId.get(candidate.id);
        if (
          !currentOwnerKey ||
          assign(
            requestByKey.get(currentOwnerKey),
            seenItems,
            seenRequests,
          )
        ) {
          ownerByItemId.set(candidate.id, request.key);
          weaponAssignments.set(request.key, candidate);
          return true;
        }
      }
      return false;
    };
    for (const request of requests) {
      if (!assign(request, new Set(), new Set())) {
        throw new Error(
          `Could not assign a unique weapon to ${request.key}.`,
        );
      }
    }
  }

  return classes.map((target, index) => {
    const statsSource = statsSources[index];
    let equipment = null;
    if (config.randomizeStartingEquipment && hasGeneralEquipmentPools) {
      equipment = {
        pickupWeapon: weaponAssignments.get(`${target.id}:primary`),
        pickupOffhand: weaponAssignments.get(`${target.id}:offhand`),
        pickupSpecial: specialIds.has(target.id)
          ? weaponAssignments.get(`${target.id}:special`)
          : null,
        helm: pickUnique(randomArmorPools.helms, usedArmorIds.helm, "helm"),
        armor: pickUnique(randomArmorPools.armors, usedArmorIds.armor, "chest armor"),
        gauntlets: pickUnique(
          randomArmorPools.gauntlets,
          usedArmorIds.gauntlets,
          "gauntlets",
        ),
        legs: pickUnique(randomArmorPools.legs, usedArmorIds.legs, "leg armor"),
      };
    }
    return {
      slot: target.id,
      name: target.name,
      from: target.name,
      to:
        statsSource.id === target.id
          ? target.name
          : `${target.name} with ${statsSource.name} stats`,
      statsFrom: statsSource.id,
      equipmentFrom: target.id,
      equipment,
      randomizeStats: config.randomizeStartingClass,
      randomizeEquipment:
        config.randomizeStartingEquipment && hasGeneralEquipmentPools,
    };
  });
}

function randomizeGifts(config, catalog) {
  if (!config.randomizeGifts || !catalog?.gifts?.length) return [];
  const rng = createStream(config.seed, "gifts", config.version);
  // Lordvessel (Gwynevere) and Key to the Seal (Ingward) remain in place while
  // progression protection is enabled.
  const protectedGiftRows = new Set([1090, 1100]);
  const gifts = config.progressionLogic
    ? catalog.gifts.filter((gift) => !protectedGiftRows.has(gift.rowId))
    : catalog.gifts;
  const sources = shuffledWithoutFixedPoints(rng, gifts);
  return gifts.map((target, index) => ({
    rowId: target.rowId,
    sourceRowId: sources[index].rowId,
    from: target.name,
    to: sources[index].name,
  }));
}

function randomizeEnemyDrops(config, catalog) {
  if (!config.randomizeEnemyDrops || !catalog?.enemyDropLots?.length) return [];
  const rng = createStream(config.seed, "enemy-drops", config.version);
  const lots = catalog.enemyDropLots;
  const sources = shuffledWithoutFixedPoints(rng, lots);
  return lots.map((target, index) => ({
    rowId: target.rowId,
    sourceRowId: sources[index].rowId,
    from: target.name,
    to: sources[index].name,
  }));
}

function randomizeShops(config, catalog) {
  if (!config.randomizeShops || !catalog?.shopEntries?.length) return [];
  const rng = createStream(config.seed, "shops", config.version);
  const groups = new Map();
  for (const entry of catalog.shopEntries) {
    // Protected mode keeps finite or event-bound goods at their original merchant.
    if (config.progressionLogic && entry.equipType === 3 && entry.eventFlag >= 0) {
      continue;
    }
    if (!groups.has(entry.equipType)) groups.set(entry.equipType, []);
    groups.get(entry.equipType).push(entry);
  }

  const placements = [];
  for (const entries of groups.values()) {
    const sources = shuffledWithoutFixedPoints(rng, entries);
    entries.forEach((target, index) => {
      placements.push({
        rowId: target.rowId,
        sourceRowId: sources[index].rowId,
        equipType: target.equipType,
        from: target.name,
        to: sources[index].name,
      });
    });
  }
  return placements;
}

function randomizeBosses(config) {
  if (!config.randomizeBosses) return [];
  const rng = createStream(config.seed, "bosses", config.version);
  const bossIndex = byId(bosses);
  return bossSlots.map((slot) => {
    const candidates = bosses.filter(
      (boss) =>
        boss.safe &&
        boss.arena.every((tag) => slot.capabilities.includes(tag)),
    );
    const pool = candidates.length > 0 ? candidates : [bossIndex.get(slot.original)];
    const replacement = pool[rng.int(pool.length)];
    return {
      slot: slot.id,
      map: slot.map,
      from: bossIndex.get(slot.original).name,
      to: replacement.name,
      compatibility: candidates.length > 0 ? "safe" : "vanilla-fallback",
    };
  });
}

function randomizeItems(config) {
  const itemIndex = byId(items);
  const normalItems = items.filter((item) => !item.progression);
  const keyItems = items.filter((item) => item.progression);
  const keyLocations = itemLocations.filter(
    (location) => itemIndex.get(location.original).progression,
  );
  const assignments = new Map(
    itemLocations.map((location) => [location.id, itemIndex.get(location.original)]),
  );
  const keyDestinationIds = new Set();

  if (config.randomizeKeyItems) {
    const rng = createStream(config.seed, "progression", config.version);
    const safeLocations = itemLocations
      .filter((location) => location.acceptsProgression)
      .sort((left, right) => left.sphere - right.sphere);
    const available = rng.shuffle(safeLocations.filter((location) => location.sphere <= 1));
    keyItems.forEach((item, index) => {
      const destination = available[index % available.length];
      const originalLocation = keyLocations.find(
        (location) => location.original === item.id,
      );
      const displacedItem = assignments.get(destination.id);
      assignments.set(destination.id, item);
      assignments.set(originalLocation.id, displacedItem);
      keyDestinationIds.add(destination.id);
    });
  }

  if (config.randomizeItems) {
    const rng = createStream(config.seed, "items", config.version);
    const targetLocations = itemLocations.filter(
      (location) => !keyDestinationIds.has(location.id),
    );
    const fixedKeyIds = new Set(
      config.randomizeKeyItems ? [] : keyLocations.map((location) => location.id),
    );
    const randomizableLocations = targetLocations.filter(
      (location) => !fixedKeyIds.has(location.id),
    );
    let shuffled = rng.shuffle(normalItems);

    const promoteCategory = (category, sphere, startIndex = 0) => {
      const targetIndex = randomizableLocations.findIndex(
        (location, index) => index >= startIndex && location.sphere <= sphere,
      );
      const itemIndexByCategory = shuffled.findIndex(
        (item, index) => index >= startIndex && item.category === category,
      );
      if (targetIndex >= 0 && itemIndexByCategory >= 0) {
        [randomizableLocations[startIndex], randomizableLocations[targetIndex]] = [
          randomizableLocations[targetIndex],
          randomizableLocations[startIndex],
        ];
        [shuffled[startIndex], shuffled[itemIndexByCategory]] = [
          shuffled[itemIndexByCategory],
          shuffled[startIndex],
        ];
      }
    };

    let guaranteed = 0;
    if (config.guaranteeEarlyWeapon) {
      promoteCategory("weapon", 0, guaranteed);
      guaranteed += 1;
    }
    if (config.balancedEarlyLoot) {
      promoteCategory("shield", 1, guaranteed);
      guaranteed += 1;
      promoteCategory("upgrade", 1, guaranteed);
    }
    randomizableLocations.forEach((location, index) => {
      assignments.set(location.id, shuffled[index % shuffled.length]);
    });
  }

  if (!config.randomizeItems && !config.randomizeKeyItems) return [];

  return itemLocations.map((location) => {
    const original = itemIndex.get(location.original);
    const replacement = assignments.get(location.id);
    return {
      location: location.id,
      map: location.map,
      sphere: location.sphere,
      from: original.name,
      to: replacement.name,
      progression: replacement.progression,
      preserved: original.id === replacement.id,
    };
  });
}

export function generate(inputConfig, { gameCatalog = null } = {}) {
  const config = normalizeConfig(inputConfig);
  const errors = validateConfig(config);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  if (gameCatalog && gameCatalog.schemaVersion !== 12) {
    throw new Error(
      `Catalog schema ${gameCatalog.schemaVersion} is obsolete. ` +
        "Verify the clean game and import its data again.",
    );
  }

  const extractedData = Boolean(
    gameCatalog?.enemySlots?.length && gameCatalog?.enemyArchetypes?.length,
  );
  const dragonPlan = extractedData
    ? buildDragonPlan(config, gameCatalog)
    : null;
  const result = {
    schemaVersion: 1,
    randomizerVersion: config.version,
    dataStatus: extractedData ? "extracted" : "prototype",
    warning: extractedData
      ? "Real game data detected. The output uses conservative slots and validated MSB/PARAM edits."
      : "This result uses development data and does not contain real IDs for a game patch.",
    seed: config.seed,
    config,
    placements: {
      enemies: extractedData
        ? randomizeExtractedEnemies(config, gameCatalog, dragonPlan)
        : randomizePrototypeEnemies(config),
      bosses: extractedData
        ? randomizeExtractedBosses(config, gameCatalog, dragonPlan)
        : randomizeBosses(config),
      items: extractedData
        ? randomizeExtractedItems(config, gameCatalog)
        : randomizeItems(config),
      startingClasses: extractedData
        ? randomizeStartingClasses(config, gameCatalog)
        : [],
      gifts: extractedData ? randomizeGifts(config, gameCatalog) : [],
      enemyDrops: extractedData
        ? randomizeEnemyDrops(config, gameCatalog)
        : [],
      shops: extractedData ? randomizeShops(config, gameCatalog) : [],
    },
    validation: {
      valid: true,
      finalBossReachable: config.randomizeKeyItems ? config.progressionLogic : true,
      notes: extractedData
        ? [
            "All hostile regular-enemy slots use an unrestricted count-preserving global permutation; friendly NPCs and invisible technical helpers stay vanilla.",
            "Area scaling inherits destination combat stats and replaces hidden level multipliers from the selected enemy.",
            "Bosses use an unrestricted permutation and are grounded at their destination encounter; dragons only exchange complete linked dragon groups.",
            config.progressionLogic
              ? "World items are randomized while progression lots remain in their original locations."
              : "World items and progression lots are randomized independently.",
            config.randomizeStartingClass
              ? "Starting-class base stats were redistributed."
              : "Starting-class base stats were preserved.",
            config.randomizeStartingEquipment
              ? "Asylum pickups were selected for each class's final stats."
              : "Starting loadouts were preserved.",
            config.randomizeGifts
              ? "Items granted by NPCs were redistributed."
              : "NPC gifts were preserved.",
            config.randomizeEnemyDrops
              ? "Renewable enemy drops were redistributed."
              : "Enemy drops were preserved.",
            config.randomizeShops
              ? config.progressionLogic
                ? "Shops were redistributed by type; finite and event-bound goods stayed protected."
                : "Shops were redistributed by item type."
              : "Shops were preserved.",
          ]
        : config.randomizeKeyItems
          ? ["Prototype progression was validated through the opening sphere; full graph validation remains pending."]
          : ["Key items were preserved."],
    },
  };

  result.placementHash = createHash("sha256")
    .update(JSON.stringify(result.placements))
    .digest("hex");
  return result;
}
