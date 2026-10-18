# Sobe a Amanda de voz na maquina (fase 3, teste gratis): servidor de orcamento, servidor de voz
# (ouvir/falar) e o agente. Ctrl+C encerra tudo.
#
#   powershell -ExecutionPolicy Bypass -File voz\local\ligar.ps1                 # Kokoro, pelo LiveKit Cloud
#   powershell -ExecutionPolicy Bypass -File voz\local\ligar.ps1 -Voz elevenlabs
#   powershell -ExecutionPolicy Bypass -File voz\local\ligar.ps1 -Modo console   # microfone do PC
#   powershell -ExecutionPolicy Bypass -File voz\local\ligar.ps1 -Publico equipe # a versao da equipe
#   powershell -ExecutionPolicy Bypass -File voz\local\ligar.ps1 -Voz cartesia    # Ana Paula, pt-BR nativa
#
# Chaves (nunca no repo): ~/.secrets/sombrear-meta.env (META_API_KEY_DASH) e, fora do console,
# ~/.secrets/sombrear-voz.env (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, ELEVEN_API_KEY,
# CARTESIA_API_KEY, VOZ_ID opcional). Dados: ~/.cache/sombrear-voz (kokoro/ e precos/).
param([string]$Voz = "kokoro", [string]$Modo = "dev", [string]$Publico = "cliente", [string]$VozId = "")
$ErrorActionPreference = "Stop"

function Carregar([string]$arq, [hashtable]$troca) {
    foreach ($l in Get-Content $arq) {
        if ($l -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            $n = $matches[1]; $v = $matches[2].Trim().Trim('"')
            if ($troca.ContainsKey($n)) { $n = $troca[$n] }
            Set-Item "env:$n" $v
        }
    }
}

Carregar "$HOME\.secrets\sombrear-meta.env" @{ META_API_KEY_DASH = 'META_API_KEY' }
$chaves = "$HOME\.secrets\sombrear-voz.env"
if (Test-Path $chaves) { Carregar $chaves @{} }
elseif ($Modo -notin "console", "download-files") { throw "Falta $chaves com LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET (README da voz, fase 3)." }

$dados = "$HOME\.cache\sombrear-voz"
$env:VOZ = $Voz
# o VOZ_ID do arquivo de chaves e da ElevenLabs (Jessica); na Cartesia o padrao e a Ana Paula (pt-BR nativa)
if ($VozId) { $env:VOZ_ID = $VozId } elseif ($Voz -eq "cartesia") { $env:VOZ_ID = "1cf751f6-8749-43ab-98bd-230dd633abdb" }
$env:PUBLICO = $Publico
$env:KOKORO_DIR = "$dados\kokoro"
$env:PYTHONIOENCODING = "utf-8"
$pastaVoz = Split-Path $PSScriptRoot -Parent
$raiz = Split-Path $pastaVoz -Parent
$logs = "$env:TEMP\sombrear-voz"
New-Item -ItemType Directory -Force $logs | Out-Null

$orc = Start-Process cmd -ArgumentList "/c", "npx tsx voz/orcamento/servidor.ts `"$dados\precos`"" -WorkingDirectory $raiz `
    -PassThru -WindowStyle Hidden -RedirectStandardOutput "$logs\orcamento.log" -RedirectStandardError "$logs\orcamento.err"
$fala = Start-Process uv -ArgumentList "run", "--group", "local", "python", "local/servidor_voz.py" -WorkingDirectory $pastaVoz `
    -PassThru -WindowStyle Hidden -RedirectStandardOutput "$logs\voz.log" -RedirectStandardError "$logs\voz.err"

try {
    Write-Host "Esperando os servidores (orcamento :8791, voz :8792)..."
    foreach ($url in "http://127.0.0.1:8791/tecidos", "http://127.0.0.1:8792/v1/audio/speech") {
        $ok = $false
        for ($i = 0; $i -lt 120 -and -not $ok; $i++) {
            try { Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 2 | Out-Null; $ok = $true }
            catch { if ($_.Exception.Response) { $ok = $true } else { Start-Sleep 1 } }
        }
        if (-not $ok) { throw "Servidor nao subiu: $url (logs em $logs)" }
    }
    Write-Host "Pronto. Voz: $Voz. Modo: $Modo. Publico: $Publico (agente sombrear-$Publico)."
    Set-Location $pastaVoz
    uv run --group local equipe.py $Modo
}
finally {
    foreach ($p in $orc, $fala) { if ($p -and -not $p.HasExited) { taskkill /T /F /PID $p.Id | Out-Null } }
    Write-Host "Servidores encerrados."
}
