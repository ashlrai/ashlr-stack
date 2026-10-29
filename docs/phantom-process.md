# Core Phantom subprocess boundary

The shared core `exec()` wrapper resolves `phantom` from the caller's PATH to an
absolute executable path before applying an operation's working directory. It
uses the first executable regular file in PATH order, ignores empty PATH
entries, and returns the existing Phantom installation error when none is
found. Explicit relative PATH entries are resolved against the caller's working
directory. Windows uses `phantom.exe`; shell command shims are not launched.

Each invocation resolves independently so a changed PATH is respected. This
pins the path passed to spawn, but does not protect against replacement of the
executable file itself. PATH and its directories must still be trusted.

The child receives only these parent environment entries when present:

- Runtime and location: `PATH`, `HOME`, `USER`, `USERPROFILE`, `SystemRoot`,
  `APPDATA`, `LOCALAPPDATA`, `PATHEXT`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`,
  `XDG_STATE_HOME`, `XDG_RUNTIME_DIR`.
- Temporary files: `TMPDIR`, `TEMP`, `TMP`.
- Locale and terminal: `LANG`, `LC_ALL`, `LC_CTYPE`, `TERM`, `NO_COLOR`.
- Vault unlock: `PHANTOM_VAULT_PASSPHRASE`, Phantom's explicit unlock input.

`PATH` is normalized before spawn: empty entries are dropped and relative
entries are made absolute against the caller's working directory, so a relative
entry can never be re-read inside the operation's project directory — neither
when locating `phantom` nor when the child searches PATH itself.

Provider credentials, arbitrary Phantom-prefixed variables, proxy overrides,
and runtime loader hooks are not inherited. Secret creation still sends its
value over stdin. Interactive stdio, exit handling and timeouts are unchanged.

This boundary covers the core vault-operation wrapper and installation probes.
The CLI's separate `stack exec -- command` proxy launcher and optional agent
preflight are outside this slice; they have different environment requirements
for the wrapped application.
