/**
 * Lógica pura da tela Acompanhar (fila de orçamentos esperando resposta).
 *
 * A unidade da tela é o PEDIDO: linhas de `orcamentos` com o mesmo `pedido_id`
 * viram um card só; linha sem `pedido_id` é um card sozinha (mesma regra do
 * Semanário — `chavePedido`). Tudo que não precisa de React mora aqui, pra
 * ter teste: agrupar, filtrar, ordenar, contar, telefone/WhatsApp, valor em
 * formato brasileiro e o rateio do "quanto o cliente pagou" entre os itens.
 */
import type { Orcamento } from '@/lib/supabase'
import { ehTeste, chavePedido } from '@/lib/analises/venda'
import { diasDesde, faixaEspera, type Desfecho } from '@/lib/desfecho'
import { ratear } from '@/lib/rateio'
import { formatCurrency } from '@/lib/utils'

export type Vista = 'fila' | 'respondidos'
export type FaixaId = 'novo' | 'atencao' | 'frio' | 'todos'
export type Ordem = 'recentes' | 'valor' | 'antigos'

export type CardPedido = {
  chave: string
  pedidoId: string | null
  /** na fila: só os itens que ainda esperam; em "respondidos": só os que têm desfecho */
  itens: Orcamento[]
  /** quantas linhas o pedido tem no total (inclui as já respondidas que não aparecem no card) */
  itensNoPedido: number
  cliente: string
  telefone: string
  responsavel: string
  origem: string | null
  /** quando o orçamento mais recente do pedido foi feito */
  criadoEm: string
  dias: number
  faixa: Exclude<FaixaId, 'todos'>
  total: number
  observacoes: string | null
  desfecho: Desfecho | null
  motivo: string | null
  respondidoEm: string | null
}

export const receitaItem = (o: Pick<Orcamento, 'valor_venda' | 'instalacao'>) =>
  Number(o.valor_venda ?? 0) + Number(o.instalacao ?? 0)

/** Está na fila: ninguém registrou resposta e a venda não foi marcada. */
export const naFila = (o: Orcamento) => !o.desfecho && !o.fechado

const maxIso = (a: string, b: string) => (new Date(a).getTime() >= new Date(b).getTime() ? a : b)

export function agrupar(linhas: Orcamento[], vista: Vista, agora: number = Date.now()): CardPedido[] {
  const grupos = new Map<string, Orcamento[]>()
  const totais = new Map<string, number>()
  for (const o of linhas) {
    if (ehTeste(o)) continue
    const kt = chavePedido(o)
    totais.set(kt, (totais.get(kt) ?? 0) + 1)
    const relevante = vista === 'fila' ? naFila(o) : !!o.desfecho
    if (!relevante) continue
    const k = chavePedido(o)
    const arr = grupos.get(k)
    if (arr) arr.push(o)
    else grupos.set(k, [o])
  }
  const cards: CardPedido[] = []
  for (const [chave, itens] of grupos) {
    itens.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    const criadoEm = itens.reduce((m, o) => maxIso(m, o.created_at), itens[0].created_at)
    const dias = diasDesde(criadoEm, agora)
    const resp = itens.map(o => o.desfecho_em).filter((d): d is string => !!d)
    cards.push({
      chave,
      pedidoId: itens[0].pedido_id ?? null,
      itens,
      itensNoPedido: Math.max(totais.get(chave) ?? itens.length, itens.length),
      cliente: itens.find(o => o.cliente)?.cliente ?? '',
      telefone: itens.find(o => o.telefone)?.telefone ?? '',
      responsavel: itens[0].responsavel ?? '',
      origem: itens.find(o => o.origem)?.origem ?? null,
      criadoEm,
      dias,
      faixa: faixaEspera(dias).id as CardPedido['faixa'],
      total: itens.reduce((s, o) => s + receitaItem(o), 0),
      observacoes: itens.find(o => o.observacoes?.trim())?.observacoes ?? null,
      desfecho: (itens.find(o => o.desfecho)?.desfecho as Desfecho | undefined) ?? null,
      motivo: itens.find(o => o.desfecho_motivo)?.desfecho_motivo ?? null,
      respondidoEm: resp.length ? resp.reduce(maxIso) : null,
    })
  }
  return cards
}

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function filtrar(
  cards: CardPedido[],
  { faixa = 'todos', busca = '', responsavel = '' }: { faixa?: FaixaId; busca?: string; responsavel?: string },
): CardPedido[] {
  const termo = semAcento(busca.trim())
  const digitos = busca.replace(/\D/g, '')
  return cards.filter((c) => {
    if (faixa !== 'todos' && c.faixa !== faixa) return false
    if (responsavel && c.responsavel !== responsavel) return false
    if (termo) {
      const texto = semAcento([c.cliente, ...c.itens.flatMap(o => [o.modelo, o.tecido])].join(' '))
      const porTexto = texto.includes(termo)
      const porFone = digitos.length >= 3 && c.itens.some(o => (o.telefone ?? '').replace(/\D/g, '').includes(digitos))
      if (!porTexto && !porFone) return false
    }
    return true
  })
}

