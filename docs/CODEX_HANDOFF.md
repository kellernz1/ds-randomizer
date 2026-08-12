# Codex handoff for Dark Souls Remastered Randomizer

This file is a compact continuation brief for another Codex chat. It summarizes
the current mod direction, major invariants, and the riskier implementation
areas. Treat the source code and tests as authoritative if anything here drifts.

## Current project state

- Repository: `kellernz1/ds-randomizer`
- Main workspace: `C:\Users\kelle\Desktop\ds-randomizer`
- Active branch expectation from the user: commit directly to `main`
- Current randomizer version: `0.5.51`
- Game target: Dark Souls Remastered, Windows, offline only
- Important generated report: `cheat-locations.txt`

## Product goal

The user wants a pre-game configurable randomizer with options selected before
launching the game. It should randomize enemies, bosses, world pickups, gifts,
enemy/NPC drops, shops, and starting classes/equipment while preserving enough
event behavior to keep progression possible.

## Core design rules

- Enemy randomization is a global permutation, not independent random sampling.
  Existing enemy occurrences trade places and should not be duplicated or
  deleted.
- Size, height, movement type, navigation, AI type, and original difficulty
  must not restrict ordinary enemy destinations.
- Scaling is handled after assignment according to the user-selected scaling
  mode.
- Friendly NPCs, merchants, quest NPCs, invisible helpers, transport crows,
  and dummy zero-param slots are protected.
- Bosses randomize only with true bosses.
- Dragons use separate dragon pools and never enter the ordinary enemy or true
  boss pools unless they are explicitly part of the dragon boss handling.
- Items/gifts/drops/shops are one shared deterministic item permutation, with
  merchant bulk ammo/throwables kept shop-only.

## Enemy-specific rules

- The first three Asylum enemies stay randomized but must remain passive until
  attacked.
- New Londo entrance passive enemies keep passive-until-attacked behavior.
- Kiln slot `m18_00_00_00:c2790_0002`, entity ID `1800201`, stays passive until
  attacked.
- The Parish Titanite Demon chamber slot `m10_01_00_00:c2300_0000` stays
  passive until attacked.
- Mimics, Pisacas, Titanite Demons, and ghosts have forced/active combat
  handling where needed.
- Male/Female Ghost replacements get tangible `NpcParam` clones so they can be
  seen and hit without Transient Curse.
- Crystal Cave butterflies (`m17_00_00_00:c3230_0000/_0001/_0002`) are ordinary
  enemies and must stay in the ordinary enemy pool even though they share the
  Moonlight Butterfly model family.
- Titanite Demons are in the regular-dragon pool but must never be assigned
  back into native Titanite Demon slots.

## Boss rules

- Boss assignments are a strict derangement for supported boss destinations.
- Four Kings destination `m16_00_00_00:c5390_0000` is script-protected for now:
  changing only the MSB body creates a false randomized boss bar while vanilla
  kings still spawn.
- Moonlight Butterfly, Gwyndolin, Four Kings, and Bed of Chaos are not portable
  replacement sources because their AI/spawn lifecycle depends on bespoke arena
  scripts.
- Moonlight Butterfly, Ceaseless, and Gwyndolin destination encounters still
  participate as boss destinations.
- Bed of Chaos destination is handled specially: the main body is replaced by a
  grounded boss and the original scripted helper/core entities are disabled and
  killed.
- Portable boss bodies get EMEVD combat activation unless the destination
  already has a deferred/contained arena activation event.
- Known explicit arena handling exists for Asylum, Stray Demon/floor-break,
  Taurus bridge, Butterfly bridge, Ceaseless, and Bell Gargoyles.
- Single-body Bell Gargoyle replacements must remove/kill unused staged
  secondary bodies and suppress orphaned bars.
- O&S second-phase/internal forms must not leak into ordinary enemy slots.

## Dragon pools

Dragon-like units currently include:

- Hellkite bridge dragon
- Undead Dragons and linked parts
- Drakes
- Hydras and all seven heads
- Crossbreed Priscilla
- Kalameet
- Gaping Dragon
- final Seath encounter body and tail
- ordinary Anor Londo Gargoyles
- Titanite Demons

The first forced-death Seath encounter is not part of the portable Seath unit.

## Item rules

- World pickups, NPC gifts, enemy drops, friendly NPC death drops, and most shop
  rows share one permutation.
- Dungeon Cell Key, Undead Asylum F2 East Key, Archive Prison Extra Key,
  Archive Tower Giant Cell Key, and Archive Tower Giant Door Key are permanently
  fixed as both source and destination.
- DLC world locations cannot receive progression items, Embers, Titanite, or
  Havel's Ring. Those items remain in the global pool but are assigned outside
  DLC world pickups.
- Peculiar Doll must appear in `cheat-locations.txt` and full spoiler reports
  by source item location, even if it lands in gifts/drops/shops.
- Weapons, armor, spells, and rings should appear as quantity 1.
- Shop stock limits: 99 bulk ammo/throwables, 10 ordinary consumables, 1
  weapons/armor/spells/consumable souls.

## Starting class rules

- Class stats and class equipment are separate options.
- Randomized class equipment must be visible on the character creator.
- Each class must have a primary weapon.
- Starting weapons and armor must not repeat between classes.
- Vanilla starting class weapons/armor are excluded from randomized class
  equipment, but remain obtainable elsewhere.
- Weapons can be allowed if the class can use them one-handed or two-handed
  with starting Strength and stat requirements.

## Important tests/validation

Run these before committing:

```powershell
npm.cmd test
npm.cmd run build:data-tool
```

When touching event/MSB behavior, also generate an audit seed against a copied
clean game directory. The last known good audit used:

```powershell
node src\cli.js generate --config config.json --seed v051-audit --output .tmp\audit-output --game .tmp\audit-game --apply --offline
```

Latest audit invariants checked:

- 8 native Titanite Demon slots found, 0 assigned back to `c2300`
- Four Kings boss placement count: 0
- Bed of Chaos changed and helper parts disabled/killed
- 3 Crystal Cave butterflies randomized
- no progression/Ember/Titanite/Havel world item in DLC
- archive prison keys absent from randomized item placements
- no always-loaded boss body missing `forceCombatActivation`
- Peculiar Doll present in global item reports

## Known risky areas

These may still need real in-game verification:

- Some Blighttown respawn behavior may be tied to vanilla mosquito/lifecycle
  events.
- Catacombs T-pose after death may be tied to skeleton/necromancer resurrection
  events.
- Four Kings is intentionally protected rather than truly randomized until its
  multi-king event can be modeled safely.
- First forced-loss Seath encounter is protected from the Seath dragon unit,
  but soul-loss behavior should still be verified in game.
