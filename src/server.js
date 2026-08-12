import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultConfig,
  generateSeed,
  normalizeConfig,
  validateConfig,
} from "./core/config.js";
import { generate } from "./core/generator.js";
import { writeOutput } from "./core/output.js";
import { createSharedSeed, readSharedSeed } from "./core/share.js";
import { detectGame, verifyCatalogSources } from "./game/detection.js";
import { loadGameCatalog } from "./data/catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDirectory = path.join(root, "public");
const configPath = path.join(root, "config.json");
const catalogPath = path.join(root, "data", "dsr-catalog.json");
const dataToolPath = path.join(
  root,
  "tools",
  "DsrDataTool",
  "bin",
  "Release",
  "net8.0",
  "DsrDataTool.dll",
);
const localDotnetPath = path.join(root, ".tools", "dotnet", "dotnet.exe");
const execFileAsync = promisify(execFile);
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function json(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, no-cache, must-revalidate",
    pragma: "no-cache",
    expires: "0",
  });
  response.end(JSON.stringify(payload));
}

async function loadConfig() {
  try {
    return normalizeConfig(JSON.parse(await readFile(configPath, "utf8")));
  } catch {
    return normalizeConfig(defaultConfig);
  }
}

function resolvePackageDirectory(value) {
  const packageDirectory = path.resolve(String(value || ""));
  const relative = path.relative(root, packageDirectory);
  if (
    !value ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !path.basename(packageDirectory).startsWith("seed_")
  ) {
    throw new Error("Invalid package directory.");
  }
  return packageDirectory;
}

async function packageState(packageDirectory) {
  if (!packageDirectory) return null;
  try {
    const resolved = resolvePackageDirectory(packageDirectory);
    await readFile(path.join(resolved, "patch-manifest.json"), "utf8");
    let active = false;
    try {
      const activation = JSON.parse(
        await readFile(path.join(resolved, "activation-manifest.json"), "utf8"),
      );
      active = activation.active === true;
    } catch {
      // The package has not been activated yet.
    }
    return { directory: resolved, hasPatch: true, active };
  } catch {
    return null;
  }
}

export async function runDataTool(argumentsList) {
  try {
    return await execFileAsync(localDotnetPath, [dataToolPath, ...argumentsList], {
      cwd: root,
      env: {
        ...process.env,
        DOTNET_CLI_HOME: path.join(root, ".tools", "cli-home"),
        NUGET_PACKAGES: path.join(root, ".tools", "nuget"),
        DOTNET_CLI_TELEMETRY_OPTOUT: "1",
        DOTNET_CLI_UI_LANGUAGE: "en-US",
        VSLANG: "1033",
      },
      windowsHide: true,
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        "The data tool is not compiled. See docs/IMPLEMENTATION.md.",
      );
    }
    throw new Error(error.stderr?.trim() || error.message);
  }
}

