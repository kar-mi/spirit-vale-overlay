# @spiritvale/build-export

Opens the captured character in the [spiritvalers.com](https://spiritvalers.com) build planner:
exact item ids, refines, socketed cards, gem refines and substat rolls, in one click.

The handoff needs no site change. The planner already boots a build out of the URL fragment
(`/simulator#b=<base64url json>`), so the window hands the link to the default browser and stops
there. A fragment never leaves the browser — no request, no `Referer`, no server log — so opening
the link does not upload the character anywhere.

## How it works

```
CharacterSnapshot            snapshot-to-build.ts          site-links.ts
(@kar-mi/...-character)  ->  v:2 build (the planner's  ->  /simulator#b=...
                             own payload shape)
```

`snapshotToBuild` is pure and takes the character as an argument, and the window takes a
`getCharacter` provider rather than reading capture state itself. Nothing in the translation cares
whose character it is.

Two rules hold the translation together:

1. **Nothing is invented.** An id the pinned catalog does not know is counted and reported in the
   window, never guessed at. A build that quietly contains the wrong item is worse than one that
   honestly says it left two cards out.
2. **Positions are preserved.** The planner's card and substat arrays are positional, and a chaos
   substat is identified purely by sitting in the last slot. Packing an array moves a chaos roll
   into a normal slot, where the planner will never floor it correctly.

## The pinned catalog snapshot

`src/catalog/snapshot.json` is a pinned, vendored subset of spiritvalers.com's catalogs, so the
exporter works offline like the rest of the app. Refresh it after a game patch that adds skills,
classes or equipment:

```
bun run --filter @spiritvale/build-export refresh-snapshot
bun run --filter @spiritvale/build-export refresh-snapshot -- --site-dir ../spiritvale-deploy
```

It carries only what the game export cannot yield: skill route slugs (68 of 258 are editorial, e.g.
`IncreasedManaRegen` -> `increased-recovery`), class slugs, the stat-type vocabulary, card-slot
counts, substat pools, and id membership lists. No item names, stat blocks, drop tables or icons —
which keeps it at ~59 KB instead of ~508 KB, keeps it stable across patches that only move item
numbers, and keeps it inside the Interoperability Snapshot grant in that site's LICENSE.

That grant requires the attribution notice reproduced in the snapshot to be preserved, which is why
the window shows a visible spiritvalers.com credit.

## Tests

`bun test packages/build-export` — the translation, the substat maths and the fragment encoding are
covered without needing a capture or a network call.
