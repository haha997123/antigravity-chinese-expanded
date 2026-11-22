$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

function Find-Node {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'nodejs\node.exe')
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
        (Get-Command node.exe -CommandType Application -All -ErrorAction SilentlyContinue |
            ForEach-Object { $_.Source })
        (Join-Path $env:USERPROFILE '.volta\bin\node.exe')
        (Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE '.workbuddy\binaries\node\versions') -Directory -ErrorAction SilentlyContinue |
            ForEach-Object { Join-Path $_.FullName 'node.exe' })
        (Get-ChildItem -LiteralPath (Join-Path $env:APPDATA 'nvm') -Directory -ErrorAction SilentlyContinue |
            ForEach-Object { Join-Path $_.FullName 'node.exe' })
    )

    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        $file = Get-Item -LiteralPath $candidate -ErrorAction SilentlyContinue
        if ($file -and $file.VersionInfo.ProductVersion -match '^v?(\d+)\.' -and [int]$Matches[1] -ge 18) {
            return $file.FullName
        }
    }
    throw '未找到 Node.js 18 或更高版本。请安装后重新打开汉化器。'
}

$form = [Windows.Forms.Form]::new()
$form.Text = 'Antigravity 汉化器'
$form.StartPosition = 'CenterScreen'
$form.AutoScaleMode = 'Font'
$form.Font = [Drawing.Font]::new('Microsoft YaHei UI', 10)
$form.ClientSize = [Drawing.Size]::new(530, 286)
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.BackColor = [Drawing.Color]::White

$heading = [Windows.Forms.Label]::new()
$heading.Text = 'Antigravity 汉化器'
$heading.Font = [Drawing.Font]::new($form.Font.FontFamily, 18, [Drawing.FontStyle]::Bold)
$heading.AutoSize = $true
$heading.Location = [Drawing.Point]::new(24, 18)
$form.Controls.Add($heading)

$versionLabel = [Windows.Forms.Label]::new()
$versionLabel.Location = [Drawing.Point]::new(26, 61)
$versionLabel.Size = [Drawing.Size]::new(480, 24)
$versionLabel.ForeColor = [Drawing.Color]::FromArgb(86, 96, 113)
$form.Controls.Add($versionLabel)

$card = [Windows.Forms.Panel]::new()
$card.Location = [Drawing.Point]::new(24, 95)
$card.Size = [Drawing.Size]::new(482, 122)
$card.BackColor = [Drawing.Color]::FromArgb(242, 246, 252)
$form.Controls.Add($card)

$statusLabel = [Windows.Forms.Label]::new()
$statusLabel.Font = [Drawing.Font]::new($form.Font.FontFamily, 12, [Drawing.FontStyle]::Bold)
$statusLabel.Location = [Drawing.Point]::new(14, 12)
$statusLabel.Size = [Drawing.Size]::new(450, 28)
$card.Controls.Add($statusLabel)

$messageBox = [Windows.Forms.TextBox]::new()
$messageBox.Location = [Drawing.Point]::new(16, 44)
$messageBox.Size = [Drawing.Size]::new(450, 62)
$messageBox.Multiline = $true
$messageBox.ReadOnly = $true
$messageBox.BorderStyle = 'None'
$messageBox.BackColor = $card.BackColor
$messageBox.ScrollBars = 'Vertical'
$messageBox.TabStop = $false
$card.Controls.Add($messageBox)

$retry = [Windows.Forms.Button]::new()
$retry.Text = '重新检查'
$retry.Location = [Drawing.Point]::new(24, 235)
$retry.Size = [Drawing.Size]::new(108, 32)
$retry.Enabled = $false
$form.Controls.Add($retry)

$close = [Windows.Forms.Button]::new()
$close.Text = '关闭'
$close.Location = [Drawing.Point]::new(410, 235)
$close.Size = [Drawing.Size]::new(96, 32)
$close.DialogResult = 'Cancel'
$form.Controls.Add($close)
$form.CancelButton = $close

