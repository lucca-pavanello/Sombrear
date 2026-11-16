/**
 * Tabela do PDF do Semanário — só lógica pura (sem jsPDF, sem React), pra os
 * índices das colunas viverem num lugar só e dar pra testar sem desenhar PDF.
 *
 * Com "Custos no PDF" ligado entra a coluna "Custo" entre Produto e Cliente
 * pagou, e cada item devolve em `partes` o custo REAL (`real`, não `tabela`)
 * das partes de `custos_detalhe`. As partes NÃO são linhas da tabela: o
 * autoTable não segura linha com a próxima na quebra de página, então elas
 * são desenhadas dentro da própria linha do item (semanarioPdfDesenho.ts).
 * Nada vazio: sem detalhe ou sem parte que case, `partes[i]` é [].
 */
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Orcamento, Pedido } from '@/lib/supabase'

export type NivelCustoPdf = 'nenhum' | 'tecido-motor' | 'todas'

export const NIVEIS_CUSTO_PDF: { value: NivelCustoPdf; label: string }[] = [
  { value: 'nenhum', label: 'Sem custos' },
  { value: 'tecido-motor', label: 'Tecido e motorização' },
  { value: 'todas', label: 'Todas as partes' },
]

// "Estrutura motorizada" e "Junção" ficam de fora de propósito: só entram em 'todas'
const PARTES_TECIDO_MOTOR = [/^Tecido(\s|$)/i, /^Motor(\s|$)/i, /^Controle(\s|$)/i]

/** "Tecido SCREEN 1% BEGE — rolo 1,50m…" → "Tecido — rolo 1,50m…" quando repete o tecido do item */
function encurtarTecido(rotulo: string, tecido: string | null | undefined): string {
  const nome = (tecido ?? '').trim()
  if (!nome) return rotulo
  const prefixo = `Tecido ${nome}`
  if (rotulo.slice(0, prefixo.length).toLowerCase() !== prefixo.toLowerCase()) return rotulo
  const resto = rotulo.slice(prefixo.length)
  // só encurta se depois do nome vier o travessão: "SCREEN 1%" não pode comer o começo de "SCREEN 1% BEGE"
  if (resto && !/^\s*[—–-]/.test(resto)) return rotulo
  return `Tecido${resto}`
}

export function partesDoPdf(
  o: Pick<Orcamento, 'custos_detalhe' | 'tecido'>,
  nivel: NivelCustoPdf,
): { rotulo: string; real: number }[] {
  if (nivel === 'nenhum' || !Array.isArray(o.custos_detalhe)) return []
  const partes: { rotulo: string; real: number }[] = []
  for (const p of o.custos_detalhe) {
    const rotulo = (p.parte ?? '').trim()
    const real = Number(p.real)
    if (!rotulo || !(real > 0)) continue
    if (nivel === 'tecido-motor' && !PARTES_TECIDO_MOTOR.some(re => re.test(rotulo))) continue
    partes.push({ rotulo: encurtarTecido(rotulo, o.tecido), real })
  }
  return partes
}

type GrupoPdf = { pedido: Pedido | null; itens: Orcamento[] }
type TotaisPdf = { bruto: number; parceira: number; sobra: number }


export function montarTabelaSemanario(args: {
  grupos: GrupoPdf[]
  totais: TotaisPdf
  nivel: NivelCustoPdf
  pago: (o: Orcamento) => number
  pagoParceira: (o: Orcamento) => number
  sobraItem: (o: Orcamento) => number
  pgtoReal: (o: Orcamento) => { forma: string; parcelas: number | null }
  totaisGrupo: (itens: Orcamento[]) => TotaisPdf
  dataDe: (o: Orcamento) => string
}): {
  head: string[][]
  body: string[][]
  foot: string[][]
  direita: number[]
  centro: number[]
  alinhamentoFoot: Record<number, 'left' | 'center' | 'right'>
  /** partes[i] = linhas de custo da linha i do corpo (vazio em total e em item sem nada a mostrar) */
  partes: { rotulo: string; valor: string }[][]
  colProduto: number
  colCusto: number
} {
  const { grupos, totais, nivel, pago, pagoParceira, sobraItem, pgtoReal, totaisGrupo, dataDe } = args
  const comCusto = nivel !== 'nenhum'
  // a coluna Custo entra depois do Produto (índice 3); o resto da linha é o mesmo de sempre
  const montar = (ini: string[], custo: string, fim: string[]) => comCusto ? [...ini, custo, ...fim] : [...ini, ...fim]

  const head = [montar(['Data', 'Pedido', 'Cliente', 'Produto'], 'Custo',
    ['Cliente pagou', 'Parcela', 'Pagamento', 'À parceira', 'Sobra'])]
  const body: string[][] = []
  const partes: { rotulo: string; valor: string }[][] = []

  for (const g of grupos) {
    g.itens.forEach((o, i) => {
      const pg = pgtoReal(o)
      const parcela = pg.parcelas && pg.parcelas > 1 ? formatCurrency(pago(o) / pg.parcelas) : '—'
      // pedido com vários itens: data/pedido/cliente só na primeira linha do grupo — evita repetir
      const primeira = i === 0
      body.push(montar([
        primeira ? formatDate(g.pedido?.data_pedido ? `${g.pedido.data_pedido}T12:00:00` : dataDe(o)) : '',
        primeira ? (g.pedido?.numero_pedido ?? o.numero_pedido ?? '—') : '',
        primeira ? (o.cliente ?? '—') : '',
        [o.modelo, o.tecido].filter(Boolean).join(' · ')
          + (o.largura && o.altura ? `\n${String(o.largura).replace('.', ',')}×${String(o.altura).replace('.', ',')}m` : ''),
      ], '', [
        formatCurrency(pago(o)),
        parcela,
        pg.forma,
        formatCurrency(pagoParceira(o)),
        formatCurrency(sobraItem(o)),
      ]))
      partes.push(partesDoPdf(o, nivel).map(p => ({ rotulo: p.rotulo, valor: formatCurrency(p.real) })))
    })
    if (g.itens.length >= 2) {
      const t = totaisGrupo(g.itens)
      body.push(montar(['', '', '', 'Total do pedido'], '',
        [formatCurrency(t.bruto), '', '', formatCurrency(t.parceira), formatCurrency(t.sobra)]))
      partes.push([])
    }
  }

  const foot = [montar(['', '', '', 'TOTAIS'], '',
    [formatCurrency(totais.bruto), '', '', formatCurrency(totais.parceira), formatCurrency(totais.sobra)])]

  return comCusto
    ? { head, body, foot, direita: [4, 5, 6, 8, 9], centro: [1, 7], partes, colProduto: 3, colCusto: 4,
        alinhamentoFoot: { 1: 'center', 4: 'right', 5: 'right', 6: 'right', 7: 'center', 8: 'right', 9: 'right' } }
    : { head, body, foot, direita: [4, 5, 7, 8], centro: [1, 6], partes, colProduto: 3, colCusto: 4,
        alinhamentoFoot: { 1: 'center', 4: 'right', 5: 'right', 6: 'center', 7: 'right', 8: 'right' } }
}
