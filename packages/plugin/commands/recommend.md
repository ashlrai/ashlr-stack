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

> Run `/stack:apply <recipe-id>` to provision these providers and wire their secrets.

If the `ashlr-stack` MCP server is not configured (tool not available), tell the user to install the plugin with `/plugin install ashlr-stack` and ensure the `stack` CLI is on PATH (`npm i -g @ashlr/stack`).

If the user gave no query, ask them one clarifying question about the goal (e.g. "what are you building?") before calling the tool.
