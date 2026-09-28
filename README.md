# Dark Souls Remastered Randomizer

A standalone, deterministic randomizer for **Dark Souls Remastered** on
Windows. Choose what to randomize before opening the game, generate a seed, and
activate it directly from the desktop launcher.

## Download

Download the latest release from
[Nexus Mods](https://www.nexusmods.com/darksoulsremastered/mods/1430).

## Features

- Randomized regular enemies and bosses, with optional area or progressive scaling
- Randomized world items, enemy and NPC drops, gifts, and shops
- Randomized starting-class stats, weapons, and armor
- Optional progression protection and 100% enemy drop rate
- Reproducible seeds that can be exported and shared
- Spoiler log and `cheat-locations.txt` reports
- Safe package activation and vanilla restoration
- Standalone launcher with no browser or local server required

## Requirements

- Windows x64
- Dark Souls Remastered on Steam
- A clean game installation without other active data mods

## How to use

1. Download and extract the archive from Nexus Mods.
2. Run `DSR-Randomizer.exe` outside the game directory.
3. Select the `DARK SOULS REMASTERED` installation directory.
4. Click **Verify**, then **Import Game Data** while the installation is clean.
5. Select what you want to randomize and choose a seed.
6. In **Package**, leave **Use extracted game data** checked and uncheck
   **Safe simulation**. Safe simulation is on by default and creates reports
   only; it does not create a package that can be activated in the game.
7. Click **Generate Randomizer**. When generation completes, click **Activate
   in Game** and wait for the success message before launching the game.
8. Use **Restore Vanilla** before changing seeds, importing game data again,
   verifying game files, or installing another data mod.

Create a new character when randomizing starting classes or equipment.

> **Play offline.** Modified game data must never be used in multiplayer. Back
> up your save files before playing.

## Building from source

Building requires Node.js 20 or newer and the .NET 8 SDK.

```powershell
npm install
npm test
npm run dist:win
```

The portable executable is generated at `release/DSR-Randomizer.exe`.

## Legal

This is an unofficial fan project and is not affiliated with FromSoftware or
Bandai Namco. No game files or locally extracted game data are distributed with
the project.

Licensed under the [GNU GPL v3](LICENSE). See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for dependency attribution.
