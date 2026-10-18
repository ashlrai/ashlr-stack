# litellm-gateway

Starter for running a [LiteLLM](https://docs.litellm.ai/) proxy as a local model gateway for Codex, Claude Code and Gemini CLI, with the provider keys held by Phantom Secrets instead of by LiteLLM.

Status: experimental. The Phantom placeholder flow below has not been verified against a mock upstream yet (open questions: whether LiteLLM keeps a path prefix and a per-exec token header on `api_base`). Treat it as a design to test, not a tested integration.

## Why placeholders
An exposed LiteLLM proxy holds every provider key in its process. In March 2026 two PyPI releases of `litellm` (1.82.7 and 1.82.8) were malicious and harvested environment variables, SSH keys, cloud credentials and `.env` files (LiteLLM's notice: https://docs.litellm.ai/blog/security-update-march-2026, advisory GHSA-5mg7-485q-xm76). The proxy also has a long list of published advisories, several of which turned a low-privilege user into a key leak or code execution (https://api.github.com/repos/BerriAI/litellm/security-advisories). So: no real keys in the proxy.

## Rules (do not weaken)
1. **Pin, never float.** Do not run an unpinned `pip install litellm`, and never on a machine that holds real secrets. Use the signed Docker image (verify the cosign signature against the key LiteLLM pins at commit `0112e53`) or a hash-pinned install, at a version at or above 1.83.0 and at or above the patch for GHSA-7hp6-4w63-5g45 on your release line (for example 1.103.1 on the 1.103 line). Re-check the pin against the advisory list on the day you upgrade.
2. **Isolate.** Run it in a container with no mounted dotfiles (no `~/.ssh`, cloud config, `.env`), not as root, no public listener. Bind to loopback.
3. **Placeholders only.** Do not use `os.environ/NAME` with real keys, a `.env` file, or an Enterprise secret manager as the default. Point each model at its Phantom route and give LiteLLM only the `phm_` placeholder value:
   ```yaml
   model_list:
     - model_name: claude-sonnet
       litellm_params:
         model: anthropic/<model-id>
         api_base: os.environ/PHANTOM_ANTHROPIC_BASE   # Phantom proxy URL
         api_key: os.environ/ANTHROPIC_API_KEY          # holds a phm_ placeholder
   general_settings:
     master_key: os.environ/LITELLM_MASTER_KEY
     allow_client_side_credentials: false
   ```
   Start it with `phantom exec -- litellm --config config.yaml`.
4. **Harden the proxy.** Set `general_settings.allow_client_side_credentials: false`, and set `NO_DOCS`, `NO_REDOC` and `NO_OPENAPI` to disable the Swagger and OpenAPI pages. Keep `LITELLM_MASTER_KEY` out of any agent's environment.
5. **Cursor is not supported by this pattern.** Cursor's IDE calls the proxy from Cursor's servers, so it needs an internet-reachable URL, which conflicts with a loopback-only proxy that holds keys. Do not expose this proxy for Cursor. The Cursor CLI cannot use LiteLLM (per LiteLLM's Cursor page).
6. **Licence.** LiteLLM is MIT outside its `enterprise/` directory. Do not build on features that need a LiteLLM licence key.

Same-user processes on the machine can still see the Phantom loopback proxy token, so this limits what the gateway and its logs hold, not what a local process of the same user can reach.

## Use
```bash
stack init --template litellm-gateway
phantom add LITELLM_MASTER_KEY     # not managed by Stack
stack add openai                    # and the others you need
```
Sources: https://docs.litellm.ai/docs/proxy/configs (`os.environ/` values, master key), https://docs.litellm.ai/docs/tutorials/cursor_integration.
