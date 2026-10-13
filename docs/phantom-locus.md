# Stack with Phantom Secrets and Locus

Ashlr Stack provisions services. It relies on two companions for the
credential and identity layers, and works best inside the Phantom workbench.

| Layer | Tool | Question it answers |
|---|---|---|
| Secret values | [Phantom Secrets](https://github.com/ashlrai/phantom-secrets) | Can this secret enter the model's context? (No: Stack stores every key with `phantom add` and MCP configs reference `$(phantom reveal NAME)`.) |
| Account identity | [Locus](https://github.com/ashlrai/locus) | Is this command acting in the right GitHub / Vercel / Supabase account? |
| Provisioning | Ashlr Stack | Which services does this project need, and are they wired? |

## Rules Stack follows

- Stack never writes raw secrets to `.env`, `.stack.toml`, logs, or MCP JSON.
  Values go to the Phantom vault (`phantom add KEY`), and generated MCP
  entries use `$(phantom reveal KEY)` so the value is resolved at spawn time.
- Errors from `phantom add` are redacted (see
  `packages/core/src/__tests__/secret-redaction.test.ts`).
- Stack does not choose *which account* a provider CLI acts as. That is
  Locus's job.

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
personal or company key. Flags shown are from Locus 0.5.x
(`locus binding add --help`).

## Inside Phantom (the workbench)

When a repo is enrolled in Phantom, Phantom detects Phantom Secrets and Locus
as companions. Agents should call Stack's MCP tools from a Locus-pinned
session; Stack's MCP server never returns secret values. Automatic key
rotation is not enabled by Stack; `phantom add --rotate` is only used when you
explicitly run a rotate flow.
