# Dark Souls Remastered Randomizer

A deterministic, pre-game randomizer for Dark Souls Remastered on Windows. It
extracts data from your own clean installation and builds an isolated seed
package before touching the game.

> Experimental software. Back up your saves and play offline. Modified data
> must never be used in multiplayer.

## Features

- 1,600+ hostile regular-enemy slots across all 18 gameplay maps
- Movement-, size-, and AI-compatible enemy replacements
- Regular enemies with ordinary enable/disable event references remain eligible
  for compatible cross-model replacements
- Friendly NPCs, merchants, quest characters, and their spawns are protected
- Primary boss encounters shuffled through portable, size-compatible pools
- The first Undead Asylum boss uses a safe floor-spawn event path when replaced
- Boss health bars updated to the randomized boss name
- 500+ world pickup and chest item lots
- Starting-class stats and equipment
- Unique, stat-compatible starting weapons collected in the Undead Asylum
- Randomized class armor shown on the creation screen and equipped at spawn
- NPC gifts, renewable enemy drops, and shops
- Independent deterministic RNG streams for every category
- Progression-item protection, spoiler logs, and reproducible placement hashes
- An `item-locations.txt` file for every item seed, with English item names,
  original areas, randomized areas, and exact Item Lot IDs
- Portable seed files with version and clean-catalog compatibility checks
- Hash-checked activation, per-seed backups, atomic replacement, and safe restore

The ten vanilla classes never receive weapons, shields, tools, or armor already
used by a vanilla starting class. Every randomized first class pickup is a
primary weapon, weapon assignments do not repeat between classes, and equipment
requirements are checked against the class's final Strength, Dexterity,
Intelligence, and Faith.

## Requirements

- Windows
- Dark Souls Remastered on Steam
- Node.js 20 or newer
- .NET 8 SDK
- A clean, unpacked game installation with no other active data mods

The configurator and generator do not download or redistribute game data.
`data/dsr-catalog.json` is produced locally from the user's installation and is
excluded from version control.

## Quick start

```powershell
npm install
npm run build:data-tool
.\start-randomizer.bat
```

In the configurator:

1. Select the `DARK SOULS REMASTERED` directory.
2. Click **Verify**, then **Import game data**.
3. Enable the categories you want to randomize.
4. Enter a seed, disable **Safe simulation**, and confirm offline play.
5. Click **Generate Randomizer**.
6. Click **Activate in Game**, then launch the game normally.

The generated seed folder always includes `item-locations.txt` when world items
are randomized. This report is created even when the full spoiler log option is
disabled.

Use **Export** beside the seed to create a small JSON file containing the seed
and every option that affects placements. Another player can use **Import seed**
to load it. Local paths, backups, extracted game data, and credentials are never
included. Both players must use the same randomizer version and matching clean
game data. Import recalculates and verifies the expected placement hash before
accepting the file.

Create a new character when testing randomized starting classes or equipment.
Use **Restore Vanilla** before importing again, changing seeds, verifying game
files, or installing another data mod.

## CLI

Generate a dry-run package:

```powershell
node src/cli.js generate --seed example --output output
```

Generate a real patch package from an imported catalog:

```powershell
node src/cli.js generate --config config.json --apply --offline
```

Run the automated suite and deterministic seed stress test:

```powershell
npm test
npm run test:seeds
```

## Safety model

The scanner only reads the selected installation. Generation writes to an
isolated `output/seed_<seed>` directory. Activation verifies every source and
patch hash, creates a backup inside the seed package, and rolls back if any file
operation fails. Restore refuses to overwrite a game file changed after
activation.

Progression protection keeps recognized keys, embers, progression rings, and
event-bound shop goods in their original locations. Boss replacement preserves
the original map entity IDs so map events continue to target the encounter.
Area scaling creates a dedicated NPC parameter row for every replacement and
inherits HP, stamina, defenses, resistances, and souls from the original enemy
in that slot. It also inherits the destination area's native level multiplier,
which scales attack power and stamina. Model-specific effects and animations
remain attached to the replacement so it can animate, navigate, and enter
combat normally. The first Asylum boss bypasses the original model-only rooftop
drop animation, is placed at the arena floor, and has its AI explicitly enabled
after the player enters the arena.
Boss mode remains experimental because some encounters contain bespoke
animations and arena scripting.

## Project layout

- `public/` — pre-game web configurator
- `src/core/` — configuration, deterministic RNG, placement generation, output
- `src/game/` — installation detection and source verification
- `tools/DsrDataTool/` — SoulsFormats-based MSB/PARAM scanner and patcher
- `test/` — deterministic and real-catalog tests
- `docs/IMPLEMENTATION.md` — implementation details and current limitations

## Legal

This is an unofficial fan project and is not affiliated with FromSoftware or
Bandai Namco. Dark Souls is a trademark of its respective owners. No game files,
keys, credentials, local paths, generated catalogs, backups, or seed packages
are committed to this repository.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for dependency attribution.
