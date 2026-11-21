/**
 * Edge Function: mensagens-chatwoot
 *
 * Copia toda mensagem do WhatsApp da Sombrear (cliente, Amanda e equipe) do Chatwoot
 * para `mensagens_sombrear`. Duas entradas, o mesmo mapeamento (./mapear.ts):
 *
 * 1. Webhook do Chatwoot (conta 1, eventos message_created e message_updated; para a aba
 *    Conversas saber na hora de encerrada e etiqueta, também conversation_status_changed e
 *    conversation_updated): POST ?chave=<CHATWOOT_WEBHOOK_SECRET> com o corpo que o Chatwoot manda.
 * 2. Sincronização: relê conversas inteiras pela API do Chatwoot. Serve para a carga do
 *    passado e para conferir que nada escapou do webhook.
 *    POST ?chave=<CHATWOOT_WEBHOOK_SECRET> com { "sincronizar": [ids] } ou
 *    { "sincronizar": "pagina", "pagina": N } (uma página de 25 conversas da lista).
 *
 * Upsert pelo id da mensagem: repetir nunca duplica, e uma edição (mensagem apagada)
 * atualiza a linha. Sem JWT: o Chatwoot não manda, a prova é a chave na URL.
 *
 * Env: CHATWOOT_URL, CHATWOOT_SOMBREAR_TOKEN, CHATWOOT_WEBHOOK_SECRET, e os do Supabase.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { preflight, resposta } from '../_shared/resposta.ts'
import { estadoDaConversa, mapearMensagem, statusDe, statusFinal, type LinhaMensagem, type MensagemChatwoot } from './mapear.ts'

const CONTA = 1

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

function chaveConfere(req: Request): boolean {
  const esperado = Deno.env.get('CHATWOOT_WEBHOOK_SECRET')
  if (!esperado) return false
  return new URL(req.url).searchParams.get('chave') === esperado
}

async function chatwoot(caminho: string): Promise<any> {
  const base = (Deno.env.get('CHATWOOT_URL') ?? '').replace(/\/$/, '')
  const r = await fetch(`${base}/api/v1/accounts/${CONTA}${caminho}`, {
    headers: { api_access_token: Deno.env.get('CHATWOOT_SOMBREAR_TOKEN') ?? '' },
  })
  if (!r.ok) throw new Error(`chatwoot ${r.status} em ${caminho}`)
  return r.json()
}

/** conversa do Chatwoot → lead do CRM (o CRM guarda o id como texto) */
async function leadsDasConversas(ids: number[]): Promise<Map<number, string>> {
  const mapa = new Map<number, string>()
  if (!ids.length) return mapa
  const { data, error } = await db.from('crm_sombrear_ia')
    .select('id, id_conversa_chatwoot')
    .in('id_conversa_chatwoot', [...new Set(ids)].map(String))
  if (error) throw error
  for (const l of data ?? []) mapa.set(Number(l.id_conversa_chatwoot), l.id)
  return mapa
}

async function gravar(linhas: LinhaMensagem[]): Promise<number> {
  if (!linhas.length) return 0
  const leads = await leadsDasConversas(linhas.map(l => l.conversa_id))
  const agora = new Date().toISOString()
  const comLead = linhas.map(l => ({ ...l, lead_id: leads.get(l.conversa_id) ?? null, atualizada_em: agora }))
  // Enviada sem status (o webhook não mandou): grava sem as colunas de entrega, para o upsert
  // não apagar o "entregue" ou "lida" que já estava na linha. Dois lotes, cada um com as suas colunas.
  const semStatus = (l: LinhaMensagem) => l.autor !== 'cliente' && l.status_entrega === null
  const lotes = [
    comLead.filter(l => !semStatus(l)),
    comLead.filter(semStatus).map(({ status_entrega: _s, erro_entrega: _e, ...resto }) => resto),
  ]
  for (const lote of lotes) {
    for (let i = 0; i < lote.length; i += 500) {
      const { error } = await db.from('mensagens_sombrear').upsert(lote.slice(i, i + 500), { onConflict: 'id' })
      if (error) throw error
    }
  }
  return comLead.length
}

/** aberta/encerrada e etiquetas da conversa, para a aba Conversas; falha aqui não derruba a mensagem */
async function gravarEstado(body: Record<string, unknown>) {
  const estado = estadoDaConversa(body)
  if (!estado) return
  const { error } = await db.from('conversas_estado').upsert({ ...estado, atualizada_em: new Date().toISOString() }, { onConflict: 'conversa_id' })
  if (error) console.error('[mensagens-chatwoot] estado da conversa:', error.message)
}

