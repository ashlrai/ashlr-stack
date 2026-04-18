# Ashlr Stack -- Windows PowerShell one-liner installer.
#
#   irm stack.ashlr.ai/install.ps1 | iex
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
        Write-StackSay 'Phantom Secrets not found -- installing...'
        # No Homebrew on Windows. Fall back to npm/bun global install.
        try {
            if ($pkgMgr -eq 'bun') {
                & bun add -g phantom-secrets *> $null
                if ($LASTEXITCODE -ne 0) { throw 'bun add -g phantom-secrets failed' }
            } else {
                & npm i -g phantom-secrets *> $null
                if ($LASTEXITCODE -ne 0) { throw 'npm i -g phantom-secrets failed' }
            }
        } catch {
            Write-StackWarn "phantom-secrets install failed -- continuing; install manually later. ($_)"
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
            return ($LASTEXITCODE -eq 0)
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
            Write-StackWarn "$binDir isn't on PATH -- add it (user scope):"
            Write-StackWarn "  [Environment]::SetEnvironmentVariable('Path', `"$binDir;`" + [Environment]::GetEnvironmentVariable('Path','User'), 'User')"
        }

        if (-not (Test-Path $binDir)) {
            New-Item -ItemType Directory -Path $binDir -Force | Out-Null
        }

        # stack.cmd shim -- .cmd so it's picked up by cmd.exe AND PowerShell.
        $stackShim = Join-Path $binDir 'stack.cmd'
        $cliEntry  = Join-Path $InstallDir 'packages\cli\src\index.ts'
        @"
@echo off
bun run "$cliEntry" %*
"@ | Set-Content -LiteralPath $stackShim -Encoding ASCII

        # Same deal for the MCP server.
        $mcpShim  = Join-Path $binDir 'ashlr-stack-mcp.cmd'
        $mcpEntry = Join-Path $InstallDir 'packages\mcp\src\server.ts'
        @"
@echo off
bun run "$mcpEntry" %*
"@ | Set-Content -LiteralPath $mcpShim -Encoding ASCII

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
        Write-StackWarn 'stack binary installed but not yet on PATH. Open a new shell or add the bin dir to your PATH.'
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
