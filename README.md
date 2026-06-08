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
wt init
wt new [--base REF] [--no-fetch] NAME
wt list [--all]
wt goto [NAME|PATH]
wt open [NAME|PATH]
wt run ACTION
wt run NAME|PATH ACTION
wt archive [--force] NAME|PATH
```

## Install

### Homebrew

Anyone can install `wt` from this public repository with Homebrew:

```sh
brew tap QuillDev/wt https://github.com/QuillDev/wt.git
brew trust QuillDev/wt
brew install QuillDev/wt/wt
```

The formula installs the tagged stable release and builds a standalone `wt` binary. Bun is used during the Homebrew build, but users do not need Bun to run `wt` after installation.

`brew trust QuillDev/wt` is required on newer Homebrew versions because this repository is used as a custom tap remote.

If `which wt` points somewhere other than Homebrew after installation, another local command is shadowing the Homebrew binary. The Homebrew binary is usually installed at `/opt/homebrew/bin/wt` on Apple Silicon macOS.

See [docs/homebrew.md](docs/homebrew.md) for release and tap setup.

### Local checkout

```sh
bun install
bun run install-local
```

## Shell goto

`wt goto [NAME|PATH]` prints the directory for a managed worktree. To make it change your current shell directory, add this wrapper to your shell config:

```sh
wt() {
  if [ "$1" = "goto" ]; then
    shift
    local dir
    dir="$(command wt goto "$@")" || return
    cd "$dir" || return
  else
    command wt "$@"
  fi
}
```
