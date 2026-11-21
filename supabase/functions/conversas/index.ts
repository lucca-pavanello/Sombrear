/**
 * Edge Function: conversas
 *
 * A equipe responde o WhatsApp pela aba Conversas do dash. Toda escrita no Chatwoot passa por
 * aqui; a tela só lê o espelho (`conversas_sombrear`, `mensagens_sombrear`).
 *
 * POST com o JWT de quem está logado. JSON { acao, conversa_id, ... } ou multipart (acao,
 * conversa_id, texto opcional como legenda, voz, arquivo):
 *  · enviar    { conversa_id, texto } ou multipart com arquivo → { ok, mensagem_id, etiquetas }
 *  · ia        { conversa_id, ligada }                         → { ok, etiquetas }
 *  · encerrar  { conversa_id }                                 → { ok, etiquetas } | { ok, ja_encerrada }
 * Erro: { ok: false, erro: <frase pra tela>, codigo }.
 *
 * Segurança: o JWT é conferido no auth.getUser; quem chama tem de estar aprovado e ter
 * `pode_conversas` (ou ser admin), a mesma regra do Dashboard. Conta e caixa do Chatwoot são
 * fixas no servidor (conta 1, caixa 5) e a conversa tem de ser dessa caixa. Token só de secret.
 *
 * `voz` (áudio gravado em OGG/Opus): na caixa de hoje (Uazapi) o áudio vai como anexo pela
 * conversa do Chatwoot. No número oficial (V2) passa a sair direto pela Graph com `voice: true`.
 *
 * Env: CHATWOOT_URL, CHATWOOT_SOMBREAR_TOKEN (os mesmos de mensagens-chatwoot) e os do Supabase.
 * Deploy: npx supabase functions deploy conversas --no-verify-jwt
 * (--no-verify-jwt como as outras: o JWT é conferido aqui, e o OPTIONS do CORS chega sem ele)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { preflight, resposta } from '../_shared/resposta.ts'
import { ADMIN_EMAIL } from '../../../src/lib/constants.ts'
import type { Pedir } from '../registrar-ligacao/chatwoot.ts'
import { encerrar, enviar, ia, type Deps, type Quem } from './acoes.ts'
import { lerPedido, recusaDoArquivo } from './pedido.ts'

const CONTA = 1

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const falha = (status: number, erro: string, codigo: string) => resposta(status, { ok: false, erro, codigo })

function chatwoot(caminho: string, init: RequestInit): Promise<Response> {
  const base = (Deno.env.get('CHATWOOT_URL') ?? '').replace(/\/$/, '')
  return fetch(`${base}/api/v1/accounts/${CONTA}${caminho}`, {
    ...init,
    headers: { ...(init.headers ?? {}), api_access_token: Deno.env.get('CHATWOOT_SOMBREAR_TOKEN') ?? '' },
  })
}

const pedir: Pedir = async (metodo, caminho, corpo) => {
  const r = await chatwoot(caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  if (!r.ok) throw new Error(`chatwoot ${r.status} em ${metodo} ${caminho.split('?')[0]}`)
  return r.json()
}

const deps: Deps = {
  pedir,
  // sem Content-Type: o fetch põe o multipart com o boundary certo
  async enviarFormulario(caminho, form) {
    const r = await chatwoot(caminho, { method: 'POST', body: form })
    if (!r.ok) throw new Error(`chatwoot ${r.status} em POST ${caminho}`)
    return r.json()
  },
  async espelharMensagem(linha) {
    const { data: lead } = await db.from('crm_sombrear_ia').select('id')
      .eq('id_conversa_chatwoot', String(linha.conversa_id)).limit(1).maybeSingle()
    const { error } = await db.from('mensagens_sombrear')
      .upsert({ ...linha, lead_id: lead?.id ?? null, atualizada_em: new Date().toISOString() }, { onConflict: 'id' })
    if (error) throw new Error(error.message)
  },
  async espelharEstado(estado) {
    const { error } = await db.from('conversas_estado')
      .upsert({ ...estado, atualizada_em: new Date().toISOString() }, { onConflict: 'conversa_id' })
    if (error) throw new Error(error.message)
  },
}

/** quem chama, se pode usar a aba Conversas; senão a Response de recusa */
async function quemChama(req: Request): Promise<Quem | Response> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return falha(401, 'Sessão expirada. Entre de novo.', 'sessao')
  const doUsuario = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user } } = await doUsuario.auth.getUser()
  if (!user) return falha(401, 'Sessão expirada. Entre de novo.', 'sessao')

  const { data: perfil } = await db.from('profiles')
    .select('approved, is_admin, pode_conversas, email, full_name').eq('id', user.id).single()
  if (perfil?.approved !== true) return falha(403, 'Seu acesso ainda não foi aprovado.', 'acesso')
  const pode = perfil.is_admin === true || perfil.email === ADMIN_EMAIL || perfil.pode_conversas === true
  if (!pode) return falha(403, 'Você não tem acesso às Conversas.', 'acesso')
  return { id: user.id, nome: String(perfil.full_name ?? '').trim() || 'Equipe' }
}

/** o pedido do corpo (JSON ou multipart) e o arquivo, se veio */
async function lerCorpo(req: Request): Promise<{ corpo: unknown; arquivo: File | null }> {
  if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
    const form = await req.formData().catch(() => null)
    if (!form) return { corpo: null, arquivo: null }
    const campos: Record<string, string> = {}
    for (const [k, v] of form.entries()) if (k !== 'arquivo' && typeof v === 'string') campos[k] = v
    const arquivo = form.get('arquivo')
    return { corpo: campos, arquivo: arquivo instanceof File ? arquivo : null }
  }
  return { corpo: await req.json().catch(() => null), arquivo: null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return falha(405, 'Método não aceito.', 'metodo')
  try {
    const quem = await quemChama(req)
    if (quem instanceof Response) return quem

    const { corpo, arquivo } = await lerCorpo(req)
    const p = lerPedido(corpo, !!arquivo)
    if (typeof p === 'string') return falha(400, p, 'pedido')
    if (arquivo) {
      const recusa = recusaDoArquivo(arquivo.type, arquivo.size)
      if (recusa) return falha(400, recusa, 'arquivo')
    }

    const r = p.acao === 'enviar' ? await enviar(deps, quem, p, arquivo)
      : p.acao === 'ia' ? await ia(deps, p)
      : await encerrar(deps, quem, p)
    return resposta(r.status, r.corpo)
  } catch (e) {
    console.error('[conversas] erro inesperado:', e instanceof Error ? e.message : e)
    return falha(500, 'Não deu certo agora. Tente de novo.', 'erro')
  }
})
