# Amanda de voz: plano completo

A Sombrear é o teste do produto (Lucca, 17/10/2026): o objetivo é a melhor versão possível, não a
mínima. O que der certo aqui vira módulo para os outros clientes.

## Régua de qualidade

- **O que o cliente ouve, a gente escolhe pelo ouvido.** A voz e o tempo de resposta decidem se a
  ligação parece loja ou robô. Teste às cegas com o Lucca entre vozes abertas (Kokoro, Pocket TTS) e
  pagas (ElevenLabs, Cartesia, Gemini TTS). Custo desempata, não decide.
- **O que ninguém ouve, a gente faz em código aberto.** Orquestração, transcrição das ligações,
  agenda, resumos.
- **Tempo de resposta abaixo de 1 s por turno**, medido em ligação de verdade, não estimado.
- **Nada grava sem o cliente concordar.** Visita, recado e retorno só depois do resumo lido e
  aceito (já é assim no código).
- **Testado antes de ouvir:** SQL da agenda, conversas em texto com o modelo de verdade e
  simulações com cenários tirados das conversas reais da Sombrear (`mensagens_sombrear`),
  inclusive com áudio de telefone ruim.

## Fases (revisadas com o Lucca, 17/10/2026)

O primeiro uso provavelmente não é atender cliente: é a equipe perguntar e a Amanda responder
pela voz. Atendimento e agendamento vêm depois, se fizer sentido.

1. **Cérebro da Amanda, por texto** (feito em 17/10: 6 conversas testadas, 78 de 88 orçamentos reais ao centavo): a mesma Amanda do WhatsApp (conhecimento, tom e as perguntas
   que ela faz para montar um orçamento), respondendo a equipe. Orçamento sempre pelo motor do
   Dash (`src/lib/simulador.ts` para persiana, `src/lib/cortina.ts` para cortina), nunca conta do
   modelo. Pronto quando acertar ao centavo as perguntas de teste que a equipe faria.
2. **Voz no computador** (montada em 17/10, falta o Lucca conversar pelo microfone): ouvir,
   falar, saber a vez de cada um. Ouvir: Parakeet v3 na CPU. Falar: Kokoro "J" (pf_dora 50% +
   if_sara 25% + pm_alex 25%), "Decor" corrigido, fala cortada em vírgula. Vez: Silero + detector
   de turno do LiveKit. Tempo até começar a falar, medido no PC: ~3,5 a 4,5 s em pergunta simples
   (fim de fala 0,5 + ouvir 0,3 a 0,9 + Muse 2 a 3 até o 1º token + 1º trecho 0,6 a 1,9). Pergunta
   de orçamento faz duas idas ao modelo (ferramenta no meio): 5 a 7 s. Meta de conversa natural é
   menos de 1,5 s: o gargalo agora é o Muse.
   Teste do Lucca pelo microfone (17/10): gostou, achou a voz ruim e viu dois sumiços. Corrigido
   no mesmo dia (`sem_silencio.py`): aviso pronto "só um instante, vou calcular" ao chamar a
   calculadora, "só um segundinho" se o Muse demora, limite de 5 s por tentativa, pedido para
   repetir quando a fala chega vazia, fala curta no Canary (português fixo), valor falado em frase
   pronta pelo código (a instalação vinha errada), e o 400 do Muse com tool_choice "none" (ficava
   muda quando a calculadora falhava). Ligação simulada (`local/simular_ligacao.py`): primeira fala
   4 a 5 s depois da pergunta, valor certo, sem silêncio comprido. Aberto: às vezes o Muse diz que
   vai calcular e não chama a calculadora naquela vez (uma volta a mais).
