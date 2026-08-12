# Dark Souls Remastered Randomizer

A deterministic, pre-game randomizer for Dark Souls Remastered on Windows. It
extracts data from your own clean installation and builds an isolated seed
package before touching the game.

> Experimental software. Back up your saves and play offline. Modified data
> must never be used in multiplayer.

## Features

- 1,800+ hostile regular-enemy slots across all 18 gameplay maps, including
  dummy and event-linked slots
- Unrestricted global enemy permutation: size, height, movement, navigation,
  AI type, and original difficulty do not restrict destinations
- Every ordinary hostile spawn is used exactly once, including permutation
  cycles involving any number of enemies
- Friendly NPCs and invisible technical helpers remain in their native locations
- Area and progressive scaling adapt combat stats to the destination slot;
  original-stat scaling deliberately retains the source enemy's strength
- Only the required cross-map Lua battle/logic scripts are merged into each
  destination map, keeping AI bundles small and isolated
- Transferable enemy visual effects, textures, and effect models are merged
  into the package's common SFX bundle, so cross-map projectiles and elemental
  attacks (including Demonic Statue fire) remain visible
- Event-controlled and dummy hostile slots participate in the same permutation
- Regular-enemy occurrences remain a global permutation, but are rebalanced to
  at most 30 unique regular models per map to stay within the Remaster's
  simultaneous character-resource budget
- Cross-model event slots keep their enable/disable lifecycle while
  model-specific animation, warp, and body-part actions from the replaced
  enemy are removed to prevent frozen enemies and resource-loader crashes
- The first three Asylum enemies remain randomized and keep their replacement
  model's idle movement, but a persistent friendly-enemy allegiance prevents
  all three from attacking until the player damages them
- The Kiln slot with entity ID `1800201` also remains randomized but stays
  passive until the player damages it
- Titanite Demons participate in the regular-dragon pool, but never occupy
  their native Titanite Demon slots
- Friendly NPCs, merchants, quest characters, and their spawns are protected
- Boss encounters exchange only with true boss encounters; ordinary Anor Londo
  gargoyles and non-boss dragons cannot enter the boss pool
- Boss replacements use complete terrain-safe X/Y/Z points. Event-staged Taurus
  Demon, Bell Gargoyle, Moonlight Butterfly, Ceaseless Discharge, and Asylum
  encounters begin directly inside their playable arenas
- Dragons only exchange locations with other dragons; ordinary Anor Londo
  Gargoyles and Titanite Demons participate in the regular-dragon pool, while
  detachable tails, wings, legs, and encounter variants move as linked groups
- Hydra bodies and all seven heads also move as linked hydra-only groups
- Sanctuary Guardian, Gargoyle, and Centipede Demon bodies and removable parts
  are randomized as inseparable boss groups
- Bed of Chaos is a portable boss source. Its destination receives one grounded
  randomized boss, disables the original scripted side entities, and restores,
  activates, and protects every arena-floor object from destruction
- Large, medium, and small Humanity enemies participate in the global
  regular-enemy permutation
- Moonlight Butterfly, Ceaseless Discharge, Dark Sun Gwyndolin, Bed of Chaos,
  and Four Kings are both destinations and portable sources in the boss pool.
  Super Ornstein and Super Smough are distinct boss archetypes rather than
  aliases of their first phases
- Boss health bars updated to the randomized boss name
- Boss assignments are a strict archetype derangement: no portable vanilla
  boss or powered Ornstein/Smough phase remains in its native encounter.
  Multi-part encounters share one linked body/part assignment; Four Kings uses
  one randomized encounter body while its four scripted extra bodies are
  disabled
- Randomized boss AI is explicitly enabled/replanned either when the destination
  arena event fires or, for ordinary always-loaded boss slots, when the map
  constructor starts
- Single-body Bell Gargoyle replacements remove and kill the unused staged
  secondary entities and suppress their orphaned boss bars
- The rooftop Asylum encounter is moved to the lower arena's full X/Y/Z
  position; Moonlight Butterfly replacements begin with their landing animation
- 500+ world pickup and chest item lots
- Starting-class stats and equipment
- Unique, stat-compatible starting weapons collected in the Undead Asylum;
  the initial weapon pool includes equipment usable one-handed or two-handed
  with the class's starting Strength
