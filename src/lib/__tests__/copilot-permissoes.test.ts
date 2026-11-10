/**
 * Copilot: o que cada perfil enxerga. Mesma regra do Dashboard (admin, pode_orcamento,
 * pode_fechamento, pode_agente_ia); margem só para admin.
 */
import { describe, expect, it } from 'vitest'
import {
  ferramentaPermitida, ferramentasPermitidas, permissoesDoPerfil, semAcessoAosDados, semMargem,
} from '../copilot/permissoes'
import { FERRAMENTAS, ferramentasDeclaradas, instrucoes } from '../copilot/prompt'
import { rodarFerramenta, type LeadCopilot, type VendaCopilot } from '../copilot/ferramentas'

const ADMIN = 'dono@sombrear.test'
const perm = (p: Parameters<typeof permissoesDoPerfil>[0]) => permissoesDoPerfil(p, ADMIN)

describe('permissoesDoPerfil', () => {
  it('admin por e-mail ou por flag vê tudo, inclusive margem', () => {
    for (const p of [{ email: ADMIN }, { email: 'x@y', is_admin: true }]) {
      expect(perm(p)).toEqual({ vendas: true, leads: true, margem: true })
    }
  })
  it('só estoque (sem flags) não vê nada de dados', () => {
    const r = perm({ email: 'estoque@x' })
    expect(r).toEqual({ vendas: false, leads: false, margem: false })
    expect(semAcessoAosDados(r)).toBe(true)
  })
  it('pode_orcamento ou pode_fechamento liberam vendas, nunca leads nem margem', () => {
    expect(perm({ pode_orcamento: true })).toEqual({ vendas: true, leads: false, margem: false })
    expect(perm({ pode_fechamento: true })).toEqual({ vendas: true, leads: false, margem: false })
  })
  it('pode_agente_ia libera só leads', () => {
    expect(perm({ pode_agente_ia: true })).toEqual({ vendas: false, leads: true, margem: false })
  })
  it('perfil ausente não tem acesso', () => {
    expect(semAcessoAosDados(perm(null))).toBe(true)
  })
})

describe('ferramentas por permissão', () => {
  const soVendas = perm({ pode_orcamento: true })
  const soLeads = perm({ pode_agente_ia: true })
  const admin = perm({ email: ADMIN })

  it('admin tem todas as ferramentas declaradas', () => {
    expect(ferramentasPermitidas(admin).sort()).toEqual(FERRAMENTAS.map((f) => f.name).sort())
    expect(ferramentasDeclaradas(admin).map((f) => f.name).sort()).toEqual(FERRAMENTAS.map((f) => f.name).sort())
  })
  it('vendas sem leads: sem ferramentas de lead nem de canal', () => {
    const nomes = ferramentasDeclaradas(soVendas).map((f) => f.name)
    expect(nomes).toContain('orcamentos_em_aberto')
    expect(nomes).toContain('calcular')
    for (const n of ['leads_quentes', 'leads_parados', 'ver_lead', 'resultado_por_canal']) expect(nomes).not.toContain(n)
  })
  it('leads sem vendas: sem venda, orçamento nem canal', () => {
    const nomes = ferramentasDeclaradas(soLeads).map((f) => f.name)
    expect(nomes).toEqual(expect.arrayContaining(['leads_quentes', 'leads_parados', 'ver_lead', 'calcular']))
    for (const n of ['numeros_do_periodo', 'orcamentos_em_aberto', 'desfechos_do_periodo', 'resultado_por_canal']) expect(nomes).not.toContain(n)
  })
  it('ferramenta desconhecida nunca é permitida', () => {
    expect(ferramentaPermitida('apagar_tudo', admin)).toBe(false)
  })
  it('sem margem a descrição não promete margem', () => {
    const d = ferramentasDeclaradas(soVendas).find((f) => f.name === 'numeros_do_periodo')!
    expect(d.description).not.toMatch(/margem/i)
    expect(ferramentasDeclaradas(admin).find((f) => f.name === 'numeros_do_periodo')!.description).toMatch(/margem/i)
  })
  it('as instruções acompanham o acesso', () => {
    expect(instrucoes('2026-09-20', 'domingo', soVendas)).toMatch(/NÃO tem acesso aos leads/)
    expect(instrucoes('2026-09-20', 'domingo', soVendas)).toMatch(/só administradores veem/)
    expect(instrucoes('2026-09-20', 'domingo', soLeads)).toMatch(/NÃO tem acesso a vendas/)
    expect(instrucoes('2026-09-20', 'domingo', admin)).not.toMatch(/NÃO tem acesso/)
    expect(instrucoes('2026-09-20', 'domingo')).toBe(instrucoes('2026-09-20', 'domingo', admin))
  })
})

describe('rodarFerramenta respeita a permissão', () => {
  const venda: VendaCopilot = { id: 'v', created_at: '2026-09-10T12:00:00Z', fechado: true, valor_venda: 100, margem: 40, data_pedido: '2026-09-10' }
  const lead: LeadCopilot = { id: 'l', created_at: '2026-09-01T12:00:00Z', nome: 'Ana', lead_temperatura: 'quente', status_lead: '3' }
  const dados = { orcamentos: [venda], leads: [lead] }
  const periodo = { periodo: { inicio: '2026-09-01', fim: '2026-09-30' } }
  const HOJE = '2026-09-20'

  it('ferramenta fora do acesso devolve erro, não dado', () => {
    const soVendas = perm({ pode_orcamento: true })
    expect(rodarFerramenta('leads_quentes', {}, dados, HOJE, soVendas)).toHaveProperty('erro')
    expect(rodarFerramenta('resultado_por_canal', periodo, dados, HOJE, soVendas)).toHaveProperty('erro')
    const soLeads = perm({ pode_agente_ia: true })
    expect(rodarFerramenta('numeros_do_periodo', periodo, dados, HOJE, soLeads)).toHaveProperty('erro')
    expect(rodarFerramenta('orcamentos_em_aberto', {}, dados, HOJE, soLeads)).toHaveProperty('erro')
  })
  it('não-admin não recebe margem; admin recebe', () => {
    const n = rodarFerramenta('numeros_do_periodo', periodo, dados, HOJE, perm({ pode_orcamento: true })) as Record<string, unknown>
    expect(n.receita).toBe(100)
    expect(n).not.toHaveProperty('margem_media_pct')
    expect(n).not.toHaveProperty('vendas_com_margem')
    const c = rodarFerramenta('comparar_periodos', { atual: periodo.periodo, anterior: { inicio: '2026-08-01', fim: '2026-08-31' } }, dados, HOJE, perm({ pode_orcamento: true }))
    expect(JSON.stringify(c)).not.toMatch(/margem/)
    const a = rodarFerramenta('numeros_do_periodo', periodo, dados, HOJE, perm({ email: ADMIN })) as Record<string, unknown>
    expect(a.margem_media_pct).toBe(40)
  })
  it('sem permissões informadas (testes) nada muda', () => {
    expect(rodarFerramenta('leads_quentes', {}, dados, HOJE)).toHaveProperty('total')
  })
  it('semMargem limpa em qualquer nível', () => {
    expect(semMargem({ a: 1, margem_media_pct: 3, x: [{ diferenca_margem_pontos: 1, b: 2 }] })).toEqual({ a: 1, x: [{ b: 2 }] })
  })
})
