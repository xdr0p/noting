[CmdletBinding()]
param(
    [switch]$Balanced,
    [switch]$IncludeTestsInHalf2,
    [switch]$KeepCombined,
    [switch]$RunRepomix
)

# Set working directory to the script's folder
Set-Location -Path $PSScriptRoot

# 1. Optionally run Repomix first if requested
if ($RunRepomix) {
    Write-Host "Running Repomix (npx repomix)..." -ForegroundColor Cyan
    npx repomix
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Repomix command failed." -ForegroundColor Red
        return
    }
}

# 2. Auto-detect default Repomix outputs or custom codebase.txt
$candidateFiles = @("codebase.txt", "repomix-output.xml", "repomix-output.txt")
$inputFile = $null

foreach ($cand in $candidateFiles) {
    if (Test-Path (Join-Path $PSScriptRoot $cand)) {
        $inputFile = $cand
        break
    }
}

if (-not $inputFile) {
    Write-Host "No Repomix output found in $PSScriptRoot (checked: $($candidateFiles -join ', '))." -ForegroundColor Yellow
    Write-Host "Attempting to generate codebase.txt via 'npx repomix'..." -ForegroundColor Cyan
    npx repomix
    if (Test-Path (Join-Path $PSScriptRoot "codebase.txt")) {
        $inputFile = "codebase.txt"
    } else {
        Write-Host "Error: Could not find or generate codebase.txt. Please run 'npx repomix' first." -ForegroundColor Red
        return
    }
}

Write-Host "Reading $inputFile..." -ForegroundColor Cyan
$raw = Get-Content (Join-Path $PSScriptRoot $inputFile) -Raw

# 3. Extract Header (Summary + Directory Tree before <files>)
$header = ""
if ($raw -match '(?s)^(.*?)<files>') {
    $header = $matches[1].Trim()
}

# 4. Extract all <file> blocks
$fileMatches = [regex]::Matches($raw, '(?s)<file path="(?<path>.*?)">.*?</file>')
if ($fileMatches.Count -eq 0) {
    Write-Host "No <file> blocks found in $inputFile" -ForegroundColor Red
    return
}

# 5. Analyze Codebase Breakdown (Tests vs App Source vs Tooling)
$allFileEntries = @()
$testFileEntries = @()
$sourceFileEntries = @()
$nonCodeFileEntries = @()
$toolingFileEntries = @()

foreach ($m in $fileMatches) {
    $path = $m.Groups["path"].Value
    $size = [System.Text.Encoding]::UTF8.GetByteCount($m.Value)
    $entry = [PSCustomObject]@{
        Path  = $path
        Match = $m
        Size  = $size
    }
    $allFileEntries += $entry
    
    $isTest = ($path.StartsWith("test/") -or 
               $path.StartsWith("tests/") -or 
               $path.StartsWith("src/test/") -or 
               $path.StartsWith("src-tauri/tests/") -or 
               $path -match '(\.|\/)(test|spec)\.[jt]sx?$' -or
               $path -match '_test\.rs$')

    $isTooling = ($path.StartsWith("codemods/") -or $path.StartsWith(".github/"))

    if ($isTest) {
        $testFileEntries += $entry
    } elseif ($isTooling) {
        $toolingFileEntries += $entry
    } elseif ($path -match '\.(iss|json|md|gitignore|txt|ya?ml|toml)$') {
        $nonCodeFileEntries += $entry
    } else {
        $sourceFileEntries += $entry
    }
}

$appEntries = $allFileEntries | Where-Object { $testFileEntries -notcontains $_ -and $toolingFileEntries -notcontains $_ }

$totalSize     = ($allFileEntries | Measure-Object -Property Size -Sum).Sum
$totalTestSize = ($testFileEntries | Measure-Object -Property Size -Sum).Sum
$totalAppSize  = ($appEntries | Measure-Object -Property Size -Sum).Sum

$testPercent = if ($totalSize -gt 0) { [math]::Round(($totalTestSize / $totalSize) * 100, 1) } else { 0 }
$appPercent  = if ($totalSize -gt 0) { [math]::Round(($totalAppSize / $totalSize) * 100, 1) } else { 0 }

