# Custom model endpoints

Stack reads these environment variables when it calls a model provider. Unset or blank means the defaults below.

| Variable | Default | Used by |
| --- | --- | --- |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | `anthropic` key check (`/v1/models`) |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | `openai` key check (`/models`) |
| `OLLAMA_HOST` | `http://localhost:11434` | `stack recommend --synth` Ollama fallback (`/v1`). Accepts `host`, `host:port`, `:port`, or a URL |

Trailing slashes are trimmed. A LiteLLM gateway or a Phantom proxy can sit in front of the providers. Only the URL handling is covered by tests. Stack has not been tested against a specific gateway.

A key check sends the key to the URL you set. Point these only at endpoints you trust.

`ANTHROPIC_BASE_URL` and `OPENAI_BASE_URL` must be `https`, or plain `http` only to `127.0.0.1` or `[::1]`. Any other value is refused and no key is sent.

LM Studio keeps its own `STACK_LM_URL`.