/** o webhook de message_updated vem sem `status`: busca na última página da conversa (20 mensagens) */
async function statusPelaApi(linha: LinhaMensagem): Promise<LinhaMensagem> {
  try {
    const r = await chatwoot(`/conversations/${linha.conversa_id}/messages`)
    const m = ((r?.payload ?? []) as MensagemChatwoot[]).find(x => Number(x.id) === linha.id)
    if (!m) return linha
    return { ...linha, status_entrega: statusFinal(statusDe(m.status), linha.erro_entrega) }
  } catch (e) {
    console.error('[mensagens-chatwoot] status pela API:', e instanceof Error ? e.message : e)
    return linha
  }
}

/** todas as mensagens de uma conversa, da mais nova para trás (a API devolve 20 por vez) */
async function lerConversa(id: number): Promise<{ linhas: LinhaMensagem[]; lidas: number }> {
  const conversa = await chatwoot(`/conversations/${id}`)
  const telefone = conversa?.meta?.sender?.phone_number ?? null
  const msgs: MensagemChatwoot[] = []
  let antes: number | null = null
  for (;;) {
    const r = await chatwoot(`/conversations/${id}/messages${antes ? `?before=${antes}` : ''}`)
    const pagina: MensagemChatwoot[] = r?.payload ?? []
    if (!pagina.length) break
    msgs.push(...pagina)
    antes = Math.min(...pagina.map(m => m.id))
    if (pagina.length < 20) break
  }
  const linhas = msgs
    .map(m => mapearMensagem({ ...m, conversation_id: id, inbox_id: m.inbox_id ?? conversa?.inbox_id }, telefone))
    .filter((l): l is LinhaMensagem => l !== null)
  return { linhas, lidas: msgs.length }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  if (!chaveConfere(req)) return resposta(401, { error: 'Não autorizado' })

  const body = await req.json().catch(() => null) as Record<string, any> | null
  if (!body) return resposta(400, { error: 'corpo vazio' })

  try {
    // ── sincronização ──
    if ('sincronizar' in body) {
      let ids: number[] = []
      let total: number | null = null
      if (body.sincronizar === 'pagina') {
        const pagina = Number(body.pagina) || 1
        const r = await chatwoot(`/conversations?status=all&assignee_type=all&page=${pagina}`)
        ids = (r?.data?.payload ?? []).map((c: { id: number }) => c.id)
        total = r?.data?.meta?.all_count ?? null
      } else if (Array.isArray(body.sincronizar)) {
        ids = body.sincronizar.map(Number).filter(Boolean)
      }
      const porConversa: Record<number, { chatwoot: number; gravadas: number }> = {}
      for (const id of ids) {
        const { linhas, lidas } = await lerConversa(id)
        porConversa[id] = { chatwoot: lidas, gravadas: await gravar(linhas) }
      }
      return resposta(200, { ok: true, conversas: ids.length, total_conversas: total, porConversa })
    }

    // ── webhook ──
    const evento = String(body.event ?? '')
    const daConversa = evento === 'conversation_status_changed' || evento === 'conversation_updated'
    if (evento !== 'message_created' && evento !== 'message_updated' && !daConversa) {
      return resposta(200, { ok: true, ignorado: evento || 'sem evento' })
    }
    if (Number(body.account?.id) !== CONTA) return resposta(200, { ok: true, ignorado: 'outra conta' })
    await gravarEstado(body)
    if (daConversa) return resposta(200, { ok: true, conversa: Number(body.id) || null })
    let linha = mapearMensagem(body as MensagemChatwoot)
    if (!linha) return resposta(200, { ok: true, ignorado: 'não é mensagem' })
    if (evento === 'message_updated' && linha.autor !== 'cliente' && linha.status_entrega === null) {
      linha = await statusPelaApi(linha)
    }
    await gravar([linha])
    return resposta(200, { ok: true, id: linha.id, autor: linha.autor })
  } catch (e) {
    // 500 de propósito: o Chatwoot registra a falha, e a sincronização relê a conversa
    console.error('[mensagens-chatwoot]', e instanceof Error ? e.message : e)
    return resposta(500, { ok: false, erro: e instanceof Error ? e.message : String(e) })
  }
})
