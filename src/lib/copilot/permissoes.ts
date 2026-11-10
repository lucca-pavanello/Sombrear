/**
 * Quem pode ver o quê no copiloto. Função pura, sem alias `@/` nem import de
 * navegador: carregada pela Edge Function `copilot-ia` e pelos testes.
 *
 * Espelha as regras do Dashboard (src/pages/Dashboard.tsx):
 *   isAdmin    = e-mail do dono || profiles.is_admin
 *   vendas     = isAdmin || pode_orcamento || pode_fechamento   (orçamentos, vendas, fila em aberto)
 *   leads      = isAdmin || pode_agente_ia                        (aba Agente IA / crm_sombrear_ia)
 *   margem     = só admin (custo e margem não vão para quem só tem um módulo)
 * Aprovação (`approved`) continua sendo exigida antes de tudo, na função.
 */

export interface PerfilCopilot {
  email?: string | null
  is_admin?: boolean | null
  pode_orcamento?: boolean | null
  pode_fechamento?: boolean | null
  pode_agente_ia?: boolean | null
}

export interface PermissoesCopilot {
  vendas: boolean
  leads: boolean
  margem: boolean
}

export function permissoesDoPerfil(perfil: PerfilCopilot | null | undefined, adminEmail: string): PermissoesCopilot {
  const isAdmin = !!perfil && (perfil.email === adminEmail || perfil.is_admin === true)
  return {
    vendas: isAdmin || perfil?.pode_orcamento === true || perfil?.pode_fechamento === true,
    leads: isAdmin || perfil?.pode_agente_ia === true,
    margem: isAdmin,
  }
}

/** O que cada ferramenta precisa. 'livre' = não lê dado da loja. */
const EXIGE: Record<string, 'vendas' | 'leads' | 'vendas+leads' | 'livre'> = {
  numeros_do_periodo: 'vendas',
  comparar_periodos: 'vendas',
  serie_mensal: 'vendas',
  vendas_por_modelo: 'vendas',
  orcamentos_em_aberto: 'vendas',
  desfechos_do_periodo: 'vendas',
  // mistura receita (vendas) com leads: precisa dos dois
  resultado_por_canal: 'vendas+leads',
  leads_quentes: 'leads',
  leads_parados: 'leads',
  ver_lead: 'leads',
  calcular: 'livre',
}

export function ferramentaPermitida(nome: string, perm: PermissoesCopilot): boolean {
  const exige = EXIGE[nome]
  if (!exige) return false // ferramenta desconhecida nunca é permitida
  if (exige === 'livre') return true
  if (exige === 'vendas') return perm.vendas
  if (exige === 'leads') return perm.leads
  return perm.vendas && perm.leads
}

/** Nomes das ferramentas liberadas (a calculadora sozinha não conta como acesso). */
export function ferramentasPermitidas(perm: PermissoesCopilot): string[] {
  return Object.keys(EXIGE).filter((n) => ferramentaPermitida(n, perm))
}

/** Sem acesso a nenhum módulo de dados: o copiloto responde 403. */
export const semAcessoAosDados = (perm: PermissoesCopilot) => !perm.vendas && !perm.leads

const CHAVES_MARGEM = new Set(['margem_media_pct', 'vendas_com_margem', 'diferenca_margem_pontos', 'margem'])

/** Remove, em qualquer nível, os campos de margem da saída de uma ferramenta. */
export function semMargem<T>(valor: T): T {
  if (Array.isArray(valor)) return valor.map((v) => semMargem(v)) as unknown as T
  if (valor && typeof valor === 'object') {
    const saida: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      if (!CHAVES_MARGEM.has(k)) saida[k] = semMargem(v)
    }
    return saida as T
  }
  return valor
}
