// The CLI bundles core implementation modules into dist. Import telemetry
// directly so a lightweight command does not initialize the provider barrel
// merely to check whether the user opted in; no new package export is needed.
export { emit as emitTelemetry } from "../../../core/src/telemetry.ts";
