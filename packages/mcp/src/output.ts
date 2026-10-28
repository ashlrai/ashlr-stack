/** Remove JSON formatting only, retaining every field and exact number spelling. */
export function compactJsonOutput(stdout: string, args: string[]): string {
  const text = stdout.trim();
  if (!args.includes("--json")) return text;
  try {
    JSON.parse(text);
  } catch {
    // Diagnostics or mixed human/JSON output must remain readable.
    return text;
  }
  let quoted = false;
  let escaped = false;
  let result = "";
  for (const char of text) {
    if (quoted) {
      result += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
      result += char;
    } else if (!" \n\r\t".includes(char)) {
      result += char;
    }
  }
  return result;
}
