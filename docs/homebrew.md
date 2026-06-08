# Homebrew

`wt` can be installed with Homebrew from the checked-in formula. The formula builds a standalone binary with Bun, so Bun is only needed while Homebrew builds the package.

## Install

Tap this repository explicitly:

```sh
brew tap QuillDev/wt https://github.com/QuillDev/wt.git
```

Homebrew 5 requires trust for custom tap remotes. Trust this tap before installing:

```sh
brew trust QuillDev/wt
```

Install the stable release:

```sh
brew install QuillDev/wt/wt
```

Enable `wt goto` for zsh:

```sh
echo 'eval "$(wt shell-init)"' >> ~/.zshrc
eval "$(wt shell-init)"
type wt
```

`type wt` should say `wt is a function`. Without the shell integration, `wt goto` can only print the target directory because executables cannot change their parent shell's current directory.

Install the latest `master` build:

```sh
brew install --HEAD QuillDev/wt/wt
```

If `which wt` still points at `~/.local/bin/wt`, that local symlink is shadowing the Homebrew binary. Remove the symlink or put Homebrew earlier in `PATH` to use `/opt/homebrew/bin/wt`.

## Maintainer Release Flow

1. Update `package.json` to the next version.
2. Commit and push the release code.
3. Tag the release:

```sh
version=vX.Y.Z
git tag "$version"
git push origin "$version"
```

4. Compute the source tarball checksum:

```sh
curl -L "https://github.com/QuillDev/wt/archive/refs/tags/$version.tar.gz" | shasum -a 256
```

5. Update `Formula/wt.rb` with the new tag URL and checksum.
6. Validate locally:

```sh
bun run check
brew tap QuillDev/wt https://github.com/QuillDev/wt.git
brew trust QuillDev/wt
mkdir -p "$(brew --repository QuillDev/wt)/Formula"
cp Formula/wt.rb "$(brew --repository QuillDev/wt)/Formula/wt.rb"
brew audit --formula QuillDev/wt/wt
brew reinstall --build-from-source QuillDev/wt/wt
brew test QuillDev/wt/wt
```

7. Commit and push the formula update.

## Notes

- The formula uses `bun install --frozen-lockfile --production`, so `bun.lock` must be committed and current.
- The installed `wt` is a compiled binary created by `bun build --compile`.
- The formula currently uses `license :cannot_represent` because the repository does not declare a project license.
