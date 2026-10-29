export function printVersion(version: string, json: boolean): void {
  const platform = `${process.platform}-${process.arch}`;
  const node = process.versions.node ? `v${process.versions.node}` : undefined;
  const bun = process.versions.bun;
  if (json) {
    console.log(
      JSON.stringify({
        version,
        platform,
        ...(bun ? { bun } : {}),
        ...(node ? { node } : {}),
      }),
    );
  } else {
    console.log(`stack ${version}`);
    console.log(`platform: ${platform}`);
    if (bun) console.log(`bun: ${bun}`);
    if (node) console.log(`node: ${node}`);
  }
}
