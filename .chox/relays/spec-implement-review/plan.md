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

