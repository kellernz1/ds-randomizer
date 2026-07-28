import { mkdir, writeFile } from "node:fs/promises";
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

function itemLocationsText(result) {
  const placements = [...result.placements.items].sort(
    (left, right) =>
      (left.itemName || left.to).localeCompare(right.itemName || right.to) ||
      (left.sourceRowId ?? 0) - (right.sourceRowId ?? 0),
  );
  return `${[
    "DARK SOULS REMASTERED RANDOMIZER - ITEM LOCATIONS",
    `Seed: ${result.seed}`,
    `Hash: ${result.placementHash}`,
    `Version: ${result.randomizerVersion}`,
    "",
    "Each entry shows where the item normally appears and where this seed placed it.",
    "",
    ...placements.flatMap((placement) => [itemPlacementLine(placement), ""]),
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
    lines.push(`[${placement.map}] ${placement.from} -> ${placement.to}`);
  }
  lines.push("", "=== BOSSES ===");
  for (const placement of result.placements.bosses) {
    lines.push(`[${placement.map}] ${placement.from} -> ${placement.to}`);
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
  if (result.placements.items.length > 0) {
    await writeFile(
      path.join(directory, "item-locations.txt"),
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
          "Every category selected in the configurator is applied independently.",
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