async function api(request, response, pathname) {
  if (request.method === "POST" && pathname === "/api/seed/new") {
    return json(response, 200, { seed: generateSeed() });
  }
  if (request.method === "GET" && pathname === "/api/state") {
    const catalog = await loadGameCatalog(catalogPath);
    const config = await loadConfig();
    return json(response, 200, {
      config,
      generatedSeed: generateSeed(),
      catalog: catalog
        ? {
            available: true,
            maps: catalog.maps.length,
            enemySlots: catalog.enemySlots.length,
            errors: catalog.errors.length,
          }
        : { available: false },
      package: await packageState(config.lastPackageDirectory),
    });
  }
  if (request.method === "POST" && pathname === "/api/share/export") {
    try {
      const catalog = await loadGameCatalog(catalogPath);
      const previousConfig = await loadConfig();
      const config = normalizeConfig({
        ...previousConfig,
        ...(await readJson(request)),
      });
      return json(response, 200, createSharedSeed(config, catalog));
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  }
  if (request.method === "POST" && pathname === "/api/share/import") {
    try {
      const catalog = await loadGameCatalog(catalogPath);
      const payload = await readJson(request);
      return json(response, 200, {
        config: readSharedSeed(payload, catalog),
      });
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  }
  if (request.method === "POST" && pathname === "/api/detect") {
    const body = await readJson(request);
    return json(response, 200, await detectGame(String(body.gameDirectory || "")));
  }
  if (request.method === "POST" && pathname === "/api/scan") {
    const body = await readJson(request);
    const gameDirectory = String(body.gameDirectory || "").trim();
    const detection = await detectGame(gameDirectory);
    if (!detection.supported) {
      return json(response, 400, { error: detection.reason });
    }
    const previousCatalog = await loadGameCatalog(catalogPath);
    if (previousCatalog) {
      const sourceState = await verifyCatalogSources(gameDirectory, previousCatalog);
      if (!sourceState.matches) {
        return json(response, 400, {
          error:
            `${sourceState.mismatches.length} maps differ from the clean catalog. ` +
            "Restore the active package before importing again.",
        });
      }
    }
    const toolResult = await runDataTool([
      "scan",
      "--game",
      gameDirectory,
      "--output",
      catalogPath,
    ]);
    const catalog = await loadGameCatalog(catalogPath);
    return json(response, 200, {
      message: toolResult.stdout.trim(),
      maps: catalog.maps.length,
      enemySlots: catalog.enemySlots.length,
      errors: catalog.errors,
    });
  }
  if (request.method === "POST" && pathname === "/api/generate") {
    const previousConfig = await loadConfig();
    const config = normalizeConfig({ ...previousConfig, ...(await readJson(request)) });
    const errors = validateConfig(config);
    if (errors.length > 0) return json(response, 400, { errors });
    const catalog = config.useExtractedData
      ? await loadGameCatalog(catalogPath)
      : null;
    if (config.useExtractedData && !catalog) {
      return json(response, 400, {
        errors: ["Import real game data before using this mode."],
      });
    }
    const result = generate(config, { gameCatalog: catalog });
    const outputDirectory = await writeOutput(
      result,
      path.resolve(root, config.outputDirectory),
    );
    let patch = null;
    if (catalog && !config.dryRun) {
      if (!config.gameDirectory) {
        return json(response, 400, {
          errors: ["Select the game directory before generating a patch package."],
        });
      }
      const patchResult = await runDataTool([
        "patch-enemies",
        "--game",
        config.gameDirectory,
        "--catalog",
        catalogPath,
        "--placements",
        path.join(outputDirectory, "randomizer.json"),
        "--output",
        outputDirectory,
      ]);
      patch = { generated: true, message: patchResult.stdout.trim() };
    }
    if (patch) config.lastPackageDirectory = outputDirectory;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    return json(response, 200, {
      seed: result.seed,
      placementHash: result.placementHash,
      outputDirectory,
      counts: {
        enemies: result.placements.enemies.length,
        bosses: result.placements.bosses.length,
        items: result.placements.items.length,
        startingClasses: result.placements.startingClasses?.length || 0,
        gifts: result.placements.gifts?.length || 0,
        enemyDrops: result.placements.enemyDrops?.length || 0,
        shops: result.placements.shops?.length || 0,
      },
      prototype: result.dataStatus === "prototype",
      dataStatus: result.dataStatus,
      patch,
    });
  }
  if (
    request.method === "POST" &&
    (pathname === "/api/install" || pathname === "/api/restore")
  ) {
    const body = await readJson(request);
    const config = await loadConfig();
    const gameDirectory = String(body.gameDirectory || config.gameDirectory || "").trim();
    const packageDirectory = resolvePackageDirectory(body.packageDirectory);
    if (!gameDirectory) {
      return json(response, 400, { error: "Select the game directory." });
    }
    if (pathname === "/api/install") {
      const detection = await detectGame(gameDirectory);
      if (!detection.supported) {
        return json(response, 400, { error: detection.reason });
      }
    }
    const command = pathname === "/api/install" ? "install" : "restore";
    const toolResult = await runDataTool([
      command,
      "--game",
      gameDirectory,
      "--package",
      packageDirectory,
    ]);
    return json(response, 200, {
      active: command === "install",
      message: toolResult.stdout.trim(),
    });
  }
  return json(response, 404, { error: "Endpoint not found." });
}

export function startServer({ port = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url, "http://127.0.0.1");
        if (url.pathname.startsWith("/api/")) {
          await api(request, response, url.pathname);
          return;
        }
        const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        const filePath = path.resolve(publicDirectory, relative);
        const localPath = path.relative(publicDirectory, filePath);
        if (localPath.startsWith("..") || path.isAbsolute(localPath)) {
          response.writeHead(403).end();
          return;
        }
        const data = await readFile(filePath);
        response.writeHead(200, {
          "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream",
          "cache-control": "no-cache",
        });
        response.end(data);
      } catch (error) {
        if (!response.headersSent) json(response, 500, { error: error.message });
        else response.end();
      }
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}
