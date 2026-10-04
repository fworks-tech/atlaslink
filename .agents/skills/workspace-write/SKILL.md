---
name: workspace-write
description: Persist session deliverables (reviews, specs, reports, generated files) into the project workspace as atlaslink:write fenced blocks. Use whenever the task asks you to create, save, or update a file in the workspace — the executor commits it with session attribution.
license: MIT
---

# Workspace Write

## Overview

Sessions never touch disk directly. To persist a deliverable, you emit one or
more `atlaslink:write` fences in your final output; the Atlaslink executor
parses them, writes the files under the session's project workspace, and
creates a single attributed git commit (`session: <id>` trailer) — so the
files show up in the `files` subgraph, diffs in `fileDiff`, and history stays
joinable with the session event log (ADR-012).

## When to Use

- The task asks you to write, save, or produce a file (review, spec, report).
- An earlier step drafted content that belongs in the workspace.
- You are asked to update a file that already exists in the workspace.

Do NOT use it for code changes to the application repository itself — only
workspace deliverables.

## Fence Format

One fence per file. The path is relative to the workspace root (no leading
`/`, no `..`, no backslashes):

````
```atlaslink:write path=code-review.md
# Code review

verdict: ...
```
````

Rules:

- The opening fence must be exactly ` ```atlaslink:write path=<path> `.
- The closing fence is ` ``` ` on its own line.
- Content between fences is verbatim — blank lines included.
- Multiple fences in one answer are applied as one commit.
- Unsafe paths (absolute, `..`, `\\`) are dropped, not partially applied.

## Example

Task: "review src/router/support.ts and save the result."

Final output:

````
Resumo em 5 linhas: ...

```atlaslink:write path=code-review.md
# Review: src/router/support.ts

## Findings
- freePort() leaks the server handle on early return...
```
````

The executor persists it; `files(projectId)` then lists `code-review.md`.
