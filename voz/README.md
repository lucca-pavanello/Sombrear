# Voz da Sombrear

A Amanda falando. Primeiro produto do laboratório (Lucca, 17/10/2026). **Nada no ar**: sem número,
sem deploy, até ser aprovado ouvindo. Fases e decisões em `PLANO.md`.

## O que tem aqui

- **Amanda da equipe (fase 1)**: `equipe.py`. A mesma Amanda do WhatsApp respondendo a equipe:
  produto, indicação por ambiente e orçamento. O conhecimento está em `conhecimento/`, copiado do
  n8n em 17/10/2026 (o n8n continua sendo a fonte enquanto a voz não vai pro ar).
- **Orçamento**: `src/lib/voz/orcar.ts`, sempre pelo motor do Dash (`simulador.ts` e `cortina.ts`).
  "Tecido mais barato" calcula todos os tecidos que servem e fica com o menor total; tecido com
  limite no nome ("ATÉ 1,40 X 1,40") só entra se a medida couber; medida do vão soma os aumentos
  da loja (persiana +0,20 × +0,20; cortina +0,40 × +0,40, porta +0,20 na altura). A voz chama por
  HTTP o `orcamento/servidor.ts`.
- **Ligação → CRM → WhatsApp**: `ligacao.py` junta a ligação e manda, quando ela termina, para
  `supabase/functions/registrar-ligacao` (lead no CRM, mensagens e nota no Chatwoot, lembrete na
  memória da Amanda do WhatsApp). Env na voz: `REGISTRAR_LIGACAO_URL` e `LIGACAO_SECRET`; sem a URL
  grava em `~/.cache/sombrear-voz/recados.jsonl`. Detalhe no PLANO.md.
- **Atendimento com agenda (fase 4)**: `atendimento.py` e `supabase/migrations/0031_agenda_visitas.sql`.
  Pronto e testado, guardado para quando o atendimento de cliente entrar.

## Rodar (bancada)

```bash
uv sync
cp .env.example .env.local                                 # META_API_KEY = META_API_KEY_DASH
npx tsx voz/orcamento/servidor.ts <pasta-da-foto-de-precos>  # na raiz do Dash, outro terminal
uv run pytest                                              # 90 testes, boa parte com o modelo de verdade
uv run equipe.py console --text                            # conversar com a Amanda digitando
uv run --group local python local/servidor_voz.py         # ouvir e falar na máquina (KOKORO_DIR)
uv run --group local equipe.py console                     # conversar pelo microfone
PYTHONPATH=. uv run --group local python local/medir_latencia.py <pasta-com-wavs>  # tempo por etapa
PYTHONPATH=. uv run --group local python local/simular_ligacao.py <wav> [<wav>...]  # ligação simulada
PYTHONPATH=. uv run --group local python local/medir_turnos.py <wav> [<wav>...]  # ligação de cliente, tempo por turno
```

A foto dos preços é um JSON por tabela `precos_*` (mais `precos_tecido_modelos`), lido só para
leitura do banco da Sombrear. Fica fora do repo.

## Fase 3: testar pelo celular, de graça

A Amanda roda no PC e o LiveKit Cloud (plano grátis: 1.000 min de agente por mês) leva o áudio
até o navegador do celular, pelo Agent Console do painel. Sem número de telefone por enquanto: o número DDD 17 só entra no
piloto. Ligar de um app SIP direto no LiveKit não é garantido (ele não aceita cadastro de app),
por isso o caminho é o navegador.

**Uma vez só (Lucca):**
1. Criar conta em cloud.livekit.io e um projeto `sombrear-voz`. Em Settings > API Keys, criar uma
   chave e anotar a URL do projeto (`wss://...livekit.cloud`), a API Key e o Secret.
2. (Teste às cegas das vozes) Criar conta grátis na ElevenLabs e na Cartesia e pegar a API key de cada.
3. Criar `~/.secrets/sombrear-voz.env` com:
   ```
   LIVEKIT_URL=wss://...
   LIVEKIT_API_KEY=...
   LIVEKIT_API_SECRET=...
   ELEVEN_API_KEY=...
   CARTESIA_API_KEY=...
   ```
4. O painel novo do LiveKit (out/2026) não tem mais Sandbox: o teste é pelo **Agent Console**.

**Cada teste:**
```powershell
powershell -ExecutionPolicy Bypass -File voz\local\ligar.ps1                  # voz Kokoro
powershell -ExecutionPolicy Bypass -File voz\local\ligar.ps1 -Voz elevenlabs
powershell -ExecutionPolicy Bypass -File voz\local\ligar.ps1 -Voz cartesia
```
No celular: entrar em cloud.livekit.io, Agents > Console > Configure, em "Agent name" pôr
`sombrear-cliente` (Amanda atendendo cliente, padrão) ou `sombrear-equipe` (com `-Publico equipe`),
"Save and start session" e falar (o Console só lista agentes hospedados no
LiveKit; a Amanda roda no PC, por isso o nome vai digitado). Ctrl+C no PC encerra tudo. Para escolher a voz da
paga: `VOZ=elevenlabs uv run --group local python local/listar_vozes.py` e pôr o id em `VOZ_ID`
no mesmo arquivo de chaves. O script lê os preços e o modelo do Kokoro de `~/.cache/sombrear-voz`
(foto dos preços de 17/10/2026; atualizar quando a loja mudar preço).

## Conferência contra orçamentos reais

