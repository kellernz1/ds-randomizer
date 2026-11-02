import { readFile } from "node:fs/promises";
import path from "node:path";

export async function loadGameCatalog(catalogPath, { allowStale = false } = {}) {
  try {
    const absolutePath = path.resolve(catalogPath);
    const catalog = JSON.parse(await readFile(absolutePath, "utf8"));
    if (
      !Number.isInteger(catalog.schemaVersion) ||
      catalog.schemaVersion < 1 ||
      catalog.schemaVersion > 22 ||
      !Array.isArray(catalog.enemySlots) ||
      !Array.isArray(catalog.enemyArchetypes)
    ) {
      throw new Error(
        `Incompatible catalog schema: expected 22, found ${catalog.schemaVersion ?? "unknown"}. ` +
          "Import game data again using this version of the randomizer.",
      );
    }
    if (!allowStale && catalog.schemaVersion !== 22) {
      throw new Error(
        `Catalog schema ${catalog.schemaVersion} is outdated; expected 22. ` +
          "Import game data again using this version of the randomizer.",
      );
    }
    return catalog;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
