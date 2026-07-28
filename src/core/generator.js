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

function randomizeExtractedEnemies(config, catalog) {
  if (!config.randomizeEnemies) return [];
  const rng = createStream(config.seed, "enemies", config.version);
  const bossSlotIds = new Set((catalog.bossSlots || []).map((slot) => slot.id));
  const bossModels = new Set(
    (catalog.bossSlots || []).map((slot) => slot.modelName),
  );
  const aiGoalIds = new Set(catalog.aiGoalIds || []);
  const unsupportedReplacementModels = new Set([
    "c2232", // AI activation is tied to the vanilla Asylum encounter.
    "c2300", // Titanite Demon AI does not activate reliably cross-map.
    "c2670", // Ghost can become invisible outside its native setup.
    "c2680", // Lightning Ghost AI does not activate reliably.
    "c2780", // Mimic activation is event-script controlled.
    "c2940", // Skeleton Baby frequently fails to render.
    "c3230", // Moonlight Butterfly requires bespoke flight/arena logic.
    "c3300", // Crystal Lizard is passive and not a combat replacement.
    "c3330", // Pisaca AI activation is event controlled.
    "c3390", // Rockworm navigation is tied to its burrow.
    "c3420", // Undead Dragon AI activation is event controlled.
    "c3421", // Bounding Demon has arena-specific navigation.
    "c3430", // Hellkite Drake is bridge-script controlled.
    "c3480", // Chaos Bug behavior is not portable.
    "c3490", // Good Vagrant is non-hostile.
    "c3530", // Hydra requires bespoke arena positioning.
    "c5201", "c5202", // Centipede limbs require their parent model.
    "c5240", // Wall Hugger requires native geometry.
    "c5250", // Ceaseless Discharge requires bespoke arena logic.
    "c5320", // Gwyndolin AI activation is encounter controlled.
  ]);
  const portableArchetypes = new Set(
    catalog.enemySlots
      .filter(
        (slot) =>
          slot.safeCandidate &&
          !slot.eventModelLocked &&
          !slot.hasEntityId,
      )
      .map(
        (slot) =>
          `${slot.modelName}:${slot.npcParamId}:${slot.thinkParamId}`,
      ),
  );
  const slots = catalog.enemySlots.filter(
    (slot) =>
      slot.safeCandidate &&
      /^m1[0-8]_/u.test(slot.mapId) &&
      !bossSlotIds.has(slot.id),
  );
  const pool = catalog.enemyArchetypes.filter(
    (archetype) =>
      archetype.charaInitId < 0 &&
      archetype.teamType === 0 &&
      archetype.safeSlotCount > 0 &&
      archetype.battleStartDistance > 0 &&
      (archetype.eyeDistance > 0 || archetype.earDistance > 0) &&
      aiGoalIds.has(archetype.battleGoalId) &&
      portableArchetypes.has(
        `${archetype.modelName}:${archetype.npcParamId}:${archetype.thinkParamId}`,
      ) &&
      !unsupportedReplacementModels.has(archetype.modelName) &&
      !bossModels.has(archetype.modelName),
  );
  const archetypesByModel = new Map();
  const hitYOffsetByArchetype = new Map(
    catalog.enemySlots.map((slot) => [
      `${slot.modelName}:${slot.npcParamId}:${slot.thinkParamId}`,
      slot.hitYOffset ?? 0,
    ]),
  );
  for (const archetype of pool) {
    if (!archetypesByModel.has(archetype.modelName)) {
      archetypesByModel.set(archetype.modelName, []);
    }
    archetypesByModel.get(archetype.modelName).push(archetype);
  }

  return slots.map((slot, index) => {
    const fitsSpawn = (candidate) =>
      candidate.teamType === 0 &&
      candidate.npcType === slot.npcType &&
      candidate.moveType === slot.moveType &&
      candidate.disablePathMove === slot.disablePathMove &&
      candidate.hitRadius > 0 &&
      candidate.hitHeight > 0 &&
      candidate.hitRadius <= Math.max(slot.hitRadius * 1.35, slot.hitRadius + 0.15) &&
      candidate.hitHeight <= Math.max(slot.hitHeight * 1.35, slot.hitHeight + 0.4) &&
      Math.abs(
        (hitYOffsetByArchetype.get(
          `${candidate.modelName}:${candidate.npcParamId}:${candidate.thinkParamId}`,
        ) ?? 0) - (slot.hitYOffset ?? 0),
      ) <= Math.max(0.35, slot.hitHeight * 0.35);
    const eventControlled = slot.eventModelLocked === true;
    const differentModelCandidates = pool.filter(
      (candidate) =>
        !eventControlled &&
        candidate.modelName !== slot.modelName &&
        fitsSpawn(candidate),
    );
    const sameModelCandidates = (archetypesByModel.get(slot.modelName) || []).filter(
      (candidate) =>
        candidate.charaInitId < 0 &&
        fitsSpawn(candidate) &&
        (eventControlled
          ? candidate.npcParamId !== slot.npcParamId
          : candidate.npcParamId !== slot.npcParamId ||
            candidate.thinkParamId !== slot.thinkParamId),
    );
    const candidates =
      differentModelCandidates.length > 0
        ? differentModelCandidates
        : sameModelCandidates;
    const replacement =
      candidates.length > 0 ? candidates[rng.int(candidates.length)] : null;
    return {
      slot: slot.id,
      map: slot.mapId,
      entityId: slot.entityId,
      from: `${slot.modelName} [NPC ${slot.npcParamId} / AI ${slot.thinkParamId}]`,
      to: replacement
        ? `${replacement.modelName} [NPC ${replacement.npcParamId} / AI ${replacement.thinkParamId}]`
        : `${slot.modelName} [NPC ${slot.npcParamId} / AI ${slot.thinkParamId}]`,
      modelName: slot.modelName,
      targetModelName: replacement?.modelName ?? slot.modelName,
      sourceNpcParamId: slot.npcParamId,
      sourceThinkParamId: slot.thinkParamId,
      targetNpcParamId: replacement?.npcParamId ?? slot.npcParamId,
      targetThinkParamId:
        eventControlled
          ? slot.thinkParamId
          : replacement?.thinkParamId ?? slot.thinkParamId,
      targetBattleGoalId:
        eventControlled
          ? slot.battleGoalId
          : replacement?.battleGoalId ?? slot.battleGoalId,
      scaledNpcParamId:
        config.enemyScaling === "vanilla" || !replacement
          ? null
          : 9_100_000 + index,
      changed: Boolean(replacement),
      compatibility:
        replacement?.modelName !== slot.modelName
          ? "movement-size-and-ai-compatible"
          : replacement
            ? eventControlled
              ? "event-model-locked-source-ai"
              : "same-model-compatible-fallback"
            : "vanilla-preserved-no-compatible-replacement",
      scaling: config.enemyScaling,
    };
  });
}