Write-Host "`n--- Codebase Composition Analysis ---" -ForegroundColor Yellow
Write-Host "  Total Files      : $($allFileEntries.Count) ($([math]::Round($totalSize / 1KB, 1)) KB)" -ForegroundColor White
Write-Host "  App Source Files : $($appEntries.Count) ($([math]::Round($totalAppSize / 1KB, 1)) KB, $appPercent% of total)" -ForegroundColor Green
Write-Host "  Test Files       : $($testFileEntries.Count) ($([math]::Round($totalTestSize / 1KB, 1)) KB, $testPercent% of total)" -ForegroundColor $(if ($testPercent -gt 20) { "Magenta" } else { "Gray" })
if ($toolingFileEntries.Count -gt 0) {
    Write-Host "  Tooling/CI Files : $($toolingFileEntries.Count) (excluded)" -ForegroundColor DarkGray
}
Write-Host "---------------------------------------`n" -ForegroundColor Yellow

# 6. Clean up previous split files
Get-ChildItem -Path $PSScriptRoot -Filter "codebase_part_*.txt" | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path $PSScriptRoot -Filter "codebase_half_*.txt" | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path $PSScriptRoot -Filter "codebase_tests.txt"  | Remove-Item -Force -ErrorAction SilentlyContinue

# 7. Splitting Strategy
if ($IncludeTestsInHalf2) {
    Write-Host "Mode: [Legacy] Half 1 = Source, Half 2 = Remaining Source + All Tests..." -ForegroundColor Cyan
    $halfTarget = $totalSize / 2
    $acc = 0
    $bestIndex = 0
    for ($i = 0; $i -lt $appEntries.Count; $i++) {
        $acc += $appEntries[$i].Size
        if ($acc -ge $halfTarget -or $i -eq ($appEntries.Count - 1)) {
            $bestIndex = $i
            break
        }
    }
    $half1Files = $appEntries[0..$bestIndex]
    $remSource = if ($bestIndex -lt ($appEntries.Count - 1)) { $appEntries[($bestIndex + 1)..($appEntries.Count - 1)] } else { @() }
    $half2Files = @($remSource) + @($testFileEntries)
    $halves = @(
        @{ Num = 1; Files = $half1Files; Desc = "Source Code (Part 1)" },
        @{ Num = 2; Files = $half2Files; Desc = "Source Code (Part 2) + All Tests" }
    )
} elseif ($Balanced) {
    Write-Host "Mode: [Balanced] Splitting app source 50/50 by size..." -ForegroundColor Cyan
    $halfTarget = $totalAppSize / 2
    $acc = 0
    $bestIndex = 0
    for ($i = 0; $i -lt $appEntries.Count; $i++) {
        $acc += $appEntries[$i].Size
        if ($acc -ge $halfTarget -or $i -eq ($appEntries.Count - 1)) {
            $bestIndex = $i
            break
        }
    }
    $half1Files = $appEntries[0..$bestIndex]
    $half2Files = if ($bestIndex -lt ($appEntries.Count - 1)) { $appEntries[($bestIndex + 1)..($appEntries.Count - 1)] } else { @() }
    $halves = @(
        @{ Num = 1; Files = $half1Files; Desc = "App Source (Part 1)" },
        @{ Num = 2; Files = $half2Files; Desc = "App Source (Part 2)" }
    )
} else {
    Write-Host "Mode: [Domain-Split] Half 1 = Frontend UI, Half 2 = Backend Rust (with shared rules & contracts)..." -ForegroundColor Cyan
    
    $feFiles = @()
    $beFiles = @()
    
    foreach ($entry in $appEntries) {
        $p = $entry.Path
        if ($p.StartsWith("src-tauri/")) {
            $beFiles += $entry
        } elseif ($p.StartsWith("src/")) {
            $feFiles += $entry
        } else {
            # Root files (package.json, tsconfig.json, vite.config.ts, index.html)
            $feFiles += $entry
        }
    }
    
    # Ensure agent instructions (AGENTS.md, CLAUDE.md, GEMINI.md) are in both halves so external agents follow rules
    $docFiles = $appEntries | Where-Object { $_.Path -match '^(AGENTS\.md|CLAUDE\.md|GEMINI\.md)$' }
    foreach ($doc in $docFiles) {
        if (($beFiles | Where-Object { $_.Path -eq $doc.Path }).Count -eq 0) {
            $beFiles = @($doc) + $beFiles
        }
        if (($feFiles | Where-Object { $_.Path -eq $doc.Path }).Count -eq 0) {
            $feFiles = @($doc) + $feFiles
        }
    }
    
    # Ensure contract/type definitions (e.g., src/types.ts, src/types/*, src/api/*) are accessible in backend half as TypeScript reference
    $typeFiles = $appEntries | Where-Object { $_.Path -match '^src/(types(\.ts|/.*)|api/.*)' }
    foreach ($tf in $typeFiles) {
        if (($beFiles | Where-Object { $_.Path -eq $tf.Path }).Count -eq 0) {
            $beFiles += $tf
        }
    }

    $halves = @(
        @{ Num = 1; Files = $feFiles; Desc = "Frontend UI (React, TipTap, Styles, Root configs)" },
        @{ Num = 2; Files = $beFiles; Desc = "Backend Rust (Tauri Commands, Rust source, Capabilities, Configs)" }
    )
}