`npx tsx voz/orcamento/conferir.ts <pasta-da-foto>` compara com os 88 orçamentos da Amanda do
WhatsApp (`orcamentos_sombrear_ia`, 24/08 a 15/10/2026). Em 17/10/2026: **78 iguais ao centavo**.
Os outros 10:
- 5 de tela solar 1% e "mais barato" de agosto e setembro: o motor achou tecido mais barato do que o
  n8n escolheu na época (preço que mudou ou o atalho do n8n, que ordena pelo preço do rolo).
- 2 larguras acima do maior rolo (3,1 e 4,9 m): a Amanda propõe dividir em peças (testado).
- 1 PV de 4,41 m com diferença grande: ainda não investigado.
- 1 Double blackout: não existe; recusar é o certo.

## Stack

| Peça | Escolha | Custo |
|---|---|---|
| Orquestrador | LiveKit Agents, autohospedado | 0 |
| Entender | Muse (Meta) por API, a chave do Dash | centavos por conversa |
| Falar (TTS) | Kokoro, voz "J" (pf_dora 50% + if_sara 25% + pm_alex 25%) | 0 |
| Falar no teste da fase 3 | ElevenLabs Flash v2.5, voz Jessica (`cgSgspJ2msm6clMCkdW9`), escolhida às cegas pelo Lucca em 17/10/2026; começa a tocar em 0,27 s | grátis até 10 mil créditos |
| Ouvir (STT) | Deepgram Nova-3 pelo LiveKit Inference (conta LiveKit que já existe; `OUVIDO=local` volta ao Parakeet TDT 0.6b v3 int8 na CPU, fala curta no Canary 1b v2) | US$ 0,0048/min de ligação (Build); local 0 |
| Telefone | LiveKit SIP + número DDD 17 | ~US$ 1 a 4/mês + minuto |

Medido em 17/10/2026 no PC (Ryzen 5 1600, sem GPU): Kokoro leva 1,3 a 2 s por frase curta (o
modelo int8 ficou mais lento); Pocket TTS 0,35 s e Piper 0,2 s até o primeiro som. A velocidade do
Kokoro depende de onde a voz rodar; por isso a fala vai cortada em vírgula (`frases.py`): o 1º
trecho sai em 0,6 a 1,9 s. Ouvir: Parakeet 0,3 a 0,85 s por pergunta e acertou "1,80 por 1,20";
Whisper small 5,5 a 7 s (codifica sempre 30 s), Whisper base 1,4 s mas errou as medidas. O Muse
leva 2 a 3 s até a primeira palavra e hoje é o gargalo.

Medido em 19/10/2026 com `local/medir_turnos.py` (8 falas de cliente com som de telefone, detector
de turno de verdade, DeepSeek e Cartesia Ana Paula), mediana por turno, da parada da fala até o
primeiro som:

| | fim de turno | texto | 1º token | voz | total | turnos < 2 s |
|---|---|---|---|---|---|---|
| antes (Parakeet local, fim 0,55/0,5/3,0) | 1,52 | 1,05 | 1,04 | 0,31 | 2,69 | 0 de 8 |
| Deepgram Nova-3 | 0,95 | 0,30 | 1,30 | 0,30 | 2,09 | 4 de 8 |
| + fim de fala 0,3/0,3/2,0 e voz antes do turno fechar (padrão) | 0,70 | 0,33 | 1,05 | 0,30 | 1,98 a 2,08 | 3 a 5 de 8 |

O que sobra é o DeepSeek: ~1 s até o 1º token com o prompt da Amanda (o cache já pega 6.656 dos
6.875 tokens) e ~0,85 s até com um "Oi" de 5 tokens, então é o piso da rede até ele. Testados e
não adotados: Cartesia ink-whisper (mais rápido, 0,83 s de fim de turno, mas cortou começo e fim
das falas: "Isso." e "Silva" sumiram e a conversa travou), ElevenLabs Scribe v2 realtime (0,78 s
de texto e errou "É de rolo, blackout" como o Parakeet) e cortar a 1ª frase mais cedo (sem
diferença medível: a voz já começa 0,3 s depois do texto). Sem o servidor de voz local (só sobe com
`-Ouvido local` ou `-Voz kokoro`), o PC fica com ~2 GB a mais livres.

Reação curta (`reacao.py`, `REACAO=0` desliga): quando o cliente termina, uma regra sobre o texto
final escolhe "Certo." / "Anotado." / "Beleza." (dado), "Deixa eu ver." (preço), "Entendi." /
"Poxa, entendi." (problema) ou "Tá joia." / "Combinado." (sim), e o áudio pronto sai na hora; na
dúvida (cumprimento, "não", pergunta aberta, fala ambígua) não sai nada. O modelo não fica sabendo
(mudar o contexto anularia a resposta que ele já começou antes do turno fechar): o começo da
resposta dele perde a reação que ele mesmo puser. Depois de "Deixa eu ver." a calculadora não
anuncia a conta de novo. Medido em 19/10, mediana por turno: 1º som 2,02 s sem a reação, 0,78 e
0,79 s com ela (7 de 8 turnos reagiram na 2ª rodada); a resposta do modelo segue em ~2,0 s.

## Etapas

1. [x] Cérebro da Amanda por texto: orçamento pelo motor do Dash, conhecimento do WhatsApp, 6 conversas testadas.
2. [~] Voz no computador: montada e medida (3,5 a 4,5 s até começar a falar); falta conversar pelo microfone.
3. [x] Teste pelo celular, de graça (navegador + LiveKit Cloud + voz Jessica): aprovado pelo Lucca em 17/10.
4. [ ] Crescer aos poucos (agenda já pronta).
