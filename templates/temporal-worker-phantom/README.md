# temporal-worker-phantom

Starter notes for running a [Temporal](https://temporal.io/) worker with its credentials held by Phantom Secrets, so no credential sits in the repository or in a checked-in config file.

Status: experimental guidance. Nothing here has been run against a Temporal cluster, and this template declares no services because Stack has no Temporal provider.

## Credentials, not on disk
A Temporal client authenticates with a bearer token (gRPC `authorization` header) and/or an mTLS client certificate, supplied as ordinary process configuration (Temporal docs: https://docs.temporal.io/self-hosted-guide/security). Create those values in Phantom, outside Stack, and start the worker under `phantom exec` so they arrive as environment variables:
```bash
stack init --template temporal-worker-phantom
phantom add TEMPORAL_API_KEY            # or the TLS client key you use
phantom exec -- <your worker command>
```
Read the variables in your worker code; do not write them to a file in the repository.

## Rules
1. **No secret values in workflow data.** Never put a raw secret in workflow or activity inputs or results, signals, memo, headers or failure messages. Pass names or opaque ids and fetch the value inside the activity. Temporal's Payload Codec can encrypt payloads before they reach the Temporal Service (https://docs.temporal.io/production-deployment/data-encryption), but it must not be the only protection for secrets.
2. **Codec Server stays local.** If you run a Codec Server, it decodes sensitive data on request. Restrict access to it; localhost-only is a documented pattern, and HTTPS is required to use authorization from the Web UI. Sharing keys between workers and the Codec Server needs key management.
3. **Set an Authorizer on self-hosted servers.** Temporal's docs warn that with no Authorizer configured, the default `noopAuthorizer` allows every API request to anyone who can reach the server.
4. **`temporal server start-dev` is for experiments only.** Never use it for production, and never point it at real secrets.
5. **Keep Temporal optional.** Do not make Phantom or Stack depend on a Temporal cluster; operating one is real infrastructure work.
