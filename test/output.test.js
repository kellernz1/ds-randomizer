import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeOutput } from "../src/core/output.js";

test("item and boss report is written independently of the full spoiler log", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "dsr-randomizer-output-"),
  );
  try {
    const result = {
      seed: "report-test",
      placementHash: "test-hash",
      randomizerVersion: "test-version",
      dataStatus: "extracted",
      config: { generateSpoilerLog: false },
      placements: {
        enemies: [],
        bosses: [
          {
            slot: "m18_01_00_00:c2232_0000",
            map: "m18_01_00_00",
            from: "c2232 [NPC 223200 / AI 223200]",
            to: "c4500 [NPC 450000 / AI 450000]",
            originalBossName: "Asylum Demon",
            randomizedBossName: "Sanctuary Guardian",
            encounterLocation: {
              area: "Undead Asylum",
              map: "m18_01_00_00",
              slot: "c2232_0000",
            },
          },
        ],
        startingClasses: [],
        gifts: [],
        enemyDrops: [],
        shops: [],
        items: [
          {
            rowId: 200,
            sourceRowId: 100,
            map: "m11_00_00_00",
            from: "Destination item",
            to: "Avelyn",
            itemName: "Avelyn",
            originalLocation: {
              area: "The Duke's Archives / Crystal Cave",
              map: "m17_00_00_00",
              itemLot: 100,
            },
            randomizedLocation: {
              area: "Painted World of Ariamis",
              map: "m11_00_00_00",
              itemLot: 200,
            },
          },
        ],
      },
      validation: { valid: true },
    };

    const outputDirectory = await writeOutput(result, temporaryDirectory);
    const report = await readFile(
      path.join(outputDirectory, "item-locations.txt"),
      "utf8",
    );
    assert.match(report, /Avelyn/u);
    assert.match(report, /Original: The Duke's Archives/u);
    assert.match(report, /Randomized: Painted World of Ariamis/u);
    assert.match(report, /Original boss: Asylum Demon/u);
    assert.match(report, /Randomized boss: Sanctuary Guardian/u);
    assert.match(report, /Undead Asylum/u);
    await assert.rejects(readFile(path.join(outputDirectory, "spoiler.txt")));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
