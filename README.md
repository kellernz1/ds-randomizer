# Dark Souls Remastered Randomizer

A standalone, deterministic randomizer for **Dark Souls Remastered** on
Windows. Choose what to randomize before opening the game, generate a seed, and
activate it directly from the desktop launcher.

Current version: **0.6.20**.

## Download

Download the latest release from
[Nexus Mods](https://www.nexusmods.com/darksoulsremastered/mods/1430).
The Nexus page also offers a source-only ZIP for users who prefer not to
download an executable. That edition requires Node.js 20+ and the .NET 8 SDK.

## Features

- Randomized regular enemies and bosses, with optional area scaling or +10%
  progressive HP and damage per Bell, Lordvessel, and Lord Soul milestone
- Configurable chance for normal chests with valid loot and map data to become
  mimics, including chests disabled at map start and protected progression
  chests; the original chest loot is awarded after defeating the mimic
- Randomized world items, enemy and NPC drops, gifts, and non-spell shop stock; spell shop entries stay fixed to preserve attunement identity
- Randomized starting-class stats, weapons, and armor
- Optional progression protection and 100% enemy drop rate
- Independent enemy seed and enemy-model exclusion list
- Optional intact Bed of Chaos arena floor; the default keeps its vanilla route
- Optional Lordvessel and Lord Soul shuffling limited to progression and boss rewards
- Reproducible seeds that can be exported and shared
- Spoiler log and `cheat-locations.txt` reports in the generated output folder
- Safe package activation and vanilla restoration
- Standalone launcher with no browser or local server required

## Requirements

- Windows x64
- Dark Souls Remastered on Steam with vanilla game data
- Other active data mods are unsupported. Seamless Co-op is recognized as an
  experimental combination; its own launcher and files must remain installed.

## How to use

1. Download and extract the archive from Nexus Mods.
2. Run `DSR-Randomizer.exe` outside the game directory.
3. Select the `DARK SOULS REMASTERED` installation directory.
4. Click **Verify**, then **Import Game Data** while the game data is vanilla.
   You can leave the Seamless Co-op loader installed; do not import data while
   another mod has changed the game's map, event, or parameter files.
5. Select what you want to randomize, set the mimic chance if desired, and
   choose a seed. Eligible protected chests can also become mimics; their
   original item lot is awarded after the mimic is defeated.
6. In **Package**, leave **Use extracted game data** checked and uncheck
   **Safe simulation**. Safe simulation is enabled by default and produces
   reports without a game package, so it must be off to activate a seed.
7. Click **Generate Randomizer**. When generation completes, click **Activate
   in Game** and wait for the success message before launching the game.
8. Use **Restore Vanilla** before changing seeds, importing game data again,
   verifying game files, or installing another data mod.

When randomizing starting classes or equipment, start a new character to use
the randomized starting setup.

> **Seamless Co-op support is experimental.** To play together, every player
> must use the same Seamless Co-op version and the same randomizer version,
> export the seed from **Share Seed**, import that seed on each player's copy,
> and activate the resulting package on every game installation. Launch through
> `ds1sc_launcher.exe`; do not use the randomized files with vanilla online
> multiplayer. The Seamless Co-op author has not tested compatibility with
> other mods, so back up saves and expect possible event or boss conflicts.

## Building from source

Building requires Node.js 20 or newer and the .NET 8 SDK.

```powershell
npm install
npm test
npm run dist:win
```

The Windows ZIP with the desktop app is generated in `release`.

### Running the source-only edition

The source-only Nexus ZIP contains no executable files. After installing
Node.js 20+ and the .NET 8 SDK, extract it and run these commands in PowerShell:

```powershell
dotnet restore tools/DsrDataTool/DsrDataTool.csproj --configfile NuGet.Config
dotnet build tools/DsrDataTool/DsrDataTool.csproj --configuration Release --no-restore
node src/cli.js ui
```

Keep the PowerShell window open while using the randomizer in your browser. No
`npm install` is required for the browser UI. Generate that source archive with
`npm run dist:nexus-source`.

## Legal

This is an unofficial fan project and is not affiliated with FromSoftware or
Bandai Namco. No game files or locally extracted game data are distributed with
the project.

Licensed under the [GNU GPL v3](LICENSE). See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for dependency attribution.
