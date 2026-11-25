#Requires -Modules Pester

BeforeAll {
  . (Join-Path -Path $PSScriptRoot -ChildPath '..' -AdditionalChildPath 'Test-PipelineOwner.ps1') -Repository o/r

  $script:Root = (Resolve-Path (Join-Path $PSScriptRoot '..' '..' '..')).Path
  $script:Team = '@whizbang-lib/build-admins'
  $script:Head = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
  $script:Older = '0123456789abcdef0123456789abcdef01234567'
  $script:Owners = ConvertFrom-CodeOwners -Lines @(
    '# a comment', '',
    '/.github/                   @whizbang-lib/build-admins',
    '/src/scripts/               @whizbang-lib/build-admins',
    '/package.json               @whizbang-lib/build-admins'
  )

  # A review as Read-PipelineOwnerPullRequest and Set-PipelineOwnerAuthority leave it.
  function New-TestReview {
    param([string]$Author = 'boss', [string]$State = 'APPROVED', [string]$CommitId = $script:Head,
      [string]$SubmittedAt = '2026-10-20T12:00:00Z', [string]$AuthorRole = 'admin')
    [pscustomobject]@{ Author = $Author; State = $State; CommitId = $CommitId; SubmittedAt = [datetimeoffset]$SubmittedAt
      AuthorRole = $AuthorRole }
  }

  # A pull request as Read-PipelineOwnerPullRequest returns it, roles filled in. Tests override from here.
  function New-TestPullRequest {
    param(
        [int]$Number = 7,
        [string]$Author = 'dana',
        [bool]$AuthorIsBot = $false,
        [string]$AuthorRole = 'write',
        [string]$HeadSha = $script:Head,
        [string[]]$Files = @('.github/workflows/ci.yml'),
        [object[]]$Reviews = @()
    )
    [pscustomobject]@{ Number = $Number; Author = $Author; AuthorIsBot = $AuthorIsBot; AuthorRole = $AuthorRole
      HeadSha = $HeadSha; Files = $Files; Reviews = $Reviews }
  }

  function Get-TestVerdict { param($PullRequest) Get-PipelineOwnerVerdict -PullRequest $PullRequest -CodeOwners $script:Owners -Owner $script:Team }
}

