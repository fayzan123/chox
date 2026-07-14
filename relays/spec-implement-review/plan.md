# Plan the task

Inspect the repository at {{repo}} and turn the task below into an
implementation-ready plan. Do not implement it in this hop.

## Task

{{task}}

## Output contract

Write every declared output to: {{produces}}.

The spec must contain a structured task breakdown with concrete files, interfaces,
behaviors, edge cases, dependencies, and verification commands. The manifest must be
valid JSON with this shape:

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

Use forward-slash, repository-relative paths. Write non-empty challenge notes that
identify assumptions or intentional departures, or explicitly say there were none.

When every declared output is written, end your final message with exactly:
"This hop is done — exit this session (/exit or Ctrl-D) to continue the relay."
