# describe-clipboard.ps1
# Reads image from clipboard, sends to vision model API, writes description to stdout.
# API key is read from CLIPBOARD_VISION_API_KEY environment variable.
# WARNING: Do not enable -Verbose or Set-PSDebug -Trace 2 — the API key would be logged.
param(
    [string]$OutputFile = "$env:TEMP\clipboard_desc.txt"
)

$ErrorActionPreference = "Stop"

# Platform guard
if (-not $IsWindows) {
    Write-Host "ERROR: This script requires Windows (uses .NET System.Windows.Forms)"
    exit 1
}

$apiKey = $env:CLIPBOARD_VISION_API_KEY
if (-not $apiKey) {
    Write-Host "ERROR: CLIPBOARD_VISION_API_KEY environment variable not set"
    exit 1
}

$tempPng = $null
$img = $null

try {
    # --- Read clipboard image ---
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
    Add-Type -AssemblyName System.Drawing -ErrorAction Stop

    $img = [System.Windows.Forms.Clipboard]::GetImage()
    if (-not $img) {
        Write-Host "ERROR: No image found in clipboard"
        exit 1
    }

    # Save to temp PNG
    $tempPng = Join-Path $env:TEMP "clipboard_$(Get-Date -Format 'yyyyMMdd_HHmmss').png"
    $img.Save($tempPng, [System.Drawing.Imaging.ImageFormat]::Png)

    # Convert to base64
    $bytes = [System.IO.File]::ReadAllBytes($tempPng)
    $base64 = [System.Convert]::ToBase64String($bytes)

    # --- Build API request ---
    $apiBase = "https://lab.iwhalecloud.com/gpt-proxy"
    $model = "LOCAL/Qwen3.5-122B-A10B"

    $body = @{
        model = $model
        messages = @(
            @{
                role = "user"
                content = @(
                    @{
                        type = "text"
                        text = "Describe this image in detail. Include all visible text, UI elements, code, error messages, objects, people, and any information conveyed. Be specific and thorough but concise. If it contains code or terminal output, quote it exactly."
                    },
                    @{
                        type = "image_url"
                        image_url = @{
                            url = "data:image/png;base64,$base64"
                        }
                    }
                )
            }
        )
        max_tokens = 1024
        temperature = 0.1
    } | ConvertTo-Json -Depth 5

    # --- Call API ---
    $response = Invoke-RestMethod -Uri "$apiBase/chat/completions" `
        -Method Post `
        -Headers @{
            "Authorization" = "Bearer $apiKey"
            "Content-Type"  = "application/json"
        } `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) `
        -TimeoutSec 30

    # Validate response structure
    if (-not $response.choices -or -not $response.choices[0].message -or -not $response.choices[0].message.content) {
        Write-Host "ERROR: Unexpected API response structure"
        Write-Host "Response: $($response | ConvertTo-Json -Compress -Depth 2)"
        exit 1
    }

    $description = $response.choices[0].message.content
} catch {
    Write-Host "ERROR: $_"
    exit 1
} finally {
    # Cleanup temp file and GDI+ handle
    if ($tempPng -and (Test-Path $tempPng)) {
        Remove-Item $tempPng -Force -ErrorAction SilentlyContinue
    }
    if ($img) {
        $img.Dispose()
    }
}

if (-not $description) {
    Write-Host "ERROR: Empty response from vision model"
    exit 1
}

# Write to output file
$description | Out-File -FilePath $OutputFile -Encoding UTF8 -Force

# Output to stdout
Write-Host "Clipboard image description saved to: $OutputFile"
Write-Host "---"
Write-Host $description
Write-Host "---"
