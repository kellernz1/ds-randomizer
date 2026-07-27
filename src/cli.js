#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateSeed, normalizeConfig, presets } from "./core/config.js";
import { generate } from "./core/generator.js";
import { writeOutput } from "./core/output.js";
import { runDataTool, startServer } from "./server.js";
import { loadGameCatalog } from "./data/catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const command = args[0] || "ui";

function flag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const next = args[index + 1];
  return next && !next.startsWith("--") ? next : true;
}

async function configFromArgs() {
  let fileConfig = {};
  const configFile = flag("config");
  if (configFile) {
    fileConfig = JSON.parse(await readFile(path.resolve(String(configFile)), "utf8"));
  }
  const presetName = String(flag("preset", fileConfig.preset || "standard"));
  const preset = presets[presetName] || presets.standard;
  return normalizeConfig({
    ...preset,
    ...fileConfig,
    seed: flag("seed", fileConfig.seed || generateSeed()),
    preset: presetName,
    outputDirectory: flag("output", fileConfig.outputDirectory || "output"),
    gameDirectory: flag("game", fileConfig.gameDirectory || ""),
    offlineAcknowledged: Boolean(
      flag("offline", fileConfig.offlineAcknowledged || false),
    ),
    dryRun: flag("apply", false) ? false : true,
  });
}

async function run() {
  if (command === "ui") {
    const { url } = await startServer();
    console.log(`Configurator opened at ${url}`);
    console.log("Keep this window open. Press Ctrl+C to stop.");
    execFile("cmd.exe", ["/c", "start", "", url]);
    return;
  }
  if (command === "generate") {
    const config = await configFromArgs();
    const catalog = flag("prototype", false)
      ? null
      : await loadGameCatalog(path.join(root, "data", "dsr-catalog.json"));
    const result = generate(config, { gameCatalog: catalog });
    const directory = await writeOutput(result, path.resolve(root, config.outputDirectory));
    if (catalog && !config.dryRun) {
      await runDataTool([
        "patch-enemies",
        "--game",
        config.gameDirectory,
        "--catalog",
        path.join(root, "data", "dsr-catalog.json"),
        "--placements",
        path.join(directory, "randomizer.json"),
        "--output",
        directory,
      ]);
    }
    console.log(`Seed: ${result.seed}`);
    console.log(`Hash: ${result.placementHash}`);
    console.log(`Output: ${directory}`);
    console.log(`Data: ${result.dataStatus}`);
    return;
  }
  if (command === "test-seeds") {
    const count = Number(flag("count", 1000));
    if (!Number.isInteger(count) || count <= 0) throw new Error("--count must be positive.");
    let valid = 0;
    for (let index = 0; index < count; index += 1) {
      const result = generate({ ...presets.standard, seed: String(index + 1) });
      if (result.validation.valid) valid += 1;
    }
    console.log(`Generated seeds: ${count}`);
    console.log(`Valid in the prototype model: ${valid}`);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
