import { expect, test } from "bun:test";
import ts from "typescript";

// Read the actual fixtures without loading animation or browser dependencies.
for (const component of ["OneCommand", "UseCases"]) {
  test(`${component} transcript keys are nonempty and unique among siblings`, async () => {
    const source = await Bun.file(
      new URL(`../src/components/${component}.tsx`, import.meta.url),
    ).text();
    const ast = ts.createSourceFile(
      "component.tsx",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    let transcripts = 0;
    let blanks = 0;
    function visit(node: ts.Node) {
      if (ts.isArrayLiteralExpression(node)) {
        const keys: string[] = [];
        for (const element of node.elements) {
          if (!ts.isObjectLiteralExpression(element)) continue;
          const fields = new Map<string, string>();
          for (const property of element.properties) {
            if (
              ts.isPropertyAssignment(property) &&
              ts.isIdentifier(property.name) &&
              ts.isStringLiteral(property.initializer)
            ) {
              fields.set(property.name.text, property.initializer.text);
            }
          }
          if (!fields.has("t") && !fields.has("kind")) continue;
          const blank = fields.get("t") === "blank";
          if (blank) blanks++;
          const key = fields.has("kind")
            ? JSON.stringify([fields.get("kind"), fields.get("text"), fields.get("detail")])
            : fields.get(blank ? "id" : "text");
          expect(key).toBeTruthy();
          if (key) keys.push(key);
        }
        if (keys.length > 0) {
          transcripts++;
          expect(new Set(keys).size).toBe(keys.length);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    expect(transcripts).toBe(component === "OneCommand" ? 9 : 4);
    expect(blanks).toBe(component === "OneCommand" ? 2 : 0);
  });
}
