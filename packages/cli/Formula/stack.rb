# Homebrew formula template for Ashlr Stack.
# Lives in the `homebrew-ashlr` tap (not distributed with this monorepo);
# kept here as a reference so publishing stays easy.
#
# brew tap ashlrai/ashlr
# brew install stack
class Stack < Formula
  desc "Ashlr Stack — the control plane for your entire dev stack."
  homepage "https://stack.ashlr.ai"
  license "MIT"
  version "0.1.0"

  # The tarball is the bun-compiled single-file binary (see scripts/build-bin.ts
  # in a future wave). Until then, users should install via `bun add -g` / `npm i -g`.
  url "https://github.com/ashlrai/ashlr-stack/releases/download/v#{version}/stack-macos-#{Hardware::CPU.arch}.tar.gz"
  # sha256 "..."

  depends_on "ashlrai/phantom/phantom"

  def install
    bin.install "stack"
  end

  test do
    assert_match "stack", shell_output("#{bin}/stack --help")
  end
end
