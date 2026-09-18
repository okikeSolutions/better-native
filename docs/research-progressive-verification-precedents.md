# Progressive verification precedents

## Question

Is Better Native's proposed approach novel? The approach keeps a complete compatibility contract from the beginning, records missing evidence honestly, accumulates verification in stages, and permits stronger support claims only after the required evidence exists.

## Conclusion

The governing idea is established, not novel. Several mature projects separate availability from support guarantees and require stronger evidence before promotion. They also distinguish the written contract from the tests available to check it.

Better Native's likely distinctive part is narrower: it derives a complete per-export migration ledger from a pinned Expo revision, then runs upstream and Effect-owned implementations as paired applications against the same native platform and records compatibility evidence separately from developer-experience evidence. None of the six systems reviewed here combines those mechanisms. That makes the application distinctive within this review, but does not establish legal, patent, or academic novelty.

The closest precedent is Rust's target tier policy. Kubernetes, W3C, SLSA, Android, and OpenFeature each supply another part of the model. Better Native should cite them as design precedents rather than claim that progressive, evidence-gated verification itself is new.

This is an engineering precedent review of the six named systems, not an exhaustive academic, standards, prior-art, or patent search.

## Closest precedents

### Rust target support tiers

Rust separates code presence from guarantees:

- Tier 3 targets exist in the codebase but receive no build or test guarantee.
- Tier 2 targets must build in continuous integration, but tests need not pass or run.
- Tier 1 targets must build and pass tests in continuous integration.

Each tier builds on the previous tier. Promotion requires meeting the target tier's requirements and approval. New targets normally begin at Tier 3 and spend time at each tier. Higher tiers are an increasing support commitment, not a permanent promise. The policy permits demotion or removal, and Tier 3 targets must not burden ordinary pull-request authors.

The policy also makes infrastructure capacity part of the guarantee. Tier 1 maintainers must arrange access to physical systems, cloud systems, or accurate emulation needed for testing. Better Native does not need to promise a device-backed tier until it can supply and maintain that access.

This is the closest match for Better Native's infrastructure constraint. A capability may exist without imposing its unavailable device infrastructure on every contribution. The guarantee increases only when the project can continuously support it.

Sources:

