/**
 * Lógica pura da "Contagem por foto": ler "1,5", calcular diferença, achar
 * duplicidade, validar linha e montar os ajustes. Sem React, sem rede.
 *
 * Movimento usado: tipo 'ajuste' de estoque_movimentacoes, que SETA o saldo
 * final (o trigger faz quantidade_atual = NEW.quantidade). É exatamente o que
 * uma contagem física é: "o que tem é isto".
 */

import type { Confianca, LinhaLida } from './contagem-resposta'

export interface ProdutoContagem {
  id: string
  nome: string
  unidade: string
  quantidade_atual: number
}

export interface LinhaContagem {
  uid: string
  textoLido: string
  materialId: string
  /** texto digitado; aceita vírgula */
  contado: string
  confianca: Confianca
  observacao: string
  incluir: boolean
  manual: boolean
}

export type ProblemaLinha = 'sem_material' | 'sem_quantidade' | 'duplicado' | null

/**
 * Lê número escrito à brasileira. "1,5" → 1.5; "1.250,5" → 1250.5; "1.250" → 1250
 * (ponto seguido de exatamente 3 dígitos é milhar); "1.5" → 1.5. Vazio/inválido/negativo → null.
 */
export function parseQuantidade(entrada: string | number | null | undefined): number | null {
  if (typeof entrada === 'number') return Number.isFinite(entrada) && entrada >= 0 ? entrada : null
  if (typeof entrada !== 'string') return null
  let s = entrada.trim().replace(/\s+/g, '')
  if (!s) return null
  if (!/^\d[\d.,]*$/.test(s)) return null
  const temVirgula = s.includes(',')
  const temPonto = s.includes('.')
  if (temVirgula && temPonto) {
    // o último separador é o decimal
    const decimalEhVirgula = s.lastIndexOf(',') > s.lastIndexOf('.')
    s = decimalEhVirgula ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (temVirgula) {
    if ((s.match(/,/g) ?? []).length > 1) return null
    s = s.replace(',', '.')
  } else if (temPonto) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
    else if ((s.match(/\./g) ?? []).length > 1) return null
  }
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : null
}

const arredonda3 = (n: number) => Math.round(n * 1000) / 1000

/** contado − saldo, em 3 casas (a coluna é NUMERIC(12,3)); null se não há quantidade. */
export function diferenca(contado: string | number | null, saldo: number): number | null {
  const c = parseQuantidade(contado)
  if (c === null) return null
  return arredonda3(c - (Number(saldo) || 0))
}

let contador = 0
export function novoUid(): string {
  contador += 1
  return `l${Date.now().toString(36)}${contador}`
}

export function formatarNumero(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}

/** Linha vinda da IA → linha editável. Sem material ou sem quantidade começa excluída. */
export function linhaDaIA(l: LinhaLida): LinhaContagem {
  return {
    uid: novoUid(),
    textoLido: l.texto_lido,
    materialId: l.material_id ?? '',
    contado: l.quantidade === null ? '' : String(l.quantidade).replace('.', ','),
    confianca: l.confianca,
    observacao: l.observacao,
    incluir: l.material_id !== null && l.quantidade !== null,
    manual: false,
  }
}

export function linhaManual(): LinhaContagem {
  return { uid: novoUid(), textoLido: '', materialId: '', contado: '', confianca: 'alta', observacao: '', incluir: false, manual: true }
}

const PESO: Record<Confianca, number> = { baixa: 0, media: 1, alta: 2 }

/** Ordem inicial: baixa confiança primeiro; estável dentro do mesmo nível. Só na carga, não ao editar. */
export function ordenarPorConfianca(linhas: LinhaContagem[]): LinhaContagem[] {
  return linhas
    .map((l, i) => ({ l, i }))
    .sort((a, b) => PESO[a.l.confianca] - PESO[b.l.confianca] || a.i - b.i)
    .map((x) => x.l)
}

/** ids de material que aparecem em 2+ linhas INCLUÍDAS. */
export function materiaisDuplicados(linhas: LinhaContagem[]): Set<string> {
  const vistos = new Set<string>()
  const dup = new Set<string>()
  for (const l of linhas) {
    if (!l.incluir || !l.materialId) continue
    if (vistos.has(l.materialId)) dup.add(l.materialId)
    vistos.add(l.materialId)
  }
  return dup
}

export function problemaDaLinha(l: LinhaContagem, duplicados: ReadonlySet<string>): ProblemaLinha {
  if (!l.materialId) return 'sem_material'
  if (parseQuantidade(l.contado) === null) return 'sem_quantidade'
  if (l.incluir && duplicados.has(l.materialId)) return 'duplicado'
  return null
}

/** Linha só pode ser marcada para entrar se tem material e quantidade válidos. */
export function podeIncluir(l: LinhaContagem): boolean {
  return !!l.materialId && parseQuantidade(l.contado) !== null
}

export interface Ajuste {
  uid: string
  produtoId: string
  nome: string
  unidade: string
  anterior: number
  novo: number
  delta: number
}

export interface Resumo {
  ajustes: Ajuste[]
  semMudanca: number
  /** linhas incluídas com problema — bloqueiam o salvar */
  bloqueadas: number
  duplicados: Set<string>
}

export function resumir(linhas: LinhaContagem[], produtos: ReadonlyMap<string, ProdutoContagem>): Resumo {
  const duplicados = materiaisDuplicados(linhas)
  const ajustes: Ajuste[] = []
  let semMudanca = 0
  let bloqueadas = 0
  for (const l of linhas) {
    if (!l.incluir) continue
    const p = produtos.get(l.materialId)
    const novo = parseQuantidade(l.contado)
    if (!p || novo === null || duplicados.has(l.materialId)) { bloqueadas += 1; continue }
    const delta = arredonda3(novo - (Number(p.quantidade_atual) || 0))
    if (delta === 0) { semMudanca += 1; continue }
    ajustes.push({ uid: l.uid, produtoId: p.id, nome: p.nome, unidade: p.unidade, anterior: Number(p.quantidade_atual) || 0, novo: arredonda3(novo), delta })
  }
  return { ajustes, semMudanca, bloqueadas, duplicados }
}

/** Observação gravada no movimento: "Contagem por foto DD/MM". */
export function motivoContagem(data: Date = new Date()): string {
  const dd = String(data.getDate()).padStart(2, '0')
  const mm = String(data.getMonth() + 1).padStart(2, '0')
  return `Contagem por foto ${dd}/${mm}`
}
