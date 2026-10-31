# Scan output examples

These examples use `stack scan --json` with the default `--path .` and
confidence threshold (`medium`). Run them in the project directory. The JSON
is written to stdout; successful scans exit 0 and do not prompt or write
`.stack.toml`.

## Empty project

In an otherwise empty directory, or one with a `package.json` containing `{}`:

```sh
stack scan --json
```

```json
{
  "hits": []
}
```

An empty list means no recognized signals met the threshold; it does not prove
there are no weaker signals. Try `--confidence low` to include them.

## Detected providers

For a directory containing this `package.json` and an empty `vercel.json`:

```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "@vercel/analytics": "^1.0.0"
  }
}
```

```sh
stack scan --json
```

```json
{
  "hits": [
    {
      "provider": "supabase",
      "confidence": "high",
      "sources": [
        "package.json:@supabase/supabase-js"
      ]
    },
    {
      "provider": "vercel",
      "confidence": "high",
      "sources": [
        "package.json:@vercel/analytics",
        "vercel.json"
      ]
    }
  ]
}
```

Each `provider` is a detected provider name; `confidence` is its highest
signal tier (`low`, `medium`, or `high`); and `sources` lists its evidence
strings. Vercel's configuration file raises its confidence to high even though
its analytics dependency is a medium signal. JSON includes all evidence; the
human report displays at most three sources per provider and suggests `stack
add` commands. Detection is heuristic and does not confirm a working service.

`--confidence high` filters out providers below high; `--confidence low`
includes every tier. With `--yes` the default threshold becomes high, even
alongside `--json`. JSON mode still only reports results. Invalid paths,
confidence values, or an unreadable or malformed `package.json` produce an
error instead of a JSON report. See the [scan guide](scan-guide.md) for inputs,
interactive modes, and adding providers.
