// Platform to release-binary mapping. The npm `stack` command uses this.
// Windows names end in .exe. An unknown platform is an error.

export const BINARY_TARGETS = {
  "linux-x64": { file: "stack-linux-x64", bunTarget: "bun-linux-x64" },
  "linux-arm64": { file: "stack-linux-arm64", bunTarget: "bun-linux-arm64" },
  "darwin-x64": { file: "stack-darwin-x64", bunTarget: "bun-darwin-x64" },
  "darwin-arm64": { file: "stack-darwin-arm64", bunTarget: "bun-darwin-arm64" },
  "win32-x64": { file: "stack-windows-x64.exe", bunTarget: "bun-windows-x64" },
  "win32-arm64": { file: "stack-windows-arm64.exe", bunTarget: "bun-windows-arm64" },
};

export function binaryTarget(platform, arch) {
  return BINARY_TARGETS[`${platform}-${arch}`];
}

export function missingBinaryMessage(platform, arch) {
  const supported = Object.entries(BINARY_TARGETS)
    .map(([key, value]) => `${key} (${value.file})`)
    .join(", ");
  return `No stack binary for ${platform} ${arch}. Supported: ${supported}.`;
}

/**
 * Pick what `stack` should run.
 * A known platform with the native file uses that file.
 * A known platform without the native file uses dist/index.js so npm install
 * still runs before a release asset exists.
 * An unknown platform fails. A known platform with neither file fails and
 * names the expected .exe or binary.
 */
export function selectLaunch({ platform, arch, nativeExists, jsExists }) {
  const target = binaryTarget(platform, arch);
  if (!target) return { kind: "error", message: missingBinaryMessage(platform, arch) };
  if (nativeExists) return { kind: "native", file: target.file };
  if (jsExists) return { kind: "javascript", file: "dist/index.js" };
  return {
    kind: "error",
    message: `No stack binary for ${platform} ${arch}. Expected ${target.file}, and dist/index.js is not in this install.`,
  };
}
