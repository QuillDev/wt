class Wt < Formula
  desc "Small Bun CLI for managing Git worktrees"
  homepage "https://github.com/QuillDev/wt"
  url "https://github.com/QuillDev/wt/archive/refs/tags/v0.1.6.tar.gz"
  sha256 "1e5a500130c06489b18b0728a226df988d9a5fb8bf2d31bf0b647c60b9b8d3a7"
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
