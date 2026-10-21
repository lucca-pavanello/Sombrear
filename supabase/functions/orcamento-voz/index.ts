/**
 * Edge Function: orcamento-voz
 *
 * A calculadora da Amanda de voz no ar, com os preços do banco na hora (a bancada usa uma foto:
 * voz/orcamento/servidor.ts). Mesmas rotas e mesmo motor (src/lib/voz/rotas.ts → orcar.ts):
 *   POST /orcamento-voz/persiana, POST /orcamento-voz/cortina, GET /orcamento-voz/tecidos?modelo=...
 * Sem JWT: quem chama é o servidor da voz, sem usuário; a prova é a mesma chave do
 * registrar-ligacao (header x-chave = LIGACAO_SECRET). Só devolve preço de venda, nunca custo.
 *
 * Os preços ficam guardados 60 s na instância: uma ligação faz várias contas seguidas e cada leitura
 * são 16 tabelas; preço mudado no Dash vale na ligação seguinte.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { preflight, resposta } from '../_shared/resposta.ts'
import type { DadosVoz } from '../../../src/lib/voz/orcar.ts'
import { atender, carregarDados } from '../../../src/lib/voz/rotas.ts'

const VALIDADE_MS = 60_000

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

let guardado: { quando: number; dados: Promise<DadosVoz> } | null = null

function precos(): Promise<DadosVoz> {
  if (guardado && Date.now() - guardado.quando < VALIDADE_MS) return guardado.dados
  const dados = carregarDados(async tabela => {
    const { data, error } = await sb.from(tabela).select('*')
    if (error) throw new Error(`${tabela}: ${error.message}`)
    return data ?? []
  })
  guardado = { quando: Date.now(), dados }
  dados.catch(() => { guardado = null })  // leitura que falhou não fica guardada
  return dados
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  const esperado = Deno.env.get('LIGACAO_SECRET')
  if (!esperado || req.headers.get('x-chave') !== esperado) return resposta(401, { erro: 'não autorizado' })
  try {
    const url = new URL(req.url)
    const corpo = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const r = atender(url.pathname, url.searchParams, corpo, await precos())
    return resposta(r.status, r.corpo)
  } catch (e) {
    console.error('orcamento-voz', e)
    return resposta(500, { erro: e instanceof Error ? e.message : String(e) })
  }
})
