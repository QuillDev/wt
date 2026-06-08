# wt

Small Bun CLI for managing Git worktrees.

Worktrees are stored under:

```text
~/.wt/worktrees/<project-name>/<worktree-name>
```

Project actions are read from:

```text
<base-repo>/.wt/actions.json
```

Example:

```json
{
  "init": {
    "command": "bun install --frozen-lockfile && bun run migrate-ledgers"
  },
  "run": {
    "command": "bun run start:dev-fastest"
  }
}
```

## Commands

```sh
wt new [--base REF] [--no-fetch] NAME
wt list [--all]
wt open [NAME|PATH]
wt run ACTION
wt run NAME|PATH ACTION
wt archive [--force] NAME|PATH
```

## Install

```sh
bun install
bun run install-local
```
