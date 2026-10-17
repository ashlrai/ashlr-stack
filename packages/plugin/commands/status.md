---
description: Show a one-screen overview of the current stack.
---

Call `stack_status`. Pass `{ json: true }` when you need to parse the result (schema `ashlr.stack.status/v1`, secret names only). If `.stack.toml` is missing, offer to run `stack_init`. If Phantom is not installed, give the install hint.
