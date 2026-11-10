/**
 * Porteiro das functions que são só um proxy (gemini-estoque, n8n-cotacao).
 *
 * Sem isto, qualquer pessoa com a chave pública do projeto — que vai no bundle do
 * site — conseguia gastar a cota do Gemini ou disparar o webhook do n8n.
 *
 * Regra igual à do Dashboard (src/pages/Dashboard.tsx):
 *   estoque   = is_admin || pode_estoque   || e-mail de admin/estoque
 *   orcamento = is_admin || pode_orcamento || e-mail de admin
 * e sempre com `profiles.approved = true`.
 *
 * Devolve a Response de recusa, ou null quando pode seguir.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resposta } from './resposta.ts'
import { ADMIN_EMAIL, ESTOQUE_EMAIL } from '../../../src/lib/constants.ts'

export type Modulo = 'estoque' | 'orcamento'

const recusa = (status: number, erro: string) => resposta(status, { ok: false, erro, error: erro })

export async function exigirAcesso(req: Request, modulo: Modulo): Promise<Response | null> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return recusa(401, 'sessão')

  const url = Deno.env.get('SUPABASE_URL')!
  const doUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user } } = await doUsuario.auth.getUser()
  if (!user) return recusa(401, 'sessão')

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: perfil } = await admin.from('profiles')
    .select('approved, is_admin, pode_estoque, pode_orcamento, email').eq('id', user.id).single()
  if (perfil?.approved !== true) return recusa(403, 'acesso pendente de aprovação')

  const ehAdmin = perfil.is_admin === true || perfil.email === ADMIN_EMAIL
  const pode = modulo === 'estoque'
    ? ehAdmin || perfil.pode_estoque === true || perfil.email === ESTOQUE_EMAIL
    : ehAdmin || perfil.pode_orcamento === true
  if (!pode) return recusa(403, modulo === 'estoque' ? 'sem acesso ao Estoque' : 'sem acesso a Orçamentos')

  return null
}
