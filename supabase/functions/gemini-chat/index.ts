/**
 * Edge Function: gemini-chat
 * Proxy de IA — mantém a chave no servidor, fora do bundle. O nome é histórico:
 * desde 10/11/2026 quem responde é o Muse (_shared/muse.ts), no formato do Gemini.
 * Usado pelo card de Insights do Agente IA (src/components/agente/InsightsAmanda.tsx).
 * O copiloto do dash saiu daqui para a `copilot-ia`, que tem ferramentas.
 *
 * Só usuário logado e aprovado: antes qualquer um com a URL gastava a chave.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { gerarConteudo } from '../_shared/muse.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    const semAcesso = (status: number, error: string) => new Response(JSON.stringify({ error }), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
    if (!authHeader) return semAcesso(401, 'Não autorizado')
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const doUsuario = createClient(url, serviceRole, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user } } = await doUsuario.auth.getUser()
    if (!user) return semAcesso(401, 'Token inválido')
    const admin = createClient(url, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: perfil } = await admin.from('profiles').select('approved').eq('id', user.id).single()
    if (perfil?.approved !== true) return semAcesso(403, 'Acesso pendente de aprovação')

    const { contents } = await req.json()

    // Resposta no formato do Gemini (candidates), que é o que os cards leem.
    const r = await gerarConteudo({ contents })
    if (!r.ok) {
      console.error('[gemini-chat] Muse falhou:', r.status, r.erro)
      return new Response(JSON.stringify({ error: r.erro }), {
        status: r.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify(r.dados), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro interno'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
