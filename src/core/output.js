import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

function safeSeed(seed) {
  return seed.replace(/[^\w.-]/gu, "_");
}

function formatItemLocation(location, fallbackMap, fallbackLot) {
  if (!location) {
    return `${fallbackMap || "Unknown area"} (Item Lot ${fallbackLot ?? "unknown"})`;
  }
  return `${location.area} (${location.map}, Item Lot ${location.itemLot})`;
}

function itemPlacementLine(placement) {
  const itemName = placement.itemName || placement.to;
  const original = formatItemLocation(
    placement.originalLocation,
    placement.map,
    placement.sourceRowId,
  );
  const randomized = formatItemLocation(
    placement.randomizedLocation,
    placement.map,
    placement.rowId,
  );
  return `${itemName}\n  Original: ${original}\n  Randomized: ${randomized}`;
}

function bossPlacementLine(placement) {
  const location = placement.encounterLocation
    ? `${placement.encounterLocation.area} (${placement.encounterLocation.map}, Encounter ${placement.encounterLocation.slot})`
    : `${placement.map || "Unknown area"} (${placement.slot || "Unknown encounter"})`;
  return `${location}\n  Original boss: ${placement.originalBossName || placement.from}\n  Randomized boss: ${placement.randomizedBossName || placement.to}`;
}

function itemLocationsText(result) {
  const itemPlacements = [
    ...result.placements.items,
    ...(result.placements.gifts || []),
    ...(result.placements.enemyDrops || []),
    ...(result.placements.shops || []),
  ].sort(
    (left, right) =>
      (left.itemName || left.to).localeCompare(right.itemName || right.to) ||
      (left.sourceRowId ?? 0) - (right.sourceRowId ?? 0),
  );
  const bossPlacements = [...result.placements.bosses].sort(
    (left, right) =>
      (left.encounterLocation?.area || left.map).localeCompare(
        right.encounterLocation?.area || right.map,
      ) ||
      left.slot.localeCompare(right.slot),
  );
  const sections = [];
  if (itemPlacements.length > 0) {
    sections.push(
      "=== GLOBAL ITEM LOCATIONS ===",
      "",
      ...itemPlacements.flatMap((placement) => [itemPlacementLine(placement), ""]),
    );
  }
  if (bossPlacements.length > 0) {
    sections.push(
      "=== BOSSES ===",
      "",
      ...bossPlacements.flatMap((placement) => [bossPlacementLine(placement), ""]),
    );
  }
  return `${[
    "DARK SOULS REMASTERED RANDOMIZER - ITEM AND BOSS LOCATIONS",
    `Seed: ${result.seed}`,
    `Hash: ${result.placementHash}`,
    `Version: ${result.randomizerVersion}`,
    "",
    "This report shows world items, NPC gifts, enemy drops, shop inventory, and boss assignments.",
    "",
    ...sections,
  ].join("\n")}\n`;
}

function spoilerText(result) {
  const lines = [
    "DARK SOULS REMASTERED RANDOMIZER",
    `Seed: ${result.seed}`,
    `Hash: ${result.placementHash}`,
    `Version: ${result.randomizerVersion}`,
    "",
    "=== ENEMIES ===",
  ];
  for (const placement of result.placements.enemies) {
    const sourceLocation = placement.sourceSlot
      ? `; source location: ${placement.sourceMap} / ${placement.sourceSlot}`
      : "";
    lines.push(
      `[${placement.map}] ${placement.from} -> ${placement.to}${sourceLocation}`,
    );
  }
  lines.push("", "=== BOSSES ===");
  for (const placement of result.placements.bosses) {
    lines.push(bossPlacementLine(placement));
  }
  lines.push("", "=== WORLD ITEMS ===");
  for (const placement of result.placements.items) {
    lines.push(itemPlacementLine(placement));
  }
  lines.push("", "=== STARTING CLASSES ===");
  for (const placement of result.placements.startingClasses || []) {
    if (placement.equipment) {
      const item = (entry) => `${entry.name} [${entry.id}]`;
      lines.push(
        `${placement.name}: stats from ${placement.statsFrom}; ` +
        `compatible Asylum pickups: ${item(placement.equipment.pickupWeapon)} / ` +
        `${item(placement.equipment.pickupOffhand)}` +
        (placement.equipment.pickupSpecial
          ? ` / ${item(placement.equipment.pickupSpecial)}`
          : "") +
        `; starting armor: ${item(placement.equipment.helm)}, ` +
        `${item(placement.equipment.armor)}, ${item(placement.equipment.gauntlets)}, ` +
        `${item(placement.equipment.legs)}`,
      );
    } else {
      lines.push(`${placement.name}: stats from ${placement.statsFrom}; equipment preserved`);
    }
  }
  lines.push("", "=== NPC GIFTS ===");
  for (const placement of result.placements.gifts || []) {
    lines.push(`[${placement.rowId}] ${placement.from} -> ${placement.to}`);
  }
  lines.push("", "=== ENEMY DROPS ===");
  for (const placement of result.placements.enemyDrops || []) {
    lines.push(`[${placement.rowId}] ${placement.from} -> ${placement.to}`);
  }
  lines.push("", "=== SHOPS ===");
  for (const placement of result.placements.shops || []) {
    lines.push(`[${placement.rowId}] ${placement.from} -> ${placement.to}`);
  }
  lines.push("", "=== VALIDATION ===", `Valid seed: ${result.validation.valid ? "YES" : "NO"}`);
  return `${lines.join("\n")}\n`;
}

export async function writeOutput(result, baseDirectory) {
  const directory = path.resolve(baseDirectory, `seed_${safeSeed(result.seed)}`);
  await mkdir(directory, { recursive: true });
  await rm(path.join(directory, "item-locations.txt"), { force: true });
  await writeFile(
    path.join(directory, "randomizer.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(directory, "config.json"),
    `${JSON.stringify(result.config, null, 2)}\n`,
    "utf8",
  );
  if (result.config.generateSpoilerLog) {
    await writeFile(path.join(directory, "spoiler.txt"), spoilerText(result), "utf8");
  }
  if (
    result.placements.items.length > 0 ||
    (result.placements.gifts || []).length > 0 ||
    (result.placements.enemyDrops || []).length > 0 ||
    (result.placements.shops || []).length > 0 ||
    result.placements.bosses.length > 0
  ) {
    await writeFile(
      path.join(directory, "cheat-locations.txt"),
      itemLocationsText(result),
      "utf8",
    );
  }
  await writeFile(
    path.join(directory, "README.txt"),
    result.dataStatus === "extracted"
      ? [
          "DSR RANDOMIZER PACKAGE - EXTRACTED GAME DATA",
          "",
          "The mod/map directory contains validated MSB copies when maps were changed.",
          "The generator does not modify the source game installation.",
          "Changed maps and GameParam are validated copies until activation.",
          "Enabled world items, NPC gifts, enemy drops, and shops share one global item pool.",
          "",
        ].join("\n")
      : [
          "DEVELOPMENT PACKAGE",
          "",
          "This package uses representative data and must not be installed into the game.",
          "",
        ].join("\n"),
    "utf8",
  );
  return directory;
}
