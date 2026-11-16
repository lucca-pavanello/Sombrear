/**
 * Opções do autoTable do PDF do Semanário — o desenho em cima de
 * `montarTabelaSemanario`. Fica fora do componente pra o exportador e o script
 * de render usarem exatamente o mesmo código.
 *
 * Com custos ligados, UMA linha por item: as partes (tecido, motor…) não são
 * linhas, são uma listinha de preços desenhada dentro da célula do Produto
 * (etiqueta + detalhe) e do Custo (valor), cada parte sob um fio. O autoTable
 * não tem "segurar com a próxima": se as partes fossem linhas, a página
 * quebraria no meio do bloco. Por isso a altura delas é somada ao padding de
 * baixo da célula e `rowPageBreak: 'avoid'` cuida do resto.
 */
import type { jsPDF } from 'jspdf'
import type { CellHookData, UserOptions } from 'jspdf-autotable'
import { LARANJA, LINHA_QUENTE, TEMA_TABELA, alinharSecoes, colunasCentro, colunasDireita } from '@/lib/pdfMarca'
import type { ParteTabela, montarTabelaSemanario } from '@/lib/semanarioPdf'

export type TabelaSemanario = ReturnType<typeof montarTabelaSemanario>

const LARGURA_PRODUTO = 70   // mm — fixa pra o quebra-de-linha dos detalhes ser calculável antes do layout
const FONTE_ETIQUETA = 6.5
const FONTE_DETALHE = 7.5
const FONTE_VALOR = 8
const COR_DETALHE: [number, number, number] = [95, 95, 95]
const COR_VALOR: [number, number, number] = [45, 45, 45]
const RECUO = 1              // mm, além do padding da célula
const FOLGA_ETIQUETA = 3     // mm entre a etiqueta mais larga e o detalhe
const MAX_COLUNA_ETIQUETA = 22
const FOLGA_ITEM = 1.5       // mm entre o texto do item e o primeiro fio
const RESPIRO = 1.3          // mm acima da primeira linha e abaixo da última de cada parte
const FOLGA_FINAL = 0.5      // mm no fim da célula
const ESPESSURA_FIO = 0.15
const ALTURA_CAIXA_ALTA = 0.72   // altura das maiúsculas da helvetica, em fração do corpo

type Linhas = { etiqueta: string | null; linhas: string[] }

