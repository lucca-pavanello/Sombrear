/**
 * Trava de sanidade para mudanças em `precos_parametros` feitas pela IA.
 *
 * Função PURA, sem import de navegador: a Edge Function `precos-ia` importa este
 * arquivo por caminho relativo (mesmo padrão de copilot-ia) e o teste roda no vitest.
 *
 * A IA entende "dois vírgula nove" mas também erra "28" por "2,8". Uma mudança
 * que foge muito do valor atual (ou da faixa que a chave admite) NÃO é recusada:
 * volta marcada como suspeita e o admin precisa confirmar de novo, de propósito.
 */

export interface VereditoParametro {
  /** valor impossível (não numérico, negativo): bloqueia de vez */
  invalido?: string
  suspeita: boolean
  motivo?: string
}

/** Fator máximo de variação aceito sem confirmação extra (3× pra cima ou pra baixo). */
export const FATOR_MAXIMO = 3

interface Faixa { min: number; max: number; nome: string }

/** Faixa plausível por tipo de chave. Chave desconhecida só passa pela regra do fator. */
export function faixaDaChave(chave: string): Faixa | null {
  if (chave.startsWith('markup_')) return { min: 1, max: 10, nome: 'markup' }
  if (chave.endsWith('_pct') || chave.startsWith('desconto_')) return { min: 0, max: 100, nome: 'porcentagem' }
  if (chave.startsWith('taxa_')) return { min: 1, max: 2, nome: 'taxa' }
  if (chave.startsWith('parceiro_') || chave === 'custo_parceiro') return { min: 0.5, max: 5, nome: 'multiplicador da parceira' }
  return null
}

const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 4 })

/** Se o número parece um dedo a mais/a menos (28 → 2,8), devolve a leitura provável. */
function leituraProvavel(novo: number, atual: number | null, faixa: Faixa | null): number | null {
  for (const cand of [novo / 10, novo / 100, novo * 10]) {
    if (!(cand > 0) || cand === novo) continue
    if (faixa && (cand < faixa.min || cand > faixa.max)) continue
    if (atual != null && atual > 0 && (cand > atual * FATOR_MAXIMO || cand < atual / FATOR_MAXIMO)) continue
    return cand
  }
  return null
}

/**
 * ÚNICO normalizador de número vindo do modelo/cliente: aceita número, "2.8",
 * "2,8", "1.234,56" e "R$ 36,00". Devolve null se não for um número finito.
 * Nunca use `Number()` direto em valor vindo da IA ou do front.
 */
export function numeroDoValor(bruto: unknown): number | null {
  if (typeof bruto === 'number') return Number.isFinite(bruto) ? bruto : null
  if (typeof bruto !== 'string') return null
  let s = bruto.replace(/\s/g, '').replace(/^R\$/i, '')
  if (!s) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

type Obrigatoriedade = 'obrig' | 'opc' | 'nulavel'

/** Campos numéricos de cada tipo de ação (o resto é texto e não passa por aqui). */
export const CAMPOS_NUMERICOS: Record<string, Record<string, Obrigatoriedade>> = {
  criar_promocao: { desconto_pct: 'obrig' },
  remover_promocao: { id: 'obrig' },
  atualizar_preco_tecido: { preco: 'obrig', largura: 'nulavel' },
  atualizar_parametro: { valor: 'obrig' },
  atualizar_preco_artigo: { preco: 'obrig' },
  atualizar_componente_ferragem: { id: 'opc', espessura: 'opc', valor: 'obrig' },
  atualizar_ph50: { valor: 'obrig' },
  atualizar_bando_param: { valor: 'obrig' },
  atualizar_colocacao: { id: 'obrig', preco: 'obrig' },
  atualizar_barra_faixa: { largura_min: 'obrig', qtd_presilhas: 'obrig' },
  atualizar_motor_componente: { custo: 'obrig' },
  atualizar_motor_estrutura: { id: 'obrig', valor: 'obrig' },
  atualizar_romana: { largura: 'obrig', altura: 'obrig', custo: 'obrig' },
}

/**
 * Converte uma vez só os campos numéricos da ação ("2,8" → 2.8). Depois disso
 * os campos são `number` (ou null/ausente quando opcionais) — nada de `Number()`
 * em valor cru. Devolve `erro` se algum campo obrigatório não for um número finito.
 */
export function normalizarAcao(acao: Record<string, unknown>): { acao: Record<string, unknown>; erro?: string } {
  const campos = CAMPOS_NUMERICOS[String(acao.tipo)] ?? {}
  const saida = { ...acao }
  for (const [campo, regra] of Object.entries(campos)) {
    const bruto = saida[campo]
    if (bruto == null || bruto === '') {
      if (regra === 'obrig') return { acao: saida, erro: `Faltou o número em "${campo}" (${String(acao.tipo)})` }
      if (regra === 'nulavel') saida[campo] = null
      else delete saida[campo]
      continue
    }
    const n = numeroDoValor(bruto)
    if (n == null) return { acao: saida, erro: `Número inválido em "${campo}" (${String(acao.tipo)}): ${String(bruto).slice(0, 40)}` }
    saida[campo] = n
  }
  return { acao: saida }
}

export function avaliarParametro(chave: string, atual: number | null | undefined, novoBruto: unknown): VereditoParametro {
  const novo = numeroDoValor(novoBruto)
  if (novo == null) {
    return { suspeita: false, invalido: `Valor inválido para ${chave}` }
  }
  if (novo < 0) return { suspeita: false, invalido: `Valor negativo não faz sentido em ${chave}` }

  const base = atual != null && Number.isFinite(Number(atual)) ? Number(atual) : null
  const faixa = faixaDaChave(chave)
  const motivos: string[] = []

  if (faixa && (novo < faixa.min || novo > faixa.max)) {
    motivos.push(`${fmt(novo)} está fora da faixa normal de ${faixa.nome} (${fmt(faixa.min)} a ${fmt(faixa.max)})`)
  }
  if (base != null && base > 0 && (novo > base * FATOR_MAXIMO || novo < base / FATOR_MAXIMO)) {
    motivos.push(`muda mais de ${FATOR_MAXIMO}× em relação ao valor de hoje (${fmt(base)})`)
  }
  if (motivos.length === 0) return { suspeita: false }

  const prov = leituraProvavel(novo, base, faixa)
  const dica = prov != null ? ` — ${fmt(novo)} parece erro de digitação de ${fmt(prov)}?` : ''
  return { suspeita: true, motivo: `${motivos.join('; ')}${dica}` }
}
