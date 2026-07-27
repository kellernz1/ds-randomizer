// Representative data used to validate the pipeline. Real IDs are imported by
// the game-data extractor and must never be invented by the patcher.
export const enemies = [
  { id: "hollow_soldier", name: "Hollow Soldier", tier: 1, size: "medium" },
  { id: "hollow_warrior", name: "Hollow Warrior", tier: 1, size: "medium" },
  { id: "rat", name: "Rat", tier: 1, size: "small" },
  { id: "skeleton", name: "Skeleton", tier: 2, size: "medium" },
  { id: "painting_guardian", name: "Painting Guardian", tier: 2, size: "medium" },
  { id: "serpent_soldier", name: "Serpent Soldier", tier: 4, size: "medium" },
  { id: "darkwraith", name: "Darkwraith", tier: 5, size: "medium" },
  { id: "giant_skeleton", name: "Giant Skeleton", tier: 5, size: "large" },
];

export const enemySlots = [
  { id: "burg_001", map: "Undead Burg", original: "hollow_soldier", maxSize: "medium", areaTier: 1 },
  { id: "burg_002", map: "Undead Burg", original: "hollow_warrior", maxSize: "medium", areaTier: 1 },
  { id: "parish_001", map: "Undead Parish", original: "hollow_soldier", maxSize: "large", areaTier: 2 },
  { id: "depths_001", map: "Depths", original: "rat", maxSize: "small", areaTier: 2 },
  { id: "catacombs_001", map: "Catacombs", original: "skeleton", maxSize: "medium", areaTier: 3 },
  { id: "painting_001", map: "Painted World", original: "painting_guardian", maxSize: "large", areaTier: 5 },
  { id: "sen_001", map: "Sen's Fortress", original: "serpent_soldier", maxSize: "medium", areaTier: 4 },
  { id: "londo_001", map: "New Londo Ruins", original: "darkwraith", maxSize: "medium", areaTier: 6 },
];

export const bosses = [
  { id: "taurus_demon", name: "Taurus Demon", arena: ["medium", "outdoor"], safe: true },
  { id: "capra_demon", name: "Capra Demon", arena: ["small"], safe: true },
  { id: "bell_gargoyles", name: "Bell Gargoyles", arena: ["medium", "outdoor", "multi"], safe: true },
  { id: "iron_golem", name: "Iron Golem", arena: ["large", "outdoor"], safe: false },
];

export const bossSlots = [
  { id: "arena_taurus", map: "Undead Burg", original: "taurus_demon", capabilities: ["medium", "outdoor"] },
  { id: "arena_capra", map: "Lower Undead Burg", original: "capra_demon", capabilities: ["small", "medium"] },
  { id: "arena_gargoyles", map: "Undead Parish", original: "bell_gargoyles", capabilities: ["medium", "outdoor", "multi"] },
];

export const items = [
  { id: "longsword", name: "Longsword", category: "weapon", progression: false },
  { id: "heater_shield", name: "Heater Shield", category: "shield", progression: false },
  { id: "firebomb", name: "Firebomb x5", category: "consumable", progression: false },
  { id: "titanite_shard", name: "Titanite Shard x3", category: "upgrade", progression: false },
  { id: "humanity", name: "Humanity", category: "consumable", progression: false },
  { id: "homeward_bone", name: "Homeward Bone x3", category: "consumable", progression: false },
  { id: "residence_key", name: "Residence Key", category: "key", progression: true },
  { id: "key_to_depths", name: "Key to Depths", category: "key", progression: true },
];

export const itemLocations = [
  { id: "firelink_01", map: "Firelink Shrine", original: "humanity", sphere: 0, acceptsProgression: true },
  { id: "firelink_02", map: "Firelink Shrine", original: "homeward_bone", sphere: 0, acceptsProgression: true },
  { id: "burg_01", map: "Undead Burg", original: "longsword", sphere: 0, acceptsProgression: true },
  { id: "burg_02", map: "Undead Burg", original: "firebomb", sphere: 0, acceptsProgression: true },
  { id: "parish_01", map: "Undead Parish", original: "heater_shield", sphere: 1, acceptsProgression: true },
  { id: "parish_02", map: "Undead Parish", original: "titanite_shard", sphere: 1, acceptsProgression: true },
  { id: "lower_burg_01", map: "Lower Undead Burg", original: "residence_key", sphere: 1, acceptsProgression: false },
  { id: "depths_01", map: "Depths", original: "key_to_depths", sphere: 2, acceptsProgression: false },
];
