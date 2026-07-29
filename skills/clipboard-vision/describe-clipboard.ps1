# describe-clipboard.ps1
# Reads image from clipboard, sends to vision model API, writes description to stdout
param(
    [string]$OutputFile = "$env:TEMP\clipboard_desc.txt"
)

$ErrorActionPreference = "Stop"

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

# Remove temp file
Remove-Item $tempPng -Force -ErrorAction SilentlyContinue

# --- Build API request ---
$apiKey = "ailab_YL+F7NNalGHNiJUHB46TaCAiMPJk2Q9PrgOcdm2aSqbEHUtxgnQjudORt2Z5BxP2BZ/qMmtBdRHHxCg6rcDlWf+CpV6em2iubEdJzVy5AiDQ"
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
try {
    $response = Invoke-RestMethod -Uri "$apiBase/chat/completions" `
        -Method Post `
        -Headers @{
            "Authorization" = "Bearer $apiKey"
            "Content-Type"  = "application/json"
        } `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) `
        -TimeoutSec 30

    $description = $response.choices[0].message.content
} catch {
    Write-Host "ERROR: API call failed: $_"
    exit 1
}

if (-not $description) {
    Write-Host "ERROR: Empty response from vision model"
    exit 1
}

# Write to output file
$description | Out-File -FilePath $OutputFile -Encoding UTF8 -Force

# Also output to stdout
Write-Host "Clipboard image description saved to: $OutputFile"
Write-Host "---"
Write-Host $description
Write-Host "---"
