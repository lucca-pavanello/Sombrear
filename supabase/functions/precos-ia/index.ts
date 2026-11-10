/**
 * Edge Function: precos-ia
 * IA de gestão de preços (Precificação 2.0 — Fase 4).
 * Princípio: a IA PROPÕE, o admin CONFIRMA, o sistema APLICA (com auditoria).
 *
 * modo 'propor'  → interpreta o pedido (texto e/ou áudio) e devolve { resposta, acoes[], transcricao }
 *                   Ações de parâmetro fora do normal voltam com `suspeita: true` + `motivo`.
 * modo 'aplicar' → valida e aplica as ações confirmadas, grava auditoria (com `lote_id` no
 *                   detalhe) e devolve { ok, aplicadas, lote_id }. Ação suspeita só entra com
 *                   `confirmada_suspeita: true` (o admin marcou a caixa extra na tela).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// Funções puras compartilhadas com o front/testes (sem import de navegador)
import { avaliarParametro } from '../../../src/lib/precos-ia/sanidade.ts'
import { validarAudio } from '../../../src/lib/precos-ia/audio.ts'
import { extrairJson } from '../../../src/lib/precos-ia/json.ts'

const MAX_ACOES = 60

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TIPOS_VALIDOS = new Set([
  'criar_promocao', 'remover_promocao', 'atualizar_preco_tecido',
  'atualizar_parametro', 'atualizar_preco_artigo', 'atualizar_componente_ferragem',
  'atualizar_ph50', 'atualizar_bando_param', 'atualizar_colocacao',
  'atualizar_barra_faixa', 'atualizar_motor_componente', 'atualizar_motor_estrutura',
  'atualizar_romana',
])
const CAMPOS_PH50 = new Set(['preco_cadarco', 'preco_fita', 'bando_ml', 'aba_pc'])
const CAMPOS_BANDO = new Set(['preco_metro', 'par', 'cd1', 'cd2'])

function resposta(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/**
 * Acha o componente de ferragem da ação. O caminho feliz é o `id` vindo da
 * listagem; quando a IA manda só o nome do item (ou um id que não existe),
 * resolvemos por item + família/cor/espessura — e, se ainda assim sobrar mais
 * de um candidato, devolvemos um erro que DIZ quais são, em vez de falhar seco.
 */
