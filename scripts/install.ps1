# Ashlr Stack -- Windows PowerShell one-liner installer.
#
#   irm https://stack.ashlr.ai/install.ps1 | iex
#
# Note: the explicit https:// scheme is required. Without it, PowerShell 5.1's
# Invoke-RestMethod defaults to http://, the host 308-redirects to https://, and
# IRM refuses cross-scheme redirects -- aborting with a (308) Permanent Redirect.
#
# Mirrors scripts/install.sh for the macOS/Linux side. It tries, in order:
#
#   1. Published registries (`@ashlr/stack` on npm) once v0.1 is live -- fast path.
#   2. Git clone + stack.cmd shim -- works today against the current repo.
#
# It also installs Phantom Secrets (Stack's vault) if it's missing. Every
# `stack add` writes through Phantom.

#requires -Version 5.1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-StackSay  ([string]$msg) { Write-Host "  " -NoNewline; Write-Host "-> stack: " -NoNewline -ForegroundColor Magenta; Write-Host $msg }
function Write-StackWarn ([string]$msg) { Write-Host "  " -NoNewline; Write-Host "!  stack: " -NoNewline -ForegroundColor Yellow;  Write-Host $msg }
function Write-StackDie  ([string]$msg) { Write-Host "  " -NoNewline; Write-Host "x  stack: " -NoNewline -ForegroundColor Red;     Write-Host $msg; exit 1 }

