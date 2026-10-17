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
- **Atendimento com agenda (fase 4)**: `atendimento.py` e `supabase/migrations/0031_agenda_visitas.sql`.
  Pronto e testado, guardado para quando o atendimento de cliente entrar.

## Rodar (bancada)

```bash
uv sync
cp .env.example .env.local                                 # META_API_KEY = META_API_KEY_DASH
npx tsx voz/orcamento/servidor.ts <pasta-da-foto-de-precos>  # na raiz do Dash, outro terminal
uv run pytest                                              # 11 conversas com o modelo de verdade
uv run equipe.py console --text                            # conversar com a Amanda digitando
```

A foto dos preços é um JSON por tabela `precos_*` (mais `precos_tecido_modelos`), lido só para
leitura do banco da Sombrear. Fica fora do repo.

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
| Ouvir (STT) | faster-whisper ou Parakeet na CPU (a medir) | 0 |
| Telefone | LiveKit SIP + número DDD 17 | ~US$ 1 a 4/mês + minuto |

Medido em 17/10/2026 no PC (Ryzen 5 1600, sem GPU): Kokoro leva 1,3 a 2 s por frase curta (o
modelo int8 ficou mais lento); Pocket TTS 0,35 s e Piper 0,2 s até o primeiro som. A velocidade do
Kokoro depende de onde a voz rodar.

## Etapas

1. [x] Cérebro da Amanda por texto: orçamento pelo motor do Dash, conhecimento do WhatsApp, 6 conversas testadas.
2. [ ] Voz no computador: ouvir, falar com a voz J, medir o tempo de resposta.
3. [ ] Ligação de teste pelo celular.
4. [ ] Crescer aos poucos (agenda já pronta).
