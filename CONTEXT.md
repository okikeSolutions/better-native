# Domain glossary

## Capability

An Expo package migration tracked as one unit. A capability includes every discovered entrypoint and
the requirements that apply to it.

## Ownership

The implementation that handles an entrypoint at runtime. Ownership does not describe how much
evidence has been collected for that implementation.

## Evidence

A recorded observation produced by a defined verification method. Evidence is scoped to the tested
behavior, platform, runtime, build, and environment.

## Support status

The guarantee Better Native makes to users for a capability. Support status is constrained by the
available evidence but remains a deliberate maintainer decision.

## Verification profile

A named set of checks that supports a specific claim. The profiles are `host`, `integration`, and
`promotion`.

## Promotion

The reviewed decision to move a capability to stable support after its promotion profile passes.
