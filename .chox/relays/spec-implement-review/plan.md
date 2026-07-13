# Plan the implementation

Inspect the repository at {{repo}} and turn the user's requested feature into an
implementer-ready plan. Do not implement it in this hop.

Write every declared output to: {{produces}}.

The spec must use a structured task breakdown with concrete files, interfaces,
behaviors, edge cases, and verification commands. The manifest must be valid JSON:

```json
{
  "files": {
    "create": ["path/from/repo/root"],
    "modify": [],
    "delete": []
  },
  "commands": ["npm test"]
}
```

Use forward-slash, repository-relative paths. Also write non-empty challenge notes
that identify any assumptions or intentional departures, or explicitly say there
were none.

## Feature request

Fix a resume bug in src/harness/runner.ts: if a run crashes in the window
between createRun() and the plan.json write, `chox run <slug> --resume` loads
an empty fallback plan and marks the run "completed" instead of "failed".
Close the window (write plan.json before or atomically with run creation)
and/or make persistedPlan() refuse to complete a run with zero hops. Add a test.
