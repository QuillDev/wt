class Wt < Formula
  desc "Small Bun CLI for managing Git worktrees"
  homepage "https://github.com/QuillDev/wt"
  url "https://github.com/QuillDev/wt/archive/refs/tags/v0.1.1.tar.gz"
  sha256 "7d3a91fe029790d40a87ad7970f88b03fbfe9eb36460e632b76166be458c9b80"
  license :cannot_represent
  head "https://github.com/QuillDev/wt.git", branch: "master"

  depends_on "bun" => :build

  def install
    system "bun", "install", "--frozen-lockfile", "--production"
    system "bun", "build", "--compile", "--outfile", "wt", "src/index.ts"
    bin.install "wt"
  end

  test do
    assert_match "Git worktrees, kept close", shell_output("#{bin}/wt --help")
  end
end
