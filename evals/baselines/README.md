# Preserved eval baselines

This directory contains byte-for-byte snapshots of reviewed eval campaigns that must remain
available after the ephemeral `.artifacts/evals` directory is cleaned. A preserved campaign is
historical evidence, not automatically an accepted regression baseline.

Each campaign directory contains:

- the original Vitest Evals `outputFile.json` report;
- the original signed evidence envelopes emitted for infrastructure-valid trials;
- `manifest.json`, which records the campaign identity, interpretation, and immutable file digests;
  and
- `SHA256SUMS`, which independently verifies the preserved bytes.

Verify a campaign from its directory with:

```sh
shasum -a 256 -c SHA256SUMS
```

Serve a preserved report from the repository root with:

```sh
bun x vitest-evals serve evals/baselines/<campaign-run-id>/outputFile.json
```

Never edit a preserved report or evidence envelope in place. Instrument changes require a new
campaign and a new directory.
