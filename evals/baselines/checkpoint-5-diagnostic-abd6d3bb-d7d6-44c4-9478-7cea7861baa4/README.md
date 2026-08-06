# First paid live diagnostic campaign

Campaign run ID: `checkpoint-5-diagnostic-abd6d3bb-d7d6-44c4-9478-7cea7861baa4`

This is the byte-for-byte preserved first paid Network and Battery model-matrix campaign. It is a
blind historical diagnostic, not an accepted performance baseline or regression threshold.

The campaign made ten serialized trial attempts. Six produced authenticated evidence and four
ended in provider infrastructure failures. None of the six infrastructure-valid trials passed all
required task gates. The provider charged USD 0.2773534 for 125,005 recorded tokens.

Known instrumentation findings discovered by this run are intentionally not corrected in these
files:

- the agent-visible workspace exposed only each package's `index.d.ts`, not its referenced public
  declaration graph;
- GPT-5.6 Luna received the wrong output-token parameter;
- the selected DeepSeek provider returned a response without the required `choices` field; and
- the Vitest pass count represented successful harness evaluation, not successful task completion.

Review the original report with:

```sh
bun x vitest-evals serve \
  evals/baselines/checkpoint-5-diagnostic-abd6d3bb-d7d6-44c4-9478-7cea7861baa4/outputFile.json
```

Verify every preserved file from this directory with:

```sh
shasum -a 256 -c SHA256SUMS
```
