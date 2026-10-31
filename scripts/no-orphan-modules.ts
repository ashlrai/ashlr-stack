import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import ts from "typescript";

// Public package exports and the executable are roots, even without importers.
export const ENTRY_POINTS = [
  "packages/core/src/index.ts",
  "packages/core/src/providers/index.ts",
  "packages/core/src/phantom.ts",
  "packages/core/src/config.ts",
  "packages/core/src/mcp-writer.ts",
  "packages/cli/src/index.ts",
];
const candidate = (path: string) => /^packages\/(core|cli)\/src\//.test(path);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    // Test-only imports must never keep dead production modules alive.
    if (
      /^(node_modules|dist|build|coverage|\.git|\.astro|__tests__|tests|__fixtures__|fixtures)$/.test(
        entry.name,
      )
    )
      return [];
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) &&
      !/\.(test|spec|node-tests|d)\.[cm]?[jt]sx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

function imports(path: string): string[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest);
  const result: string[] = [];
  function visit(node: ts.Node) {
    let specifier: ts.Node | undefined;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      specifier = node.moduleSpecifier;
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
      specifier = node.moduleReference.expression;
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    )
      specifier = node.arguments[0];
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      specifier = node.argument.literal;
    if (specifier && ts.isStringLiteralLike(specifier)) result.push(specifier.text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

/** Find unreferenced modules, including disconnected chains and cycles. Never executes source. */
export function findOrphanModules(
  root: string,
  entryPoints: readonly string[] = ENTRY_POINTS,
): string[] {
  const configPath = resolve(root, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error)
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const files = [...sources(resolve(root, "packages")), ...sources(resolve(root, "scripts"))];
  const graph = new Map<string, string[]>();
  const local = (file: string) => relative(root, file).split(sep).join("/");
  const roots = new Set(entryPoints.map((path) => resolve(root, path)));
  const cache = ts.createModuleResolutionCache(root, (path) => path, options);
  for (const file of files) {
    const dependencies = imports(file).flatMap((specifier) => {
      const target = ts.resolveModuleName(specifier, file, options, ts.sys, cache).resolvedModule;
      return target ? [resolve(target.resolvedFileName)] : [];
    });
    graph.set(file, dependencies);
    // Other packages and tooling may legitimately consume core/CLI internals.
    if (!candidate(local(file))) roots.add(file);
  }
  for (const entry of entryPoints) {
    if (!graph.has(resolve(root, entry))) throw new Error(`Missing entry point: ${entry}`);
  }
  const reachable = new Set<string>();
  function visit(file: string) {
    if (reachable.has(file)) return;
    reachable.add(file);
    for (const dependency of graph.get(file) ?? []) visit(dependency);
  }
  for (const entry of roots) visit(entry);
  return files
    .filter((file) => candidate(local(file)) && !reachable.has(file))
    .map(local)
    .sort();
}

if (import.meta.main) {
  const orphans = findOrphanModules(resolve(import.meta.dir, ".."));
  console.log(JSON.stringify(orphans, null, 2));
  process.exitCode = orphans.length ? 1 : 0;
}
