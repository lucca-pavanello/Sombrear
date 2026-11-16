/**
 * Identidade Sombrear nos PDFs — a MESMA faixa em todos.
 *
 * Antes cada exportador desenhava seu cabeçalho ("Loja Sombrear",
 * "Sombrear — Orçamentos", "Sombrear — Semanário de vendas"…) e só a
 * proposta ao cliente tinha a marca de verdade. Este módulo extrai a faixa
 * da proposta — quadrado branco com o S, wordmark, subtítulo — e um rodapé
 * padrão com endereço, data de geração e página, pra tudo sair da mesma
 * família.
 *
 * Cada mudança aqui muda TODOS os PDFs de uma vez — é o ponto.
 */
import type { jsPDF } from 'jspdf'

export const LARANJA: [number, number, number] = [232, 112, 26]
const CINZA_TEXTO: [number, number, number] = [130, 130, 130]

export const ENDERECO = 'Sombrear Cortinas e Persianas · Av. Fernando Costa, 984 – Vila Maceno'

/* CNPJ e WhatsApp vêm do ambiente (Vercel) — a loja preenche, o código não
   inventa. Vazios, o rodapé simplesmente não os mostra. */
const fmtFone = (v: string | undefined): string | null => {
  const d = (v ?? '').replace(/\D/g, '').replace(/^55/, '')
  if (d.length < 10) return null
  return `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}`
}
const FONE = fmtFone(import.meta.env.VITE_WHATSAPP_LOJA as string | undefined)
const CNPJ = ((import.meta.env.VITE_CNPJ_LOJA as string | undefined) ?? '').trim() || null

/** Estilos de tabela compartilhados (autoTable) */
export const LINHA_QUENTE: [number, number, number] = [226, 217, 208]

export const TEMA_TABELA = {
  theme: 'striped' as const,
  // divisórias verticais finas + moldura, num tom quente — colunas firmes sem virar grade pesada
  styles: { lineColor: LINHA_QUENTE, lineWidth: { right: 0.15 } },
  tableLineColor: LINHA_QUENTE,
  tableLineWidth: 0.2,
  headStyles: { fillColor: LARANJA, textColor: 255 as const, fontStyle: 'bold' as const, fontSize: 9, lineWidth: 0, halign: 'center' as const },
  footStyles: { fillColor: [243, 245, 247] as [number, number, number], textColor: [24, 28, 36] as [number, number, number], fontStyle: 'bold' as const, lineWidth: 0 },
  alternateRowStyles: { fillColor: [252, 248, 245] as [number, number, number] },
  bodyStyles: { fontSize: 9 },
}

/**
 * columnStyles do autoTable só alinha o CORPO. Os nomes de coluna são sempre
 * centrados (headStyles); este hook alinha a linha de TOTAIS pela régua das
 * colunas de dinheiro, pra soma cair embaixo dos números que soma.
 */
export const alinharSecoes = (mapa: Record<number, 'left' | 'center' | 'right'>) =>
  (data: { section: string; column: { index: number }; cell: { styles: { halign?: string } } }) => {
    if (data.section === 'foot') {
      const h = mapa[data.column.index]
      if (h) data.cell.styles.halign = h
    }
  }

/** halign à direita para as colunas de dinheiro — papel lê número pela vírgula */
export const colunasDireita = (indices: number[]) =>
  Object.fromEntries(indices.map(i => [i, { halign: 'right' as const }]))

export const colunasCentro = (indices: number[]) =>
  Object.fromEntries(indices.map(i => [i, { halign: 'center' as const }]))

/**
 * Faixa da marca no topo da página atual. Retorna o Y onde o conteúdo começa.
 * `titulo` fica à direita em caixa alta (é o assunto do documento; a marca é fixa).
 */
export function faixaMarca(doc: jsPDF, titulo: string, subtitulo?: string): number {
  const W = doc.internal.pageSize.getWidth()
  const M = 14
  doc.setFillColor(...LARANJA)
  doc.rect(0, 0, W, 30, 'F')
  doc.setFillColor(196, 94, 20)          // #C45E14 — a ponta escura do gradiente da marca
  doc.rect(0, 28.6, W, 1.4, 'F')

  // o "S" no quadrado branco — mesmo desenho do app e da proposta
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(M, 6.5, 17, 17, 3.5, 3.5, 'F')
  doc.setTextColor(...LARANJA)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('S', M + 8.5, 17.5, { align: 'center' })

  doc.setTextColor(255, 255, 255)
  doc.setFontSize(17)
  doc.text('Sombrear', M + 21.5, 15.5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.text('Cortinas e Persianas sob medida', M + 21.5, 21.5)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(titulo.toUpperCase(), W - M, subtitulo ? 14 : 17, { align: 'right' })
  if (subtitulo) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.text(subtitulo, W - M, 20.5, { align: 'right' })
  }
  doc.setTextColor(40, 40, 40)
  doc.setFont('helvetica', 'normal')
  return 38
}

/** Linha de contato completa — endereço + CNPJ + WhatsApp (o que existir) */
export const contatoLoja = () =>
  [ENDERECO, CNPJ && `CNPJ ${CNPJ}`, FONE && `WhatsApp ${FONE}`].filter(Boolean).join('  ·  ')

/** Rodapé em TODAS as páginas: endereço, geração e "pág X de Y". Chamar por último. */
export function rodapeMarca(doc: jsPDF) {
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const total = doc.getNumberOfPages()
  const quando = new Date().toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
  const contato = [CNPJ && `CNPJ ${CNPJ}`, FONE && `WhatsApp ${FONE}`].filter(Boolean).join('  ·  ')
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    doc.setDrawColor(...LARANJA)
    doc.setLineWidth(0.4)
    doc.line(14, H - 15.5, W - 14, H - 15.5)
    doc.setLineWidth(0.2)
    doc.setFontSize(7.5)
    doc.setTextColor(...CINZA_TEXTO)
    doc.text(ENDERECO, 14, H - 11)
    doc.text(`pág. ${p} de ${total}`, W - 14, H - 11, { align: 'right' })
    if (contato) doc.text(contato, 14, H - 6.5)
    doc.text(`Gerado em ${quando}`, W - 14, H - 6.5, { align: 'right' })
  }
}
