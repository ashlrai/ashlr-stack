import { describe, expect, test } from "bun:test";
import { TOOLS } from "../src/tools.ts";

function tool(name: string) {
  const found = TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

describe("json flag on stack_info and stack_env_show", () => {
  test("stack_info passes --json only when asked", () => {
    const info = tool("stack_info");
    expect(info.inputSchema.properties.json?.type).toBe("boolean");
    expect(info.cliArgs({ service: "openai" })).toEqual(["info", "openai"]);
    expect(info.cliArgs({ service: "openai", json: true })).toEqual(["info", "openai", "--json"]);
  });

  test("stack_env_show passes --json only when asked", () => {
    const env = tool("stack_env_show");
    expect(env.inputSchema.properties.json?.type).toBe("boolean");
    expect(env.cliArgs({})).toEqual(["env", "show"]);
    expect(env.cliArgs({ json: true })).toEqual(["env", "show", "--json"]);
  });
});
