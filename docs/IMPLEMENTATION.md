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

## Implemented in 0.5.18

- Real catalog schema 12 with 18 maps, event and Lua AI sources, English item
  and boss names, and 2,192 enemy parts
- English FMG names for gifts, drops, shops, and starting equipment prevent
  Japanese internal parameter labels from leaking into seed reports
- Regular enemies use an unrestricted, count-preserving global permutation
  instead of sampling with replacement or requiring reciprocal pairs
- All hostile regular slots participate, including dummy and event-controlled
  parts; friendly NPCs and invisible engine helpers remain protected
- Size, height, movement, navigation, AI type, and original difficulty are not
  placement constraints
- Area and progressive modes inherit destination combat stats; vanilla mode
  deliberately keeps the source enemy's original stats
- Invisible helper-only character resources are excluded from cross-map pools
- World items, gifts, enemy drops, and shops preserve their source multisets
  through deterministic permutations
- Per-seed `cheat-locations.txt` showing every randomized world item's original
  and randomized area and Item Lot ID, plus the boss assigned to every
  randomized encounter
- A detached interactive Command Prompt launcher, so stopping the server does
  not show Windows' localized batch-file termination question
- Scaled replacements inherit every combat-scaling `SpEffect` from the
  destination, preventing hidden late-game HP and attack multipliers
- Randomized boss AI is explicitly enabled when its health bar appears
- Boss models use a strict non-vanilla assignment, while duplicate parts and
  alternate-map copies of one encounter share the same replacement and name
- Only required cross-map Lua battle/logic scripts, matching goal records, and
  referenced globals are merged into each destination map's `luabnd`
- Transferable enemy FFX effects, textures, and effect models from map bundles
  are merged into the package's `CommonEffects` bundle so cross-map attacks
  remain visible, including Demonic Statue fire projectiles
- EMEVD instruction edits preserve parameter indices, and the adapted Asylum
  AI activation runs before the intro event terminates
- Preset definitions and preset CLI/config handling have been removed
- 1,800+ hostile regular-enemy slots, including dummy and event-linked enemies
- `NpcParam` team classification that excludes friendly and neutral characters
- Unrestricted cross-map placement pools for eligible regular enemies
- Cross-model animation reset that prevents frozen bind poses and inactive AI
- Round-trip assertions that preserve every spawn transform and all unselected NPCs
- Ordinary event enable/disable references do not block cross-model enemies
- Deterministic multi-enemy permutation cycles with no eligible source reused
- Area scaling copies every combat-scaling `SpEffect` from the destination
- Bosses use an unrestricted permutation and every destination receives a
  terrain-level Y coordinate
- Dragons are isolated into dragon-only permutation groups; detachable parts
  and alternate encounter bodies follow their parent group
- Hydras use linked hydra-only body/head groups, and Moonlight Butterfly,
  Ceaseless Discharge, and Gwyndolin are included as boss encounters
- All 45 Humanity enemy slots participate in the regular permutation
- Sanctuary Guardian tails, both Gargoyle tail types, and all Centipede Demon
  removable parts follow their linked boss assignment
- Bed of Chaos body, core, and bug are reserved as one native scripted group
  and never leak into the regular-enemy permutation
- First Asylum boss rooftop animation is replaced by a floor spawn
- Adapted Asylum intro explicitly enables replacement AI after arena entry
- Portable seed files contain deterministic options, version, catalog fingerprint, and verified placement hash
- English-only launcher status, dependency, and failure messages
- Cross-map enemy model declarations and validated MSB round trips
- Explicit boss catalog with grounded, unrestricted replacement pools
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
- Isolated packages containing changed MSBs, AI/event bundles, `GameParam`,
  and the hash-guarded common enemy-effect bundle when enemies are randomized
- Source and output hashes, round-trip validation, atomic install, backup,
  rollback, and guarded restore

## Protected entities

Friendly/neutral teams, human-NPC models, and invisible technical helper
characters are not randomized. Hostile regular enemies do not require
compatible movement, dimensions, vertical offset, pathing, AI type, original
difficulty, dummy status, or event linkage at their destination. Entity IDs are
preserved so enable/disable and encounter events continue to target the slot.
Dragon bodies and detachable parts use linked dragon-only groups.

World-item payload fields are copied while each destination keeps its
acquisition flag. Progression protection recognizes key goods, embers, the
Peculiar Doll, and progression rings. Those lots remain vanilla in protected
mode. Shop rows preserve price, stock, flags, and conditions while only the
item ID is redistributed within its item type.

## Known limitations

- Boss replacement remains experimental. Replacements are grounded and the
  first Asylum encounter bypasses its model-specific rooftop animation, but
  some later arenas still contain bespoke cutscenes or geometry.
- Bed of Chaos remains vanilla because its three entities and progression
  events cannot be represented safely by a single ordinary boss slot.
- Full key-item graph randomization is not enabled in protected real-data mode;
  recognized progression lots remain vanilla to prevent softlocks.
- Area and progressive modes currently use the same slot-relative combat-stat
  inheritance; a distinct progressive curve is planned.
- The project currently activates through direct, hash-guarded file replacement;
  mod-loader packaging is not implemented.

Prototype data remains available for tests that run without the game. The real
catalog is always generated locally and is intentionally ignored by Git.