export function opcoesTabelaSemanario(doc: jsPDF, t: TabelaSemanario, comCusto: boolean): UserOptions {
  const alinharFoot = alinharSecoes(t.alinhamentoFoot)
  const base: UserOptions = {
    head: t.head, body: t.body, foot: t.foot,
    ...TEMA_TABELA,
    columnStyles: { ...colunasDireita(t.direita), ...colunasCentro(t.centro) },
    didParseCell: alinharFoot,
    margin: { left: 14, right: 14, bottom: 20 },
  }
  if (!comCusto) return base

  const mm = (pt: number) => pt / doc.internal.scaleFactor
  const alturaLinha = (fonte: number) => mm(fonte) * doc.getLineHeightFactor()
  const capDetalhe = mm(FONTE_DETALHE) * ALTURA_CAIXA_ALTA
  const alturaParte = (n: number) => RESPIRO + capDetalhe + (n - 1) * alturaLinha(FONTE_DETALHE) + RESPIRO
  const fonteDoc = doc.getFontSize()
  const fonteNome = doc.getFont()
  const linhasPorLinha = new Map<number, Linhas[]>()   // linha do corpo → etiqueta e linhas quebradas de cada parte

  const usar = (estilo: 'normal' | 'bold', corpo: number) => { doc.setFont('helvetica', estilo); doc.setFontSize(corpo) }
  const restaurarFonte = () => { doc.setFont(fonteNome.fontName, fonteNome.fontStyle); doc.setFontSize(fonteDoc) }

  // coluna das etiquetas: a mais larga do documento inteiro + folga, com teto
  usar('bold', FONTE_ETIQUETA)
  const larguraEtiqueta = (p: ParteTabela) => doc.getTextWidth(p.categoria.toUpperCase())
  const maiorEtiqueta = Math.max(0, ...t.partes.flat().map(larguraEtiqueta))
  const colunaEtiqueta = Math.min(MAX_COLUNA_ETIQUETA, maiorEtiqueta + FOLGA_ETIQUETA)
  const cabeEtiqueta = new Set(t.partes.flat().filter(p => larguraEtiqueta(p) <= colunaEtiqueta - FOLGA_ETIQUETA))

  // os valores são desenhados à mão (a célula do Custo é vazia), então o autoTable
  // não os mede: sem este piso a coluna fica do tamanho do título e o valor invade o Produto
  usar('normal', FONTE_VALOR)
  const maiorValor = Math.max(0, ...t.partes.flat().map(p => doc.getTextWidth(p.valor)))
  restaurarFonte()

  return {
    ...base,
    rowPageBreak: 'avoid',
    columnStyles: { ...base.columnStyles, [t.colProduto]: { cellWidth: LARGURA_PRODUTO },
      [t.colCusto]: { halign: 'right' as const, minCellWidth: Math.max(20, maiorValor + 5) },
      // "Cliente pagou" é o título mais largo: sem piso ele quebra em duas linhas
      [t.colCusto + 1]: { halign: 'right' as const, minCellWidth: 28 } },
    didParseCell: (data: CellHookData) => {
      alinharFoot(data)
      if (data.section !== 'body' || data.column.index !== t.colProduto) return
      const partes = t.partes[data.row.index]
      if (!partes?.length) return
      const { cell } = data
      const pad = { top: cell.padding('top'), right: cell.padding('right'), bottom: cell.padding('bottom'), left: cell.padding('left') }
      const util = LARGURA_PRODUTO - pad.left - pad.right - RECUO
      usar('normal', FONTE_DETALHE)
      const quebradas: Linhas[] = partes.map(p => cabeEtiqueta.has(p)
        ? { etiqueta: p.categoria.toUpperCase(), linhas: (p.detalhe ? doc.splitTextToSize(p.detalhe, util - colunaEtiqueta) : []) as string[] }
        : { etiqueta: null, linhas: doc.splitTextToSize(p.rotulo, util) as string[] })
      restaurarFonte()
      linhasPorLinha.set(data.row.index, quebradas)
      const alturaPartes = quebradas.reduce((s, q) => s + alturaParte(Math.max(1, q.linhas.length)), 0)
      cell.styles.cellPadding = { ...pad, bottom: pad.bottom + FOLGA_ITEM + alturaPartes + FOLGA_FINAL }
    },
    didDrawCell: (data: CellHookData) => {
      if (data.section !== 'body') return
      const ehProduto = data.column.index === t.colProduto
      if (!ehProduto && data.column.index !== t.colCusto) return
      const quebradas = linhasPorLinha.get(data.row.index)
      if (!quebradas) return
      const partes = t.partes[data.row.index]
      const { cell } = data
      // o início das partes vem da célula do Produto (a do Custo é vazia): abaixo do texto do item
      const produto = data.row.cells[t.colProduto]
      const alturaTexto = produto.text.length * alturaLinha(produto.styles.fontSize)
      let topo = cell.y + produto.padding('top') + alturaTexto + FOLGA_ITEM
      const xEsq = cell.x + cell.padding('left')

      const corAntes = doc.getTextColor()
      const corFioAntes = doc.getDrawColor()
      const espessuraAntes = doc.getLineWidth()
      doc.setDrawColor(LINHA_QUENTE[0], LINHA_QUENTE[1], LINHA_QUENTE[2])
      doc.setLineWidth(ESPESSURA_FIO)
      quebradas.forEach((q, k) => {
        // um fio por parte, contínuo: do padding do Produto até a borda dele e por toda a célula do Custo
        doc.line(ehProduto ? xEsq : cell.x, topo, cell.x + cell.width, topo)
        // as três fontes dividem UMA linha de base (alphabetic), não o topo
        const linhaBase = topo + RESPIRO + capDetalhe
        if (ehProduto) {
          if (q.etiqueta) {
            usar('bold', FONTE_ETIQUETA)
            doc.setTextColor(LARANJA[0], LARANJA[1], LARANJA[2])
            doc.text(q.etiqueta, xEsq + RECUO, linhaBase, { baseline: 'alphabetic' })
          }
          usar('normal', FONTE_DETALHE)
          doc.setTextColor(COR_DETALHE[0], COR_DETALHE[1], COR_DETALHE[2])
          const x = xEsq + RECUO + (q.etiqueta ? colunaEtiqueta : 0)
          q.linhas.forEach((l, i) => doc.text(l, x, linhaBase + i * alturaLinha(FONTE_DETALHE), { baseline: 'alphabetic' }))
        } else {
          usar('normal', FONTE_VALOR)
          doc.setTextColor(COR_VALOR[0], COR_VALOR[1], COR_VALOR[2])
          doc.text(partes[k].valor, cell.x + cell.width - cell.padding('right'), linhaBase, { baseline: 'alphabetic', align: 'right' })
        }
        topo += alturaParte(Math.max(1, q.linhas.length))
      })
      restaurarFonte()
      doc.setTextColor(corAntes)
      doc.setDrawColor(corFioAntes)
      doc.setLineWidth(espessuraAntes)
    },
  }
}