const bossSize = new Map(
  Object.entries({
    c2230: 3, c2231: 3, c2232: 3, c2240: 3, c2250: 3, c2320: 4,
    c2360: 3, c2730: 3, c3320: 1, c3471: 3, c4100: 3,
    c4500: 3, c4510: 4, c5200: 4, c5210: 4, c5220: 3,
    c5260: 5, c5270: 2, c5280: 3, c5290: 4,
    c5350: 2, c5370: 1, c5390: 2,
  }),
);

const portableBossModels = new Set([
  "c2230", "c2231", "c2240", "c2250", "c2320", "c2360",
  "c2730", "c3320", "c4100", "c4500", "c5210", "c5220",
  "c5260", "c5270", "c5280", "c5350", "c5370",
]);
const canonicalBossModel = new Map([
  ["c5271", "c5270"],
  ["c5351", "c5350"],
]);

function randomizeExtractedBosses(config, catalog) {
  if (!config.randomizeBosses || !catalog?.bossSlots?.length) return [];
  const rng = createStream(config.seed, "bosses", config.version);
  const aiGoalIds = new Set(catalog.aiGoalIds || []);
  const areaNames = new Map(
    (catalog.maps || []).map((map) => [map.id, map.name]),
  );
  const bossNames = catalog.bossNames || {};
  const sources = catalog.bossSlots.filter(
    (slot) =>
      bossSize.has(canonicalBossModel.get(slot.modelName) || slot.modelName) &&
      slot.npcParamId >= 0 &&
      slot.thinkParamId >= 0,
  );
  const archetypes = [
    ...new Map(
      sources.filter(
        (slot) =>
          portableBossModels.has(slot.modelName) &&
          aiGoalIds.has(slot.battleGoalId),
      ).map((slot) => [
        `${slot.modelName}:${slot.npcParamId}:${slot.thinkParamId}`,
        slot,
      ]),
    ).values(),
  ];
  const replacementsByModel = new Map();
  for (const modelName of new Set(sources.map(
    (slot) => canonicalBossModel.get(slot.modelName) || slot.modelName,
  ))) {
    const sourceSize = bossSize.get(modelName);
    const candidates = archetypes.filter(
      (candidate) =>
        candidate.modelName !== modelName &&
        bossSize.get(candidate.modelName) <= sourceSize,
    );
    if (candidates.length === 0) {
      throw new Error(
        `No portable non-vanilla boss can replace ${modelName}.`,
      );
    }
    replacementsByModel.set(
      modelName,
      candidates[rng.int(candidates.length)],
    );
  }
  return sources.map((slot, index) => {
    const sourceModelName =
      canonicalBossModel.get(slot.modelName) || slot.modelName;
    const isFirstAsylumBoss =
      slot.mapId === "m18_01_00_00" && slot.modelName === "c2232";
    const replacement = replacementsByModel.get(sourceModelName);
    const changed = true;
    const originalBossName =
      bossNames[sourceModelName] ||
      `${sourceModelName} [NPC ${slot.npcParamId}]`;
    const randomizedBossName =
      bossNames[replacement.modelName] ||
      `${replacement.modelName} [NPC ${replacement.npcParamId}]`;
    return {
      slot: slot.id,
      map: slot.mapId,
      entityId: slot.entityId,
      from: `${slot.modelName} [NPC ${slot.npcParamId} / AI ${slot.thinkParamId}]`,
      to: `${replacement.modelName} [NPC ${replacement.npcParamId} / AI ${replacement.thinkParamId}]`,
      originalBossName,
      randomizedBossName,
      encounterLocation: {
        area: areaNames.get(slot.mapId) || slot.mapId,
        map: slot.mapId,
        slot: slot.name,
      },
      modelName: slot.modelName,
      targetModelName: replacement.modelName,
      sourceNpcParamId: slot.npcParamId,
      sourceThinkParamId: slot.thinkParamId,
      targetNpcParamId: replacement.npcParamId,
      targetThinkParamId: replacement.thinkParamId,
      targetBattleGoalId: replacement.battleGoalId,
      scaledNpcParamId:
        config.enemyScaling === "vanilla" || !changed
          ? null
          : 9_200_000 + index,
      changed,
      compatibility: canonicalBossModel.has(slot.modelName)
        ? "linked-boss-form"
        : isFirstAsylumBoss
        ? "asylum-floor-spawn"
        : "portable-same-or-smaller-boss",
      scaling: config.enemyScaling,
    };
  });
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
  if (gameCatalog && gameCatalog.schemaVersion !== 11) {
    throw new Error(
      `Catalog schema ${gameCatalog.schemaVersion} is obsolete. ` +
        "Verify the clean game and import its data again.",
    );
  }

  const extractedData = Boolean(
    gameCatalog?.enemySlots?.length && gameCatalog?.enemyArchetypes?.length,
  );
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
        ? randomizeExtractedEnemies(config, gameCatalog)
        : randomizePrototypeEnemies(config),
      bosses: extractedData
        ? randomizeExtractedBosses(config, gameCatalog)
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
            "Ordinary event-linked enemies use tighter compatible cross-model replacements; model-specific boss events receive dedicated handling.",
            "Area scaling inherits destination combat stats and replaces hidden level multipliers from the selected enemy.",
            "Bosses use portable size-compatible pools; the first Undead Asylum boss uses a safe floor-spawn event path.",
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
