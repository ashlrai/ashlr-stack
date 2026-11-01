# Stack with Phantom Secrets and Locus

Ashlr Stack provisions services. It relies on two companions for the
credential and identity layers, and works best inside the Phantom workbench.
This guide covers the Stack 0.3 release candidate (this checkout: <!-- fresh:begin version-pin -->0.3.1<!-- fresh:end -->). Check
`stack --version` and command help when using an older installed release.

| Layer | Tool | Question it answers |
|---|---|---|
| Secret values | [Phantom Secrets](https://github.com/ashlrai/phantom-secrets) | Where are selected credentials stored and how are commands run with them? Stack uses the vault and `phantom exec --` runtime wrapper. |
| Account identity | [Locus](https://github.com/ashlrai/locus) | Is this command acting in the right GitHub / Vercel / Supabase account? |
| Provisioning | Ashlr Stack | Which services does this project need, and are they wired? |

## Rules Stack follows

- Store credentials in the Phantom vault (`phantom add KEY`) from a trusted
  terminal. Run commands with `phantom exec --` rather than copying values
  into shell arguments, checked-in configuration, or agent output.
- Stack's generated MCP entries vary by provider. A command substitution
  string in an MCP JSON environment field is not evaluated by JSON itself.
  Review the entry and the client's runtime support before using it; wrapping
  a process does not automatically repair an incompatible generated entry.
- Errors from `phantom add` are redacted (see
  `packages/core/src/__tests__/secret-redaction.test.ts`).
- Stack does not choose *which account* a provider CLI acts as. That is
  Locus's job.

## Run with Phantom Secrets

From a project configured with Phantom Secrets, start your application through
Phantom's runtime wrapper:

```bash
phantom exec -- bun dev
# Stack's wrapper, from a project with .stack.toml:
stack exec -- bun dev
```

`stack exec` delegates to `phantom exec`. The runtime uses Phantom's secret
proxy; it does not promise that every application receives raw secret values
as environment variables. Keep application and provider logs free of secrets.

## Run Stack in the right account with Locus

Bind each repo's owner scope (personal / company / client) once in Locus,
then run Stack inside that binding so `gh`, `vercel`, `supabase`, and the
provider APIs only see the pinned account:

```bash
# one time per account (credential refs are Phantom names, never raw tokens)
locus binding add client-acme --tenant acme --provider github \
  --account acme-gh --credential-ref phm:GH_TOKEN_ACME --org acme-corp --non-interactive
locus workspace --default client-acme --allow client-acme --require-pin

# provision inside the sealed session
locus run -b client-acme -- stack add vercel
locus run -b client-acme -- stack doctor
```

Use matching Phantom names per scope (for example `GH_TOKEN_PERSONAL`,
`GH_TOKEN_ASHLR`, `GH_TOKEN_ACME`) so a client project never resolves a
personal or company key. Check `locus --version` and
`locus binding add --help` for the flags supported by your installed release.

## Inside Phantom (the workbench)

When a repo is enrolled in Phantom, Phantom detects Phantom Secrets and Locus
as companions. Agents should call Stack's MCP tools from a Locus-pinned
session. Do not request secret values through MCP or copy them into agent
context. Automatic key rotation is not enabled by Stack; `phantom add --rotate` is only used when you
explicitly run a rotate flow.
