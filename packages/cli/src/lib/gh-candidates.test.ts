import { expect, test } from "bun:test";
import { win32 } from "node:path";
import { ghBinaryCandidates } from "./fleet-gc.ts";

test("Windows gh lookup uses USERPROFILE and path.win32 when HOME is unset", () => {
  const home = "C:\\Users\\dev";
  const local = "C:\\Users\\dev\\AppData\\Local";
  const programFiles = "C:\\Program Files";
  const paths = ghBinaryCandidates(
    {
      USERPROFILE: home,
      APPDATA: "C:\\Users\\dev\\AppData\\Roaming",
      LOCALAPPDATA: local,
      ProgramFiles: programFiles,
    },
    "win32",
  );
  expect(paths).toContain(win32.join(home, ".local", "bin", "gh.exe"));
  expect(paths).toContain(win32.join(local, "GitHub CLI", "gh.exe"));
  expect(paths).toContain(win32.join(programFiles, "GitHub CLI", "gh.exe"));
  expect(paths).toContain("C:\\Users\\dev\\.local\\bin\\gh.exe");
  expect(paths.some((path) => path.includes("Roaming"))).toBe(false);
});

test("USERPROFILE wins over HOME for Windows gh lookup", () => {
  const paths = ghBinaryCandidates(
    { USERPROFILE: "C:\\Users\\dev", HOME: "D:\\elsewhere" },
    "win32",
  );
  expect(paths).toContain(win32.join("C:\\Users\\dev", ".local", "bin", "gh.exe"));
  expect(paths.some((path) => path.includes("elsewhere"))).toBe(false);
});
