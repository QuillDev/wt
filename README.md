# wt

Small CLI for managing Git worktrees.

## Install

```sh
brew tap QuillDev/wt https://github.com/QuillDev/wt.git
brew trust QuillDev/wt
brew install QuillDev/wt/wt
```

Enable `wt goto` in zsh:

```sh
echo 'eval "$(wt shell-init)"' >> ~/.zshrc
eval "$(wt shell-init)"
type wt
```

`type wt` should say `wt is a function`.

## Usage

```sh
wt init
wt new [--base REF] [--no-fetch] [NAME]
wt list [--all]
wt goto [root|NAME|PATH]
wt open [NAME|PATH]
wt rename NEW_NAME
wt rename NAME|PATH NEW_NAME
wt run [NAME|PATH] [ACTION]
wt archive [--force] NAME|PATH
```

`wt new` creates managed worktrees under `~/.wt/worktrees/<project>/<name>`. If `NAME` is omitted, it generates one like `wt/3f9a`.

`wt goto` changes directories when shell integration is loaded. Without it, the command prints the target path.

`wt rename` moves a managed worktree to `~/.wt/worktrees/<project>/<new-name>` and updates Git's worktree metadata. Run `wt rename NEW_NAME` inside a managed worktree to rename the current one, or `wt rename NAME|PATH NEW_NAME` to rename another worktree. It does not rename the Git branch checked out in that worktree.

`wt archive` moves the worktree to `~/.wt/archived`, prunes the Git worktree entry, and returns quickly even when the worktree contains large untracked directories. `--force` skips the confirmation prompt.

## Actions

Run `wt init` in a repository to create `.wt/actions.json`:

```json
{
  "init": {
    "command": "bun install --frozen-lockfile"
  },
  "run": {
    "command": "bun run dev"
  }
}
```

`init` runs after `wt new`. `run` is used by `wt run`.

## Local Development

```sh
bun install
bun run check
bun run install-local
```

See [docs/homebrew.md](docs/homebrew.md) for Homebrew release notes.
