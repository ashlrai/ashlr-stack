---
description: Inspect available provider checks and report failed or unchecked services.
---

Call `stack_doctor` in the intended project context. Without `all`, a directory with no `.stack.toml` returns an error, not a healthy report; offer `stack_init` or `{ all: true }`. Summarize the returned checks, including failures and adapters without a health check. Offer `{ fix: true }` only after explaining the requested repair effects. Fix can skip entries whose vault names already exist; it does not rotate credentials or prove every service and consumer works.