export function ordenar(cards: CardPedido[], ordem: Ordem, vista: Vista = 'fila'): CardPedido[] {
  const quando = (c: CardPedido) => new Date(vista === 'respondidos' ? (c.respondidoEm ?? c.criadoEm) : c.criadoEm).getTime()
  const copia = [...cards]
  if (ordem === 'valor') return copia.sort((a, b) => b.total - a.total || quando(b) - quando(a))
  if (ordem === 'antigos') return copia.sort((a, b) => quando(a) - quando(b))
  return copia.sort((a, b) => quando(b) - quando(a))
}

export function contarFaixas(cards: CardPedido[]): Record<FaixaId, number> {
  const r: Record<FaixaId, number> = { novo: 0, atencao: 0, frio: 0, todos: cards.length }
  for (const c of cards) r[c.faixa]++
  return r
}

export function resumir(cards: CardPedido[]) {
  return {
    fila: cards.length,
    parado: cards.reduce((s, c) => s + c.total, 0),
    frios: cards.filter(c => c.faixa === 'frio').length,
  }
}

/** Número que o selo da aba mostra: pedidos na fila dentro de "até 7 dias". */
export function contarNovos(linhas: Orcamento[], agora: number = Date.now()): number {
  return agrupar(linhas, 'fila', agora).filter(c => c.faixa === 'novo').length
}

/* ── Valor em formato brasileiro ─────────────────────────────────────────── */

/**
 * "1.200,50" → 1200.5 · "1200,5" → 1200.5 · "1200.50" → 1200.5 · "1.200" → 1200.
 * Com vírgula, o ponto é sempre milhar. Sem vírgula, ponto seguido de exatamente
 * 3 dígitos em grupos é milhar; qualquer outro ponto é decimal. Vazio/zero/negativo → null.
 */
export function parseValorBR(texto: string | null | undefined): number | null {
  if (!texto) return null
  let t = String(texto).replace(/[^\d,.]/g, '')
  if (!t) return null
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  const n = parseFloat(t)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

/** Texto de pagamento gravado em `forma_pagamento_real` (mesmo formato de antes). */
export function formaDePagamento(parcelas: number, efetivo: number, base: number): string | null {
  if (parcelas >= 2 && efetivo > 0) {
    const juros = base > 0 && efetivo > base + 0.009
      ? ` · +${(((efetivo - base) / base) * 100).toFixed(1)}% de juros`
      : ''
    return `${parcelas}x de ${formatCurrency(efetivo / parcelas)}${juros}`
  }
  return parcelas === 1 ? 'à vista' : null
}

/* ── Telefone / WhatsApp ─────────────────────────────────────────────────── */

/** Mesma regra do EditOrcamentoForm: só dígitos, e 55 só entra se ainda não estiver. */
export function telefoneInternacional(tel: string | null | undefined): string {
  const digits = (tel ?? '').replace(/\D/g, '')
  return digits ? (digits.startsWith('55') ? digits : `55${digits}`) : ''
}

export function formatarTelefone(tel: string | null | undefined): string {
  let d = (tel ?? '').replace(/\D/g, '')
  if (!d) return ''
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2)
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return tel!.trim()
}

export function primeiroNome(cliente: string | null | undefined): string {
  const nome = (cliente ?? '').trim().split(/\s+/)[0] ?? ''
  if (!nome) return ''
  return nome.charAt(0).toLocaleUpperCase('pt-BR') + nome.slice(1).toLocaleLowerCase('pt-BR')
}

export function mensagemCobranca(cliente: string | null | undefined, modelo: string | null | undefined): string {
  const nome = primeiroNome(cliente)
  const m = (modelo ?? '').trim()
  return `Olá${nome ? `, ${nome}` : ''}! Aqui é da Sombrear. Passando para saber se ficou alguma dúvida sobre o orçamento${m ? ` de ${m}` : ''} que enviamos. Posso ajudar?`
}

/** Link do WhatsApp com a mensagem pronta; '' quando não há telefone. */
export function linkWhatsApp(card: Pick<CardPedido, 'cliente' | 'telefone' | 'itens'>): string {
  const fone = telefoneInternacional(card.telefone)
  if (!fone) return ''
  return `https://wa.me/${fone}?text=${encodeURIComponent(mensagemCobranca(card.cliente, card.itens[0]?.modelo))}`
}

