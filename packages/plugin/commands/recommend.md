---
description: Recommend providers for a goal and save the result as a reusable recipe. Usage — /stack:recommend <query>
---

Call `stack_recommend` via the ashlr-stack MCP server with the user's query. Pass `save: true` so the recipe is persisted, and `k: 6` so the top 6 hits come back.

Invocation:

```
stack_recommend { query: "<user's input>", save: true, k: 6 }
```

Then render the hits as a short bulleted list, one line per provider:

```
• <displayName>  <category>  — <rationale-or-blurb>
```

After the list, show the saved recipe id on its own line (e.g. `Recipe: rec_xxx`).

Suggest the next step verbatim:

> Review the saved recipe, then run `/stack:apply <recipe-id>` for the provider setup you authorize; inspect its partial results.

If the tool is unavailable, explain the required setup: inside Claude Code use `/plugin marketplace add ashlrai/ashlr-stack`, then `/plugin install stack@ashlr`. The plugin entrypoint prefers `ashlr-stack-mcp` on PATH and otherwise needs the monorepo source plus Bun. The server also needs the Stack CLI on PATH and the intended project as its working directory. Installing the CLI alone does not install or commission the server. The published 0.3.10 CLI and MCP packages declare Node.js 20 or newer (`npm i -g @ashlr/stack ashlr-stack-mcp`); check `stack --version` and the actual client tools after setup.

If the user gave no query, ask them one clarifying question about the goal (e.g. "what are you building?") before calling the tool.