// deno-lint-ignore no-explicit-any
async function acharComponente(db: any, acao: Record<string, unknown>): Promise<{ id: number } | { erro: string }> {
  const id = Number(acao.id)
  if (Number.isInteger(id) && id > 0) {
    const { data } = await db.from('precos_ferragem_componentes').select('id').eq('id', id).maybeSingle()
    if (data) return { id: data.id }
  }

  const item = String(acao.item ?? '').trim()
  if (!item) {
    return { erro: 'Não consegui identificar o componente de ferragem (faltou o item). Diga o nome do item, a família e a cor — ex.: "tubo 32 da ROLO BRANCA".' }
  }

  let q = db.from('precos_ferragem_componentes').select('id, familia, cor, espessura, item').ilike('item', item)
  if (acao.familia) q = q.eq('familia', String(acao.familia).toUpperCase())
  if (acao.cor) q = q.eq('cor', String(acao.cor).toUpperCase())
  if (acao.espessura != null && Number.isFinite(Number(acao.espessura))) q = q.eq('espessura', Number(acao.espessura))

  const { data, error } = await q
  if (error) return { erro: `Falha ao procurar o componente "${item}": ${error.message}` }
  if (!data?.length) return { erro: `Componente "${item}" não existe na tabela de ferragens.` }
  if (data.length > 1) {
    // deno-lint-ignore no-explicit-any
    const onde = data.map((d: any) => `${d.familia} ${d.cor} ${d.espessura}mm`).join(' · ')
    return { erro: `"${item}" existe em ${data.length} lugares (${onde}). Diga qual — ex.: "o da ROLO PRETA 32".` }
  }
  return { id: data[0].id }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // ── Auth: apenas admin ──────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return resposta(401, { error: 'Não autorizado' })

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const callerClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser()
    if (authError || !caller) return resposta(401, { error: 'Token inválido' })

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: perfil } = await db.from('profiles').select('is_admin').eq('id', caller.id).single()
    const isAdmin = caller.email === 'luccapavanallo@gmail.com' || perfil?.is_admin === true
    if (!isAdmin) return resposta(403, { error: 'Acesso negado: apenas admins' })

    const body = await req.json()

    // ══════════════ MODO PROPOR ══════════════
    if (body.modo === 'propor') {
      const mensagem = String(body.mensagem ?? '').slice(0, 2000)
      const audio = body.audio != null ? validarAudio(body.audio) : null
      if (audio && !audio.ok) return resposta(audio.status, { error: audio.erro })
      if (!mensagem.trim() && !audio) return resposta(400, { error: 'Mensagem vazia' })

      // contexto compacto do banco — TODAS as tabelas de preço (menos a matriz Romana, grande demais)
      const [
        { data: tecidos }, { data: promos }, { data: params }, { data: artigos },
        { data: ferragens }, { data: ph50 }, { data: bandoParams }, { data: bandos },
        { data: barraFaixas }, { data: colocacao }, { data: motorEst }, { data: motorComp },
      ] = await Promise.all([
        db.from('precos_tecidos').select('nome, tipo, largura, preco').order('nome'),
        db.from('precos_promocoes').select('id, alvo_nome, desconto_pct, inicio, fim').order('inicio'),
        db.from('precos_parametros').select('chave, valor, descricao'),
        db.from('precos_artigos').select('categoria, nome, preco'),
        db.from('precos_ferragem_componentes').select('id, familia, cor, espessura, item, tipo_custo, valor').order('familia'),
        db.from('precos_ph50').select('modelo, cor, preco_cadarco, preco_fita, bando_ml, aba_pc'),
        db.from('precos_bandos_params').select('cor, preco_metro, par, cd1, cd2'),
        db.from('precos_bandos').select('cor, largura, qtd_cd'),
        db.from('precos_barra_faixas').select('largura_min, qtd_presilhas'),
        db.from('precos_colocacao').select('id, ml_min, ml_max, preco'),
        db.from('precos_motor_estrutura').select('id, largura, alt_faixa, valor, grupo'),
        db.from('precos_motor_componentes').select('item, custo, quantidade'),
      ])

      // Orçamentos e vendas: sem isso a assistente não sabe responder "quanto o
      // Fernando pagou" nem "quanto vai pra parceira neste mês" — e é justamente
      // o que o admin pergunta enquanto olha o Fechamento.
      const [{ data: vendas }, { data: recentes }] = await Promise.all([
        db.from('orcamentos')
          .select('cliente, modelo, tecido, largura, altura, quantidade, acabamentos, cor_ferragem_motor, ' +
                  'valor_venda, valor_cobrado, instalacao, custo_tecido, custo_acabamento, valor_parceiro, ' +
                  'valor_parceiro_pago, margem, created_at, responsavel, fonte')
          .eq('fechado', true).order('created_at', { ascending: false }).limit(60),
        db.from('orcamentos')
          .select('cliente, modelo, tecido, largura, altura, quantidade, valor_venda, custo_tecido, ' +
                  'valor_parceiro, fechado, created_at, responsavel')
          .eq('fechado', false).order('created_at', { ascending: false }).limit(40),
      ])
      const compacto = (linhas: Record<string, unknown>[] | null) =>
        (linhas ?? []).map(l => {
          const o: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(l)) {
            if (v == null || v === '') continue
            o[k] = k === 'created_at' ? String(v).slice(0, 10) : v
          }
          return o
        })

      // Histórico de mudanças: com o "antes" gravado na auditoria a IA consegue
      // responder "qual era o valor antes?" e reverter sem perguntar ao admin.
      const { data: auditoria } = await db.from('precos_auditoria')
        .select('acao, detalhe, criado_em').order('criado_em', { ascending: false }).limit(25)
      const mudancas = (auditoria ?? []).map(a => {
        const d = (a.detalhe ?? {}) as Record<string, unknown>
        const antes = d.antes as Record<string, unknown> | Array<Record<string, unknown>> | undefined
        const valorAntes = Array.isArray(antes)
          ? antes.map(x => x.preco ?? x.valor).join(' / ')
          : (antes?.valor ?? antes?.preco ?? antes?.custo ?? null)
        return {
          quando: String(a.criado_em).slice(0, 16).replace('T', ' '),
          o_que: a.acao,
          alvo: d.item ?? d.nome ?? d.chave ?? d.tecido ?? d.modelo ?? d.id ?? null,
          detalhe_alvo: [d.familia, d.cor, d.espessura, d.categoria].filter(Boolean).join(' ') || null,
          de: valorAntes,
          para: d.valor ?? d.preco ?? d.custo ?? d.desconto_pct ?? null,
        }
      })

      const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
      const sistema = `Você é a assistente de gestão de preços da Sombrear (persianas). Hoje é ${hoje}.
O admin descreve mudanças em linguagem natural (digitada ou FALADA); você devolve APENAS um JSON válido:
{"transcricao": "se veio áudio: o que o admin disse, palavra por palavra; sem áudio: string vazia",
 "resposta": "texto curto e simpático confirmando o que entendeu (ou perguntando o que faltou)",
 "acoes": [lista de ações — VAZIA se faltar informação ou o pedido não for sobre preços]}

ÁUDIO: quando a mensagem do admin vier como áudio, (a) transcreva fielmente em português do Brasil no campo
"transcricao", sem corrigir nem resumir; (b) trate essa transcrição EXATAMENTE como um pedido digitado
(mesmas regras, mesma confirmação). Números falados viram números: "dois vírgula nove" = 2.9,
"um oitenta e cinco" falando de markup = 1.85, "dez por cento" = 10. Se o áudio estiver mudo ou
ininteligível: transcricao vazia, acoes vazia e peça pra repetir. Nunca invente o que não foi dito.

Tipos de ação permitidos (use EXATAMENTE estes campos):
- {"tipo":"criar_promocao","tecido":"NOME EXATO","desconto_pct":10,"inicio":"YYYY-MM-DD","fim":"YYYY-MM-DD"}
- {"tipo":"remover_promocao","id":123}
- {"tipo":"atualizar_preco_tecido","nome":"NOME EXATO","largura":null ou número,"preco":36.00}  (largura null = todas as larguras)
- {"tipo":"atualizar_parametro","chave":"chave_exata","valor":2.8}
- {"tipo":"atualizar_preco_artigo","categoria":"PV" ou "PH_ALUMINIO","nome":"NOME EXATO","preco":50.00}
- {"tipo":"atualizar_componente_ferragem","id":123,"item":"nome do item (informativo)","valor":14.00}  (use o id do componente listado em FERRAGENS; a escada inteira recalcula sozinha)
- {"tipo":"atualizar_ph50","modelo":"MODELO EXATO","cor":"COR EXATA","campo":"preco_cadarco|preco_fita|bando_ml|aba_pc","valor":250.00}
- {"tipo":"atualizar_bando_param","cor":"BRANCO" ou "PRETO","campo":"preco_metro|par|cd1|cd2","valor":30.00}
- {"tipo":"atualizar_colocacao","id":1,"preco":85.00}  (use o id da faixa em INSTALAÇÃO)
- {"tipo":"atualizar_barra_faixa","largura_min":2.5,"qtd_presilhas":3}
- {"tipo":"atualizar_motor_componente","item":"ITEM EXATO","custo":399.00}
- {"tipo":"atualizar_motor_estrutura","id":1,"valor":66.13}  (use o id da linha em MOTOR estrutura)
- {"tipo":"atualizar_romana","largura":1.30,"altura":1.20,"custo":100.68}  (célula exata da matriz, passos de 0,10 entre 1,00 e 4,00)

Regras:
- Use APENAS nomes que existem nos dados abaixo (case exato). Se o admin falar "screen 3 bege", encontre "SCREEN 3% BEGE".
- Um pedido pode gerar várias ações (até ${MAX_ACOES}). Promoção é por NOME de tecido: "screen 1% em promoção" gera
  uma ação criar_promocao para cada nome distinto de tecido que casar com "screen 1%" (não uma por largura).
- Mudar vários parâmetros num só pedido é normal ("sobe o markup de venda pra 2,9 e o de PV pra 1,85"): uma
  atualizar_parametro por chave. Valor que pareça erro (28 em vez de 2,8): proponha o que ouviu — o sistema
  marca o suspeito pro admin conferir — e comente isso na resposta.
- Datas relativas: resolva com base em hoje ("a partir de segunda", "até o fim do mês").
- NUNCA invente valores. Dúvida ou ambiguidade → acoes vazia + pergunta na resposta.
- Pedidos fora de preços/promoções/parâmetros → acoes vazia + explique educadamente.

MARGENS E TAXAS (tabela PARÂMETROS abaixo; a chave é o que você usa em atualizar_parametro):
- markup_venda: persianas de tecido (Rolô, Double, Romana e a parte tecido do Motorizado). Venda = custo × markup × taxa_parcelamento².
- markup_acabamento: bandô e barra dessas persianas; mesma fórmula, markup próprio.
- markup_motorizacao: só o motor do Rolô Motorizado. Venda = custo × markup, SEM taxa de parcelamento.
- markup_venda_pv_ph: PV e PH Alumínio 25mm ("o markup do PV"). Venda = custo × markup × taxa_parcelamento².
- markup_venda_ph50, taxa_ph50, markup_bando_ph50, bando_ph50_venda_fixo: PH 50mm. Venda = custo × markup × taxa_ph50 (não usa o parcelamento geral); o bandô tem markup próprio e uma parcela fixa em R$ (bando_ph50_venda_fixo NÃO é markup).
- taxa_parcelamento: juros do parcelamento; entra ao QUADRADO (2×) na venda de todos os modelos, exceto PH 50mm.
- desconto_avista_pct: % de desconto sobre o total para pagamento à vista.
- parceiro_* e custo_parceiro: quanto a loja PAGA à empresa parceira = custo de tabela × número (custo_parceiro é o padrão; os demais são por item: tecido, romana, ferragem, bandô, barra, kitbox, motor). NÃO mudam o preço do cliente; servem pra margem e pro fechamento com a parceira.
- markup_atacado: tabela de atacado nova, ainda não entra em nenhum orçamento.
- kitbox*, barra_*: são custos/fórmulas, não margens (só cite se pedirem).
Quando pedirem "as margens / markups / taxas que usamos", liste TODOS os parâmetros de PARÂMETROS cuja chave começa com markup_, taxa_, desconto_ ou parceiro_ (mais custo_parceiro e bando_ph50_venda_fixo), sem omitir nenhum, agrupados por assunto: um título em **negrito** e, abaixo, uma tabela markdown:
| Chave | Valor atual | O que significa |
|---|---|---|
Valor como está no banco, com vírgula decimal (2,8). "O que significa" em português simples e curto. Termine com uma frase dizendo que basta pedir a mudança (por voz ou texto) que você prepara a proposta pra ele conferir.

Consulta: você PODE responder perguntas de preço sobre QUALQUER dado abaixo (ferragens, PH 50,
bandôs, barra, instalação, motor) — cite o valor exato — E TAMBÉM sobre os orçamentos e vendas
listados adiante (quem comprou, quanto pagou, quanto vai pra parceira, totais do período). Edição: TUDO acima é editável pelas ações;
apenas criar/remover LINHAS (tecido novo, faixa nova etc.) se faz na aba correspondente.
Romana: a matriz não está listada aqui — para EDITAR uma célula use atualizar_romana com a célula
exata que o admin informar; para CONSULTAR valores dela, indique a aba Ferragens › ROMANA.

DADOS ATUAIS:
TECIDOS: ${JSON.stringify(tecidos)}
PROMOÇÕES: ${JSON.stringify(promos)}
PARÂMETROS: ${JSON.stringify(params)}
ARTIGOS (PV/PH Alumínio, preço por m²): ${JSON.stringify(artigos)}
FERRAGENS (componentes; escada = soma(por_metro)×largura + soma(fixo); 'opcional_*' fica fora da soma): ${JSON.stringify(ferragens)}
PH 50MM (preço por m²): ${JSON.stringify(ph50)}
BANDÔ (preço = largura×preco_metro + qtd_cd×(cd1+cd2) + par): params=${JSON.stringify(bandoParams)} escada=${JSON.stringify(bandos)}
BARRA NIVELADORA (preço = metro×largura + presilha×qtd; params barra_* acima): faixas=${JSON.stringify(barraFaixas)}
INSTALAÇÃO (por metro linear): ${JSON.stringify(colocacao)}
MOTOR: estrutura=${JSON.stringify(motorEst)} componentes=${JSON.stringify(motorComp)}
ROMANA: a ferragem é uma matriz largura×altura (31×31) editável na aba Ferragens › ROMANA — grande demais pra listar aqui.

VENDAS FECHADAS (as 60 mais recentes — é o que aparece na aba Fechamento):
${JSON.stringify(compacto(vendas))}
ORÇAMENTOS EM ABERTO (os 40 mais recentes):
${JSON.stringify(compacto(recentes))}
Sobre esses dados, você PODE responder: quem comprou o quê, por quanto, quanto foi cobrado de
verdade (valor_cobrado quando existe, senão valor_venda), quanto vai/foi pago à parceira
(valor_parceiro_pago quando existe, senão valor_parceiro), custo, margem, totais por período,
por cliente, por modelo ou por responsável. Some você mesmo quando pedirem totais.
LIMITE HONESTO: o custo gravado (custo_tecido) é o custo do PRODUTO somado — a separação entre
tecido e ferragem NÃO é guardada por orçamento. Se pedirem essa separação, diga isso e ofereça o
custo total do produto e o do acabamento, ou o cálculo pelas tabelas para aquelas medidas.
Se o cliente citado não estiver nas listas acima, diga que não achou nas vendas recentes em vez de inventar.

MUDANÇAS JÁ FEITAS (mais recente primeiro; "de"=valor anterior, "para"=valor que entrou):
${JSON.stringify(mudancas)}
Use esta lista para responder "qual era o valor antes?" e para reverter ("volta pro valor anterior"):
pegue o "de" da mudança mais recente daquele item e proponha a ação com esse valor — NÃO pergunte ao
admin um valor que já está aqui. Se o item não aparecer na lista, aí sim diga que não há registro.`

      const historico = Array.isArray(body.historico) ? body.historico.slice(-6) : []
      const contents = [
        ...historico.map((h: { papel: string; texto: string }) => ({
          role: h.papel === 'user' ? 'user' : 'model',
          parts: [{ text: String(h.texto).slice(0, 1000) }],
        })),
        {
          role: 'user',
          parts: [
            { text: mensagem.trim() || 'Pedido enviado por áudio — transcreva e execute.' },
            ...(audio?.ok ? [{ inline_data: { mime_type: audio.mimeType, data: audio.data } }] : []),
          ],
        },
      ]

      const apiKey = Deno.env.get('GEMINI_API_KEY')!
      const corpo = JSON.stringify({
        systemInstruction: { parts: [{ text: sistema }] },
        contents,
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      })
      // modelos em ordem de preferência (1.5 foi aposentado; mantém fallback)
      // Uma chamada ao Gemini com fallback de modelo. Devolve o JSON já interpretado
      // (ou null se o texto não for JSON válido) ou o último erro HTTP.
      async function perguntar(): Promise<{ parsed: Record<string, unknown> | null } | { erro: unknown }> {
        let ultimoErro: unknown = null
        for (const modelo of ['gemini-3.7-flash', 'gemini-flash-latest']) {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo },
          )
          const json = await res.json()
          if (res.ok) {
            const texto = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
            return { parsed: extrairJson(String(texto)) }
          }
          ultimoErro = json
          console.error(`precos-ia: modelo ${modelo} falhou`, JSON.stringify(json).slice(0, 300))
        }
        return { erro: ultimoErro }
      }

      // JSON inválido do modelo: tenta UMA vez de novo antes de desistir
      let r = await perguntar()
      if ('parsed' in r && !r.parsed) {
        console.error('precos-ia: JSON inválido do modelo, repetindo uma vez')
        r = await perguntar()
      }
      if ('erro' in r) return resposta(502, { error: 'Nenhum modelo Gemini respondeu', detalhe: r.erro })
      const parsed = r.parsed ?? { resposta: 'Não consegui interpretar — pode reformular?', acoes: [] }

      // Trava de sanidade: parâmetro fora do normal volta marcado, e o admin confirma de novo.
      const atualPorChave = new Map((params ?? []).map((p: { chave: string; valor: unknown }) => [p.chave, Number(p.valor)] as [string, number]))
      const acoes = (Array.isArray(parsed.acoes) ? parsed.acoes : [])
        .filter((a) => a && typeof a === 'object' && TIPOS_VALIDOS.has((a as { tipo?: string }).tipo ?? ''))
        .slice(0, MAX_ACOES)
        .map((a) => {
          const acao = { ...(a as Record<string, unknown>) }
          // a IA não decide a própria confirmação nem o lote
          delete acao.suspeita; delete acao.motivo; delete acao.confirmada_suspeita; delete acao.atual
          if (acao.tipo === 'atualizar_parametro') {
            const atual = atualPorChave.get(String(acao.chave))
            if (atual != null && Number.isFinite(atual)) acao.atual = atual
            const v = avaliarParametro(String(acao.chave), atual, acao.valor)
            if (v.invalido) { acao.suspeita = true; acao.motivo = v.invalido }
            else if (v.suspeita) { acao.suspeita = true; acao.motivo = v.motivo }
          }
          return acao
        })
      return resposta(200, {
        resposta: String(parsed.resposta ?? ''),
        acoes,
        transcricao: audio?.ok ? String(parsed.transcricao ?? '').trim() : '',
      })
    }

    // ══════════════ MODO APLICAR ══════════════
    if (body.modo === 'aplicar') {
      const acoes = Array.isArray(body.acoes) ? body.acoes : []
      if (acoes.length === 0) return resposta(400, { error: 'Nenhuma ação para aplicar' })
      if (acoes.length > MAX_ACOES) return resposta(400, { error: `Máximo de ${MAX_ACOES} ações por vez` })
      // todas as linhas de auditoria deste "Aplicar" levam o mesmo lote (vai dentro do `detalhe`,
      // porque precos_auditoria não tem coluna própria) — o front usa pra "Desfazer tudo"
      const loteId = crypto.randomUUID()

      // FASE 1: validar TODAS as ações antes de aplicar qualquer uma
      // (evita aplicação parcial: ou entra tudo, ou nada entra)
      for (const acao of acoes) {
        const tipo = String(acao.tipo ?? '')
        if (!TIPOS_VALIDOS.has(tipo)) return resposta(400, { error: `Ação desconhecida: ${tipo}` })
        if (tipo === 'criar_promocao') {
          const pct = Number(acao.desconto_pct)
          if (!(pct > 0 && pct < 100)) return resposta(400, { error: `Desconto inválido em ${acao.tecido}` })
          if (!acao.inicio || !acao.fim || String(acao.fim) < String(acao.inicio)) return resposta(400, { error: `Período inválido em ${acao.tecido}` })
          const { count } = await db.from('precos_tecidos').select('id', { count: 'exact', head: true }).eq('nome', acao.tecido)
          if (!count) return resposta(400, { error: `Tecido não encontrado: ${acao.tecido}` })
        } else if (tipo === 'remover_promocao') {
          const { count } = await db.from('precos_promocoes').select('id', { count: 'exact', head: true }).eq('id', Number(acao.id))
          if (!count) return resposta(400, { error: `Promoção #${acao.id} não existe` })
        } else if (tipo === 'atualizar_preco_tecido') {
          if (!(Number(acao.preco) > 0)) return resposta(400, { error: `Preço inválido em ${acao.nome}` })
          let qv = db.from('precos_tecidos').select('id', { count: 'exact', head: true }).eq('nome', acao.nome)
          if (acao.largura != null) qv = qv.eq('largura', Number(acao.largura))
          const { count } = await qv
          if (!count) return resposta(400, { error: `Tecido não encontrado: ${acao.nome}` })
        } else if (tipo === 'atualizar_parametro') {
          const { data: atualRow } = await db.from('precos_parametros').select('valor').eq('chave', String(acao.chave)).maybeSingle()
          if (!atualRow) return resposta(400, { error: `Parâmetro não encontrado: ${acao.chave}` })
          const v = avaliarParametro(String(acao.chave), Number(atualRow.valor), acao.valor)
          if (v.invalido) return resposta(400, { error: v.invalido })
          // valor fora do normal só entra se o admin marcou a confirmação extra
          if (v.suspeita && acao.confirmada_suspeita !== true) {
            return resposta(400, { error: `Parâmetro ${acao.chave} precisa de confirmação extra: ${v.motivo}` })
          }
        } else if (tipo === 'atualizar_preco_artigo') {
          if (!(Number(acao.preco) > 0)) return resposta(400, { error: `Preço inválido em ${acao.nome}` })
          const { count } = await db.from('precos_artigos').select('id', { count: 'exact', head: true })
            .eq('categoria', String(acao.categoria)).eq('nome', String(acao.nome))
          if (!count) return resposta(400, { error: `Artigo não encontrado: ${acao.nome}` })
        } else if (tipo === 'atualizar_componente_ferragem') {
          if (!(Number(acao.valor) > 0)) return resposta(400, { error: `Valor inválido no componente ${acao.item ?? acao.id}` })
          // id é o caminho feliz; sem ele (ou com id inválido) resolvemos pelo nome do item
          const alvo = await acharComponente(db, acao)
          if ('erro' in alvo) return resposta(400, { error: alvo.erro })
          acao.id = alvo.id // normaliza pra FASE 2 aplicar por id
        } else if (tipo === 'atualizar_ph50') {
          if (!CAMPOS_PH50.has(String(acao.campo))) return resposta(400, { error: `Campo inválido no PH 50: ${acao.campo}` })
          if (!(Number(acao.valor) > 0)) return resposta(400, { error: `Valor inválido em ${acao.modelo} ${acao.cor}` })
          const { count } = await db.from('precos_ph50').select('id', { count: 'exact', head: true })
            .eq('modelo', String(acao.modelo)).eq('cor', String(acao.cor))
          if (!count) return resposta(400, { error: `Item PH 50 não encontrado: ${acao.modelo} ${acao.cor}` })
        } else if (tipo === 'atualizar_bando_param') {
          if (!CAMPOS_BANDO.has(String(acao.campo))) return resposta(400, { error: `Campo inválido no bandô: ${acao.campo}` })
          if (!(Number(acao.valor) > 0)) return resposta(400, { error: `Valor inválido no bandô ${acao.cor}` })
          const { count } = await db.from('precos_bandos_params').select('cor', { count: 'exact', head: true }).eq('cor', String(acao.cor))
          if (!count) return resposta(400, { error: `Bandô não encontrado: ${acao.cor}` })
        } else if (tipo === 'atualizar_colocacao') {
          if (!(Number(acao.preco) > 0)) return resposta(400, { error: 'Preço de instalação inválido' })
          const { count } = await db.from('precos_colocacao').select('id', { count: 'exact', head: true }).eq('id', Number(acao.id))
          if (!count) return resposta(400, { error: `Faixa de instalação #${acao.id} não existe` })
        } else if (tipo === 'atualizar_barra_faixa') {
          const qtd = Number(acao.qtd_presilhas)
          if (!(Number.isInteger(qtd) && qtd > 0)) return resposta(400, { error: 'Quantidade de presilhas inválida' })
          const { count } = await db.from('precos_barra_faixas').select('largura_min', { count: 'exact', head: true })
            .eq('largura_min', Number(acao.largura_min))
          if (!count) return resposta(400, { error: `Faixa da barra não encontrada: a partir de ${acao.largura_min}m` })
        } else if (tipo === 'atualizar_motor_componente') {
          if (!(Number(acao.custo) > 0)) return resposta(400, { error: `Custo inválido em ${acao.item}` })
          const { count } = await db.from('precos_motor_componentes').select('id', { count: 'exact', head: true }).eq('item', String(acao.item))
          if (!count) return resposta(400, { error: `Componente de motor não encontrado: ${acao.item}` })
        } else if (tipo === 'atualizar_motor_estrutura') {
          if (!(Number(acao.valor) > 0)) return resposta(400, { error: 'Valor de estrutura inválido' })
          const { count } = await db.from('precos_motor_estrutura').select('id', { count: 'exact', head: true }).eq('id', Number(acao.id))
          if (!count) return resposta(400, { error: `Linha de estrutura #${acao.id} não existe` })
        } else if (tipo === 'atualizar_romana') {
          if (!(Number(acao.custo) > 0)) return resposta(400, { error: 'Custo inválido na matriz Romana' })
          const { count } = await db.from('precos_romana_matriz').select('largura', { count: 'exact', head: true })
            .eq('largura', Number(acao.largura)).eq('altura', Number(acao.altura))
          if (!count) return resposta(400, { error: `Célula ${acao.largura}×${acao.altura} não existe na matriz Romana` })
        }
      }

      // FASE 2: aplicar (tudo já validado) — guarda o "antes" no detalhe pra permitir o Desfazer
      const aplicadas: string[] = []
      for (const acao of acoes) {
        const tipo = String(acao.tipo ?? '')
        // sinalizadores de tela não são parte do que foi aplicado
        const { suspeita: _s, motivo: _m, atual: _a, confirmada_suspeita: _c, ...limpa } = acao
        let detalhe: Record<string, unknown> = { ...limpa, lote_id: loteId }
        if (_s === true && _c === true) detalhe.confirmada_suspeita = true

        if (tipo === 'criar_promocao') {
          const pct = Number(acao.desconto_pct)
          const { data: nova, error } = await db.from('precos_promocoes').insert({
            alvo_tipo: 'tecido', alvo_nome: acao.tecido, desconto_pct: pct, inicio: acao.inicio, fim: acao.fim,
          }).select('id').single()
          if (error) throw error
          detalhe = { ...detalhe, promo_id: nova?.id }
          aplicadas.push(`Promoção: ${acao.tecido} −${pct}% (${acao.inicio} → ${acao.fim})`)
        } else if (tipo === 'remover_promocao') {
          const { data: antes } = await db.from('precos_promocoes').select('*').eq('id', Number(acao.id)).single()
          const { error } = await db.from('precos_promocoes').delete().eq('id', Number(acao.id))
          if (error) throw error
          detalhe = { ...detalhe, antes }
          aplicadas.push(`Promoção #${acao.id} removida`)
        } else if (tipo === 'atualizar_preco_tecido') {
          const preco = Number(acao.preco)
          let qa = db.from('precos_tecidos').select('id, largura, preco').eq('nome', acao.nome)
          if (acao.largura != null) qa = qa.eq('largura', Number(acao.largura))
          const { data: antes } = await qa
          let q = db.from('precos_tecidos').update({ preco }).eq('nome', acao.nome)
          if (acao.largura != null) q = q.eq('largura', Number(acao.largura))
          const { data: tocadas, error } = await q.select('id')
          if (error) throw error
          if (!tocadas?.length) throw new Error(`Tecido não encontrado: ${acao.nome}`)
          detalhe = { ...detalhe, antes }
          aplicadas.push(`Preço: ${acao.nome}${acao.largura != null ? ` (${acao.largura}m)` : ''} → R$ ${preco.toFixed(2)}`)
        } else if (tipo === 'atualizar_parametro') {
          const { data: antes } = await db.from('precos_parametros').select('valor').eq('chave', String(acao.chave)).single()
          const { data: tocadas, error } = await db.from('precos_parametros')
            .update({ valor: Number(acao.valor) }).eq('chave', String(acao.chave)).select('chave')
          if (error) throw error
          if (!tocadas?.length) throw new Error(`Parâmetro não encontrado: ${acao.chave}`)
          detalhe = { ...detalhe, antes }
          aplicadas.push(`Parâmetro: ${acao.chave} → ${acao.valor}`)
        } else if (tipo === 'atualizar_preco_artigo') {
          const preco = Number(acao.preco)
          const { data: antes } = await db.from('precos_artigos').select('preco')
            .eq('categoria', String(acao.categoria)).eq('nome', String(acao.nome)).single()
          const { data: tocadas, error } = await db.from('precos_artigos')
            .update({ preco }).eq('categoria', String(acao.categoria)).eq('nome', String(acao.nome))
            .select('id')
          if (error) throw error
          if (!tocadas?.length) throw new Error(`Artigo não encontrado: ${acao.nome}`)
          detalhe = { ...detalhe, antes }
          aplicadas.push(`Artigo: ${acao.nome} → R$ ${preco.toFixed(2)}`)
        } else if (tipo === 'atualizar_componente_ferragem') {
          const valor = Number(acao.valor)
          const { data: antes } = await db.from('precos_ferragem_componentes')
            .select('familia, cor, espessura, item, valor').eq('id', Number(acao.id)).single()
          const { data: tocadas, error } = await db.from('precos_ferragem_componentes')
            .update({ valor }).eq('id', Number(acao.id)).select('id')
          if (error) throw error
          if (!tocadas?.length) throw new Error(`Componente #${acao.id} não encontrado`)
          detalhe = { ...detalhe, antes }
          aplicadas.push(`Ferragem: ${antes?.item ?? acao.item ?? `componente #${acao.id}`} (${antes?.familia ?? ''} ${antes?.cor ?? ''}) → R$ ${valor.toFixed(2)}`)
        } else if (tipo === 'atualizar_ph50') {
          const campo = String(acao.campo), valor = Number(acao.valor)
          const { data: antes } = await db.from('precos_ph50').select(campo)
            .eq('modelo', String(acao.modelo)).eq('cor', String(acao.cor)).single()
          const { error } = await db.from('precos_ph50').update({ [campo]: valor })
            .eq('modelo', String(acao.modelo)).eq('cor', String(acao.cor))
          if (error) throw error
          detalhe = { ...detalhe, antes }
          aplicadas.push(`PH 50 ${acao.modelo} ${acao.cor}: ${campo} → R$ ${valor.toFixed(2)}`)
        } else if (tipo === 'atualizar_bando_param') {
          const campo = String(acao.campo), valor = Number(acao.valor)
          const { data: antes } = await db.from('precos_bandos_params').select(campo).eq('cor', String(acao.cor)).single()
          const { error } = await db.from('precos_bandos_params').update({ [campo]: valor }).eq('cor', String(acao.cor))
          if (error) throw error
          detalhe = { ...detalhe, antes }
          aplicadas.push(`Bandô ${acao.cor}: ${campo} → R$ ${valor.toFixed(2)}`)
        } else if (tipo === 'atualizar_colocacao') {
          const preco = Number(acao.preco)
          const { data: antes } = await db.from('precos_colocacao').select('ml_min, ml_max, preco').eq('id', Number(acao.id)).single()
          const { error } = await db.from('precos_colocacao').update({ preco }).eq('id', Number(acao.id))
          if (error) throw error
          detalhe = { ...detalhe, antes }
          aplicadas.push(`Instalação (${antes?.ml_min}–${antes?.ml_max}ml) → R$ ${preco.toFixed(2)}`)
        } else if (tipo === 'atualizar_barra_faixa') {
          const qtd = Number(acao.qtd_presilhas)
          const { data: antes } = await db.from('precos_barra_faixas').select('qtd_presilhas')
            .eq('largura_min', Number(acao.largura_min)).single()
          const { error } = await db.from('precos_barra_faixas').update({ qtd_presilhas: qtd })
            .eq('largura_min', Number(acao.largura_min))
          if (error) throw error
          detalhe = { ...detalhe, antes }
          aplicadas.push(`Barra: a partir de ${acao.largura_min}m → ${qtd} presilhas`)
        } else if (tipo === 'atualizar_motor_componente') {
          const custo = Number(acao.custo)
          const { data: antes } = await db.from('precos_motor_componentes').select('custo').eq('item', String(acao.item)).single()
          const { error } = await db.from('precos_motor_componentes').update({ custo }).eq('item', String(acao.item))
          if (error) throw error
          detalhe = { ...detalhe, antes }
          aplicadas.push(`Motor: ${acao.item} → R$ ${custo.toFixed(2)}`)
        } else if (tipo === 'atualizar_motor_estrutura') {
          const valor = Number(acao.valor)
          const { data: antes } = await db.from('precos_motor_estrutura').select('largura, alt_faixa, valor').eq('id', Number(acao.id)).single()
          const { error } = await db.from('precos_motor_estrutura').update({ valor }).eq('id', Number(acao.id))
          if (error) throw error
          detalhe = { ...detalhe, antes }
          aplicadas.push(`Motor estrutura (${antes?.largura}m, ${antes?.alt_faixa}) → R$ ${valor.toFixed(2)}`)
        } else if (tipo === 'atualizar_romana') {
          const custo = Number(acao.custo)
          const { data: antes } = await db.from('precos_romana_matriz').select('custo')
            .eq('largura', Number(acao.largura)).eq('altura', Number(acao.altura)).single()
          const { error } = await db.from('precos_romana_matriz').update({ custo })
            .eq('largura', Number(acao.largura)).eq('altura', Number(acao.altura))
          if (error) throw error
          detalhe = { ...detalhe, antes }
          aplicadas.push(`Romana ${acao.largura}×${acao.altura}m → R$ ${custo.toFixed(2)}`)
        }

        await db.from('precos_auditoria').insert({
          usuario: caller.email ?? caller.id, origem: 'ia', acao: tipo, detalhe,
        })
      }

      // Aqui havia um POST para /webhook/sincronizar-precos espelhando os preços
      // numa planilha. Removido em 26/09: o workflow do n8n está desativado, e o
      // comentário antigo dizia "sync agendado cobre" — mas o cron dele também
      // está desligado. Ou seja, a falha era engolida e nada cobria. Preço
      // aplicado aqui já vale na hora, porque o motor lê as tabelas direto.

      return resposta(200, { ok: true, aplicadas, lote_id: loteId })
    }

    return resposta(400, { error: 'modo deve ser "propor" ou "aplicar"' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro interno'
    return resposta(500, { error: message })
  }
})
