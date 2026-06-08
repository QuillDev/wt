class Wt < Formula
  desc "Small Bun CLI for managing Git worktrees"
  homepage "https://github.com/QuillDev/wt"
  url "https://github.com/QuillDev/wt/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "b8380bd562ac7cf67bb4c9093ad8a17e03bc005771e083ca552ed7aaf48eee95"
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