- Randomized class armor shown on the creation screen and equipped at spawn
- Starting equipment draws from every named base weapon and armor piece in the
  game data, including equipment that is not sold or placed in ordinary loot;
  character-creator, invisible, no-travel, transformation, reinforced, and
  infusion variants are excluded
- NPC gifts, hostile and friendly NPC death drops, renewable enemy drops, and
  shops, including the Dusk Crown Ring
- Randomized New Londo ghosts have both ghost-state flags and the alternate
  ghost model disabled, keeping them visible and directly damageable in combat
- World items, NPC gifts, enemy-drop lots, and shops are true permutations:
  existing contents trade locations without duplication or deletion
- Weapons, armor, spells, and rings always appear as a single item; stackable
  consumables preserve meaningful stack quantities
- Arrows, bolts, throwable consumables, and other bulk merchant ammunition stay
  in the shop pool. Generated stock keeps finite purchase limits: 99 for bulk
  ammunition and throwables, 10 for ordinary consumables, and 1 for weapons,
  armor and spells. Consumable souls only use rows with a native persistent
  stock flag and disappear after their single purchase, preventing soul farming
- DLC world locations never receive progression items, Embers, Titanite, or
  Havel's Ring; those items remain in the shared permutation but are assigned
  outside the DLC
- Independent deterministic RNG streams for every category
- Progression-item protection, spoiler logs, and reproducible placement hashes
- A `cheat-locations.txt` report with English item and boss names, original and
  randomized item areas, exact Item Lot IDs, and each encounter's assigned boss
- Full spoiler reports include the same global item-location section as
  `cheat-locations.txt`, so items such as the Peculiar Doll are visible by
  source item even when randomized into gifts, drops, or shops
- Enemy spoiler entries include the original source map and spawn slot for
  every permutation assignment
- Portable seed files with version and clean-catalog compatibility checks
- One explicit custom configuration model with no hidden preset system
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
4. Enter a seed and disable **Safe simulation** to build an installable package.
5. Click **Generate Randomizer**.
6. Click **Activate in Game**, then launch the game normally.

The generated seed folder includes `cheat-locations.txt` when world items or
bosses are randomized. This report is created even when the full spoiler log
option is disabled.

Enemy randomization packages also include a patched common SFX bundle. It is
installed and restored with the same hash checks and per-seed backup as the
map, AI, event, and parameter files.

Use **Export** beside the seed to create a small JSON file containing the seed
and every option that affects placements. Another player can use **Import seed**
to load it. Local paths, backups, extracted game data, and credentials are never
included. Both players must use the same randomizer version and matching clean
game data. Import recalculates and verifies the expected placement hash before
accepting the file.

Create a new character when testing randomized starting classes or equipment.
Use **Restore Vanilla** before importing again, changing seeds, verifying game
files, or installing another data mod.

When an update changes the catalog schema, restore any active package, verify
the clean installation, and run **Import game data** again before generating a
new seed. Extracted catalogs from older schemas are intentionally rejected.

## CLI

Generate a dry-run package:

```powershell
node src/cli.js generate --seed example --output output
```

Generate a real patch package from an imported catalog:

```powershell
node src/cli.js generate --config config.json --apply
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
unlisted event-bound shop goods in their original locations. Requested utility
goods, consumables, covenant items, and spells—including smithboxes, the Crest
of Artorias, Master Key, Dusk Crown Ring, and the documented spell list—remain
eligible for randomization. Boss replacement preserves
the original map entity IDs so map events continue to target the encounter and
places the replacement at a known terrain-safe X/Y/Z coordinate.
Area scaling creates a dedicated NPC parameter row for every replacement and
inherits HP, stamina, defenses, resistances, and souls from the original enemy
in that slot. Every combat-scaling `SpEffect` also comes from the destination,
so hidden late-game HP, defense, and attack multipliers cannot leak into an
early encounter. Incompatible initial animation IDs are cleared so replacements
can animate and enter combat normally. Boss replacements are grounded before
play begins, and the first Asylum encounter bypasses its original rooftop drop
animation.
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
