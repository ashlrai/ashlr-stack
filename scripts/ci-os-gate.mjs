// Decide an OS gate from the needs context. Failure and cancellation fail the
// gate. A skip passes only when the path gate did not ask for that OS.

export function osGate(needs) {
  const classify = needs.classify;
  let runOs = true;
  if (classify) {
    if (classify.result !== "success") return { ok: false, reason: `classify=${classify.result ?? "missing"}` };
    runOs = classify.outputs?.run_os === "true";
  }
  for (const [name, job] of Object.entries(needs)) {
    if (name === "classify") continue;
    const result = job?.result ?? "missing";
    if (result === "failure" || result === "cancelled") return { ok: false, reason: `${name}=${result}` };
    if (result === "success") continue;
    if (result === "skipped" && !runOs) continue;
    return { ok: false, reason: `${name}=${result}` };
  }
  return { ok: true, reason: "" };
}

function main() {
  const needs = JSON.parse(process.env.NEEDS ?? "{}");
  const decision = osGate(needs);
  if (!decision.ok) {
    console.error(`::error::${decision.reason}`);
    process.exit(1);
  }
  console.log("OS gate passed");
}

if (process.argv[1]?.endsWith("ci-os-gate.mjs")) main();
