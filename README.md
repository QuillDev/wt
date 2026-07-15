# wt

Small CLI for managing Git worktrees.

## Install

```sh
brew tap QuillDev/wt https://github.com/QuillDev/wt.git
brew trust QuillDev/wt
brew install QuillDev/wt/wt
```

Enable `wt goto` and `wt wire` in your shell:

```sh
# fish
echo 'wt shell-init | source' >> ~/.config/fish/config.fish

# zsh/bash
echo 'eval "$(wt shell-init)"' >> ~/.zshrc
eval "$(wt shell-init)"
type wt
```

`type wt` should say `wt is a function`.

## Usage

```sh
wt init
wt new [--base REF] [--remote-branch BRANCH] [--no-fetch] [NAME]
wt list [--all]
wt goto [root|NAME|PATH]
wt open [NAME|PATH]
wt ports [NAME|PATH]
wt wire [VARIABLE] [ADDRESS]
wt rename NEW_NAME
wt rename NAME|PATH NEW_NAME
wt run [NAME|PATH] [ACTION]
wt archive [--force] NAME|PATH
```

`wt new` creates managed worktrees under
`~/.wt/worktrees/<project>/<name>`. If `NAME` is omitted, it generates one
like `wt/3f9a`.

Use `--base REF` to create the new local branch from any Git ref, such as
`origin/develop`. Use `--remote-branch BRANCH` when the base is a remote
branch; `--remote-branch feature/api` resolves to `origin/feature/api`, and
`--remote-branch upstream/feature/api` uses that explicit remote.

`wt goto` changes directories when shell integration is loaded. Without it,
the command prints the target path.

With no argument, `wt open` opens the current worktree when run inside a
managed worktree; otherwise, it prompts for a worktree.

`wt ports` finds active Portless addresses whose server process is running
inside the selected worktree. It infers the current worktree when run in a
repository, or accepts a worktree name/path.

`wt rename` moves a managed worktree to
`~/.wt/worktrees/<project>/<new-name>` and updates Git's worktree metadata. Run
`wt rename NEW_NAME` inside a managed worktree to rename the current one, or
`wt rename NAME|PATH NEW_NAME` to rename another worktree. It does not rename
the Git branch checked out in that worktree.

`wt archive` moves the worktree to `~/.wt/archived`, prunes the Git worktree
entry, and returns quickly even when the worktree contains large untracked
directories. `--force` skips the confirmation prompt.

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

## Environment wiring

Declare environment variables in `<base-repo>/.wt/wires.json`:

```json
{
  "API_URL": {
    "default": "http://localhost:3000"
  },
  "ASSETS_URL": {}
}
```

Run `wt wire` in that project to choose a variable, then choose an address
exposed by any managed worktree. The optional `default` appears alongside
discovered addresses. You can also use `wt wire API_URL` or set an explicit
value with `wt wire API_URL http://localhost:4000`.

With shell integration enabled, the chosen value is exported into your current
shell. Without shell integration, `wt wire` prints a shell assignment instead.
Wiring is intentionally session-only; it does not modify `.env` files. Address
discovery uses `portless list`, then associates each route with a worktree using
the server process's current working directory. It requires both `portless` and
`lsof`.

Like `actions.json`, `wires.json` is local by default because `wt init` creates
`.wt/.gitignore` containing `*`.

## Local Development

```sh
bun install
bun run check
bun run install-local
```

See [docs/homebrew.md](docs/homebrew.md) for Homebrew release notes.