Describe 'Get-PipelineOwnerVerdict' {
  It 'passes a pull request that changes no file build admins own, whoever opened it' {
    $v = Get-TestVerdict (New-TestPullRequest -AuthorRole 'read' -Files @('src/assets/docs/v1.0.0/index.md', 'README.md'))
    $v.Pass | Should -BeTrue
    $v.Exempt | Should -BeFalse
    $v.OwnedFiles | Should -BeNullOrEmpty
    $v.Reason | Should -Match 'no file'
  }

  It 'passes a build admin''s own pipeline change with no review' {
    $v = Get-TestVerdict (New-TestPullRequest -Author 'boss' -AuthorRole 'admin')
    $v.Pass | Should -BeTrue
    $v.Reason | Should -Match 'build admin'
  }

  It 'fails a committer''s pipeline change with no review, naming the files and what it needs' {
    $v = Get-TestVerdict (New-TestPullRequest -Files @('.github/workflows/ci.yml', 'src/app/app.ts', 'package.json'))
    $v.Pass | Should -BeFalse
    $v.OwnedFiles | Should -Be @('.github/workflows/ci.yml', 'package.json')
    $v.Problems.Count | Should -Be 1
    $v.Problems[0] | Should -Match ([regex]::Escape('.github/workflows/ci.yml'))
    $v.Problems[0] | Should -Match ([regex]::Escape('package.json'))
    $v.Problems[0] | Should -Not -Match ([regex]::Escape('src/app/app.ts'))
    $v.Problems[0] | Should -Match 'build admin'
    $v.Problems[0] | Should -Match 'approv'
    $v.Problems[0] | Should -Match $script:Head.Substring(0, 7)
    $v.Problems[0] | Should -Not -Match '/recheck'
    $v.Problems[0] | Should -Match ([regex]::Escape('whizbang-lib/whizbang/blob/develop/GOVERNANCE.md#roles'))
  }

  It 'lists the first 20 owned files and counts the rest' {
    $files = @(1..23 | ForEach-Object { ".github/workflows/w$_.yml" })
    $v = Get-TestVerdict (New-TestPullRequest -Files $files)
    $v.OwnedFiles.Count | Should -Be 23
    $v.Problems[0] | Should -Match ([regex]::Escape('w20.yml'))
    $v.Problems[0] | Should -Not -Match ([regex]::Escape('w21.yml'))
    $v.Problems[0] | Should -Match 'and 3 more'
  }

  It 'shows a head commit id shorter than seven characters whole' {
    (Get-TestVerdict (New-TestPullRequest -HeadSha 'abc')).Problems[0] | Should -Match '\(abc\)'
  }

  It 'fails a maintainer''s pipeline change with no review: maintaining the code is not owning the pipeline' {
    (Get-TestVerdict (New-TestPullRequest -AuthorRole 'maintain')).Pass | Should -BeFalse
  }

  It 'fails a pipeline change from someone with no role on the repository' {
    (Get-TestVerdict (New-TestPullRequest -AuthorRole '')).Pass | Should -BeFalse
  }

  It 'passes a committer''s pipeline change a build admin approved on the current head' {
    $v = Get-TestVerdict (New-TestPullRequest -Reviews @(New-TestReview))
    $v.Pass | Should -BeTrue
    $v.Reason | Should -Match 'boss'
  }

  It 'fails when the build admin approved an earlier commit only' {
    $v = Get-TestVerdict (New-TestPullRequest -Reviews @(New-TestReview -CommitId $script:Older))
    $v.Pass | Should -BeFalse
    $v.Problems[0] | Should -Match 'earlier commit'
  }

  It 'fails when the only approval is from someone without the admin role' -TestCases @(
    @{ Role = 'write' }, @{ Role = 'maintain' }, @{ Role = '' }
  ) {
    (Get-TestVerdict (New-TestPullRequest -Reviews @(New-TestReview -Author 'kim' -AuthorRole $Role))).Pass | Should -BeFalse
  }

  It 'fails when a build admin requested changes' {
    (Get-TestVerdict (New-TestPullRequest -Reviews @(New-TestReview -State 'CHANGES_REQUESTED'))).Pass | Should -BeFalse
  }

  It 'fails when a build admin approved and then requested changes on the same head' {
    $reviews = @(
      (New-TestReview -State 'APPROVED' -SubmittedAt '2026-10-20T12:00:00Z'),
      (New-TestReview -State 'CHANGES_REQUESTED' -SubmittedAt '2026-10-20T13:00:00Z'))
    (Get-TestVerdict (New-TestPullRequest -Reviews $reviews)).Pass | Should -BeFalse
  }

  It 'fails when the build admin''s approval was dismissed' {
    (Get-TestVerdict (New-TestPullRequest -Reviews @(New-TestReview -State 'DISMISSED'))).Pass | Should -BeFalse
  }

  It 'keeps an approval when the build admin later only commented' {
    $reviews = @(
      (New-TestReview -State 'COMMENTED' -SubmittedAt '2026-10-20T13:00:00Z'),
      (New-TestReview -State 'APPROVED' -SubmittedAt '2026-10-20T12:00:00Z'))
    (Get-TestVerdict (New-TestPullRequest -Reviews $reviews)).Pass | Should -BeTrue
  }

  It 'passes when a build admin re-approved on the current head after approving an earlier commit' {
    $reviews = @(
      (New-TestReview -CommitId $script:Older -SubmittedAt '2026-10-20T11:00:00Z'),
      (New-TestReview -SubmittedAt '2026-10-20T12:00:00Z'))
    (Get-TestVerdict (New-TestPullRequest -Reviews $reviews)).Pass | Should -BeTrue
  }

  It 'exempts a pull request opened by a bot, as the linked-change gate does' {
    $v = Get-TestVerdict (New-TestPullRequest -Author 'dependabot[bot]' -AuthorIsBot $true -AuthorRole '')
    $v.Pass | Should -BeTrue
    $v.Exempt | Should -BeTrue
    $v.Reason | Should -Match 'bot'
  }

  It 'does not exempt a user whose login merely ends in [bot]' {
    (Get-TestVerdict (New-TestPullRequest -Author 'sneaky[bot]' -AuthorIsBot $false)).Pass | Should -BeFalse
  }
}