- [Rust target tier policy](https://doc.rust-lang.org/rustc/target-tier-policy.html)
- [Rust platform support](https://doc.rust-lang.org/rustc/platform-support.html)

### Kubernetes feature graduation

Kubernetes enhancements commonly progress through Alpha, Beta, and Stable. Its enhancement repository says work often spans several releases. The KEP process records design, test, graduation, production-readiness, documentation, and infrastructure obligations in version control.

The stage labels make different promises to users. Alpha features are disabled by default, may be buggy, may change incompatibly, and may disappear. Beta features are usually enabled by default but still carry change risk. GA features are always enabled and expected to remain in later releases.

The KEP template encourages authors to merge early and iterate, and says a merged provisional KEP is neither complete nor approved. Graduation criteria are not required until a release is targeted. For Beta and GA, the template asks authors to show that tests have run regularly and remained stable. Its example Beta criteria require functional, security, monitoring, and testing work to be complete. Example GA criteria move to real-world use, elapsed feedback time, and resolution of issues found during Beta.

This supports separating day-to-day implementation gates from promotion gates. It also supports recording obligations early without requiring all evidence before implementation can proceed.

Sources:

- [Kubernetes enhancements repository](https://github.com/kubernetes/enhancements)
- [Kubernetes KEP template](https://github.com/kubernetes/enhancements/blob/master/keps/NNNN-kep-template/README.md)
- [Kubernetes feature gates and stages](https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates/#feature-stages)

### W3C Recommendation track

The W3C process separates technical completeness from demonstrated implementation experience. Candidate Recommendation is the phase for collecting implementation experience. The process asks whether every feature has an implementation, whether independent implementations interoperate, whether they are publicly deployed, and what implementation problems were found. A transition to Recommendation normally requires adequate implementation experience. If W3C grants an exception with minimal experience, it must explain the reason publicly.

This closely matches the rule that an unmet verification obligation may be visible and justified but cannot silently support the strongest compatibility claim.

Source:

- [W3C Process Document, implementation experience](https://www.w3.org/policies/process/#implementation-experience)
- [W3C Process Document, transition to Recommendation](https://www.w3.org/policies/process/#transition-rec)

### SLSA levels and attestations

SLSA 1.2 uses cumulative levels to communicate current security guarantees and provide a path for improvement. Its design principles say levels should represent concrete outcomes and manageable increments. SLSA permits separate tracks when the concerns are genuinely independent, although it warns that tracks add complexity and should be used sparingly. It also prefers explicit attestations over conclusions inferred from configuration. SLSA is a supply-chain assurance model, not a direct precedent for feature maturity, so the transferable part is its treatment of claims and evidence.

Better Native can apply the same logic to compatibility evidence:

- Define a level by a concrete claim, not by effort expended.
- Keep platform evidence separate when one platform does not imply another.
- Derive status from retained evidence rather than a manually selected maturity label.

Sources:

- [SLSA 1.2 specification](https://slsa.dev/spec/v1.2/)
- [SLSA 1.2 guiding principles](https://slsa.dev/spec/v1.2/principles)
- [SLSA 1.2 tracks](https://slsa.dev/spec/v1.2/tracks)

### Android CDD and CTS

Android explicitly separates compatibility policy from test execution. The Compatibility Definition Document says no test suite can be comprehensive and codifies requirements that testing alone cannot establish. Android treats the source as the comprehensive platform and API specification, with the CDD as a policy hub. The Compatibility Test Suite combines API-signature, API-behavior, negative, unit, and functional tests. It runs against an emulator or attached device, includes manual CTS Verifier checks, and stores results for review.

This supports two Better Native choices:

1. the compatibility denominator and policy must exist independently of available test infrastructure; and
2. host, emulator, simulator, physical-device, and manual evidence prove different things and should not be collapsed into one pass result.

Sources:

- [Android Compatibility Definition Document overview](https://source.android.com/docs/compatibility/cdd)
- [Android Compatibility Test Suite overview](https://source.android.com/docs/compatibility/cts)

### OpenFeature conformance and maturity

OpenFeature separates normative conformance from document stability. It derives test assertions from enumerated normative requirements and defines compliance as satisfying all applicable mandatory requirements. Separately, specification sections progress through Experimental, Hardening, and Stable. Stability governs change policy and production guidance, while conformance answers whether an implementation meets the mandatory requirements.

Its SDK compatibility table keeps several facts separate for each SDK: specification version, SDK release version, stable-release availability, and support for individual features. That is close to the proposed separation of implementation, evidence, and release status. OpenFeature should not be cited as evidence of a mature universal automated conformance harness. Its useful precedent here is the data model.

This is a useful precedent for keeping Better Native's export ownership and behavioral conformance separate from whether a package is experimental, preview, or stable.

Source:

- [OpenFeature specification, conformance and document statuses](https://openfeature.dev/specification/)
- [OpenFeature SDK compatibility](https://openfeature.dev/docs/reference/sdks/sdk-compatibility/)

## What is established and what is distinctive

| Better Native idea                                                                         | Precedent                                                                              | Novelty assessment                         |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------ |
| Code or a capability can exist before the strongest infrastructure-backed guarantee        | Rust Tier 3; Kubernetes Alpha                                                          | Established                                |
| Stronger guarantees require stronger continuous checks                                     | Rust tiers; Kubernetes graduation                                                      | Established                                |
| Promotion is distinct from ordinary implementation work                                    | Kubernetes KEP lifecycle                                                               | Established                                |
| Missing evidence remains visible and limits claims                                         | W3C implementation experience; Rust tier guarantees                                    | Established                                |
| Policy and complete requirements are not reducible to tests                                | Android CDD versus CTS                                                                 | Established                                |
| Retained evidence should determine claims                                                  | SLSA attestations                                                                      | Established                                |
| Conformance and product maturity are separate                                              | OpenFeature                                                                            | Established                                |
| Every export discovered from a pinned upstream revision has explicit migration ownership   | No equivalent in the six reviewed systems                                              | Distinctive within this review             |
| The pinned Expo implementation is the behavioral oracle for a paired candidate run         | Android uses upstream AOSP as a reference, but the paired package-level method differs | Distinctive within this review             |
| Metro selects upstream and candidate graphs for execution against the same native platform | No equivalent in the six reviewed systems                                              | Distinctive within this review             |
| Compatibility evidence and human or coding-agent DX evidence support separate claims       | No equivalent in the six reviewed systems                                              | Distinctive combination within this review |

The Better Native mechanisms in the last four rows are documented in the repository's [documentation architecture](./documentation.md), [native parity evidence model](./testing.md#native-parity-evidence), [upstream revision record](../compatibility/upstreams.json), and [DX evidence model](./evals.md). These are descriptions of Better Native itself, not external novelty evidence.

## Recommended framing for Better Native

Do not present the approach as a new verification theory. A defensible description is:

> Better Native applies established tiered-support and evidence-gated promotion practices to Expo package migration. Its contribution is a source-derived, per-export compatibility ledger and paired upstream-versus-candidate evidence model for Effect-native APIs.

Rust offers the clearest vocabulary for infrastructure-backed guarantees. Kubernetes offers the clearest promotion process. W3C shows that a technically complete candidate may wait for implementation experience before promotion. Android supports keeping a complete compatibility policy even though test machinery is necessarily incomplete. SLSA supports deriving claims from concrete retained evidence. OpenFeature shows why conformance and release maturity need separate fields.

## Practical answer to the infrastructure constraint

The precedents support reducing the default verification load without weakening the contract. They do not support calling unverified behavior compatible.

A sound policy for Better Native is:

1. Keep the complete export denominator and reviewed ownership declarations mandatory from the first change.
2. Let implemented packages merge at a clearly named pre-promotion status when host checks pass and missing platform evidence remains explicit.
3. Define each verification tier by the claim it permits, not by the amount of work performed.
4. Run device and other scarce checks as promotion evidence. Do not make unavailable infrastructure a routine pull-request gate for pre-promotion work.
5. Promote only after all required evidence exists for the declared platforms. Keep the option to demote when the project can no longer sustain that guarantee.

This preserves strictness where it matters. The claim remains narrow until the evidence grows.

## Design implications

1. Keep implementation ownership, evidence status, and release maturity as separate fields.
2. Derive evidence status from artifacts whenever possible.
3. Make the lowest development tier cheap and non-blocking for infrastructure that the project cannot sustain continuously.
4. Require the complete compatibility denominator at every tier.
5. Require all applicable platform evidence only for the strongest support claim.
6. Permit deferred or blocked obligations only with a reason and tracking issue.
7. Allow demotion when continuous infrastructure or maintainership disappears.
8. Publish the exact guarantee attached to each tier, as Rust does, rather than using vague labels alone.
