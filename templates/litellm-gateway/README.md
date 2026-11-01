# litellm-gateway

Starter for running a [LiteLLM](https://docs.litellm.ai/) proxy as a local model gateway for Codex, Claude Code and Gemini CLI, with the provider keys held by Phantom Secrets instead of by LiteLLM.

Status: experimental. The Phantom placeholder flow below has not been verified against a mock upstream yet (open questions: whether LiteLLM keeps a path prefix and a per-exec token header on `api_base`). Treat it as a design to test, not a tested integration.

## Prerequisites and what the template provides

Install Stack and Phantom Secrets, and initialize Phantom for the project in a trusted terminal (`phantom init --empty` if it is not already initialized). You also need provider accounts and keys for the models you intend to use, and a separately configured, pinned LiteLLM installation or image. Follow the isolation and pinning rules below.

The checked-in `stack.toml` declares these service and secret-name slots, with `dev` as the default environment:

| Service | Phantom secret name |
| --- | --- |
| `openai` | `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY` |
| `xai` | `XAI_API_KEY` |
| `deepseek` | `DEEPSEEK_API_KEY` |

These are declarations, not provisioned credentials. The template does not include a LiteLLM installation, model configuration, Phantom route URLs, or a `LITELLM_MASTER_KEY` slot. Supply those separately. In particular, `PHANTOM_ANTHROPIC_BASE` in the example below is a prerequisite you must arrange for the running proxy; this template does not set it. A container must also be able to reach the Phantom route without exposing the gateway publicly. Verify the route, including any required path and per-exec token header, with a mock upstream before using real provider credentials.

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
   The example is illustrative, not a checked-in `config.yaml` or a verified launch recipe. Confirm that your Phantom and LiteLLM versions can forward the route and its required authentication before relying on it.
4. **Harden the proxy.** Set `general_settings.allow_client_side_credentials: false`, and set `NO_DOCS`, `NO_REDOC` and `NO_OPENAPI` to disable the Swagger and OpenAPI pages. Keep `LITELLM_MASTER_KEY` out of any agent's environment.
5. **Cursor is not supported by this pattern.** Cursor's IDE calls the proxy from Cursor's servers, so it needs an internet-reachable URL, which conflicts with a loopback-only proxy that holds keys. Do not expose this proxy for Cursor. The Cursor CLI cannot use LiteLLM (per LiteLLM's Cursor page).
6. **Licence.** LiteLLM is MIT outside its `enterprise/` directory. Do not build on features that need a LiteLLM licence key.

Same-user processes on the machine can still see the Phantom loopback proxy token, so this limits what the gateway and its logs hold, not what a local process of the same user can reach.

## Use

In a new project directory, write the template shape without attempting automatic provisioning:

```bash
stack init --template litellm-gateway --noProvision
```

The service entries already exist after init, so `stack add openai` (and the equivalent for the other declared services) reports that the service is already in the stack. The default init provisioning path also encounters these existing entries. Add the provider keys you need to Phantom in a trusted terminal using their names in the table, and create `LITELLM_MASTER_KEY` separately with `phantom add LITELLM_MASTER_KEY`. These actions do not configure LiteLLM or establish that placeholder forwarding works. Keep the master key out of agent environments and do not put secret values in config files or command arguments.

## Local verification

After init, inspect `.stack.toml`: it should contain the four service slots and the default `dev` environment above. `stack templates list --json` also reports the template's service and secret names; neither check proves that credentials exist or that a gateway works. `stack doctor` can report missing or unchecked credentials, but it does not verify the LiteLLM-to-Phantom forwarding path.

From a checkout of this repository, run the template checks without credentials:

```bash
HOME=$(mktemp -d) bun test packages/core/src/__tests__/template-litellm-gateway.test.ts
```

For an integration check, use a local mock upstream and dummy credentials first. Confirm the expected path and per-exec authentication reach the mock, that the proxy binds only to loopback, and that no real provider key appears in gateway configuration or logs. A passing template test alone does not establish those properties.

Sources: https://docs.litellm.ai/docs/proxy/configs (`os.environ/` values, master key), https://docs.litellm.ai/docs/tutorials/cursor_integration.
