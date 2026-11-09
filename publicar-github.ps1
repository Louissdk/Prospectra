param(
    [ValidateSet('Public', 'Private')]
    [string]$Visibility = 'Public'
)

$ErrorActionPreference = 'Stop'
$RepoFullName = 'Louissdk/Prospectra'
$Description = 'Extensão Chrome Manifest V3 para prospecção local no Google Maps, com identificação de sites e e-mails públicos.'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$GitArgs)
    & git -C $ProjectRoot @GitArgs
    if ($LASTEXITCODE -ne 0) { throw "Falha no comando git: git $($GitArgs -join ' ')" }
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw 'GitHub CLI (gh) não encontrado. Instale em https://cli.github.com/ e execute gh auth login.'
}

& gh auth status
if ($LASTEXITCODE -ne 0) {
    throw 'GitHub CLI não está autenticado. Execute gh auth login e rode este script novamente.'
}

if (-not (Test-Path (Join-Path $ProjectRoot '.git'))) {
    & git -C $ProjectRoot init -b main
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível iniciar o repositório Git local.' }
}

Invoke-Git add --all
& git -C $ProjectRoot diff --cached --quiet
$hasStagedChanges = ($LASTEXITCODE -ne 0)
$head = & git -C $ProjectRoot rev-parse --verify HEAD 2>$null
$hasCommit = ($LASTEXITCODE -eq 0)
if ($hasStagedChanges -or -not $hasCommit) {
    & git -C $ProjectRoot commit -m 'feat: initial Prospectra Chrome extension'
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível criar o commit local.' }
}

& gh repo view $RepoFullName --json url --jq .url 2>$null
$repoExists = ($LASTEXITCODE -eq 0)
if (-not $repoExists) {
    $visibilityFlag = if ($Visibility -eq 'Public') { '--public' } else { '--private' }
    & gh repo create $RepoFullName $visibilityFlag --source $ProjectRoot --remote origin --push --description $Description
    if ($LASTEXITCODE -ne 0) { throw 'O GitHub não criou/publicou o repositório. Verifique permissões e tente novamente.' }
} else {
    $expectedRemote = 'https://github.com/Louissdk/Prospectra.git'
    $remote = & git -C $ProjectRoot remote get-url origin 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $remote) {
        & git -C $ProjectRoot remote add origin $expectedRemote
        if ($LASTEXITCODE -ne 0) { throw 'Não foi possível configurar o remote origin.' }
    } else {
        $normalizedRemote = ([string]$remote).Trim() -replace '^git@github\.com:', 'https://github.com/'
        $normalizedRemote = $normalizedRemote.TrimEnd('/')
        if ($normalizedRemote -ne $expectedRemote -and $normalizedRemote -ne $expectedRemote.TrimEnd('.git')) {
            throw "O remote origin aponta para '$remote', não para '$expectedRemote'. Push cancelado por segurança."
        }
    }
    & git -C $ProjectRoot push -u origin main
    if ($LASTEXITCODE -ne 0) { throw 'O repositório já existe, mas o push falhou. Verifique se a branch remota possui commits diferentes.' }
}

Write-Host ''
Write-Host 'Prospectra publicado com sucesso:' -ForegroundColor Green
Write-Host 'https://github.com/Louissdk/Prospectra'