Describe 'Test-CodeOwnerMatch' {
  It 'matches <Path> against <Pattern>: <Expected>' -TestCases @(
    # A trailing slash is a directory, anchored by the leading slash: anything under it, at any depth.
    @{ Pattern = '/.github/'; Path = '.github/workflows/ci.yml'; Expected = $true }
    @{ Pattern = '/.github/'; Path = '.github/CODEOWNERS'; Expected = $true }
    @{ Pattern = '/src/scripts/'; Path = 'src/scripts/build.mjs'; Expected = $true }
    # A file merely named like the directory is not in it.
    @{ Pattern = '/rtd/'; Path = 'rtd'; Expected = $false }
    @{ Pattern = '/rtd/'; Path = 'rtd.md'; Expected = $false }
    @{ Pattern = '/.github/'; Path = '.github-old/ci.yml'; Expected = $false }
    # Anchored at the root: the same directory deeper down is not the owned one.
    @{ Pattern = '/src/scripts/'; Path = 'mcp-docs-server/src/scripts/x.mjs'; Expected = $false }
    @{ Pattern = '/.github/'; Path = 'mcp-docs-server/.github/x.yml'; Expected = $false }
    # An exact file, anchored at the root.
    @{ Pattern = '/package.json'; Path = 'package.json'; Expected = $true }
    @{ Pattern = '/package.json'; Path = 'mcp-docs-server/package.json'; Expected = $false }
    @{ Pattern = '/package.json'; Path = 'package.json.bak'; Expected = $false }
    @{ Pattern = '/tsconfig.json'; Path = 'mcp-docs-server/tsconfig.json'; Expected = $false }
    # A file pattern also owns a directory of that name, as git and GitHub read it.
    @{ Pattern = '/package.json'; Path = 'package.json/x'; Expected = $true }
    # Case matters, as on GitHub.
    @{ Pattern = '/package.json'; Path = 'Package.json'; Expected = $false }
    # With no leading slash and no inner slash, the name matches at any depth.
    @{ Pattern = 'BannedSymbols.txt'; Path = 'src/BannedSymbols.txt'; Expected = $true }
    @{ Pattern = 'tools/'; Path = 'a/tools/b.txt'; Expected = $true }
    # An inner slash anchors it like a leading one.
    @{ Pattern = 'docs/api/'; Path = 'docs/api/x.md'; Expected = $true }
    @{ Pattern = 'docs/api/'; Path = 'src/docs/api/x.md'; Expected = $false }
  ) {
    Test-CodeOwnerMatch -Pattern $Pattern -Path $Path | Should -Be $Expected
  }

  It 'refuses a wildcard pattern it cannot read, rather than owning too few files' -TestCases @(
    @{ Pattern = '*.yml' }, @{ Pattern = '/docs/**/x.md' }, @{ Pattern = '/a?.txt' }, @{ Pattern = '/[ab].txt' }
  ) {
    { Test-CodeOwnerMatch -Pattern $Pattern -Path 'x.yml' } | Should -Throw '*not supported*'
  }
}

Describe 'Get-OwnedFile' {
  It 'lets the last matching pattern decide, as GitHub does' {
    $owners = ConvertFrom-CodeOwners -Lines @(
      '/.github/              @whizbang-lib/build-admins',
      '/.github/ISSUE_TEMPLATE/ @whizbang-lib/maintainers')
    $owned = Get-OwnedFile -CodeOwners $owners -Owner $script:Team -Files @('.github/ISSUE_TEMPLATE/bug.yml', '.github/workflows/ci.yml')
    $owned | Should -Be @('.github/workflows/ci.yml')
  }

  It 'treats a pattern with no owner as unowning what it matches' {
    $owners = ConvertFrom-CodeOwners -Lines @('/.github/ @whizbang-lib/build-admins', '/.github/README.md')
    Get-OwnedFile -CodeOwners $owners -Owner $script:Team -Files @('.github/README.md') | Should -BeNullOrEmpty
  }

  It 'returns each owned file once' {
    Get-OwnedFile -CodeOwners $script:Owners -Owner $script:Team -Files @('package.json', 'package.json') | Should -Be @('package.json')
  }
}

Describe 'ConvertFrom-CodeOwners' {
  It 'reads patterns and owners, skipping comments and blank lines' {
    $script:Owners.Count | Should -Be 3
    $script:Owners[0].Pattern | Should -Be '/.github/'
    $script:Owners[0].Owners | Should -Be @('@whizbang-lib/build-admins')
  }

  It 'drops a trailing comment' {
    (ConvertFrom-CodeOwners -Lines @('/package.json  @whizbang-lib/build-admins  # the dependencies')).Owners | Should -Be @('@whizbang-lib/build-admins')
  }

  It 'reads the repository''s own CODEOWNERS, every pattern of which this gate can match' {
    $entries = ConvertFrom-CodeOwners -Lines (Get-Content (Join-Path $Root '.github' 'CODEOWNERS'))
    $entries.Count | Should -BeGreaterThan 0
    foreach ($e in $entries) { { Test-CodeOwnerMatch -Pattern $e.Pattern -Path 'x' } | Should -Not -Throw }
    Get-OwnedFile -CodeOwners $entries -Owner $script:Team -Files @('.github/workflows/ci.yml', 'src/scripts/build.mjs', 'pnpm-lock.yaml', 'rtd/build.py', 'src/assets/docs/v1.0.0/index.md', 'README.md') |
      Should -Be @('.github/workflows/ci.yml', 'src/scripts/build.mjs', 'pnpm-lock.yaml', 'rtd/build.py')
  }
}

