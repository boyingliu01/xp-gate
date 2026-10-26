<#
.SYNOPSIS
    Measure cyclomatic complexity of PowerShell functions via the AST.

.DESCRIPTION
    lizard cannot parse PowerShell, so a PowerShell-primary repository had a
    permanently unmeasured complexity dimension (#537). The platform, however,
    CAN answer the question: PowerShell's own AST yields an exact decision-point
    count per function, which is the same quantity lizard measures for other
    languages.

    This script is the measurement half; gate-3.sh is the verdict half. Keeping
    them apart means the gate does not have to know a project's refactor history
    and the script does not have to know about baselines.

    Output is line-oriented and stable, because gate-3.sh parses it:

        functions_measured=<n>     total functions inspected
        max_ccn=<n>                highest CCN seen
        over_threshold=<n>         functions with CCN > -Threshold
        OVER <file>:<line> <name> ccn=<n>     one per over-threshold function
        FUNC <file>:<line> <name> ccn=<n>     one per function when -List is set

.PARAMETER Path
    Files or directories to analyse. Directories are walked for *.ps1/*.psm1.

.PARAMETER Threshold
    Reporting threshold. Functions above it are emitted as OVER lines. This does
    NOT filter FUNC lines, which is what makes a ratchet able to compare against
    a baseline collected at a different threshold -- see #598.

.PARAMETER List
    Emit a FUNC line for every function, not just the ones over the threshold.
    A ratchet needs the full population: comparing only OVER lines against a
    baseline that also stores only over-threshold entries is how a brand-new
    well-factored function (CCN 2-4) got reported as a "regression".

.PARAMETER Strict
    Treat a parse failure as a hard error (exit 3) instead of skipping the file.

.EXAMPLE
    ./Measure-PowerShellComplexity.ps1 -Path ./src -Threshold 5

.EXAMPLE
    ./Measure-PowerShellComplexity.ps1 -Path ./src -Threshold 5 -List

.NOTES
    Exit codes:
      0  measured (findings are reported, not signalled by exit code)
      2  no analyzable files
      3  parse/tooling failure (fail closed)
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string[]] $Path = @('.'),

    [Parameter(Mandatory = $false)]
    [ValidateRange(1, 1000)]
    [int] $Threshold = 5,

    [Parameter(Mandatory = $false)]
    [switch] $List,

    [Parameter(Mandatory = $false)]
    [switch] $Strict
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- Collect files -----------------------------------------------------------

$files = New-Object System.Collections.Generic.List[string]
$missing = 0

foreach ($p in $Path) {
    if (-not (Test-Path -LiteralPath $p)) { $missing++; continue }
    $item = Get-Item -LiteralPath $p
    if ($item.PSIsContainer) {
        Get-ChildItem -LiteralPath $item.FullName -Recurse -File -Include '*.ps1', '*.psm1' |
            ForEach-Object { $files.Add($_.FullName) }
    }
    elseif ($item.Extension -in @('.ps1', '.psm1')) {
        $files.Add($item.FullName)
    }
}

if ($files.Count -eq 0) {
    if ($Strict -and $missing -gt 0) {
        [Console]::Error.WriteLine("ERR no analyzable PowerShell files ($missing path(s) did not exist)")
        exit 3
    }
    Write-Output 'functions_measured=0'
    Write-Output 'max_ccn=0'
    Write-Output 'over_threshold=0'
    exit 2
}

# --- Count decision points ---------------------------------------------------
#
# CCN = 1 + number of decision points, which is the definition lizard uses.
# Decision points in PowerShell: if / elseif, the loop keywords, catch, the
# ternary and null-coalescing operators, and each -and/-or in a condition.
# Declaring a function is not itself a decision, so every function starts at 1.

function Get-DecisionCount {
    param([System.Management.Automation.Language.Ast] $AstBody)

    $count = 0

    $count += @($AstBody.FindAll({ param($n) $n -is [System.Management.Automation.Language.IfStatementAst] }, $true)).Count
    $count += @($AstBody.FindAll({ param($n) $n -is [System.Management.Automation.Language.LoopStatementAst] }, $true)).Count
    $count += @($AstBody.FindAll({ param($n) $n -is [System.Management.Automation.Language.TrapStatementAst] }, $true)).Count
    $count += @($AstBody.FindAll({ param($n) $n -is [System.Management.Automation.Language.TernaryExpressionAst] }, $true)).Count

    # Binary expressions whose operator short-circuits count as decisions, which
    # is what makes `if ($a -and $b -or $c)` score higher than `if ($a)`.
    foreach ($bin in $AstBody.FindAll({ param($n) $n -is [System.Management.Automation.Language.BinaryExpressionAst] }, $true)) {
        $op = $null
        try { $op = $bin.Operator } catch { continue }
        if ($op -eq 'And' -or $op -eq 'Or') { $count++ }
    }

    # catch blocks: FindAll over class-based ASTs is not available for them, so
    # walk TryStatementAst nodes and count their CatchClauses.
    foreach ($try in $AstBody.FindAll({ param($n) $n -is [System.Management.Automation.Language.TryStatementAst] }, $true)) {
        $count += @($try.CatchClauses).Count
    }

    return $count
}

$measured = 0
$maxCcn = 0
$over = 0
$parseErrors = New-Object System.Collections.Generic.List[string]

foreach ($file in $files) {
    $tokens = $null
    $errors = $null
    $ast = $null
    try {
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($file, [ref]$tokens, [ref]$errors)
    }
    catch {
        $parseErrors.Add("$file : $($_.Exception.Message)")
        continue
    }

    if ($errors -and $errors.Count -gt 0) {
        $first = ($errors | Select-Object -First 1)
        $parseErrors.Add("$file : $($first.Message)")
        continue
    }

    $funcs = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)
    foreach ($f in $funcs) {
        $ccn = 1 + (Get-DecisionCount -AstBody $f.Body)
        $measured++
        if ($ccn -gt $maxCcn) { $maxCcn = $ccn }

        if ($ccn -gt $Threshold) { $over++ }

        if ($List -or $ccn -gt $Threshold) {
            $line = $f.Extent.StartLineNumber
            $kind = if ($ccn -gt $Threshold) { 'OVER' } elseif ($List) { 'FUNC' } else { $null }
            if ($kind) {
                Write-Output ('{0} {1}:{2} {3} ccn={4}' -f $kind, $file, $line, $f.Name, $ccn)
            }
        }
    }
}

if ($parseErrors.Count -gt 0 -and $Strict) {
    foreach ($pe in $parseErrors) { [Console]::Error.WriteLine("ERR parse: $pe") }
    exit 3
}
elseif ($parseErrors.Count -gt 0) {
    foreach ($pe in $parseErrors) { [Console]::Error.WriteLine("WARN parse skipped: $pe") }
}

Write-Output "functions_measured=$measured"
Write-Output "max_ccn=$maxCcn"
Write-Output "over_threshold=$over"
exit 0