3. **Ligação de teste** (feito em 17/10, de graça): a Amanda no PC, o LiveKit Cloud grátis levando o
   áudio ao navegador do celular (Agent Console) e a voz Jessica da ElevenLabs (plano grátis). O
   Lucca testou pelo celular e aprovou. Para ir ao ar falta: número DDD 17 (Twilio US$ 4,25/mês ou
   SIP brasileiro), servidor fora do PC, voz brasileira nativa (US$ 5 de crédito na ElevenLabs
   libera) e gravação/transcrição das ligações.
   **Antes de ir ao ar, rodada de melhorias** (pedido do Lucca em 18/10, começada no mesmo dia):
   - Amanda atendendo CLIENTE (`PUBLICO=cliente`, padrão; a da equipe segue com `PUBLICO=equipe`).
     O jeito da casa vem do prompt do WhatsApp (n8n). Ela abre com "Bom dia, tudo bem? Aqui é a
     Amanda, da Sombrear Decor. Como posso te ajudar?", pergunta o nome e o cômodo, confere a medida
     repetindo e pergunta "quer que eu calcule o valor pra te passar?" antes de dar preço. Se o
     cliente pediu o preço, calcula sem enrolar. Fechar ou agendar: passa o WhatsApp da loja e o
     horário, sem dizer que anotou (ainda não há registro da ligação).
     Revisto no mesmo dia com o roteiro da loja: abre com "Boa tarde, Amanda da Sombrear Decor aqui.
     Como posso te ajudar?"; orçamento e dúvida: entende o caso, pede foto pelo WhatsApp e, se o
     cliente quiser o preço antes, pede modelo e medidas e fala o valor na ligação; outro assunto:
     nome completo e telefone. O contato vai para `anotar_contato`, que no teste grava em
     `~/.cache/sombrear-voz/recados.jsonl`. **Para ir ao ar, o recado tem que chegar no time**
     (Dash ou WhatsApp da loja), senão a promessa de "o time te chama" não se cumpre.
   - Ligação → CRM → WhatsApp (19/10, feito em código, **ainda não no ar**): quando a ligação
     termina, a voz (`ligacao.py`) manda conversa, nome, telefone, assunto e último orçamento para
     a edge function `registrar-ligacao`. Ela guarda a ligação (`ligacoes`, migration 0032), cria
     ou atualiza o lead no CRM com origem "Ligação", manda 2 mensagens no WhatsApp pelo Chatwoot
     (confere o nome: "anotei seu nome como *Fulano*, tá certinho?"; depois o valor por escrito e o
     pedido de foto, ou "seu recado já está com o time"), deixa nota interna com a conversa para a
     equipe e um lembrete na memória da Amanda do WhatsApp, para ela continuar de onde a ligação
     parou. Se a equipe já assumiu o lead (etiqueta humano), só a nota. Ligação de telefone (SIP)
     traz o número: ela oferece chamar nele em vez de pedir. Repetir o envio não duplica (`ref`).
     Para ligar: aplicar a 0032, publicar a função, criar o secret `LIGACAO_SECRET` (o mesmo na
     voz, com `REGISTRAR_LIGACAO_URL`) e testar de ponta a ponta com o número do Lucca.
   - Cérebro mais rápido (19/10): o Muse pensa antes de responder mesmo no "minimal" (50 a 80 tokens
     de raciocínio até num "oi", sem como desligar) e varia de 1,3 a 5 s. Medidos 8 modelos com o
     prompt real: DeepSeek V4.1 Flash sem raciocínio ~1,1 s até a 1ª palavra e 3 erros em 39 testes
     (GPT-5 mini 5, Gemini 3.8 Flash 5 mas 1,8 s, os outros rápidos 9 a 14). Escolha do Lucca:
     DeepSeek, padrão na voz (`LLM=muse` volta). Depois do ajuste do prompt: 3 rodadas seguidas
     dos 39 testes sem erro. Custo estimado ~US$ 0,004 por ligação de 3 min (o dobro no pico da
     China). Atenção para ir ao ar: os dados passam por servidor na China (nome e telefone do
     cliente), conferir a LGPD.
   - Voz (18/10): medido no PC, só a Cartesia (pt-BR nativa, ~0,4 s até o 1º som, plano grátis)
     serve ao vivo; Supertonic 2,6 a 3,2 s, OmniVoice 10 a 30 vezes mais lento que o tempo real e com
     pesos sem uso comercial, Piper sem voz feminina em pt-BR. Ordem pedida pelo Lucca: primeiro
     testar a ligação com qualquer voz, a voz final por último (talvez clonada de alguém, com autorização).
4. **Crescer aos poucos**: a mesma Amanda ganhando uma coisa por vez (agenda de visitas, que já
   está pronta na 0031; aviso à equipe; o que mais for pedido).
5. **Piloto com cliente** e 6. **frentes abaixo**: mais para frente.

## Frentes

| # | Frente | O que faz | Depende de |
|---|---|---|---|
| 0 | Fundação | agenda de visitas (feito), uma Amanda só (mesmo conhecimento e memória por telefone que a do WhatsApp), tela de Agenda e de Ligações no Dash com gravação, transcrição e resumo | nada |
| 1 | Atender | atende o fixo, marca visita, tira dúvida, anota recado, passa para a loja no horário quando o cliente pede gente | 0 e o desvio do fixo |
| 2 | Ligar | confirma a visita na véspera, retoma orçamento parado, avisa que o pedido chegou e marca instalação, pós-venda com pedido de avaliação, reativa clientes antigos | 0 e a regra de ligação ativa (0303, LGPD) |
| 3 | Vendedor | no celular, dentro do Dash: dita a medição e vira rascunho de orçamento com as calculadoras; pergunta a agenda do dia | 0 |
| 4 | Ouvir | transcreve as ligações da equipe também e entra na revisão diária: dúvidas, objeções, venda perdida | 1 (o fixo passando pelo nosso SIP) |

Ordem de construção: 0 → 1 e 3 juntas → 2 → 4. Cada frente só vai para o cliente real depois do
Lucca ouvir e aprovar.

## Medir (para virar case)

Antes de ligar qualquer coisa, tirar a linha de base: ligações por dia e não atendidas, visitas por
semana e quantas furam, orçamentos parados e quanto tempo levam para fechar. Depois, a mesma conta
todo mês, mais custo por ligação.

## Decisões em aberto

1. Voz: aceitar pagar pela voz se a aberta perder no teste às cegas?
2. ~~Quando perguntarem se é robô~~: igual ao WhatsApp, "Sou a assistente virtual da Sombrear..." (18/10).
3. O fixo (17) 3304-1354: a IA atende só quando ninguém pega (desvio) ou sempre, passando para a
   loja quando precisa? Portar o número ou desviar para um número SIP?
4. Ligação ativa: quais das cinco a loja topa, e em que horário.
5. ~~Cérebro mais rápido na voz~~ (DeepSeek, 19/10, ver fase 3): o Muse leva 2 a 3 s até a primeira palavra (com raciocínio
   "minimal"; sem ele, 5 a 9 s). Ficar no Muse e disfarçar ("deixa eu calcular" gravado antes da
   conta) ou testar um modelo rápido só para a voz (custo novo)?
