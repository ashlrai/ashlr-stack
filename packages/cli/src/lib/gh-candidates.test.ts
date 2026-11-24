import { expect, test } from "bun:test";
import { join } from "node:path";
import { ghBinaryCandidates } from "./fleet-gc.ts";

test("Windows gh lookup uses USERPROFILE when HOME is unset", () => {
  const home = "C:\\Users\\dev";
  const paths = ghBinaryCandidates(
    {
      USERPROFILE: home,
      LOCALAPPDATA: `${home}\\AppData\\Local`,
      ProgramFiles: "C:\\Program Files",
    },
    "win32",
  );
  expect(paths).toContain(join(home, ".local", "bin", "gh.exe"));
  expect(paths).toContain(join(`${home}\\AppData\\Local`, "GitHub CLI", "gh.exe"));
  expect(paths).toContain(join("C:\\Program Files", "GitHub CLI", "gh.exe"));
  expect(paths.join("\n")).not.toContain("/.local/bin/gh\n");
});
