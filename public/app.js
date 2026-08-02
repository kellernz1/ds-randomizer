const form = document.querySelector("#config-form");
const message = document.querySelector("#message");
let latestGeneratedSeed = "";
let latestPackageDirectory = "";

function setForm(config) {
  for (const [key, value] of Object.entries(config)) {
    const field = form.elements[key];
    if (!field) continue;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else field.value = value;
  }
}

function readForm() {
  const result = {};
  for (const field of form.elements) {
    if (!field.name) continue;
    result[field.name] = field.type === "checkbox" ? field.checked : field.value;
  }
  return result;
}

async function request(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error(
      "The local randomizer server disconnected. Close this tab and run start-randomizer.bat again.",
    );
  }
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(
      `The server returned an invalid response (HTTP ${response.status}). Restart the configurator.`,
    );
  }
  if (!response.ok) {
    throw new Error(payload.errors?.join("\n") || payload.error || "Unknown error.");
  }
  return payload;
}

const state = await request("/api/state");
latestGeneratedSeed = state.generatedSeed;
setForm(state.config);
if (state.package) {
  latestPackageDirectory = state.package.directory;
  document.querySelector("#install-package").disabled =
    !state.package.hasPatch || state.package.active;
  document.querySelector("#restore-package").disabled = !state.package.active;
}
if (state.catalog.available) {
  document.querySelector("#detection").textContent =
    `Catalog: ${state.catalog.maps} maps and ` +
    `${state.catalog.enemySlots} character slots.`;
}

document.querySelector("#new-seed").addEventListener("click", async () => {
  const button = document.querySelector("#new-seed");
  button.disabled = true;
  try {
    const result = await request("/api/seed/new", {
      method: "POST",
      cache: "no-store",
    });
    latestGeneratedSeed = result.seed;
    form.elements.seed.value = latestGeneratedSeed;
    message.textContent = `New seed: ${latestGeneratedSeed}`;
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#export-seed").addEventListener("click", async () => {
  message.textContent = "Preparing shared seed file...";
  try {
    const sharedSeed = await request("/api/share/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(readForm()),
    });
    const blob = new Blob(
      [`${JSON.stringify(sharedSeed, null, 2)}\n`],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const download = document.createElement("a");
    const safeSeed = sharedSeed.seed.replace(/[^\w.-]/gu, "_");
    download.href = url;
    download.download = `dsr-seed_${safeSeed}.json`;
    download.click();
    URL.revokeObjectURL(url);
    message.textContent =
      `Exported seed ${sharedSeed.seed} with hash ` +
      `${sharedSeed.placementHash.slice(0, 12)}…. Share the downloaded JSON file.`;
  } catch (error) {
    message.textContent = error.message;
  }
});

const seedFile = document.querySelector("#seed-file");
document.querySelector("#import-seed").addEventListener("click", () => {
  seedFile.click();
});
seedFile.addEventListener("change", async () => {
  const [file] = seedFile.files;
  seedFile.value = "";
  if (!file) return;
  if (file.size > 64 * 1024) {
    message.textContent = "The shared seed file is too large.";
    return;
  }
  message.textContent = "Importing shared seed...";
  try {
    const payload = JSON.parse(await file.text());
    const result = await request("/api/share/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setForm(result.config);
    latestGeneratedSeed = result.config.seed;
    message.textContent =
      `Verified and imported seed ${result.config.seed} and all randomized options.`;
  } catch (error) {
    message.textContent =
      error instanceof SyntaxError ? "Invalid shared seed JSON file." : error.message;
  }
});

document.querySelector("#detect").addEventListener("click", async () => {
  const detection = document.querySelector("#detection");
  detection.textContent = "Verifying...";
  try {
    const result = await request("/api/detect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameDirectory: form.elements.gameDirectory.value }),
    });
    detection.textContent = result.reason;
  } catch (error) {
    detection.textContent = error.message;
  }
});

document.querySelector("#scan").addEventListener("click", async () => {
  const detection = document.querySelector("#detection");
  detection.textContent = "Reading copies of the game data...";
  try {
    const result = await request("/api/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameDirectory: form.elements.gameDirectory.value }),
    });
    detection.textContent =
      `Imported: ${result.maps} maps and ${result.enemySlots} character slots. ` +
      `${result.errors.length} auxiliary files ignored.`;
    form.elements.useExtractedData.checked = true;
  } catch (error) {
    detection.textContent = error.message;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector(".primary");
  button.disabled = true;
  message.textContent = "Generating placements...";
  try {
    const result = await request("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(readForm()),
    });
    message.textContent =
      `Done. Seed ${result.seed}\n` +
      `${result.counts.enemies} enemies, ${result.counts.bosses} bosses, and ${result.counts.items} world items.\n` +
      `${result.counts.startingClasses} starting classes processed.\n` +
      `${result.counts.gifts} gifts, ${result.counts.enemyDrops} drops, and ` +
      `${result.counts.shops} shop entries processed.\n` +
      `Output: ${result.outputDirectory}` +
      (result.patch ? `\nValidated patch package: ${result.patch.message}` : "");
    latestPackageDirectory = result.outputDirectory;
    document.querySelector("#install-package").disabled = !result.patch;
    document.querySelector("#restore-package").disabled = true;
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

async function changeActivation(endpoint) {
  if (!latestPackageDirectory) return;
  const installButton = document.querySelector("#install-package");
  const restoreButton = document.querySelector("#restore-package");
  installButton.disabled = true;
  restoreButton.disabled = true;
  message.textContent =
    endpoint === "install" ? "Activating package..." : "Restoring vanilla files...";
  try {
    const result = await request(`/api/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        gameDirectory: form.elements.gameDirectory.value,
        packageDirectory: latestPackageDirectory,
      }),
    });
    message.textContent = result.message;
    installButton.disabled = result.active;
    restoreButton.disabled = !result.active;
  } catch (error) {
    message.textContent = error.message;
    installButton.disabled = endpoint === "restore";
    restoreButton.disabled = endpoint === "install";
  }
}

document.querySelector("#install-package").addEventListener("click", () => {
  changeActivation("install");
});
document.querySelector("#restore-package").addEventListener("click", () => {
  changeActivation("restore");
});