# 8. Write Full Halves
foreach ($h in $halves) {
    $halfNum = $h.Num
    $hFiles = $h.Files
    $hDesc = $h.Desc
    $hContent = ($hFiles | ForEach-Object { $_.Match.Value }) -join "`r`n`r`n"
    $hSizeKb = [math]::Round(($hFiles | Measure-Object -Property Size -Sum).Sum / 1KB, 1)

    $halfOutput = @"
$header

<!-- Codebase Split: Half $halfNum of 2 ($($hFiles.Count) files, ${hSizeKb} KB) - $hDesc -->
<!-- Clean boundary cut: All files, classes, and functions are complete and intact. -->
<files>
$hContent
</files>
"@
    $halfOutFile = Join-Path $PSScriptRoot "codebase_half_$halfNum.txt"
    $halfOutput | Set-Content $halfOutFile -Encoding UTF8
    $actualKb = [math]::Round((Get-Item $halfOutFile).Length / 1KB, 1)
    Write-Host " [OK] Created codebase_half_$halfNum.txt ($($hFiles.Count) files, ${actualKb} KB) [$hDesc]" -ForegroundColor Green
}

# 9. Write Dedicated Tests Suite (if not in Half 2)
if (-not $IncludeTestsInHalf2 -and $testFileEntries.Count -gt 0) {
    $testContent = ($testFileEntries | ForEach-Object { $_.Match.Value }) -join "`r`n`r`n"
    $testSizeKb = [math]::Round(($testFileEntries | Measure-Object -Property Size -Sum).Sum / 1KB, 1)
    $testOutput = @"
$header

<!-- Codebase Tests Suite ($($testFileEntries.Count) files, ${testSizeKb} KB) -->
<!-- Contains all frontend and backend unit, integration, and AST tests. -->
<files>
$testContent
</files>
"@
    $testOutFile = Join-Path $PSScriptRoot "codebase_tests.txt"
    $testOutput | Set-Content $testOutFile -Encoding UTF8
    $actualTestKb = [math]::Round((Get-Item $testOutFile).Length / 1KB, 1)
    Write-Host " [OK] Created codebase_tests.txt ($($testFileEntries.Count) files, ${actualTestKb} KB) [All Tests]" -ForegroundColor Yellow
}

# 10. Clean up temporary repomix output unless -KeepCombined is specified
if (-not $KeepCombined -and (Test-Path (Join-Path $PSScriptRoot "codebase.txt"))) {
    Remove-Item -Path (Join-Path $PSScriptRoot "codebase.txt") -Force -ErrorAction SilentlyContinue
    Write-Host "`n [OK] Removed temporary codebase.txt (use -KeepCombined to retain)." -ForegroundColor DarkGray
}

Write-Host "`nAll operations completed successfully." -ForegroundColor Green
