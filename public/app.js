const form = document.querySelector("#config-form");
const message = document.querySelector("#message");
const presetSelect = form.elements.preset;
let presets = {};
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
presets = state.presets;
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
    `Catalog: ${state.catalog.maps} maps, ${state.catalog.enemySlots} slots, ` +
    `${state.catalog.safeSlots} conservative candidates.`;
}

document.querySelector("#new-seed").addEventListener("click", async () => {
  const nextState = await request("/api/state");
  latestGeneratedSeed = nextState.generatedSeed;
  form.elements.seed.value = latestGeneratedSeed;
});

presetSelect.addEventListener("change", () => {
  const preset = presets[presetSelect.value];
  if (preset) setForm({ ...preset, preset: presetSelect.value });
});

for (const field of form.querySelectorAll("input, select")) {
  if (field.name !== "preset") {
    field.addEventListener("change", () => {
      presetSelect.value = "custom";
    });
  }
}

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
      `Imported: ${result.maps} maps, ${result.enemySlots} slots, and ` +
      `${result.safeSlots} conservative candidates. ` +
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
