/**
 * Edge Function: copilot-ia
 *
 * O copiloto do dash (src/components/shared/AICopilot.tsx via src/hooks/useGemini.ts).
 * Antes o navegador mandava 11 números agregados como texto e o Gemini respondia em
 * cima deles: sem nomes, sem modelo, sem mês a mês, e com margem misturando as linhas
 * da calculadora. Agora a IA chama ferramentas de leitura (src/lib/copilot/ferramentas.ts)
 * que usam as mesmas regras de venda das telas, e só responde com o que elas devolvem.
 *
 * Segurança (padrão da classificar-conversas):
 *  - só usuário logado e aprovado em `profiles`;
 *  - as tabelas são lidas com o token de quem pergunta, então vale o RLS dele;
 *  - telefone é lido só para casar venda com lead e nunca vai para a IA;
 *  - orçamentos em aberto e desfechos vêm junto das vendas; as contas de venda seguem
 *    filtrando `fechado` (ehVenda), então os números de sempre não mudam.
 *
 * Pedido:   { pergunta: string, historico?: {role:'user'|'model', text}[], responsavel?: string }
 * Resposta: { ok: true, resposta } | { ok: false, erro }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { preflight, resposta } from '../_shared/resposta.ts'
import { FERRAMENTAS, instrucoes } from '../../../src/lib/copilot/prompt.ts'
import {
  hojeCasa, rodarFerramenta, type Dados, type LeadCopilot, type VendaCopilot,
} from '../../../src/lib/copilot/ferramentas.ts'

const MAX_RODADAS = 6
const MAX_PERGUNTA = 2000
const MAX_HISTORICO = 10
const MODELOS = ['gemini-3.7-flash', 'gemini-flash-latest']

type Parte = { text?: string; functionCall?: { name: string; args?: Record<string, unknown> }; [k: string]: unknown }
type Conteudo = { role: 'user' | 'model'; parts: Parte[] }

async function lerTudo<T>(pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const todos: T[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await pagina(de, de + 999)
    if (error) throw new Error(error.message)
    todos.push(...(data ?? []))
    if ((data ?? []).length < 1000) return todos
  }
}

async function chamarGemini(apiKey: string, corpo: unknown): Promise<{ ok: true; conteudo: Conteudo } | { ok: false; status: number; erro: string }> {
  let ultimo = { status: 500, erro: 'sem resposta' }
  for (const modelo of MODELOS) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(45_000),
      },
    )
    const data = await res.json().catch(() => null)
    if (res.ok) {
      const conteudo = data?.candidates?.[0]?.content as Conteudo | undefined
      if (conteudo?.parts?.length) return { ok: true, conteudo: { role: 'model', parts: conteudo.parts } }
      return { ok: false, status: 502, erro: `resposta vazia (${data?.candidates?.[0]?.finishReason ?? 'sem motivo'})` }
    }
    ultimo = { status: res.status, erro: JSON.stringify(data?.error ?? data).slice(0, 300) }
    // 404 = modelo indisponível, tenta o próximo; o resto para aqui
    if (res.status !== 404) break
  }
  return { ok: false, ...ultimo }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return resposta(401, { ok: false, erro: 'sessão' })

    const url = Deno.env.get('SUPABASE_URL')!
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const doUsuario = createClient(url, anon, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user } } = await doUsuario.auth.getUser()
    if (!user) return resposta(401, { ok: false, erro: 'sessão' })

    const admin = createClient(url, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: perfil } = await admin.from('profiles').select('approved').eq('id', user.id).single()
    if (perfil?.approved !== true) return resposta(403, { ok: false, erro: 'acesso pendente de aprovação' })

    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) return resposta(500, { ok: false, erro: 'GEMINI_API_KEY não configurada' })

    const corpo = await req.json().catch(() => null)
    const pergunta = String(corpo?.pergunta ?? '').trim().slice(0, MAX_PERGUNTA)
    if (!pergunta) return resposta(400, { ok: false, erro: 'pergunta vazia' })
    const responsavel = typeof corpo?.responsavel === 'string' && corpo.responsavel.trim() ? corpo.responsavel.trim() : null
    const historico: Conteudo[] = (Array.isArray(corpo?.historico) ? corpo.historico : [])
      .filter((m: { role?: string; text?: unknown }) => (m?.role === 'user' || m?.role === 'model') && typeof m.text === 'string' && m.text.trim())
      .slice(-MAX_HISTORICO)
      .map((m: { role: 'user' | 'model'; text: string }) => ({ role: m.role, parts: [{ text: m.text.slice(0, MAX_PERGUNTA) }] }))

    // ── Dados, com o RLS de quem pergunta ────────────────────────────────
    const [orcamentos, leads] = await Promise.all([
      lerTudo<VendaCopilot>((de, ate) => {
        let q = doUsuario.from('orcamentos')
          .select('id, cliente, valor_cobrado, valor_venda, instalacao, fechado, data_pedido, created_at, pedido_id, modelo, responsavel, origem, telefone, margem, ' +
            'desfecho, desfecho_em, desfecho_motivo')
        if (responsavel) q = q.eq('responsavel', responsavel)
        return q.order('id').range(de, ate)
      }),
      lerTudo<LeadCopilot>((de, ate) => doUsuario.from('crm_sombrear_ia')
        .select('id, created_at, nome, whatsapp, identificador_usuario, status_lead, origem, ultimo_valor_cotado, ' +
          'timestamp_ultima_msg, lead_temperatura, lead_score, modelo_interesse, ambiente, cidade, resumo_conversa, ' +
          'objecoes, chatwoot_labels, precisa_humano')
        .order('id')
        .range(de, ate)),
    ])
    const dados: Dados = { orcamentos, leads }

    // ── Laço de ferramentas ─────────────────────────────────────────────
    const agora = new Date()
    const hoje = hojeCasa(agora)
    const diaSemana = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long' }).format(agora)
    const sistema = instrucoes(hoje, diaSemana) +
      (responsavel ? `\n\nAs vendas estão filtradas pelo responsável ${responsavel}; diga isso quando falar de venda.` : '')
    const conversa: Conteudo[] = [...historico, { role: 'user', parts: [{ text: pergunta }] }]

    for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
      const ultima = rodada === MAX_RODADAS - 1
      const r = await chamarGemini(apiKey, {
        systemInstruction: { parts: [{ text: sistema }] },
        contents: conversa,
        tools: [{ functionDeclarations: FERRAMENTAS }],
        // na última rodada a IA tem de responder com o que já tem
        toolConfig: { functionCallingConfig: { mode: ultima ? 'NONE' : 'AUTO' } },
        generationConfig: { temperature: 0.2 },
      })
      if (!r.ok) {
        console.error('[copilot-ia] Gemini falhou:', r.status, r.erro)
        return resposta(r.status === 429 ? 429 : 502, { ok: false, erro: r.status === 429 ? 'limite' : 'modelo' })
      }
      conversa.push(r.conteudo)
      const chamadas = r.conteudo.parts.filter((p) => p.functionCall)
      if (chamadas.length === 0) {
        const texto = r.conteudo.parts.map((p) => p.text ?? '').join('').trim()
        return resposta(200, { ok: true, resposta: texto || 'Não consegui montar uma resposta com os dados do dash. Tente perguntar de outro jeito.' })
      }
      conversa.push({
        role: 'user',
        parts: chamadas.map((p) => ({
          functionResponse: {
            name: p.functionCall!.name,
            response: { resultado: rodarFerramenta(p.functionCall!.name, p.functionCall!.args ?? {}, dados, hoje) },
          },
        })),
      })
    }
    return resposta(200, { ok: true, resposta: 'Não consegui fechar a resposta. Tente uma pergunta mais direta.' })
  } catch (err) {
    console.error('[copilot-ia] erro:', err)
    return resposta(500, { ok: false, erro: 'interno' })
  }
})
