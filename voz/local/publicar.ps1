# Publica a Amanda de voz no LiveKit Cloud (fora do PC). Primeira vez cria o agente; depois, nova versao.
#
#   powershell -ExecutionPolicy Bypass -File voz\local\publicar.ps1
#   powershell -ExecutionPolicy Bypass -File voz\local\publicar.ps1 -SoChaves   # so troca as chaves (reinicia)
#
# Antes de publicar confere o conhecimento contra o n8n (conhecimento/atualizar.py): se ficou velho, para.
# As chaves do agente saem de ~/.secrets/sombrear-voz.env para um arquivo temporario, apagado no fim;
# nada vai para o repo. LIVEKIT_* o LiveKit Cloud injeta sozinho.
#
# O que roda no ar (mudar aqui, nao no codigo):
#   LLM          cerebro (modelo.OUTROS); fora da China
#   VOZ / VOZ_ID voz de quem fala (a clonada entra aqui no fim)
#   URL_ORCAMENTO a funcao orcamento-voz, com o preco do banco
param([string]$Llm = "deepseek-baseten", [string]$Voz = "cartesia",
      [string]$VozId = "1cf751f6-8749-43ab-98bd-230dd633abdb", [switch]$SoChaves)
$ErrorActionPreference = "Stop"

$pastaVoz = Split-Path $PSScriptRoot -Parent
$chaves = "$HOME\.secrets\sombrear-voz.env"
$lidas = @{}
foreach ($l in Get-Content $chaves) {
    if ($l -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { $lidas[$matches[1]] = $matches[2].Trim().Trim('"') }
}
foreach ($n in "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET") { Set-Item "env:$n" $lidas[$n] }

# a chave do cerebro escolhido (modelo.OUTROS): DEEPSEEK_API_KEY, BASETEN_API_KEY...
$chaveLlm = (& uv run --directory $pastaVoz python -c "from modelo import OUTROS; print(OUTROS['$Llm'][1][1])").Trim()
$precisa = @($chaveLlm, "LIGACAO_SECRET", "REGISTRAR_LIGACAO_URL")
if ($Voz -eq "cartesia") { $precisa += "CARTESIA_API_KEY" } elseif ($Voz -eq "elevenlabs") { $precisa += "ELEVEN_API_KEY" }
$faltam = $precisa | Where-Object { -not $lidas[$_] }
if ($faltam) { throw "Falta em $chaves : $($faltam -join ', ')" }

if (-not $SoChaves) {
    $env:PYTHONIOENCODING = "utf-8"
    uv run --directory $pastaVoz python conhecimento/atualizar.py --conferir
    if ($LASTEXITCODE -ne 0) { throw "Conhecimento velho em relacao ao n8n: rode 'uv run python conhecimento/atualizar.py', confira e commite antes de publicar." }
}

$segredos = [System.IO.Path]::GetTempFileName()
try {
    $linhas = @(
        "PUBLICO=cliente", "LLM=$Llm", "VOZ=$Voz", "VOZ_ID=$VozId",
        "URL_ORCAMENTO=https://nlswyjpjzibuvdsaooyg.supabase.co/functions/v1/orcamento-voz"
    )
    foreach ($n in $precisa) { $linhas += "$n=$($lidas[$n])" }
    [System.IO.File]::WriteAllLines($segredos, $linhas)

    Set-Location $pastaVoz
    if (-not (Test-Path "livekit.toml")) {
        # regioes do LiveKit Cloud em 21/10/2026: us-east, eu-central, ap-south; a mais perto do Brasil
        lk agent create --region us-east --secrets-file $segredos --yes .
    } elseif ($SoChaves) {
        lk agent update-secrets --secrets-file $segredos --overwrite .
    } else {
        lk agent update-secrets --secrets-file $segredos --overwrite .
        lk agent deploy .
    }
    if ($LASTEXITCODE -ne 0) { throw "lk falhou (codigo $LASTEXITCODE)" }
    lk agent status .
}
finally {
    Remove-Item $segredos -Force -ErrorAction SilentlyContinue
}