Describe 'Set-PipelineOwnerAuthority' {
  It 'fills in the author''s and each reviewer''s role, asking once per login' {
    $script:asked = [System.Collections.Generic.List[string]]::new()
    $pr = New-TestPullRequest -AuthorRole '' -Reviews @(
      (New-TestReview -Author 'boss' -AuthorRole ''), (New-TestReview -Author 'boss' -AuthorRole '' -State 'COMMENTED'),
      (New-TestReview -Author 'kim' -AuthorRole ''))
    $roles = @{ dana = 'write'; boss = 'admin'; kim = 'maintain' }
    Set-PipelineOwnerAuthority -PullRequest $pr -RoleOf { param([string]$Login) $script:asked.Add($Login); $roles[$Login] }

    $pr.AuthorRole | Should -Be 'write'
    @($pr.Reviews.AuthorRole) | Should -Be @('admin', 'admin', 'maintain')
    @($script:asked) | Should -Be @('dana', 'boss', 'kim')
  }
}

Describe 'ConvertFrom-PipelineOwnerJson' {
  It 'reads the author, the head commit, the changed files (renamed from too) and the reviews' {
    $pull = '{"number":7,"user":{"login":"dana","type":"User"},"head":{"sha":"' + $script:Head + '"}}'
    $files = @('.github/workflows/ci.yml', 'docs/x.md', 'scripts/Old.ps1')
    $reviews = '[[{"user":{"login":"boss"},"state":"APPROVED","commit_id":"' + $script:Head + '","submitted_at":"2026-10-20T12:00:00Z"},' +
      '{"user":null,"state":"COMMENTED","commit_id":"' + $script:Head + '","submitted_at":"2026-10-20T12:30:00Z"}]]'
    $pr = ConvertFrom-PipelineOwnerJson -PullJson $pull -Files $files -ReviewsJson $reviews

    $pr.Number | Should -Be 7
    $pr.Author | Should -Be 'dana'
    $pr.AuthorIsBot | Should -BeFalse
    $pr.HeadSha | Should -Be $script:Head
    $pr.Files | Should -Be $files
    @($pr.Reviews).Count | Should -Be 1
    $pr.Reviews[0].Author | Should -Be 'boss'
    $pr.Reviews[0].State | Should -Be 'APPROVED'
    $pr.Reviews[0].CommitId | Should -Be $script:Head
  }

  It 'reads a review with no submission time as the oldest, and drops empty file names' {
    $pull = '{"number":7,"user":{"login":"dana","type":"User"},"head":{"sha":"' + $script:Head + '"}}'
    $reviews = '[[{"user":{"login":"boss"},"state":"PENDING","commit_id":"' + $script:Head + '","submitted_at":null}]]'
    $pr = ConvertFrom-PipelineOwnerJson -PullJson $pull -Files @('a.md', '') -ReviewsJson $reviews
    $pr.Reviews[0].SubmittedAt | Should -Be ([datetimeoffset]::MinValue)
    $pr.Files | Should -Be @('a.md')
  }

  It 'marks a bot author' {
    $pull = '{"number":8,"user":{"login":"dependabot[bot]","type":"Bot"},"head":{"sha":"' + $script:Head + '"}}'
    (ConvertFrom-PipelineOwnerJson -PullJson $pull -Files @() -ReviewsJson '[[]]').AuthorIsBot | Should -BeTrue
  }
}