function Test-CommandExists {
    param([Parameter(Mandatory)][string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

# Convert a Windows path (C:\Users\foo\bin) to a Git Bash / MSYS path
# (/c/Users/foo/bin). Git Bash inherits the Windows user PATH, but only at
# shell-start time -- so an already-running bash (e.g. inside Claude Code on
# Windows) won't see new entries until the session restarts. Writing an
# explicit export to ~/.bashrc with the unix-style path covers that gap and
# also handles users whose Git Bash was launched with a sanitized PATH.
function ConvertTo-BashPath {
    param([Parameter(Mandatory)][string]$WinPath)
    $p = $WinPath -replace '\\', '/'
    if ($p -match '^([A-Za-z]):/(.*)$') {
        $drive = $Matches[1].ToLower()
        return "/$drive/$($Matches[2])"
    }
    return $p
}

# Append `export PATH="<bash-path>:$PATH"` to the user's ~/.bashrc (idempotent
# via a marker comment) so Git Bash sessions pick up the stack bin dir.
# Best-effort: skips silently if no HOME / no writable bashrc.
function Add-ToBashrcPath {
    param([Parameter(Mandatory)][string]$WinBinDir)
    # NB: $home is a PowerShell read-only automatic variable -- using a different name.
    $homeDir = if ($env:HOME) { $env:HOME } else { $env:USERPROFILE }
    if (-not $homeDir) { return }
    $bashrc = Join-Path $homeDir '.bashrc'
    $bashPath = ConvertTo-BashPath -WinPath $WinBinDir
    $marker = "# ashlr-stack PATH ($bashPath)"
    try {
        if ((Test-Path $bashrc) -and (Select-String -Path $bashrc -SimpleMatch $marker -Quiet -ErrorAction SilentlyContinue)) {
            return
        }
        $line = "`n$marker`nexport PATH=`"$bashPath`:`$PATH`"`n"
        Add-Content -LiteralPath $bashrc -Value $line -Encoding UTF8
        Write-StackSay "wired $bashPath into $bashrc (for Git Bash / Claude Code)"
    } catch {
        Write-StackWarn "could not update $bashrc -- add '$bashPath' to your bash PATH manually. ($_)"
    }
}

function Install-AshlrStack {
    $RepoUrl    = if ($env:STACK_REPO_URL)    { $env:STACK_REPO_URL }    else { 'https://github.com/ashlrai/ashlr-stack.git' }
    $InstallDir = if ($env:STACK_INSTALL_DIR) { $env:STACK_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'ashlr-stack' }

    # -----------------------------------------------------------------------
    # 1. Prerequisites -- Bun (preferred) or Node+npm.
    # -----------------------------------------------------------------------

    $pkgMgr = $null
    if (Test-CommandExists 'bun') {
        $pkgMgr = 'bun'
    } elseif (Test-CommandExists 'npm') {
        $pkgMgr = 'npm'
    } else {
        Write-StackSay 'installing bun (needed to run stack)...'
        try {
            Invoke-RestMethod 'https://bun.sh/install.ps1' | Invoke-Expression
        } catch {
            Write-StackDie "bun install failed -- install manually: https://bun.sh ($_)"
        }

        # Refresh PATH inside this session so we can see the freshly installed bun.
        $bunBin = Join-Path $env:USERPROFILE '.bun\bin'
        if ((Test-Path $bunBin) -and ($env:Path -notlike "*$bunBin*")) {
            $env:Path = "$bunBin;$env:Path"
        }
        if (-not (Test-CommandExists 'bun')) {
            Write-StackDie 'bun install completed but `bun` is still not on PATH. Open a new shell and retry.'
        }
        $pkgMgr = 'bun'
    }
    Write-StackSay "using $pkgMgr"

    # -----------------------------------------------------------------------
    # 2. Phantom Secrets -- Stack's vault.
    # -----------------------------------------------------------------------

    if (-not (Test-CommandExists 'phantom')) {
        Write-StackSay 'Phantom Secrets not found -- installing via phantom installer...'
        # Use phantom's own one-liner. This sidesteps two real bugs in the
        # bun/npm path on Windows:
        #   1. Bun-on-Windows doesn't reliably materialize the `phantom` shim
        #      from the npm package's `bin` field, so even a successful
        #      `bun add -g phantom-secrets` leaves nothing on PATH.
        #   2. The PS5.1 native-stderr-as-error trap: redirecting bun's stderr
        #      with `*>` inside try/catch + EAP=Stop turns benign progress
        #      output into spurious throws.
        # Phantom's installer downloads the signed release directly and wires
        # User PATH itself, so it works whether bun is healthy or not.
        try {
            $phantomScript = Invoke-RestMethod 'https://phm.dev/install.ps1' -UseBasicParsing
            $phantomScript | & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command -
            if ($LASTEXITCODE -ne 0) { throw "phantom installer exited $LASTEXITCODE" }
            # phantom's installer modified User PATH; refresh this session so
            # subsequent commands can see the new entries.
            $env:Path = ([Environment]::GetEnvironmentVariable('Path','User')) + ';' +
                        ([Environment]::GetEnvironmentVariable('Path','Machine'))
        } catch {
            Write-StackWarn "phantom-secrets install failed -- continuing; install manually from https://phm.dev. ($_)"
        }
    } else {
        Write-StackSay 'phantom already installed -- good.'
    }

    # -----------------------------------------------------------------------
    # 3. Stack CLI -- try registries first, fall back to git clone + shim.
    # -----------------------------------------------------------------------

    function Invoke-RegistryInstall {
        try {
            if ($pkgMgr -eq 'bun') {
                & bun add -g '@ashlr/stack' 'ashlr-stack-mcp' *> $null
            } else {
                & npm i -g '@ashlr/stack' 'ashlr-stack-mcp' *> $null
            }
            if ($LASTEXITCODE -ne 0) { return $false }

            # Where the freshly-globally-installed shim lands. bun -> ~/.bun/bin,
            # npm -> %APPDATA%\npm. Both put themselves on Windows User PATH at
            # tool-install time, but already-running shells (Git Bash, the
            # Claude Code session that just kicked this off) won't see it until
            # restart. Mirror the entry into ~/.bashrc so bash picks it up.
            $globalBin = if ($pkgMgr -eq 'bun') {
                Join-Path $env:USERPROFILE '.bun\bin'
            } else {
                Join-Path $env:APPDATA 'npm'
            }
            if (Test-Path $globalBin) {
                Add-ToBashrcPath -WinBinDir $globalBin
            }
            return $true
        } catch {
            return $false
        }
    }

    function Invoke-CloneInstall {
        Write-StackSay 'installing from source (git clone + shim)...'
        if (-not (Test-CommandExists 'git')) {
            Write-StackDie 'git is required for the source-install path.'
        }

        $parent = Split-Path -Parent $InstallDir
        if (-not (Test-Path $parent)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }

        if (Test-Path (Join-Path $InstallDir '.git')) {
            Write-StackSay "updating existing checkout at $InstallDir"
            & git -C $InstallDir pull --ff-only --quiet
        } else {
            Write-StackSay "cloning $RepoUrl -> $InstallDir"
            & git clone --depth 1 --quiet $RepoUrl $InstallDir
        }

        Push-Location $InstallDir
        try {
            & bun install --silent
            if ($LASTEXITCODE -ne 0) {
                Write-StackWarn 'bun install inside the checkout had issues -- continuing.'
            }
        } finally {
            Pop-Location
        }

        # Pick a bin dir on PATH. Preference order:
        #   1. $env:USERPROFILE\.local\bin  (matches Linux/macOS muscle memory)
        #   2. $env:LOCALAPPDATA\Programs\ashlr-stack\bin  (Windows-y fallback)
        $preferred = Join-Path $env:USERPROFILE '.local\bin'
        $fallback  = Join-Path $env:LOCALAPPDATA 'Programs\ashlr-stack\bin'
        $pathDirs  = $env:Path -split ';' | Where-Object { $_ }

        $binDir = $null
        if ($pathDirs -contains $preferred) {
            $binDir = $preferred
        } elseif ($pathDirs -contains $fallback) {
            $binDir = $fallback
        } else {
            $binDir = $fallback
            $userPath = [Environment]::GetEnvironmentVariable('Path','User')
            $userPathDirs = if ($userPath) { $userPath -split ';' | Where-Object { $_ } } else { @() }
            if ($userPathDirs -notcontains $binDir) {
                $newUserPath = if ($userPath) { "$binDir;$userPath" } else { $binDir }
                [Environment]::SetEnvironmentVariable('Path', $newUserPath, 'User')
                # Make the new PATH visible to this same session, too.
                $env:Path = "$binDir;$env:Path"
                Write-StackSay "added $binDir to user PATH"
            }
        }

        if (-not (Test-Path $binDir)) {
            New-Item -ItemType Directory -Path $binDir -Force | Out-Null
        }

        # We write TWO shims per command:
        #   1. <name>.cmd  -- picked up by cmd.exe and PowerShell.
        #   2. <name>      -- bare-name shell script with a bash shebang, picked
        #                     up by Git Bash. MSYS2 bash's PATH lookup does NOT
        #                     auto-append .cmd, so a user (or Claude Code, which
        #                     shells out through Git Bash on Windows) typing
        #                     `stack` would otherwise get "command not found"
        #                     even though the bin dir is on PATH.
        # The bash shim MUST use LF line endings -- a CRLF after the shebang
        # makes /usr/bin/env try to exec "bash\r" and fail with ENOENT.

        function Write-Shim {
            param(
                [Parameter(Mandatory)][string]$BinDir,
                [Parameter(Mandatory)][string]$Name,
                [Parameter(Mandatory)][string]$EntryWinPath
            )
            $cmdShim = Join-Path $BinDir "$Name.cmd"
            $cmdBody = "@echo off`r`nbun run `"$EntryWinPath`" %*`r`n"
            [System.IO.File]::WriteAllText($cmdShim, $cmdBody, [System.Text.UTF8Encoding]::new($false))

            $bashShim   = Join-Path $BinDir $Name
            $entryBash  = ConvertTo-BashPath -WinPath $EntryWinPath
            $bashBody   = "#!/usr/bin/env bash`nexec bun run `"$entryBash`" `"`$@`"`n"
            [System.IO.File]::WriteAllText($bashShim, $bashBody, [System.Text.UTF8Encoding]::new($false))
        }

        $cliEntry = Join-Path $InstallDir 'packages\cli\src\index.ts'
        $mcpEntry = Join-Path $InstallDir 'packages\mcp\src\server.ts'
        Write-Shim -BinDir $binDir -Name 'stack'            -EntryWinPath $cliEntry
        Write-Shim -BinDir $binDir -Name 'ashlr-stack-mcp'  -EntryWinPath $mcpEntry
        $stackShim = Join-Path $binDir 'stack.cmd'

        # Mirror the bin dir into Git Bash's PATH too, so an already-running
        # bash (Claude Code on Windows runs commands through Git Bash) picks it
        # up on next session start.
        Add-ToBashrcPath -WinBinDir $binDir

        Write-StackSay "stack shim written to $stackShim"
    }

    Write-StackSay 'installing the stack CLI...'
    if (Invoke-RegistryInstall) {
        Write-StackSay 'installed from npm registry.'
    } else {
        Write-StackSay 'registry install unavailable (v0.1 not published yet) -- falling back to source.'
        Invoke-CloneInstall
    }

    # -----------------------------------------------------------------------
    # 4. Verify.
    # -----------------------------------------------------------------------

    if (-not (Test-CommandExists 'stack')) {
        Write-StackWarn 'stack installed and PATH updated, but not yet visible in this shell.'
        Write-StackWarn 'Restart your terminal -- and if you use Claude Code, restart that session too -- then run: stack --help'
        return
    }

    $version = try { (& stack --version) 2>$null } catch { 'unknown' }
    if (-not $version) { $version = 'unknown' }
    Write-StackSay "done. Version: $version"
    Write-StackSay 'try: stack providers    # see the 23 curated providers'
    Write-StackSay '     stack init         # scaffold a new project'
}

# Only execute the installer when NOT dot-sourced. Dot-sourcing this file (e.g.
# `pwsh -Command { . ./scripts/install.ps1 }` for a parse check, or via a test
# harness) just defines `Install-AshlrStack` without running anything.
if ($MyInvocation.InvocationName -ne '.') {
    Install-AshlrStack
}
