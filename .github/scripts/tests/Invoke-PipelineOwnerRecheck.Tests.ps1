#Requires -Modules Pester

BeforeAll {
  . (Join-Path -Path $PSScriptRoot -ChildPath '..' -AdditionalChildPath 'Invoke-PipelineOwnerRecheck.ps1') -Repository o/r -Number 0
}

Describe 'Select-PipelineOwnerJob' {
  BeforeAll {
    $script:Gate = "Gate $([char]0x00B7) Pipeline owner"
    function New-TestJob { param([string]$Conclusion, [string]$Status = 'completed', [string]$Name = $script:Gate, [long]$Id = 41)
      [pscustomobject]@{ name = $Name; databaseId = $Id; status = $Status; conclusion = $Conclusion } }
  }

  It 'picks the failed gate when a review approves, since the approval may be the one it waits for' {
    $jobs = @((New-TestJob -Name 'Build' -Id 40 -Conclusion 'failure'), (New-TestJob -Conclusion 'failure'))
    Select-PipelineOwnerJob -Jobs $jobs -ReviewState 'approved' | Should -Be 41
  }

  It 'picks the passed gate when a review requests changes or is dismissed, since it may have counted that approval' -TestCases @(
    @{ State = 'changes_requested' }, @{ State = 'dismissed' }
  ) {
    Select-PipelineOwnerJob -Jobs @(New-TestJob -Conclusion 'success') -ReviewState $State | Should -Be 41
  }

  It 'picks nothing when the review cannot change the verdict' -TestCases @(
    @{ State = 'approved'; Conclusion = 'success' }
    @{ State = 'changes_requested'; Conclusion = 'failure' }
    @{ State = 'dismissed'; Conclusion = 'failure' }
    @{ State = 'commented'; Conclusion = 'failure' }
    @{ State = 'commented'; Conclusion = 'success' }
  ) {
    Select-PipelineOwnerJob -Jobs @(New-TestJob -Conclusion $Conclusion) -ReviewState $State | Should -BeNullOrEmpty
  }

  It 'picks nothing when the gate has not finished, or is not in the run' {
    Select-PipelineOwnerJob -Jobs @(New-TestJob -Status 'in_progress' -Conclusion '') -ReviewState 'approved' | Should -BeNullOrEmpty
    Select-PipelineOwnerJob -Jobs @(New-TestJob -Name 'Build' -Conclusion 'failure') -ReviewState 'approved' | Should -BeNullOrEmpty
  }
}

Describe 'Update-PipelineOwnerGate' {
  BeforeEach {
    $script:calls = [System.Collections.Generic.List[string]]::new()
    $script:runStatus = 'completed'
    $script:runs = $null
    $script:gate = "Gate $([char]0x00B7) Pipeline owner"
    Mock Invoke-Gh {
      $line = $Arguments -join ' '
      $script:calls.Add($line)
      if ($line -like 'pr view 7 *') { return 'abc123' }
      if ($line -like 'run list *') {
        if ($null -ne $script:runs) { return $script:runs }
        return (ConvertTo-Json -Compress -InputObject @(
            @{ databaseId = 5; status = $script:runStatus; conclusion = 'failure'; event = 'pull_request'; createdAt = '2026-10-20T12:00:00Z' },
            @{ databaseId = 3; status = 'completed'; conclusion = 'failure'; event = 'pull_request'; createdAt = '2026-10-20T10:00:00Z' },
            @{ databaseId = 9; status = 'completed'; conclusion = 'success'; event = 'push'; createdAt = '2026-10-20T13:00:00Z' }))
      }
      if ($line -like 'run view 5 *') {
        return (ConvertTo-Json -Compress -InputObject @(@{ name = $script:gate; databaseId = 41; status = 'completed'; conclusion = 'failure' }))
      }
    }
  }

  It 're-runs the gate job of the latest pull request run for the head commit' {
    Update-PipelineOwnerGate -Repository 'o/r' -Number 7 -ReviewState 'approved'
    $script:calls | Should -Contain 'run rerun --job 41 -R o/r'
    @($script:calls | Where-Object { $_ -like 'run list * --commit abc123 *' }).Count | Should -Be 1
    @($script:calls | Where-Object { $_ -like 'run watch*' }).Count | Should -Be 0
  }

  It 'waits for a run that is still going, which cannot be re-run yet, then re-runs its gate' {
    $script:runStatus = 'in_progress'
    Update-PipelineOwnerGate -Repository 'o/r' -Number 7 -ReviewState 'approved'
    $watch = [array]::IndexOf($script:calls.ToArray(), 'run watch 5 -R o/r --interval 30')
    $rerun = [array]::IndexOf($script:calls.ToArray(), 'run rerun --job 41 -R o/r')
    $watch | Should -BeGreaterThan -1
    $rerun | Should -BeGreaterThan $watch
  }

  It 'does nothing when the review cannot change the verdict' {
    Update-PipelineOwnerGate -Repository 'o/r' -Number 7 -ReviewState 'commented'
    @($script:calls | Where-Object { $_ -like 'run rerun*' }).Count | Should -Be 0
  }

  It 'does nothing when the head commit has no pull request run yet' {
    $script:runs = '[]'
    Update-PipelineOwnerGate -Repository 'o/r' -Number 7 -ReviewState 'approved'
    @($script:calls | Where-Object { $_ -like 'run view*' -or $_ -like 'run rerun*' }).Count | Should -Be 0
  }
}

Describe 'Invoke-Gh' {
  It 'returns what gh prints' {
    Invoke-Gh -Arguments @('--version') | Should -Not -BeNullOrEmpty
  }

  It 'throws when gh fails, naming the command' {
    { Invoke-Gh -Arguments @('no-such-command', 'x') } | Should -Throw '*gh no-such-command x failed*'
  }

  It 'names a one-word command that fails' {
    { Invoke-Gh -Arguments @('no-such-command') } | Should -Throw '*gh no-such-command failed*'
  }
}

Describe 'the re-check, run as the workflow runs it' {
  It 're-checks the pull request it is given, with the review state' {
    $global:PipelineOwnerRecheckCalls = [System.Collections.Generic.List[string]]::new()
    Mock gh {
      $line = $args -join ' '
      $global:PipelineOwnerRecheckCalls.Add($line)
      $global:LASTEXITCODE = 0
      if ($line -like 'pr view 7 *') { return 'abc123' }
      if ($line -like 'run list *') { return '[]' }
    }
    & (Join-Path $PSScriptRoot '..' 'Invoke-PipelineOwnerRecheck.ps1') -Repository o/r -Number 7 -ReviewState approved 6>$null
    $global:PipelineOwnerRecheckCalls | Should -Contain 'pr view 7 -R o/r --json headRefOid --jq .headRefOid'
    @($global:PipelineOwnerRecheckCalls | Where-Object { $_ -like 'run list *--commit abc123*' }).Count | Should -Be 1
  }

  # The mock runs in the invoked script's scope, so the calls it records are kept in a global, removed here.
  AfterAll { Remove-Variable -Name PipelineOwnerRecheckCalls -Scope Global -ErrorAction SilentlyContinue }
}
