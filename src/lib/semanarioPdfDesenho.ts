/**
 * Opções do autoTable do PDF do Semanário — o desenho em cima de
 * `montarTabelaSemanario`. Fica fora do componente pra o exportador e o script
 * de render usarem exatamente o mesmo código.
 *
 * Com custos ligados, UMA linha por item: as partes (tecido, motor…) não são
 * linhas, são desenhadas dentro da célula do Produto (rótulo) e do Custo
 * (valor). O autoTable não tem "segurar com a próxima": se as partes fossem
 * linhas, a página quebraria no meio do bloco. Por isso a altura delas é
 * somada ao padding de baixo da célula e `rowPageBreak: 'avoid'` cuida do resto.
 */
import type { jsPDF } from 'jspdf'
import type { CellHookData, UserOptions } from 'jspdf-autotable'
import { TEMA_TABELA, alinharSecoes, colunasCentro, colunasDireita } from '@/lib/pdfMarca'
import type { montarTabelaSemanario } from '@/lib/semanarioPdf'

export type TabelaSemanario = ReturnType<typeof montarTabelaSemanario>

const LARGURA_PRODUTO = 70   // mm — fixa pra o quebra-de-linha dos rótulos ser calculável antes do layout
const FONTE_PARTE = 7.5
const COR_PARTE: [number, number, number] = [110, 110, 110]
const RECUO_PARTE = 2        // mm, além do padding da célula
const FOLGA_PARTE = 1        // mm entre o texto do item e a primeira parte

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

  const alturaLinha = (fonte: number) => fonte * doc.getLineHeightFactor() / doc.internal.scaleFactor
  const fonteDoc = doc.getFontSize()
  const linhasPorLinha = new Map<number, string[][]>()   // linha do corpo → linhas quebradas de cada parte

  // quebra os rótulos com a fonte pequena, que é a que eles terão no desenho
  const quebrar = (rotulos: string[], largura: number) => {
    const antes = doc.getFontSize()
    doc.setFontSize(FONTE_PARTE)
    const r = rotulos.map(rot => doc.splitTextToSize(rot, largura) as string[])
    doc.setFontSize(antes)
    return r
  }

  // os valores são desenhados à mão (a célula do Custo é vazia), então o autoTable
  // não os mede: sem este piso a coluna fica do tamanho do título e o valor invade o Produto
  doc.setFontSize(FONTE_PARTE)
  const maiorValor = Math.max(0, ...t.partes.flat().map(p => doc.getTextWidth(p.valor)))
  doc.setFontSize(fonteDoc)

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
      const quebradas = quebrar(partes.map(p => p.rotulo), LARGURA_PRODUTO - pad.left - pad.right - RECUO_PARTE)
      linhasPorLinha.set(data.row.index, quebradas)
      const nLinhas = quebradas.reduce((s, l) => s + l.length, 0)
      cell.styles.cellPadding = { ...pad, bottom: pad.bottom + FOLGA_PARTE + nLinhas * alturaLinha(FONTE_PARTE) }
    },
    didDrawCell: (data: CellHookData) => {
      if (data.section !== 'body') return
      const ehProduto = data.column.index === t.colProduto
      if (!ehProduto && data.column.index !== t.colCusto) return
      const quebradas = linhasPorLinha.get(data.row.index)
      if (!quebradas) return
      const partes = t.partes[data.row.index]
      // o início das partes vem da célula do Produto (a do Custo é vazia): abaixo do texto do item
      const produto = data.row.cells[t.colProduto]
      const alturaTexto = produto.text.length * alturaLinha(produto.styles.fontSize)
      let y = data.cell.y + produto.padding('top') + alturaTexto + FOLGA_PARTE

      const corAntes = doc.getTextColor()
      const fonteAntes = doc.getFontSize()
      doc.setFontSize(FONTE_PARTE)
      doc.setTextColor(...COR_PARTE)
      quebradas.forEach((linhas, k) => {
        if (ehProduto) {
          doc.text(linhas, data.cell.x + data.cell.padding('left') + RECUO_PARTE, y, { baseline: 'top' })
        } else {
          doc.text(partes[k].valor, data.cell.x + data.cell.width - data.cell.padding('right'), y, { baseline: 'top', align: 'right' })
        }
        y += linhas.length * alturaLinha(FONTE_PARTE)
      })
      doc.setFontSize(fonteAntes)
      doc.setTextColor(corAntes)
    },
  }
}