/* ── Texto do item ───────────────────────────────────────────────────────── */

const medida = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** "Rolô Blackout Branco 1,50×2,00 · 2 un" */
export function resumoItem(o: Orcamento): string {
  const base = [o.modelo, o.tecido].filter(Boolean).join(' ')
  const med = o.largura && o.altura ? ` ${medida(Number(o.largura))}×${medida(Number(o.altura))}` : ''
  const qtd = o.quantidade > 1 ? ` · ${o.quantidade} un` : ''
  return `${base}${med}${qtd}`.trim()
}

/* ── Escritas (patches) ──────────────────────────────────────────────────── */

export type Patch = Partial<Orcamento>
export type Escrita = { id: string; patch: Patch }

const carimbo = (email: string | null, agora: Date) => ({
  desfecho_em: agora.toISOString(),
  desfecho_por: email,
})

export function escritasNaoFechou(itens: Orcamento[], motivo: string | null, email: string | null, agora = new Date()): Escrita[] {
  return itens.map(o => ({
    id: o.id,
    patch: { desfecho: 'perdido', ...carimbo(email, agora), desfecho_motivo: motivo },
  }))
}

export function escritasSumiu(itens: Orcamento[], email: string | null, agora = new Date()): Escrita[] {
  return itens.map(o => ({
    id: o.id,
    patch: { desfecho: 'sumiu', ...carimbo(email, agora), desfecho_motivo: null },
  }))
}

/**
 * Fechou. O "quanto o cliente pagou" é do pedido inteiro: é rateado entre os itens
 * proporcional ao valor de cada um (mesma `ratear` do Semanário, que grava
 * `valor_cobrado` POR ITEM) e a soma dos itens bate o total ao centavo.
 * Se o valor é igual ao calculado, grava `valor_cobrado: null` (não é ajuste, e limpa
 * qualquer valor de um fechamento anterior). Idem `forma_pagamento_real` sem forma informada.
 */
export function escritasFechou(
  itens: Orcamento[],
  { origem, parcelas, cobrado }: { origem: string; parcelas: number; cobrado: number | null },
  email: string | null,
  agora = new Date(),
): Escrita[] {
  const pesos = itens.map(receitaItem)
  const base = pesos.reduce((s, p) => s + p, 0)
  const efetivo = cobrado ?? base
  const ajustou = cobrado != null && Math.abs(cobrado - base) > 0.005
  const partes = ajustou ? ratear(cobrado!, pesos) : null
  const forma = formaDePagamento(parcelas, efetivo, base)
  return itens.map((o, i) => ({
    id: o.id,
    patch: {
      desfecho: 'fechou',
      ...carimbo(email, agora),
      desfecho_motivo: null,
      fechado: true,
      status: 'fechado',
      origem: origem || o.origem || null,
      // sempre escreve: sem ajuste, um valor_cobrado antigo de um fechamento anterior não pode sobreviver
      valor_cobrado: partes ? partes[i] : null,
      forma_pagamento_real: forma ?? null,
    },
  }))
}

/**
 * Voltar pra fila. `escritoAqui` = o que o fluxo "Fechou" desta tela gravou nesta
 * sessão (valor_cobrado/forma); só nesse caso, e só se ainda for o mesmo valor, o
 * dinheiro é limpo. Linha antiga: só desfecho e `fechado` — não dá pra saber quem
 * gravou o valor. `status` só volta pra CALCULADO se estiver 'fechado'.
 */
export function escritaVoltar(
  o: Orcamento,
  escritoAqui?: { valor_cobrado?: number | null; forma_pagamento_real?: string | null },
): Patch {
  const patch: Patch = { desfecho: null, desfecho_em: null, desfecho_por: null, desfecho_motivo: null }
  if (o.desfecho === 'fechou') {
    patch.fechado = false
    if (o.status === 'fechado') patch.status = 'CALCULADO'
    if (escritoAqui) {
      if (escritoAqui.valor_cobrado != null && Number(o.valor_cobrado) === Number(escritoAqui.valor_cobrado)) patch.valor_cobrado = null
      if (escritoAqui.forma_pagamento_real && o.forma_pagamento_real === escritoAqui.forma_pagamento_real) patch.forma_pagamento_real = null
    }
  }
  return patch
}

/** Valores atuais dos campos que o patch vai escrever — é o que o "Desfazer" devolve. */
export function valoresAnteriores(o: Orcamento, patch: Patch): Patch {
  const prev: Record<string, unknown> = {}
  for (const k of Object.keys(patch) as (keyof Orcamento)[]) prev[k] = o[k] ?? null
  return prev as Patch
}
