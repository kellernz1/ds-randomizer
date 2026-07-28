# Implementation status

## Architecture

The project separates three responsibilities:

1. The pure generator accepts a catalog and configuration and produces
   deterministic placements.
2. Validation checks configuration, catalog compatibility, hashes, round trips,
   equipment requirements, uniqueness, and progression protection.
3. `DsrDataTool` reads and writes MSB/PARAM formats and performs guarded package
   activation and restore operations.

The scanner never invents missing IDs and the generator never writes directly to
the source installation. A catalog is a local snapshot of the selected game
files; source hashes prevent applying it to a different installation state.

## Implemented in 0.5.9

- Real catalog schema 9 with 18 maps, event sources, English item and boss
  names, and 2,192 enemy parts
- Per-seed `item-locations.txt` showing every randomized world item's original
  and randomized area and Item Lot ID, plus the boss assigned to every
  randomized encounter
- A detached interactive Command Prompt launcher, so stopping the server does
  not show Windows' localized batch-file termination question
- 1,600+ hostile regular-enemy slots, including event-linked visible enemies
- `NpcParam` team classification that excludes friendly and neutral characters
- Movement type, dimensions, pathing, and detection-aware replacement pools
- Cross-model animation reset that prevents frozen bind poses and inactive AI
- Round-trip assertions that preserve every spawn transform and all unselected NPCs
- Ordinary event enable/disable references do not block cross-model enemies
- Tighter height, radius, and vertical-offset checks for regular-enemy spawns
- Area scaling copies the game's native level `SpEffect` from the destination
- Auxiliary/unnamed boss variants are excluded from the replacement pool
- First Asylum boss rooftop animation is replaced by a safe floor spawn
- Adapted Asylum intro explicitly enables replacement AI after arena entry
- Portable seed files contain deterministic options, version, catalog fingerprint, and verified placement hash
- English-only launcher status, dependency, and failure messages
- Cross-map enemy model declarations and validated MSB round trips
- Explicit primary-boss catalog with size-compatible replacement pools
- Boss health-bar name patching in EMEVD while preserving encounter entity IDs
- Per-slot scaled `NpcParam` clones for area and progressive scaling modes
- 527 world item lots, including 25 recognized progression lots
- Independent world-item, enemy, boss, class, gift, drop, and shop streams
- Progression-lot and acquisition-flag preservation
- Ten real starting classes from `CharaInitParam`
- Unique, requirement-compatible weapon matching without replacement
- Per-slot armor randomization and vanilla starting-item exclusion
- Asylum floor pickups preserved separately from spawn equipment
- 20 NPC gift lots, 64 renewable enemy-drop lots, and 392 shop rows
- Isolated packages containing changed MSBs and/or `GameParam.parambnd.dcx`
- Source and output hashes, round-trip validation, atomic install, backup,
  rollback, and guarded restore

## Conservative rules

Regular enemies may keep event entity IDs, but parts with friendly/neutral team
types, human-NPC models, talk IDs, character-init bindings, move points, or
other known high-risk metadata remain excluded. Replacement pools require
compatible movement, size, vertical offset, pathing, and combat-detection
metadata. An entity ID by itself is not treated as a model-specific event
dependency; ordinary character enable/disable events work with replacements.
Bosses use only portable
primary NPC/AI rows; roaming variants, clones, unnamed variants, and auxiliary
fight parts are excluded from the source pool.

World-item payload fields are copied while each destination keeps its
acquisition flag. Progression protection recognizes key goods, embers, the
Peculiar Doll, and progression rings. Those lots remain vanilla in protected
mode. Shop rows preserve price, stock, flags, and conditions while only the
item ID is redistributed within its item type.

## Known limitations

- Boss replacement remains experimental. Portable bosses are matched by size.
  The first Asylum encounter bypasses its model-specific rooftop animation, but
  some later arenas still contain bespoke cutscenes or geometry.
- Full key-item graph randomization is not enabled in protected real-data mode;
  recognized progression lots remain vanilla to prevent softlocks.
- Area and progressive modes currently use the same slot-relative combat-stat
  inheritance; a distinct progressive curve is planned.
- The project currently activates through direct, hash-guarded file replacement;
  mod-loader packaging is not implemented.

Prototype data remains available for tests that run without the game. The real
catalog is always generated locally and is intentionally ignored by Git.
