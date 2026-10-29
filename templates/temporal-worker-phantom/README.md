# temporal-worker-phantom

Starter notes for running a [Temporal](https://temporal.io/) worker with its credentials held by Phantom Secrets, so no credential sits in the repository or in a checked-in config file.

Status: experimental guidance. This template has not been verified against a Temporal cluster.

## Prerequisites

- Stack with this template available (`stack templates list`), and a fresh project directory without an existing `.stack.toml`.
- Your own worker code, Temporal SDK and reachable Temporal server or namespace. The template contains no worker, SDK, server, connection settings or test workflow. Stack has no Temporal provider; the template declares no services and defaults to the `dev` environment.
- For an authenticated connection, Phantom Secrets installed and initialized in the project (`phantom status --json`; for a new project, `phantom init --empty` in a trusted terminal), plus credentials accepted by your Temporal endpoint. The endpoint may use an API key, mTLS, or other configured authentication. A local development server need not require production credentials.

## Verify the Stack configuration locally

In your project directory, run:

```bash
stack init --template temporal-worker-phantom
stack list --json
```

Initialization writes `.stack.toml`, `.stack.local.toml` and an entry in `.gitignore`, and registers the project locally. It does not provision a Temporal server or start a worker. The JSON report should identify the template as `temporal-worker-phantom` and show `"services": []`; `.stack.toml` should contain the default `dev` environment. This checks the Stack configuration only, not connectivity, credentials or worker execution.

## Credentials and running a worker

For an API-key based endpoint, create the secret in Phantom from a trusted terminal, then start your own worker under Phantom:

```bash
phantom add TEMPORAL_API_KEY
phantom exec -- <your worker command>
```

`TEMPORAL_API_KEY` is an example name for your worker, not a secret declared or configured by this template. Phantom's runtime uses a secret proxy and does not guarantee raw credentials in the worker's environment. Verify that your SDK's gRPC authentication or mTLS configuration is compatible with your Phantom setup before relying on this flow; the template does not implement that integration. Follow your endpoint and SDK instructions for address, namespace, TLS and credential configuration. Do not put raw credentials in repository files or logs. See [Temporal's security guide](https://docs.temporal.io/self-hosted-guide/security) and [Stack's Phantom runtime notes](../../docs/phantom-locus.md#run-with-phantom-secrets).

## Rules
1. **No secret values in workflow data.** Never put a raw secret in workflow or activity inputs or results, signals, memo, headers or failure messages. Pass names or opaque ids and fetch the value inside the activity. Temporal's Payload Codec can encrypt payloads before they reach the Temporal Service (https://docs.temporal.io/production-deployment/data-encryption), but it must not be the only protection for secrets.
2. **Codec Server stays local.** If you run a Codec Server, it decodes sensitive data on request. Restrict access to it; localhost-only is a documented pattern, and HTTPS is required to use authorization from the Web UI. Sharing keys between workers and the Codec Server needs key management.
3. **Set an Authorizer on self-hosted servers.** Temporal's docs warn that with no Authorizer configured, the default `noopAuthorizer` allows every API request to anyone who can reach the server.
4. **`temporal server start-dev` is for experiments only.** Never use it for production, and never point it at real secrets.
5. **Keep Temporal optional.** Do not make Phantom or Stack depend on a Temporal cluster; operating one is real infrastructure work.
