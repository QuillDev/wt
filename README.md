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
wt goto [root|NAME|PATH]
wt shell-init
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

An executable cannot directly change the current directory of its parent shell. `wt goto [root|NAME|PATH]` prints the target directory by itself; enable the shell integration to make it run `cd`.

For the current shell:

```sh
eval "$(wt shell-init)"
```

Confirm it is active:

```sh
type wt
```

The output should say `wt is a function`. If it points at a file path, the shell integration is not loaded and `wt goto` will only print the target path.

To enable it permanently in zsh:

```sh
echo 'eval "$(wt shell-init)"' >> ~/.zshrc
```

The generated shell function is:

```sh
_wt_bin='/opt/homebrew/bin/wt'
wt() {
  if [ "$1" = "goto" ]; then
    shift
    local tmp
    local dir
    tmp="$(mktemp)" || return
    env WT_GOTO_OUTPUT="$tmp" "$_wt_bin" goto "$@" || {
      rm -f "$tmp"
      return
    }
    dir="$(cat "$tmp")"
    rm -f "$tmp"
    [ -n "$dir" ] || return
    cd "$dir" || return
  else
    "$_wt_bin" "$@"
  fi
}
```
