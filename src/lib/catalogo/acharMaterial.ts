/**
 * Achar o material de que a pessoa está falando — e recusar quando não dá.
 *
 * A IA recebe "atualiza o custo da microfibra para 7 reais". No catálogo há
 * TRÊS microfibras: a da Corttex 3,00 m a R$ 6,30/m, a da Corttex 3,00 m
 * marfim, e a Microfibra Clássica 3,30 m da TA Decor a R$ 13,90/m. Escolher
 * uma delas por conta própria tem dois terços de chance de estragar o custo
 * errado — e o erro só apareceria semanas depois, num orçamento.
 *
 * Então: quando sobra mais de um candidato, esta função NÃO escolhe. Ela
 * devolve a lista com o que diferencia um do outro (fornecedor, largura,
 * cor, custo) para a IA perguntar qual.
 *
 * Mesmo desenho do `acharComponente` da precos-ia, que já resolve isso para
 * ferragem e é o precedente da casa.
 */

export interface MaterialCandidato {
  item_id: string
  descricao: string
  codigo_fornecedor: string | null
  fornecedor: string | null
  cor: string | null
  largura_m: number | null
  custo_unitario: number
  unidade_canonica: string
}

export type Resolucao =
  | { tipo: 'achou'; material: MaterialCandidato }
  | { tipo: 'nenhum'; mensagem: string }
  | { tipo: 'ambiguo'; mensagem: string; candidatos: MaterialCandidato[] }

/** Tira acento e caixa: "LINHO IRLANDÊS" e "linho irlandes" são o mesmo. */
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** Como a pessoa reconhece o material numa lista. */
export function descrever(m: MaterialCandidato): string {
  const partes = [m.descricao]
  if (m.fornecedor) partes.push(m.fornecedor)
  if (m.largura_m) partes.push(`${m.largura_m.toFixed(2).replace('.', ',')} m`)
  if (m.cor) partes.push(m.cor)
  partes.push(
    `R$ ${m.custo_unitario.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    })}/${m.unidade_canonica}`
  )
  return partes.join(' · ')
}

export interface Pistas {
  /** O que a pessoa escreveu: nome, código, ou um pedaço de qualquer um. */
  termo: string
  /** Dito explicitamente ("o da Corttex"), quando houver. */
  fornecedor?: string | null
  cor?: string | null
  larguraM?: number | null
}

/**
 * Resolve na ordem do mais específico para o mais frouxo, e para assim que
 * um nível dá exatamente um resultado. Nunca pula para o nível seguinte
 * depois de um nível ter dado vários — isso seria trocar uma resposta
 * precisa e ambígua por uma imprecisa e única.
 */
export function acharMaterial(
  candidatos: MaterialCandidato[],
  pistas: Pistas
): Resolucao {
  const termo = normalizar(pistas.termo ?? '')
  if (!termo) {
    return { tipo: 'nenhum', mensagem: 'Diga qual material você quer alterar.' }
  }

  // As pistas secundárias filtram antes de qualquer casamento de nome.
  let pool = candidatos
  if (pistas.fornecedor) {
    const f = normalizar(pistas.fornecedor)
    const filtrado = pool.filter(m => normalizar(m.fornecedor ?? '').includes(f))
    if (filtrado.length > 0) pool = filtrado
  }
  if (pistas.cor) {
    const c = normalizar(pistas.cor)
    const filtrado = pool.filter(m => normalizar(m.cor ?? '').includes(c))
    if (filtrado.length > 0) pool = filtrado
  }
  if (pistas.larguraM) {
    const filtrado = pool.filter(
      m => m.largura_m !== null && Math.abs(m.largura_m - pistas.larguraM!) < 0.005
    )
    if (filtrado.length > 0) pool = filtrado
  }

  // 1. Código do fornecedor, exato. É o identificador estável dos três.
  const porCodigo = pool.filter(m => normalizar(m.codigo_fornecedor ?? '') === termo)
  if (porCodigo.length === 1) return { tipo: 'achou', material: porCodigo[0] }
  if (porCodigo.length > 1) return ambiguo(porCodigo, pistas.termo)

  // 2. Descrição exata.
  const exato = pool.filter(m => normalizar(m.descricao) === termo)
  if (exato.length === 1) return { tipo: 'achou', material: exato[0] }
  if (exato.length > 1) return ambiguo(exato, pistas.termo)

  // 3. Todas as palavras do termo aparecem na descrição (em qualquer ordem).
  //    "trilho duplo branco" acha "TMDBB-TRILHO MAX DUPLO BRANCO (40.7 MM)".
  const palavras = termo.split(/\s+/).filter(p => p.length > 1)
  const porPalavras = palavras.length
    ? pool.filter(m => {
        const alvo = normalizar(`${m.descricao} ${m.codigo_fornecedor ?? ''}`)
        return palavras.every(p => alvo.includes(p))
      })
    : []
  if (porPalavras.length === 1) return { tipo: 'achou', material: porPalavras[0] }
  if (porPalavras.length > 1) return ambiguo(porPalavras, pistas.termo)

  return {
    tipo: 'nenhum',
    mensagem:
      `Não achei nenhum material que case com "${pistas.termo}" no catálogo de custos. ` +
      'Confira o nome, ou cadastre o material antes de dar o custo dele.',
  }
}

function ambiguo(candidatos: MaterialCandidato[], termo: string): Resolucao {
  const lista = candidatos.map(m => `• ${descrever(m)}`).join('\n')
  return {
    tipo: 'ambiguo',
    candidatos,
    mensagem:
      `"${termo}" casa com ${candidatos.length} materiais do catálogo. ` +
      `Diga qual, pelo código ou pelo fornecedor:\n${lista}`,
  }
}
