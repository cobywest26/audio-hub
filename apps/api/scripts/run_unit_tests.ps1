param(
    [string]$PythonPath = ""
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$apiRoot = Resolve-Path (Join-Path $scriptDir "..")

if ([string]::IsNullOrWhiteSpace($PythonPath)) {
    $repoRoot = Resolve-Path (Join-Path $apiRoot "..\..")
    $PythonPath = Join-Path $repoRoot "hubvenv\Scripts\python.exe"
}

Push-Location $apiRoot
try {
    & $PythonPath -m unittest discover -s tests -p "test_*.py" -v
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
