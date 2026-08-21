# Contributing to Atlaslink

Thanks for your interest in Atlaslink! This guide covers how to contribute cleanly and consistently. The repository is governed by the conventions documented in [AGENTS.md](AGENTS.md) — this guide is the human-facing summary.

## Code of conduct

Be respectful and constructive. This is a small, product-oriented project and we want it to stay a welcoming place to work.

## Getting started

1. **Fork** the repository (or ask for write access) and clone it.
2. Install the prerequisites and run the scaffold setup — see the [README](README.md#getting-started).
3. Pick an issue from the [issues page](https://github.com/fworks-tech/atlaslink/issues) or open a new one describing what you want to do.

## Branch conventions

One branch per issue:

```
type/issue-NUMBER-short-description
```

- Branch names are **lowercase**, hyphenated, no spaces.
- Never commit directly to `main`.
- Example: `fix/issue-12-bridge-timeout-retry`

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `ci`, `chore`, `revert`.

## Commit conventions

The repository enforces [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope)!: subject
```

- `!` marks a breaking change.
- Subject: **imperative**, lowercase, ≤ 150 chars, no trailing period.
- One logical change per commit — if in doubt, split it.
- Never write vague subjects like `fix stuff`, `wip`, `update`, `changes`.

| Type      | When to use                          |
|-----------|--------------------------------------|
| `feat`    | A new feature                         |
| `fix`     | A bug fix                             |
| `docs`    | Documentation only                    |
| `test`    | Adding or fixing tests                |
| `refactor`| Code change that neither fixes nor adds a feature |
| `ci`      | CI configuration and scripts          |
| `chore`   | Maintenance, dependencies, tooling    |

## Pull request workflow

1. Create your branch, implement, and commit using Conventional Commits.
2. Ensure any relevant tests pass and the change is lint/type clean.
3. Open a PR that:
   - Links to the issue it resolves — `Closes #N` or `Fixes #N` in the description.
   - Has a title following the same Conventional Commit format as commits.
   - Answers in the description: **what** changed, **why**, and **how to test**.
4. All CI checks must pass before merge.

## Agenthood standards

Atlaslink is built on **Agenthood**, an agent-team runtime with 20 specialized members (see `AGENTS.md`). Members such as the **Scribe** (commit messages), the **Builder** (implementation), and the **Reviewer** (code review) can be invoked to help:

```bash
npx agenthood run the-scribe "write a commit message for the current diff"
npx agenthood run the-reviewer "review the open PR"
```

Use them when you want a second pair of eyes or help with standards — but the human is always the final reviewer.

## Tests

There is no test suite in the scaffold yet; tests arrive with the first code milestones. When code lands:

- Follow test-driven development where practical.
- Keep coverage on the behavior that matters, not for its own sake.

## Questions

Open an issue or ask on the [issues page](https://github.com/fworks-tech/atlaslink/issues). We're friendly.
