# typed: false
# frozen_string_literal: true

class Stack < Formula
  desc "Ashlr Stack — AI-ready secret & provider wiring CLI"
  homepage "https://stack.ashlr.ai"
  version "$VERSION$"
  license "MIT"

  depends_on "ashlrai/phantom/phantom"

  on_macos do
    on_arm do
      url "https://github.com/ashlrai/ashlr-stack/releases/download/v$VERSION$/stack-darwin-arm64"
      sha256 "$SHA_DARWIN_ARM64$"

      def install
        bin.install "stack-darwin-arm64" => "stack"
      end
    end

    on_intel do
      url "https://github.com/ashlrai/ashlr-stack/releases/download/v$VERSION$/stack-darwin-x64"
      sha256 "$SHA_DARWIN_X64$"

      def install
        bin.install "stack-darwin-x64" => "stack"
      end
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/ashlrai/ashlr-stack/releases/download/v$VERSION$/stack-linux-arm64"
      sha256 "$SHA_LINUX_ARM64$"

      def install
        bin.install "stack-linux-arm64" => "stack"
      end
    end

    on_intel do
      url "https://github.com/ashlrai/ashlr-stack/releases/download/v$VERSION$/stack-linux-x64"
      sha256 "$SHA_LINUX_X64$"

      def install
        bin.install "stack-linux-x64" => "stack"
      end
    end
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/stack --version")
    assert_match "supabase", shell_output("#{bin}/stack providers 2>&1")
  end
end