$titles = @{
    'applied' = '汉化已应用'
    'already-applied' = '已使用当前汉化'
    'partial' = '已应用兼容的界面译文'
    'waiting' = '等待适配更新'
    'busy' = '请稍后重新检查'
    'error' = '汉化未完成'
}
$script:worker = $null
$timer = [Windows.Forms.Timer]::new()
$timer.Interval = 150

function Show-Result($result) {
    $versionLabel.Text = if ($result.version) { "客户端版本 $($result.version)" } else { '客户端版本未获取' }
    $statusLabel.Text = $titles[[string]$result.status]
    $statusLabel.ForeColor = switch ($result.status) {
        { $_ -in 'applied', 'already-applied' } { [Drawing.Color]::FromArgb(21, 100, 64); break }
        { $_ -in 'waiting', 'busy' } { [Drawing.Color]::FromArgb(123, 74, 9); break }
        'error' { [Drawing.Color]::FromArgb(149, 38, 38); break }
        default { [Drawing.Color]::FromArgb(32, 63, 113) }
    }
    $messageBox.Text = [string]$result.message
    $retry.Enabled = $true
}

function Start-Check {
    $retry.Enabled = $false
    $versionLabel.Text = '正在读取客户端版本'
    $statusLabel.Text = '正在检查'
    $statusLabel.ForeColor = [Drawing.Color]::FromArgb(32, 63, 113)
    $messageBox.Text = '正在检查词典更新及客户端兼容性，请稍候。'

    try {
        $details = [Diagnostics.ProcessStartInfo]::new()
        $details.FileName = Find-Node
        $details.Arguments = '"' + (Join-Path $PSScriptRoot 'localizer.cjs') + '"'
        $details.WorkingDirectory = $PSScriptRoot
        $details.UseShellExecute = $false
        $details.CreateNoWindow = $true
        $details.RedirectStandardOutput = $true
        $details.RedirectStandardError = $true
        $details.StandardOutputEncoding = [Text.Encoding]::UTF8
        $details.StandardErrorEncoding = [Text.Encoding]::UTF8
        $process = [Diagnostics.Process]::Start($details)
        $script:worker = @{
            Process = $process
            Output = $process.StandardOutput.ReadToEndAsync()
            Errors = $process.StandardError.ReadToEndAsync()
        }
        $timer.Start()
    } catch {
        Show-Result @{ status = 'error'; message = $_.Exception.Message }
    }
}

$timer.Add_Tick({
    if (-not $script:worker.Process.HasExited -or -not $script:worker.Output.IsCompleted -or
        -not $script:worker.Errors.IsCompleted) { return }

    $timer.Stop()
    try {
        $stdout = ($script:worker.Output.GetAwaiter().GetResult()).TrimEnd()
        $stderr = ($script:worker.Errors.GetAwaiter().GetResult()).Trim()
        $lastLine = ($stdout -split '\r?\n')[-1]
        try {
            $result = ConvertFrom-Json -InputObject $lastLine
        } catch {
            if ($stderr) { throw $stderr }
            throw '汉化引擎未返回结果，请重新检查。'
        }
        if (-not $result -or -not $titles.ContainsKey([string]$result.status) -or
            -not ($result.message -is [string]) -or -not $result.message.Trim()) {
            throw '汉化引擎返回了无法识别的结果。'
        }
        Show-Result $result
    } catch {
        Show-Result @{ status = 'error'; message = $_.Exception.Message }
    } finally {
        $script:worker.Process.Dispose()
        $script:worker = $null
    }
})

$form.Add_Shown({ Start-Check })
$retry.Add_Click({ Start-Check })
try {
    [void]$form.ShowDialog()
} finally {
    $timer.Dispose()
    if ($script:worker) { $script:worker.Process.Dispose() }
    $form.Dispose()
}
