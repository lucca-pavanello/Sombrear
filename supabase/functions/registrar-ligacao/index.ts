/**
 * Edge Function: registrar-ligacao
 *
 * A Amanda de voz chama quando a ligação termina:
 *   POST com header x-chave: <LIGACAO_SECRET> e o corpo de ./registrar.ts (Ligacao).
 * Guarda a ligação, cria/atualiza o lead no CRM, manda as mensagens no WhatsApp pelo Chatwoot,
 * deixa a nota da equipe e o lembrete na memória da Amanda do WhatsApp. Sem JWT: o servidor da
 * voz não tem usuário, a prova é a chave.
 *
 * Env: LIGACAO_SECRET, CHATWOOT_URL, CHATWOOT_SOMBREAR_TOKEN e os do Supabase.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { preflight, resposta } from '../_shared/resposta.ts'
import type { Pedir } from './chatwoot.ts'
import { registrar, type Db, type Lead, type Ligacao, type StatusWhatsapp } from './registrar.ts'

const CONTA = 1
const CAMPOS_LEAD = 'id, nome, status_lead, resumo_conversa, chatwoot_labels, precisa_humano, id_conversa_chatwoot'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

const pedir: Pedir = async (metodo, caminho, corpo) => {
  const base = (Deno.env.get('CHATWOOT_URL') ?? '').replace(/\/$/, '')
  const r = await fetch(`${base}/api/v1/accounts/${CONTA}${caminho}`, {
    method: metodo,
    headers: { api_access_token: Deno.env.get('CHATWOOT_SOMBREAR_TOKEN') ?? '', 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  if (!r.ok) throw new Error(`chatwoot ${r.status} em ${metodo} ${caminho.split('?')[0]}`)
  return r.json()
}

function ok<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error
  return r.data
}

const db: Db = {
  async statusLigacao(ref) {
    const d = ok(await sb.from('ligacoes').select('whatsapp_status').eq('ref', ref).maybeSingle())
    return (d?.whatsapp_status as StatusWhatsapp) ?? null
  },
  async salvarLigacao(linha) {
    ok(await sb.from('ligacoes').upsert(linha, { onConflict: 'ref' }))
  },
  async acharLead(identificador) {
    return ok(await sb.from('crm_sombrear_ia').select(CAMPOS_LEAD).eq('identificador_usuario', identificador).maybeSingle()) as Lead | null
  },
  async criarLead(campos) {
    return ok(await sb.from('crm_sombrear_ia').insert(campos).select(CAMPOS_LEAD).single()) as Lead
  },
  async atualizarLead(id, campos) {
    ok(await sb.from('crm_sombrear_ia').update(campos).eq('id', id))
  },
  async lembrar(sessao, texto) {
    // o formato que a memória Postgres do n8n (LangChain) grava e lê
    ok(await sb.from('n8n_chat_histories').insert({
      session_id: sessao,
      message: { type: 'ai', content: texto, tool_calls: [], invalid_tool_calls: [], additional_kwargs: {}, response_metadata: {} },
    }))
  },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  const esperado = Deno.env.get('LIGACAO_SECRET')
  if (!esperado || req.headers.get('x-chave') !== esperado) return resposta(401, { erro: 'não autorizado' })
  let lig: Ligacao
  try {
    lig = await req.json()
  } catch {
    return resposta(400, { erro: 'corpo inválido' })
  }
  if (!lig?.ref || !lig?.inicio) return resposta(400, { erro: 'faltam ref e inicio' })
  try {
    return resposta(200, await registrar(lig, db, pedir))
  } catch (e) {
    console.error('registrar-ligacao', e)
    return resposta(500, { erro: e instanceof Error ? e.message : String(e) })
  }
})
