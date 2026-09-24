[CmdletBinding()]
param(
    [switch]$AllowRemote,
    [string]$ConfirmRemote
)

$ErrorActionPreference = 'Stop'
$ApiBase = if ($env:CLIPBOARD_VISION_API_BASE) { $env:CLIPBOARD_VISION_API_BASE } else { 'http://127.0.0.1:11434/v1' }
$Model = $env:CLIPBOARD_VISION_MODEL
$ApiKey = $env:CLIPBOARD_VISION_API_KEY
$MaxBytes = if ($env:CLIPBOARD_VISION_MAX_BYTES) { [long]$env:CLIPBOARD_VISION_MAX_BYTES } else { 10485760 }

if (-not $Model) { throw 'CLIPBOARD_VISION_MODEL is required' }
if ($MaxBytes -le 0) { throw 'CLIPBOARD_VISION_MAX_BYTES must be positive' }
$Endpoint = $null
if (-not [Uri]::TryCreate($ApiBase, [UriKind]::Absolute, [ref]$Endpoint) -or
    -not $Endpoint.IsAbsoluteUri -or
    $Endpoint.Scheme -notin @('http', 'https') -or
    $Endpoint.UserInfo.Length -ne 0 -or
    $Endpoint.Query.Length -ne 0 -or
    $Endpoint.Fragment.Length -ne 0) {
    throw 'CLIPBOARD_VISION_API_BASE must be an absolute HTTP(S) URI without credentials'
}
$Address = $null
$LiteralAddress = [Net.IPAddress]::TryParse($Endpoint.Host.Trim('[', ']'), [ref]$Address)
$Loopback = $LiteralAddress -and [Net.IPAddress]::IsLoopback($Address)
$NormalizedHost = $Endpoint.Host.Trim('[', ']').ToLowerInvariant()
$EffectivePort = if ($Endpoint.IsDefaultPort) { if ($Endpoint.Scheme -eq 'https') { 443 } else { 80 } } else { $Endpoint.Port }
$DisplayHost = if ($NormalizedHost.Contains(':')) { "[$NormalizedHost]" } else { $NormalizedHost }
$BasePath = $Endpoint.AbsolutePath.TrimEnd('/')
$EffectiveEndpoint = "$($Endpoint.Scheme.ToLowerInvariant())://$DisplayHost`:$EffectivePort$BasePath/chat/completions"
if (-not $Loopback) {
    $ConsentBytes = [Text.Encoding]::UTF8.GetBytes("$EffectiveEndpoint`n$Model")
    $Hasher = [Security.Cryptography.SHA256]::Create()
    try { $ExpectedConfirmation = ([BitConverter]::ToString($Hasher.ComputeHash($ConsentBytes))).Replace('-', '').ToLowerInvariant() } finally { $Hasher.Dispose() }
    [Console]::Error.WriteLine("Remote disclosure: clipboard image data will be sent to $EffectiveEndpoint using model $Model.")
    [Console]::Error.WriteLine("Confirmation token for this canonical endpoint and model: $ExpectedConfirmation")
    if (-not $AllowRemote -or $ConfirmRemote -cne $ExpectedConfirmation) {
        throw 'Remote endpoint requires -AllowRemote and the disclosed -ConfirmRemote token'
    }
}

$TempDirectory = Join-Path ([IO.Path]::GetTempPath()) ("clipboard-vision-" + [Guid]::NewGuid())
$ImagePath = Join-Path $TempDirectory 'clipboard.png'
try {
    New-Item -ItemType Directory -Path $TempDirectory | Out-Null
    if ($env:CLIPBOARD_VISION_TEST_IMAGE) {
        Copy-Item -LiteralPath $env:CLIPBOARD_VISION_TEST_IMAGE -Destination $ImagePath
    } else {
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $Image = [Windows.Forms.Clipboard]::GetImage()
        if ($null -eq $Image) { throw 'Clipboard does not contain an image' }
        try { $Image.Save($ImagePath, [Drawing.Imaging.ImageFormat]::Png) } finally { $Image.Dispose() }
    }
    if ((Get-Item $ImagePath).Length -gt $MaxBytes) { throw "Clipboard image exceeds $MaxBytes bytes" }

    $Encoded = [Convert]::ToBase64String([IO.File]::ReadAllBytes($ImagePath))
    $Body = @{
        model = $Model
        messages = @(@{ role = 'user'; content = @(
            @{ type = 'text'; text = 'Describe this clipboard image.' },
            @{ type = 'image_url'; image_url = @{ url = "data:image/png;base64,$Encoded" } }
        ) })
    } | ConvertTo-Json -Depth 8 -Compress
    $Headers = @{}
    if ($ApiKey) { $Headers.Authorization = "Bearer $ApiKey" }
    try {
        if ($env:CLIPBOARD_VISION_TEST_HTTP_CAPTURE) {
            Set-Content -LiteralPath $env:CLIPBOARD_VISION_TEST_HTTP_CAPTURE -Value $Body -Encoding utf8
            if ($env:CV_TEST_HTTP_FAILURE) { throw 'test HTTP failure body secret' }
            if ($env:CV_TEST_MALFORMED_JSON) { $Response = $null }
            elseif ($env:CV_TEST_NON_STRING) { $Response = @{ choices = @(@{ message = @{ content = @{ value = 1 } } }) } }
            else { $Response = @{ choices = @(@{ message = @{ content = 'test description' } }) } }
        } else {
            $Response = Invoke-RestMethod -Method Post -Uri $EffectiveEndpoint -Headers $Headers -ContentType 'application/json' -Body $Body -MaximumRedirection 0
        }
    } catch {
        throw 'Vision API request failed (response body redacted)'
    }
    $Result = $Response.choices[0].message.content
    if ($Result -isnot [string]) { throw 'Invalid vision API response (body redacted)' }
    $Result
} finally {
    Remove-Item -LiteralPath $TempDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