Describe 'the check, run as the workflow runs it' {
  BeforeAll {
    $script:Check = Join-Path $PSScriptRoot '..' 'Test-PipelineOwner.ps1'
    $script:Owners = Join-Path $TestDrive 'CODEOWNERS'
    Set-Content -LiteralPath $script:Owners -Value '/.github/ @whizbang-lib/build-admins'

    # Runs the script in this process (so the gh mock applies), returning its exit code and output.
  function Invoke-Check { param([int]$Number = 7, [string]$CodeOwners = $script:Owners)
    $out = @(& $script:Check -Repository o/r -PullRequest $Number -CodeOwnersPath $CodeOwners 6>&1)
    [pscustomobject]@{ Exit = $LASTEXITCODE; Output = $out -join "`n" } }
  }

  BeforeEach {
    # What gh returns, by the start of its arguments; a key ending in '!' fails with exit 1.
    $global:PipelineOwnerTestGh = @{
      'api repos/o/r/pulls/7'                     = '{"number":7,"user":{"login":"dana","type":"User"},"head":{"sha":"' + $script:Head + '"}}'
      'api --paginate repos/o/r/pulls/7/files'    = '.github/workflows/ci.yml'
      'api --paginate --slurp repos/o/r/pulls/7/reviews' = '[[{"user":{"login":"boss"},"state":"APPROVED","commit_id":"' + $script:Head + '","submitted_at":"2026-10-20T12:00:00Z"}]]'
      'api repos/o/r/collaborators/dana/permission' = 'write'
      'api repos/o/r/collaborators/boss/permission' = 'admin'
    }
    $global:PipelineOwnerTestFailing = @()
    Mock gh {
      $line = $args -join ' '
      foreach ($key in $global:PipelineOwnerTestGh.Keys | Sort-Object -Property Length -Descending) {
        if ($line.StartsWith($key)) {
          $global:LASTEXITCODE = if ($global:PipelineOwnerTestFailing -contains $key) { 1 } else { 0 }
          return $global:PipelineOwnerTestGh[$key]
        }
      }
      $global:LASTEXITCODE = 1
    }
    $script:Summary = Join-Path $TestDrive 'summary.md'
    Remove-Item -LiteralPath $script:Summary -ErrorAction SilentlyContinue
    $env:GITHUB_STEP_SUMMARY = $null
  }

  # The mock runs in the invoked script's scope, so what it returns is kept in globals, removed here.
  AfterAll {
    $env:GITHUB_STEP_SUMMARY = $null
    Remove-Variable -Name PipelineOwnerTestGh, PipelineOwnerTestFailing -Scope Global -ErrorAction SilentlyContinue
  }


  It 'passes a pipeline change a build admin approved on its head, and writes the step summary' {
    $env:GITHUB_STEP_SUMMARY = $script:Summary
    $r = Invoke-Check
    $r.Exit | Should -Be 0
    $r.Output | Should -Match 'approved on its head commit by build admin boss'
    Get-Content -LiteralPath $script:Summary -Raw | Should -Match 'Pipeline owner: pull request #7'
  }

  It 'fails a pipeline change with no build admin approval, with an error line, and writes why to the summary' {
    $env:GITHUB_STEP_SUMMARY = $script:Summary
    $global:PipelineOwnerTestGh['api repos/o/r/collaborators/boss/permission'] = 'write'
    $r = Invoke-Check
    $r.Exit | Should -Be 1
    $r.Output | Should -Match 'Pipeline owner: failed'
    $r.Output | Should -Match '::error::Pull request #7 changes files'
    Get-Content -LiteralPath $script:Summary -Raw | Should -Match '- Pull request #7'
  }

  It 'reports a bot''s pull request as exempt' {
    $global:PipelineOwnerTestGh['api repos/o/r/pulls/7'] = '{"number":7,"user":{"login":"dependabot[bot]","type":"Bot"},"head":{"sha":"' + $script:Head + '"}}'
    $r = Invoke-Check
    $r.Exit | Should -Be 0
    $r.Output | Should -Match 'Pipeline owner: exempt'
  }

  It 'reads a reviewer who is not a collaborator as having no role' {
    $global:PipelineOwnerTestFailing = @('api repos/o/r/collaborators/boss/permission')
    (Invoke-Check).Exit | Should -Be 1
  }

  It 'fails, saying why, when there is no pull request number' {
    $r = Invoke-Check -Number 0
    $r.Exit | Should -Be 1
    $r.Output | Should -Match 'No pull request to check'
  }

  It 'fails, saying why, when there is no CODEOWNERS file' {
    $r = Invoke-Check -CodeOwners (Join-Path $TestDrive 'missing')
    $r.Exit | Should -Be 1
    $r.Output | Should -Match 'No CODEOWNERS file'
  }

  It 'fails when the pull request, its files or its reviews cannot be read' -TestCases @(
    @{ Key = 'api repos/o/r/pulls/7'; What = 'Reading pull request #7 failed' }
    @{ Key = 'api --paginate repos/o/r/pulls/7/files'; What = 'Reading the files of pull request #7 failed' }
    @{ Key = 'api --paginate --slurp repos/o/r/pulls/7/reviews'; What = 'Reading the reviews of pull request #7 failed' }
  ) {
    $global:PipelineOwnerTestFailing = @($Key)
    $r = Invoke-Check
    $r.Exit | Should -Be 1
    $r.Output | Should -Match ([regex]::Escape("::error::$What"))
  }
}
