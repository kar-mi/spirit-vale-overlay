# Healing attribution follow-up

## Current behavior

Combat logs contain `heal` events with a recipient and value, but many have no
`actorId`, `sourceId`, or `sourceLabel`. The HPS meter therefore credits those
heals to the recipient so they remain visible, and shows them as **Unattributed
healing** in the skill breakdown.

The replay identity issue is separate and has been fixed: replay snapshots are
now captured before later identity removal/reset records can erase names from
earlier encounters.

## Evidence from the captured session

The 2026-07-28 session contains 754 positive heals totaling 943,200. The
actor-less heals have no source in the log. Two observed Blood Crash sequences
have a self-targeted `BloodCrash` activation and zero-damage record, followed
immediately by an actor-less heal for the same actor.

That is strong evidence for Blood Crash, but it is not a general attribution
mechanism. A UI-side `BloodCrash` check plus a time window was intentionally
rejected because it hardcodes game mechanics and can mislabel unrelated heals.

## Root cause

`@kar-mi/spirit-vale-tools-combat` owns the activation-to-heal attribution.
Its `FishNetCombatTracker` currently considers only a fixed list of healing
skill IDs (`Heal`, `HighHeal`, and `FieldHealing`) when it processes a
`Recover_C` packet. It therefore discards Blood Crash as a heal candidate
before the overlay or replay code receives the event.

The bundled skill catalog knows that `BloodCrash` is an active skill, but its
public definition has no semantic field describing whether a skill produces a
direct heal, regeneration, or self-heal. The overlay cannot make a reliable,
data-driven decision from the event it receives.

## Recommended design

Add generated healing-attribution metadata to the skill catalog, then use that
metadata in the combat tracker instead of fixed skill-ID sets.

- Extend each skill definition with an optional heal behavior: direct,
  regeneration, self-heal, or none.
- Populate the behavior from the authoritative skill extraction pipeline, not
  from overlay code.
- Have `FishNetCombatTracker` select eligible activations using the catalog
  behavior and the existing target/tick/ambiguity rules.
- Emit the resolved actor, source ID, source label, attribution, and activation
  ID on the normal `heal` event. HPS and replay then require no special cases.
- When no catalog-backed candidate exists, retain recipient-owned healing as an
  explicit **Health Leech** fallback only if that product label is desired. It
  should not claim certainty about the underlying game mechanic.

## Acceptance tests

- A catalog-marked self-heal such as Blood Crash produces a heal event credited
  to the casting warrior with `sourceId: "BloodCrash"`.
- Catalog-marked direct and regeneration heals retain their existing
  attribution behavior.
- Overlapping eligible activations remain ambiguous rather than guessing.
- A heal with no eligible catalog-backed source is kept under the recipient's
  fallback category.
- Live and replay HPS show the same actor and skill breakdown.
