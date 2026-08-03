import { readFile } from "node:fs/promises";
import path from "node:path";

export async function loadGameCatalog(catalogPath) {
  try {
    const absolutePath = path.resolve(catalogPath);
    const catalog = JSON.parse(await readFile(absolutePath, "utf8"));
    if (
      ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].includes(catalog.schemaVersion) ||
      !Array.isArray(catalog.enemySlots) ||
      !Array.isArray(catalog.enemyArchetypes)
    ) {
      throw new Error("Incompatible catalog schema.");
    }
    return catalog;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
