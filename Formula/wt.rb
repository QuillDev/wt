class Wt < Formula
  desc "Small Bun CLI for managing Git worktrees"
  homepage "https://github.com/QuillDev/wt"
  url "https://github.com/QuillDev/wt/archive/refs/tags/v0.1.3.tar.gz"
  sha256 "7629c79447d2c6b31641525c286c51df57c79e7ffde20dacfbc65c96f1692e88"
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
