#!/usr/bin/env pwsh
#Requires -Version 7.0

<#
.SYNOPSIS
    Re-runs the "Gate - Pipeline owner" job of a pull request's latest CI run when a submitted or dismissed
    review can change its verdict, so a build admin's approval is seen without a new push.

.DESCRIPTION
    The library does this in its pr-intake.yml (Invoke-PrIntake.ps1 -Mode Review); this repository has no
    intake workflow, so pipeline-owner-recheck.yml runs this script alone. The decision is the library's:
    an approval re-runs a failed gate, and a change request or a dismissal re-runs a passed one. A comment
    changes nothing.

    One difference: GitHub cannot re-run a job of a run that is still going. The library leaves such a run
    alone and asks for /recheck; this repository has no such command, so this waits for the run to end
    (gh run watch) and then re-runs the gate.

    Exit 0 when done, including when nothing needed re-running; a failed gh call throws.

.PARAMETER Repository
    owner/name.

.PARAMETER Number
    The pull request number.

.PARAMETER ReviewState
    The submitted or dismissed review's state: approved, changes_requested, commented or dismissed.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Repository,
  [Parameter(Mandatory)][int]$Number,
  [string]$ReviewState = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# The pipeline-owner gate's job name in ci.yml, with the middle dot kept ASCII-only in source.
$script:PipelineOwnerJob = "Gate $([char]0x00B7) Pipeline owner"

function Invoke-Gh {
  <# .SYNOPSIS Runs gh; throws when it fails. #>
  param([Parameter(Mandatory)][string[]]$Arguments)
  $output = & gh @Arguments
  if ($LASTEXITCODE -ne 0) { throw "gh $($Arguments[0..([Math]::Min(1, $Arguments.Count - 1))] -join ' ') failed (exit $LASTEXITCODE)" }
  return $output
}

function Select-PipelineOwnerJob {
  <#
  .SYNOPSIS
      The id of the finished "Gate - Pipeline owner" job when a review in ReviewState can change its
      verdict: an approval of a failed gate, or a change request or dismissal of a passed one. Nothing else.
  #>
  param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Jobs, [Parameter(Mandatory)][AllowEmptyString()][string]$ReviewState)
  $gate = $Jobs | Where-Object { $_.name -eq $script:PipelineOwnerJob -and $_.status -eq 'completed' } | Select-Object -First 1
  if (-not $gate) { return }
  $wanted = switch ($ReviewState) { 'approved' { 'failure' } { $_ -in @('changes_requested', 'dismissed') } { 'success' } default { '' } }
  if ($wanted -and $gate.conclusion -eq $wanted) { return $gate.databaseId }
}

function Update-PipelineOwnerGate {
  <#
  .SYNOPSIS
      Re-runs the pipeline-owner gate of the pull request's latest CI run for its head commit when the
      review can change its verdict, waiting first for a run that is still going.
  #>
  param([Parameter(Mandatory)][string]$Repository, [Parameter(Mandatory)][int]$Number, [Parameter(Mandatory)][AllowEmptyString()][string]$ReviewState)
  $head = ((Invoke-Gh -Arguments @('pr', 'view', "$Number", '-R', $Repository, '--json', 'headRefOid', '--jq', '.headRefOid')) -join '').Trim()
  $runs = (Invoke-Gh -Arguments @('run', 'list', '-R', $Repository, '--workflow', 'ci.yml', '--commit', $head,
      '--json', 'databaseId,status,conclusion,event,createdAt')) -join "`n" | ConvertFrom-Json
  $latest = @($runs) | Where-Object { $_ -and $_.event -eq 'pull_request' } | Sort-Object { [datetimeoffset]$_.createdAt } | Select-Object -Last 1
  if (-not $latest) { Write-Host "Pull request #${Number}: no CI run for $head yet; its gate reads the reviews when it runs."; return }
  if ($latest.status -ne 'completed') {
    Write-Host "Pull request #${Number}: CI run $($latest.databaseId) is still going; waiting for it to end."
    [void](Invoke-Gh -Arguments @('run', 'watch', "$($latest.databaseId)", '-R', $Repository, '--interval', '30'))
  }
  $jobs = (Invoke-Gh -Arguments @('run', 'view', "$($latest.databaseId)", '-R', $Repository, '--json', 'jobs', '--jq', '.jobs')) -join "`n" | ConvertFrom-Json
  $job = Select-PipelineOwnerJob -Jobs @($jobs) -ReviewState $ReviewState
  if (-not $job) { Write-Host "Pull request #${Number}: a $ReviewState review does not change the pipeline-owner gate."; return }
  [void](Invoke-Gh -Arguments @('run', 'rerun', '--job', "$job", '-R', $Repository))
  Write-Host "Re-ran the pipeline-owner gate (job $job) of CI run $($latest.databaseId) for pull request #$Number."
}

# Dot-sourcing for tests loads the functions without running anything.
if ($MyInvocation.InvocationName -eq '.') { return }

Update-PipelineOwnerGate -Repository $Repository -Number $Number -ReviewState $ReviewState
