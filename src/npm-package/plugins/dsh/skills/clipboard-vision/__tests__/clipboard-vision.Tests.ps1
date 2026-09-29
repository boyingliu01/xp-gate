# @test REQ-379 Windows privacy-safe clipboard vision
# @intent Verify bound remote consent and redirect blocking on Windows CI
# @covers AC-379-02, AC-379-03, AC-379-06

Describe 'clipboard-vision PowerShell behavior' {
    BeforeAll {
        $ScriptPath = Join-Path $PSScriptRoot '..\scripts\clipboard-vision.ps1'
        $Fixture = Join-Path ([IO.Path]::GetTempPath()) ("clipboard-vision-pester-" + [Guid]::NewGuid())
        $ImagePath = Join-Path $Fixture 'clipboard.png'
        $CapturePath = Join-Path $Fixture 'request.json'
        New-Item -ItemType Directory -Path $Fixture | Out-Null
        [IO.File]::WriteAllBytes($ImagePath, [byte[]](137, 80, 78, 71, 13, 10, 26, 10))
        $env:CLIPBOARD_VISION_TEST_IMAGE = $ImagePath
        $env:CLIPBOARD_VISION_TEST_HTTP_CAPTURE = $CapturePath
        $env:CLIPBOARD_VISION_MODEL = 'windows-fixture-model'

        $ConsentBytes = [Text.Encoding]::UTF8.GetBytes("https://vision.example.test:443/v1/chat/completions`nwindows-fixture-model")
        $Hasher = [Security.Cryptography.SHA256]::Create()
        try {
            $Token = ([BitConverter]::ToString($Hasher.ComputeHash($ConsentBytes))).Replace('-', '').ToLowerInvariant()
        } finally {
            $Hasher.Dispose()
        }
    }

    BeforeEach {
        Remove-Item -LiteralPath $CapturePath -ErrorAction SilentlyContinue
        Remove-Item Env:CLIPBOARD_VISION_MAX_BYTES -ErrorAction SilentlyContinue
        Remove-Item Env:CV_TEST_MALFORMED_JSON -ErrorAction SilentlyContinue
        Remove-Item Env:CV_TEST_NON_STRING -ErrorAction SilentlyContinue
        Remove-Item Env:CV_TEST_HTTP_FAILURE -ErrorAction SilentlyContinue
        $env:CLIPBOARD_VISION_API_BASE = 'https://VISION.Example.Test/v1'
    }

    AfterAll {
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

    It 'rejects invalid endpoints before disclosure or HTTP capture' {
        foreach ($InvalidBase in @(
            'relative/path',
            'ftp://vision.example.test/v1',
            'file:///tmp/vision',
            'https://user:secret@vision.example.test/v1'
        )) {
            $env:CLIPBOARD_VISION_API_BASE = $InvalidBase
            $Disclosure = { & $ScriptPath -AllowRemote -ConfirmRemote 'unused' 2>&1 | Out-String }
            $Disclosure | Should -Throw
            Test-Path $CapturePath | Should -BeFalse
            try { & $Disclosure | Out-Null } catch { $_.Exception.Message | Should -Not -Match 'Remote disclosure' }
        }
    }

    It 'rejects stale consent after endpoint scheme port or path changes' {
        foreach ($ChangedBase in @(
            'http://vision.example.test/v1',
            'https://vision.example.test:8443/v1',
            'https://vision.example.test/other'
        )) {
            $env:CLIPBOARD_VISION_API_BASE = $ChangedBase
            { & $ScriptPath -AllowRemote -ConfirmRemote $Token 2>$null } | Should -Throw
            Test-Path $CapturePath | Should -BeFalse
        }
    }

    It 'rejects an unrelated stale confirmation token' {
        { & $ScriptPath -AllowRemote -ConfirmRemote 'stale-token' 2>$null } | Should -Throw
        Test-Path $CapturePath | Should -BeFalse
    }

    It 'returns the successful response and captures one request' {
        $Result = & $ScriptPath -AllowRemote -ConfirmRemote $Token 2>$null

        $Result | Should -BeExactly 'test description'
        Test-Path $CapturePath | Should -BeTrue
        (Get-Content -LiteralPath $CapturePath -Raw) | Should -Match 'windows-fixture-model'
    }

    It 'rejects malformed and non-string responses' {
        $env:CV_TEST_MALFORMED_JSON = '1'
        { & $ScriptPath -AllowRemote -ConfirmRemote $Token 2>$null } | Should -Throw
        Remove-Item Env:CV_TEST_MALFORMED_JSON

        $env:CV_TEST_NON_STRING = '1'
        { & $ScriptPath -AllowRemote -ConfirmRemote $Token 2>$null } | Should -Throw '*redacted*'
    }

    It 'redacts HTTP failures without exposing the secret response body' {
        $env:CV_TEST_HTTP_FAILURE = '1'
        $Failure = { & $ScriptPath -AllowRemote -ConfirmRemote $Token 2>&1 }

        $Failure | Should -Throw '*redacted*'
        try { & $Failure | Out-Null } catch {
            $_.Exception.Message | Should -Not -Match 'secret'
        }
    }

    It 'rejects an oversized image' {
        $env:CLIPBOARD_VISION_MAX_BYTES = '4'

        { & $ScriptPath -AllowRemote -ConfirmRemote $Token 2>$null } | Should -Throw '*exceeds*'
    }

    It 'enforces No output parameter support without writing a file' {
        $OutputPath = Join-Path $Fixture 'result.txt'

        { & $ScriptPath -AllowRemote -ConfirmRemote $Token -Output $OutputPath 2>$null } | Should -Throw
        Test-Path $OutputPath | Should -BeFalse
    }

    It 'treats localhost as remote and literal IPv4 and IPv6 loopback as local' {
        $env:CLIPBOARD_VISION_API_BASE = 'http://localhost:11434/v1'
        { & $ScriptPath 2>$null } | Should -Throw

        foreach ($LoopbackBase in @('http://127.9.8.7:11434/v1', 'http://[::1]:11434/v1')) {
            $env:CLIPBOARD_VISION_API_BASE = $LoopbackBase
            & $ScriptPath 2>$null | Should -BeExactly 'test description'
        }
    }

    It 'keeps redirect blocking and executable test seams in the production script' {
        $Content = Get-Content -LiteralPath $ScriptPath -Raw

        $Content | Should -Match 'MaximumRedirection\s+0'
        $Content | Should -Match 'SHA256'
        $Content | Should -Match 'CLIPBOARD_VISION_TEST_IMAGE'
        $Content | Should -Match 'CLIPBOARD_VISION_TEST_HTTP_CAPTURE'
        $Content | Should -Not -Match '\$Output|Set-Content.*Result'
    }
}
