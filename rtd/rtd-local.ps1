#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Local RTD (MkDocs) build and serve via Docker.

.DESCRIPTION
    Builds or serves the Read the Docs mirror site using Docker.
    No Python installation required on the host.

.PARAMETER Command
    The command to run: 'serve' (default) or 'build'.

.EXAMPLE
    ./rtd/rtd-local.ps1 serve
    # Builds and serves at http://localhost:8000

.EXAMPLE
    ./rtd/rtd-local.ps1 build
    # Builds static output only
#>

param(
    [Parameter(Position = 0)]
    [ValidateSet('serve', 'build')]
    [string]$Command = 'serve'
)

$ErrorActionPreference = 'Stop'

# Ensure Docker is available
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker is required but not found. Install Docker Desktop: https://docs.docker.com/get-docker/"
    exit 1
}

# Resolve paths
$scriptDir = $PSScriptRoot
$repoRoot = Split-Path $scriptDir -Parent

Push-Location $scriptDir
try {
    switch ($Command) {
        'serve' {
            Write-Host "Starting MkDocs dev server at http://localhost:8000 ..." -ForegroundColor Cyan
            docker compose up --build
        }
        'build' {
            Write-Host "Building MkDocs site ..." -ForegroundColor Cyan
            docker compose run --rm mkdocs sh -c "python rtd/build.py && mkdocs build"
            Write-Host "Build complete. Output in rtd/_build/" -ForegroundColor Green
        }
    }
}
finally {
    Pop-Location
}
