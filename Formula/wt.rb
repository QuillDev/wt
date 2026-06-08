class Wt < Formula
  desc "Small Bun CLI for managing Git worktrees"
  homepage "https://github.com/QuillDev/wt"
  url "https://github.com/QuillDev/wt/archive/refs/tags/v0.1.4.tar.gz"
  sha256 "cc44f48714d2ce92b1c527d18f02982e78cb27be09b2876cbb653eeef564a286"
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
