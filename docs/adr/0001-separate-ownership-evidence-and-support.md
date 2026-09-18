---
status: accepted
---

# Separate ownership, evidence, and support

Better Native will record implementation ownership, collected evidence, and support status as
separate facts. The current model overloads `fallback` for implementations that are complete but
await scarce native evidence, which makes runtime ownership inaccurate and keeps useful work on
long-lived branches.

The complete Expo-derived compatibility denominator remains mandatory from the first migration
change. Host verification gates ordinary development, integration evidence may accumulate after the
implementation merges, and the full capability-specific promotion profile gates stable support.
Missing evidence must stay visible and must prevent any claim that depends on it.

Better Native initially uses two support states: `experimental` and `stable`. A maintainer selects
the intended support state, and validation rejects it when the required evidence is absent or stale.
An intermediate state will be added only when it carries a distinct user guarantee.

The supporting precedent review is recorded in
[Progressive verification precedents](../research-progressive-verification-precedents.md).

## Considered options

Keeping the current all-or-nothing gate preserves one simple status but makes unavailable
infrastructure block integration. Weakening the compatibility denominator would make development
faster by hiding unknown work, so it is rejected. Separating the three facts keeps the denominator
strict while moving scarce infrastructure to the point where Better Native makes a stronger claim.

## Consequences

Effect-owned implementations may merge with experimental support after host verification. Stable
support still requires every applicable integration, simulator, emulator, and physical-device
obligation. The repository must expose missing and stale evidence, prevent unsupported promotion,
and allow demotion when it can no longer sustain a guarantee.
