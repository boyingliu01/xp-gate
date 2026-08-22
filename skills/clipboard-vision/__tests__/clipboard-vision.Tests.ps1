# @test REQ-379 Windows privacy-safe clipboard vision
# @intent Verify bound remote consent and redirect blocking on Windows CI
# @covers AC-379-02, AC-379-03, AC-379-06

$ScriptPath = Join-Path $PSScriptRoot '..\scripts\clipboard-vision.ps1'
$Content = Get-Content -LiteralPath $ScriptPath -Raw

if ($Content -match '\$Output|Set-Content.*Result') { throw 'No output parameter: output persistence remains' }
if ($Content -match 'Output') { throw 'No output parameter: output persistence remains' }

if ($Content -notmatch 'MaximumRedirection\s+0') { throw 'PowerShell HTTP redirects are not disabled' }
if ($Content -notmatch 'SHA256') { throw 'PowerShell remote consent is not destination-bound' }
if ($Content -notmatch 'CLIPBOARD_VISION_TEST_IMAGE') { throw 'Windows CI clipboard seam is missing' }
if ($Content -notmatch 'CLIPBOARD_VISION_TEST_HTTP_CAPTURE') { throw 'Windows CI HTTP seam is missing' }

$Fixture = Join-Path ([IO.Path]::GetTempPath()) ("clipboard-vision-pester-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $Fixture | Out-Null
try {
    $ImagePath = Join-Path $Fixture 'clipboard.png'
    $CapturePath = Join-Path $Fixture 'request.json'
    [IO.File]::WriteAllBytes($ImagePath, [byte[]](137, 80, 78, 71, 13, 10, 26, 10))
    $env:CLIPBOARD_VISION_TEST_IMAGE = $ImagePath
    $env:CLIPBOARD_VISION_TEST_HTTP_CAPTURE = $CapturePath
    $env:CLIPBOARD_VISION_API_BASE = 'https://VISION.Example.Test/v1'
    $env:CLIPBOARD_VISION_MODEL = 'windows-fixture-model'

    foreach ($InvalidBase in @('relative/path', 'ftp://vision.example.test/v1', 'file:///tmp/vision', 'https://user:secret@vision.example.test/v1')) {
        $env:CLIPBOARD_VISION_API_BASE = $InvalidBase
        $Rejected = $false
        $Disclosure = ''
        try { $Disclosure = (& $ScriptPath -AllowRemote -ConfirmRemote 'unused' 2>&1 | Out-String) } catch { $Rejected = $true }
        if (-not $Rejected -or (Test-Path $CapturePath)) { throw "Invalid API base reached a test seam: $InvalidBase" }
        if ($Disclosure -match 'Remote disclosure') { throw "Invalid API base was disclosed before rejection: $InvalidBase" }
    }
    $env:CLIPBOARD_VISION_API_BASE = 'https://VISION.Example.Test/v1'

    foreach ($ChangedBase in @('http://vision.example.test/v1', 'https://vision.example.test:8443/v1', 'https://vision.example.test/other')) {
        $env:CLIPBOARD_VISION_API_BASE = $ChangedBase
        $Rejected = $false
        try { & $ScriptPath -AllowRemote -ConfirmRemote 'stale-token' 2>$null } catch { $Rejected = $true }
        if (-not $Rejected -or (Test-Path $CapturePath)) { throw "Changed endpoint reached the HTTP seam: $ChangedBase" }
    }
    $env:CLIPBOARD_VISION_API_BASE = 'https://VISION.Example.Test/v1'

    $Rejected = $false
    try { & $ScriptPath -AllowRemote -ConfirmRemote 'stale-token' 2>$null } catch { $Rejected = $true }
    if (-not $Rejected -or (Test-Path $CapturePath)) { throw 'Stale confirmation reached the HTTP seam' }

    $ConsentBytes = [Text.Encoding]::UTF8.GetBytes("https://vision.example.test:443/v1/chat/completions`nwindows-fixture-model")
    $Hasher = [Security.Cryptography.SHA256]::Create()
    try { $Token = ([BitConverter]::ToString($Hasher.ComputeHash($ConsentBytes))).Replace('-', '').ToLowerInvariant() } finally { $Hasher.Dispose() }
    $Result = & $ScriptPath -AllowRemote -ConfirmRemote $Token 2>$null
    if ($Result -ne 'test description') { throw 'Bound confirmation did not complete one-shot analysis' }
    if (-not (Test-Path $CapturePath)) { throw 'HTTP seam did not capture the request' }

    Remove-Item -LiteralPath $CapturePath
    $env:CV_TEST_MALFORMED_JSON = '1'
    $Rejected = $false
    try { & $ScriptPath -AllowRemote -ConfirmRemote $Token 2>$null } catch { $Rejected = $true }
    if (-not $Rejected) { throw 'Malformed response was accepted' }
    Remove-Item Env:CV_TEST_MALFORMED_JSON

    $env:CV_TEST_NON_STRING = '1'
    $Rejected = $false
    try { & $ScriptPath -AllowRemote -ConfirmRemote $Token 2>$null } catch { $Rejected = $true }
    if (-not $Rejected) { throw 'Non-string response was accepted' }
    Remove-Item Env:CV_TEST_NON_STRING

    $env:CV_TEST_HTTP_FAILURE = '1'
    $Failure = ''
    try { & $ScriptPath -AllowRemote -ConfirmRemote $Token 2>&1 } catch { $Failure = $_.Exception.Message }
    if ($Failure -notmatch 'redacted' -or $Failure -match 'secret') { throw 'HTTP failure was not redacted' }
    Remove-Item Env:CV_TEST_HTTP_FAILURE

    $env:CLIPBOARD_VISION_MAX_BYTES = '4'
    $Rejected = $false
    try { & $ScriptPath -AllowRemote -ConfirmRemote $Token 2>$null } catch { $Rejected = $true }
    if (-not $Rejected) { throw 'Oversized image was accepted' }
    Remove-Item Env:CLIPBOARD_VISION_MAX_BYTES

    $OutputPath = Join-Path $Fixture 'result.txt'
    $Rejected = $false
    try { & $ScriptPath -AllowRemote -ConfirmRemote $Token -Output $OutputPath 2>$null } catch { $Rejected = $true }
    if (-not $Rejected -or (Test-Path $OutputPath)) { throw 'No output parameter: persistence option was accepted' }

    $env:CLIPBOARD_VISION_API_BASE = 'http://localhost:11434/v1'
    $Rejected = $false
    try { & $ScriptPath 2>$null } catch { $Rejected = $true }
    if (-not $Rejected) { throw 'localhost was trusted as literal loopback' }
    foreach ($LoopbackBase in @('http://127.9.8.7:11434/v1', 'http://[::1]:11434/v1')) {
        $env:CLIPBOARD_VISION_API_BASE = $LoopbackBase
        $Result = & $ScriptPath 2>$null
        if ($Result -ne 'test description') { throw "Literal loopback failed: $LoopbackBase" }
    }
} finally {
    Remove-Item Env:CLIPBOARD_VISION_TEST_IMAGE -ErrorAction SilentlyContinue
    Remove-Item Env:CLIPBOARD_VISION_TEST_HTTP_CAPTURE -ErrorAction SilentlyContinue
    Remove-Item Env:CLIPBOARD_VISION_API_BASE -ErrorAction SilentlyContinue
    Remove-Item Env:CLIPBOARD_VISION_MODEL -ErrorAction SilentlyContinue
    Remove-Item Env:CLIPBOARD_VISION_MAX_BYTES -ErrorAction SilentlyContinue
    Remove-Item Env:CV_TEST_MALFORMED_JSON -ErrorAction SilentlyContinue
    Remove-Item Env:CV_TEST_NON_STRING -ErrorAction SilentlyContinue
    Remove-Item Env:CV_TEST_HTTP_FAILURE -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $Fixture -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output 'clipboard-vision PowerShell behavior passed'
