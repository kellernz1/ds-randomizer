import { access } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const knownBase = Object.freeze({
  executable:
    "a45aaa36dd2f6cc151670a639ea5547043cf38ea79ff4178b963c6ed71f98d7b",
  gameParam:
    "cc4a81cc87f028534d965c908a8aa7dba2f9e235ac30f5e72ddf6bb45dc7b5ab",
});

const modIndicators = [
  "DarkSoulsItemRandomizer.exe",
  "SeamlessCoop",
  "OnlineFix.ini",
  "OnlineFix64.dll",
  "winmm.dll",
  "dlllist.txt",
  "dinput8.dll",
  "modengine.ini",
];

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

export async function detectGame(gameDirectory) {
  if (!gameDirectory) {
    return { found: false, supported: false, reason: "No game directory provided." };
  }
  const executable = path.join(gameDirectory, "DarkSoulsRemastered.exe");
  const gameParam = path.join(
    gameDirectory,
    "param",
    "GameParam",
    "GameParam.parambnd.dcx",
  );
  try {
    await access(executable);
    await access(gameParam);
    const [executableHash, gameParamHash, indicatorStates] = await Promise.all([
      sha256(executable),
      sha256(gameParam),
      Promise.all(
        modIndicators.map(async (name) => ({
          name,
          found: await exists(path.join(gameDirectory, name)),
        })),
      ),
    ]);
    const detectedMods = indicatorStates
      .filter((indicator) => indicator.found)
      .map((indicator) => indicator.name);
    const knownVersion =
      executableHash === knownBase.executable &&
      gameParamHash === knownBase.gameParam;
    const clean = detectedMods.length === 0;
    const supported = knownVersion && clean;
    return {
      found: true,
      supported,
      clean,
      knownVersion,
      executable,
      executableHash,
      gameParamHash,
      detectedMods,
      reason: supported
        ? "Recognized clean and compatible installation."
        : !clean
          ? `Mods/loaders detectados: ${detectedMods.join(", ")}.`
          : "Game files found, but their hashes are not recognized.",
    };
  } catch {
    return {
      found: false,
      supported: false,
      executable,
      reason: "DarkSoulsRemastered.exe was not found in this directory.",
    };
  }
}

export async function verifyCatalogSources(gameDirectory, catalog) {
  const requiredSources = catalog?.sourceFiles || [];
  const mismatches = [];
  for (const source of requiredSources) {
    const filePath = path.join(
      gameDirectory,
      ...source.path.split("/"),
    );
    if (!(await exists(filePath)) || (await sha256(filePath)) !== source.sha256) {
      mismatches.push(source.path);
    }
  }
  return {
    matches: mismatches.length === 0,
    checked: requiredSources.length,
    mismatches,
  };
}
