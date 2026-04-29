param(
    [string]$PythonPath = ""
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$webRoot = Resolve-Path (Join-Path $scriptDir "..")

if ([string]::IsNullOrWhiteSpace($PythonPath)) {
    $repoRoot = Resolve-Path (Join-Path $webRoot "..\..")
    $PythonPath = Join-Path $repoRoot "hubvenv\Scripts\python.exe"
}

Push-Location $webRoot
try {
    & $PythonPath -m unittest discover -s tests -p "ut_*.py" -v
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
