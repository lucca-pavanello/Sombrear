/**
 * As ferramentas de leitura do copilot — as contas que a IA pede e o código faz.
 *
 * Mesmo padrão do chat da TECPAV (`chat-ia`) e do Garimpo (`conversar-ia`): a IA nunca
 * recebe a tabela nem faz conta de cabeça. Ela chama uma ferramenta, a ferramenta devolve
 * o número pronto e a resposta só pode usar o que veio daqui.
 *
 * Carregado também dentro da Edge Function `copilot-ia`, por isso só importa
 * `../analises/venda.ts` (sem alias `@/`, extensão explícita). As regras de venda são as
 * mesmas das telas: `fechado`, `valor_cobrado ?? valor_venda + instalacao`, itens do mesmo
 * pedido são uma venda só, data do pedido no dia de São Paulo.
 *
 * Telefone e e-mail nunca saem daqui: servem só para casar venda com lead.
 */

import { chavePedido, dataVenda, ehTeste, ehVenda, receita, type VendaMinima } from '../analises/venda.ts'
import { MOTIVOS_PERDA, faixaEspera } from '../desfecho.ts'
import { ferramentaPermitida, semMargem, type PermissoesCopilot } from './permissoes.ts'

export type VendaCopilot = VendaMinima & {
  modelo?: string | null
  responsavel?: string | null
  origem?: string | null
  telefone?: string | null
  margem?: number | null
  /** 'fechou' | 'perdido' | 'sumiu' | null (null = ainda esperando resposta); ver src/lib/desfecho.ts */
  desfecho?: string | null
  desfecho_em?: string | null
  desfecho_motivo?: string | null
}

export type LeadCopilot = {
  id: string
  created_at: string
  nome?: string | null
  whatsapp?: string | null
  identificador_usuario?: string | null
  status_lead?: string | null
  origem?: string | null
  ultimo_valor_cotado?: string | null
  timestamp_ultima_msg?: string | null
  lead_temperatura?: string | null
  lead_score?: number | null
  modelo_interesse?: string | null
  ambiente?: string | null
  cidade?: string | null
  resumo_conversa?: string | null
  objecoes?: string | null
  chatwoot_labels?: string | null
  precisa_humano?: string | null
}

// ── Datas no dia da loja ─────────────────────────────────────────────────────

const DIA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
})

export function diaCasa(iso: string | null | undefined): string | null {
  if (!iso) return null
  const t = new Date(iso)
  return Number.isFinite(t.getTime()) ? DIA.format(t) : null
}

export const hojeCasa = (agora: Date = new Date()) => DIA.format(agora)

const DATA = /^\d{4}-\d{2}-\d{2}$/

export type Periodo = { inicio: string; fim: string }

/** Confere "AAAA-MM-DD" e a ordem; o que vem da IA não é confiável. */
export function periodoValido(p: Partial<Periodo> | null | undefined): Periodo | null {
  if (!p || !DATA.test(String(p.inicio)) || !DATA.test(String(p.fim))) return null
  return p.inicio! <= p.fim! ? { inicio: p.inicio!, fim: p.fim! } : { inicio: p.fim!, fim: p.inicio! }
}

const noDia = (iso: string | null | undefined, p: Periodo) => {
  const d = diaCasa(iso)
  return !!d && d >= p.inicio && d <= p.fim
}

const diasEntre = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)

const arred = (n: number, casas = 2) => Math.round(n * 10 ** casas) / 10 ** casas

// ── Venda ────────────────────────────────────────────────────────────────────

function vendasDo(orcs: VendaCopilot[], p: Periodo) {
  return orcs.filter((o) => ehVenda(o) && !ehTeste(o) && noDia(dataVenda(o), p))
}

export type Numeros = {
  periodo: Periodo
  receita: number
  pedidos: number
  itens: number
  ticket_por_pedido: number | null
  /** margem ponderada pela receita, só das vendas com margem informada */
  margem_media_pct: number | null
  vendas_com_margem: number
  aviso?: string
}

export function numerosDoPeriodo(orcs: VendaCopilot[], p: Periodo, hoje = hojeCasa()): Numeros {
  const vendas = vendasDo(orcs, p)
  const total = vendas.reduce((s, o) => s + receita(o), 0)
  const pedidos = new Set(vendas.map(chavePedido)).size
  const comMargem = vendas.filter((o) => o.margem != null && Number.isFinite(Number(o.margem)))
  const baseMargem = comMargem.reduce((s, o) => s + receita(o), 0)
  const margem = baseMargem > 0
    ? comMargem.reduce((s, o) => s + Number(o.margem) * receita(o), 0) / baseMargem
    : null
  const saida: Numeros = {
    periodo: p,
    receita: arred(total),
    pedidos,
    itens: vendas.length,
    ticket_por_pedido: pedidos > 0 ? arred(total / pedidos) : null,
    margem_media_pct: margem === null ? null : arred(margem, 1),
    vendas_com_margem: comMargem.length,
  }
  if (p.fim >= hoje && p.inicio <= hoje) saida.aviso = 'período ainda em andamento'
  return saida
}

/**
 * Compara dois períodos. Se o atual ainda não terminou, o anterior é cortado no mesmo
 * número de dias: 20 dias de setembro contra agosto inteiro não é queda, é mês incompleto.
 */
export function compararPeriodos(orcs: VendaCopilot[], atual: Periodo, anterior: Periodo, hoje = hojeCasa()) {
  let ant = anterior
  let aviso: string | undefined
  if (atual.fim > hoje && atual.inicio <= hoje) {
    const decorridos = diasEntre(atual.inicio, hoje)
    const fimCortado = new Date(Date.parse(`${anterior.inicio}T12:00:00Z`) + decorridos * 86_400_000)
      .toISOString().slice(0, 10)
    if (fimCortado < anterior.fim) {
      ant = { inicio: anterior.inicio, fim: fimCortado }
      aviso = `período atual em andamento: o anterior foi cortado até ${fimCortado} para comparar trechos iguais`
    }
  } else if (diasEntre(atual.inicio, atual.fim) !== diasEntre(anterior.inicio, anterior.fim)) {
    aviso = 'os dois períodos têm tamanhos diferentes'
  }
  const a = numerosDoPeriodo(orcs, atual, hoje)
  const b = numerosDoPeriodo(orcs, ant, hoje)
  const variacao = (x: number | null, y: number | null) =>
    x == null || y == null || y <= 0 ? null : arred(((x - y) / y) * 100, 1)
  return {
    atual: a,
    anterior: b,
    variacao_pct: {
      receita: variacao(a.receita, b.receita),
      pedidos: variacao(a.pedidos, b.pedidos),
      ticket_por_pedido: variacao(a.ticket_por_pedido, b.ticket_por_pedido),
    },
    diferenca_margem_pontos: a.margem_media_pct != null && b.margem_media_pct != null
      ? arred(a.margem_media_pct - b.margem_media_pct, 1)
      : null,
    ...(aviso ? { aviso } : {}),
  }
}

/** Receita e pedidos dos últimos `meses` meses do calendário, com os meses zerados. */
export function serieMensal(orcs: VendaCopilot[], meses = 6, hoje = hojeCasa()) {
  const n = Math.min(Math.max(Math.round(meses) || 6, 1), 24)
  let ano = Number(hoje.slice(0, 4))
  let mes = Number(hoje.slice(5, 7))
  const lista: string[] = []
  for (let i = 0; i < n; i++) {
    lista.unshift(`${ano}-${String(mes).padStart(2, '0')}`)
    mes--
    if (mes === 0) { mes = 12; ano-- }
  }
  return lista.map((m) => {
    const vendas = orcs.filter((o) => ehVenda(o) && !ehTeste(o) && diaCasa(dataVenda(o))?.slice(0, 7) === m)
    return {
      mes: m,
      receita: arred(vendas.reduce((s, o) => s + receita(o), 0)),
      pedidos: new Set(vendas.map(chavePedido)).size,
      ...(m === hoje.slice(0, 7) ? { em_andamento: true } : {}),
    }
  })
}

export function porModelo(orcs: VendaCopilot[], p: Periodo) {
  const mapa = new Map<string, { modelo: string; itens: number; pedidos: Set<string>; receita: number }>()
  for (const o of vendasDo(orcs, p)) {
    const modelo = (o.modelo ?? '').trim() || 'sem modelo'
    const linha = mapa.get(modelo) ?? { modelo, itens: 0, pedidos: new Set<string>(), receita: 0 }
    linha.itens++
    linha.pedidos.add(chavePedido(o))
    linha.receita += receita(o)
    mapa.set(modelo, linha)
  }
  return [...mapa.values()]
    .map((l) => ({ modelo: l.modelo, itens: l.itens, pedidos: l.pedidos.size, receita: arred(l.receita) }))
    .sort((a, b) => b.receita - a.receita)
}

// ── Lead ─────────────────────────────────────────────────────────────────────

/** Mesma regra de `normalizarTelefone` do dash: sem 55 e sem o 9º dígito. */
export function normalizarTelefone(v: string | null | undefined): string {
  let d = String(v ?? '').replace(/\D/g, '')
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
  if (d.length === 11) d = d.slice(0, 2) + d.slice(3)
  return d
}

const ehHistorico = (l: LeadCopilot) => ['historico', 'novo'].includes((l.status_lead ?? '').trim().toLowerCase())
const marcadoConvertido = (l: LeadCopilot) => ['convertido', 'fechado'].includes((l.status_lead ?? '').trim().toLowerCase())
const recebeuPreco = (v: string | null | undefined) => {
  const n = parseFloat(String(v ?? '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0
}
const canal = (v: string | null | undefined) => (v ?? '').trim().toLowerCase() || 'sem canal'

/** ids dos leads com venda na loja pelo telefone, feita no dia em que chegaram ou depois */
export function leadsQueCompraram(leads: LeadCopilot[], orcs: VendaCopilot[]): Set<string> {
  const porTel = new Map<string, LeadCopilot>()
  for (const l of leads) {
    const t = normalizarTelefone(l.whatsapp ?? l.identificador_usuario)
    if (t && !porTel.has(t)) porTel.set(t, l)
  }
  const ids = new Set<string>()
  for (const o of orcs) {
    if (!ehVenda(o) || ehTeste(o)) continue
    const l = porTel.get(normalizarTelefone(o.telefone))
    const dv = diaCasa(dataVenda(o))
    const dl = l ? diaCasa(l.created_at) : null
    if (l && dv && dl && dv >= dl) ids.add(l.id)
  }
  return ids
}

export function porCanal(orcs: VendaCopilot[], leads: LeadCopilot[], p: Periodo) {
  const compraram = leadsQueCompraram(leads, orcs)
  const porTel = new Map<string, LeadCopilot>()
  for (const l of leads) {
    const t = normalizarTelefone(l.whatsapp ?? l.identificador_usuario)
    if (t && !porTel.has(t)) porTel.set(t, l)
  }
  const mapa = new Map<string, { canal: string; leads: number; cotados: number; compraram: number; pedidos: Set<string>; receita: number }>()
  const pega = (c: string) => {
    const l = mapa.get(c) ?? { canal: c, leads: 0, cotados: 0, compraram: 0, pedidos: new Set<string>(), receita: 0 }
    mapa.set(c, l)
    return l
  }
  for (const l of leads) {
    if (ehHistorico(l) || !noDia(l.created_at, p)) continue
    const linha = pega(canal(l.origem))
    linha.leads++
    if (recebeuPreco(l.ultimo_valor_cotado)) linha.cotados++
    if (marcadoConvertido(l) || compraram.has(l.id)) linha.compraram++
  }
  for (const o of vendasDo(orcs, p)) {
    const origem = o.origem || porTel.get(normalizarTelefone(o.telefone))?.origem
    const linha = pega(canal(origem))
    linha.pedidos.add(chavePedido(o))
    linha.receita += receita(o)
  }
  return [...mapa.values()]
    .map((l) => ({
      canal: l.canal,
      leads: l.leads,
      cotados: l.cotados,
      leads_que_compraram: l.compraram,
      conversao_pct: l.leads > 0 ? arred((l.compraram / l.leads) * 100, 1) : null,
      pedidos: l.pedidos.size,
      receita: arred(l.receita),
    }))
    .sort((a, b) => b.receita - a.receita || b.leads - a.leads)
}

const diasDesde = (iso: string | null | undefined, hoje: string) => {
  const d = diaCasa(iso)
  return d ? diasEntre(d, hoje) : null
}

const fichaCurta = (l: LeadCopilot, hoje: string) => ({
  id: l.id,
  nome: l.nome?.trim() || 'sem nome',
  canal: canal(l.origem),
  temperatura: l.lead_temperatura ?? null,
  score: l.lead_score ?? null,
  modelo_interesse: l.modelo_interesse ?? null,
  ultimo_valor_cotado: recebeuPreco(l.ultimo_valor_cotado) ? l.ultimo_valor_cotado : null,
  dias_sem_mensagem: diasDesde(l.timestamp_ultima_msg ?? l.created_at, hoje),
  com_a_equipe: (l.chatwoot_labels ?? '').toLowerCase().split(',').some((x) => x.trim() === 'humano')
    || (l.precisa_humano ?? '').trim().toLowerCase() === 'sim',
})

/** Quem tem mais chance de fechar: quente ou morno, ainda sem venda, pelo score. */
export function leadsQuentes(leads: LeadCopilot[], orcs: VendaCopilot[], limite = 10, hoje = hojeCasa()) {
  const compraram = leadsQueCompraram(leads, orcs)
  const candidatos = leads.filter((l) =>
    !ehHistorico(l) && !marcadoConvertido(l) && !compraram.has(l.id)
    && ['quente', 'morno'].includes((l.lead_temperatura ?? '').trim().toLowerCase()))
  const lista = candidatos
    .sort((a, b) => (b.lead_score ?? -1) - (a.lead_score ?? -1)
      || (diasDesde(a.timestamp_ultima_msg, hoje) ?? 999) - (diasDesde(b.timestamp_ultima_msg, hoje) ?? 999))
    .slice(0, Math.min(Math.max(limite, 1), 20))
    .map((l) => fichaCurta(l, hoje))
  return { total: candidatos.length, mostrando: lista.length, leads: lista }
}

/** Lead parado: recebeu preço, não comprou e está sem mensagem há `dias` dias ou mais. */
export function leadsParados(leads: LeadCopilot[], orcs: VendaCopilot[], dias = 7, limite = 10, hoje = hojeCasa()) {
  const compraram = leadsQueCompraram(leads, orcs)
  const minimo = Math.max(Math.round(dias) || 7, 1)
  const candidatos = leads
    .filter((l) => !ehHistorico(l) && !marcadoConvertido(l) && !compraram.has(l.id)
      && recebeuPreco(l.ultimo_valor_cotado))
    .map((l) => ({ l, parado: diasDesde(l.timestamp_ultima_msg ?? l.created_at, hoje) ?? 0 }))
    .filter((x) => x.parado >= minimo)
  const lista = candidatos
    .sort((a, b) => (b.l.lead_score ?? -1) - (a.l.lead_score ?? -1) || a.parado - b.parado)
    .slice(0, Math.min(Math.max(limite, 1), 20))
    .map((x) => fichaCurta(x.l, hoje))
  return { total: candidatos.length, mostrando: lista.length, dias_minimos: minimo, leads: lista }
}

/** Ficha de um lead por nome ou id. Nunca devolve telefone. */
export function verLead(leads: LeadCopilot[], orcs: VendaCopilot[], termo: string, hoje = hojeCasa()) {
  const t = String(termo ?? '').trim().toLowerCase()
  if (t.length < 2) return { achados: 0, leads: [] }
  const achados = leads.filter((l) => l.id === termo || (l.nome ?? '').toLowerCase().includes(t))
  const compraram = leadsQueCompraram(leads, orcs)
  return {
    achados: achados.length,
    leads: achados.slice(0, 5).map((l) => ({
      ...fichaCurta(l, hoje),
      chegou_em: diaCasa(l.created_at),
      comprou: marcadoConvertido(l) || compraram.has(l.id),
      ambiente: l.ambiente ?? null,
      cidade: l.cidade ?? null,
      objecoes: l.objecoes ?? null,
      resumo: (l.resumo_conversa ?? '').slice(0, 600) || null,
    })),
  }
}

// ── Orçamentos em aberto e desfechos ─────────────────────────────────────────
// Orçamento em aberto = a fila do "Acompanhar": sem desfecho e ainda não fechado.
// Venda (fechado) é coisa à parte: nenhuma conta de venda olha para estas linhas.

const semAcento = (v: string | null | undefined) =>
  String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

const ehAberto = (o: VendaCopilot) => !o.desfecho && !o.fechado && !ehTeste(o)

type Cotacao = { itens: VendaCopilot[]; valor: number }

/** Itens do mesmo pedido contam como UM orçamento, com os valores somados (como o Semanário). */
function agruparPedidos(lista: VendaCopilot[]): Cotacao[] {
  const mapa = new Map<string, Cotacao>()
  for (const o of lista) {
    const k = chavePedido(o)
    const c = mapa.get(k) ?? { itens: [], valor: 0 }
    c.itens.push(o)
    c.valor += receita(o)
    mapa.set(k, c)
  }
  return [...mapa.values()]
}

export type FiltroAbertos = { responsavel?: string | null; modelo?: string | null; limite?: number; ordem?: 'valor' | 'antigos' }

export function orcamentosEmAberto(orcs: VendaCopilot[], f: FiltroAbertos = {}, hoje = hojeCasa()) {
  const resp = semAcento(f.responsavel)
  const mod = semAcento(f.modelo)
  const itens = orcs.filter((o) => ehAberto(o)
    && (!resp || semAcento(o.responsavel).includes(resp))
    && (!mod || semAcento(o.modelo).includes(mod)))
  const cotacoes = agruparPedidos(itens).map((c) => ({
    cliente: c.itens[0].cliente?.trim() || 'sem nome',
    modelo: [...new Set(c.itens.map((o) => (o.modelo ?? '').trim()).filter(Boolean))].join(', ') || 'sem modelo',
    valor: arred(c.valor),
    // como o card do Acompanhar: a espera conta do item MAIS RECENTE do pedido (menor nº de dias)
    dias_parado: Math.min(...c.itens.map((o) => diasDesde(o.created_at, hoje) ?? 0)),
    responsavel: c.itens[0].responsavel?.trim() || 'sem responsável',
  }))
  const faixas = new Map<string, { faixa: string; orcamentos: number; valor: number }>()
  for (const rotulo of ['até 7 dias', '8 a 30 dias', 'mais de 30 dias']) faixas.set(rotulo, { faixa: rotulo, orcamentos: 0, valor: 0 })
  for (const c of cotacoes) {
    const l = faixas.get(faixaEspera(c.dias_parado).rotulo)!
    l.orcamentos++
    l.valor += c.valor
  }
  const quer = f.limite != null && Number.isFinite(Number(f.limite)) ? Math.min(Math.max(Math.round(Number(f.limite)), 1), 20) : 0
  const lista = quer
    ? [...cotacoes]
      .sort(f.ordem === 'antigos' ? (a, b) => b.dias_parado - a.dias_parado || b.valor - a.valor : (a, b) => b.valor - a.valor || b.dias_parado - a.dias_parado)
      .slice(0, quer)
    : []
  return {
    orcamentos_em_aberto: cotacoes.length,
    valor_total: arred(cotacoes.reduce((s, c) => s + c.valor, 0)),
    por_faixa_de_espera: [...faixas.values()].map((l) => ({ ...l, valor: arred(l.valor) })),
    filtros: { responsavel: f.responsavel?.trim() || null, modelo: f.modelo?.trim() || null },
    ...(quer ? { ordenado_por: f.ordem === 'antigos' ? 'mais antigos' : 'maior valor', mostrando: lista.length, orcamentos: lista } : {}),
  }
}

/**
 * Desfechos marcados no período (pelo dia de `desfecho_em`): fechou / não fechou / sumiu.
 * Conversão entre quem respondeu = fechou ÷ (fechou + não fechou); "sumiu" não respondeu.
 */
export function desfechosDoPeriodo(orcs: VendaCopilot[], p: Periodo) {
  const marcados = orcs.filter((o) => !!o.desfecho && !ehTeste(o) && noDia(o.desfecho_em, p))
  const conta = { fechou: 0, perdido: 0, sumiu: 0 }
  const valor = { fechou: 0, perdido: 0, sumiu: 0 }
  const motivos = new Map<string, { motivo: string; orcamentos: number; valor: number }>()
  for (const g of agruparPedidos(marcados)) {
    const d = g.itens[0].desfecho as keyof typeof conta
    if (!(d in conta)) continue
    conta[d]++
    valor[d] += g.valor
    if (d === 'perdido') {
      const bruto = (g.itens[0].desfecho_motivo ?? '').trim()
      const chave = semAcento(bruto) || 'sem motivo informado'
      const rotulo = MOTIVOS_PERDA.find((m) => semAcento(m) === chave) ?? (bruto || 'sem motivo informado')
      const m = motivos.get(chave) ?? { motivo: rotulo, orcamentos: 0, valor: 0 }
      m.orcamentos++
      m.valor += g.valor
      motivos.set(chave, m)
    }
  }
  const respondidos = conta.fechou + conta.perdido
  const todos = respondidos + conta.sumiu
  return {
    periodo: p,
    fechou: conta.fechou,
    nao_fechou: conta.perdido,
    sumiu: conta.sumiu,
    total_com_desfecho: todos,
    respondidos,
    conversao_entre_respondidos_pct: respondidos > 0 ? arred((conta.fechou / respondidos) * 100, 1) : null,
    conversao_sobre_todos_pct: todos > 0 ? arred((conta.fechou / todos) * 100, 1) : null,
    valor_fechou: arred(valor.fechou),
    valor_nao_fechou: arred(valor.perdido),
    valor_sumiu: arred(valor.sumiu),
    motivos_de_perda: [...motivos.values()]
      .map((m) => ({ ...m, valor: arred(m.valor) }))
      .sort((a, b) => b.orcamentos - a.orcamentos || b.valor - a.valor),
  }
}

// ── Conta ────────────────────────────────────────────────────────────────────

/**
 * Calculadora para a IA não fazer conta de cabeça. Aceita só números, + - * / ( ) e
 * vírgula decimal; qualquer outra coisa é recusada antes de avaliar.
 */
export function calcular(expressao: string): { resultado: number } | { erro: string } {
  const e = String(expressao ?? '').replace(/,/g, '.').replace(/\s+/g, '')
  if (!e || e.length > 200 || !/^[\d.+\-*/()]+$/.test(e)) return { erro: 'expressão inválida' }
  let i = 0
  const numero = (): number => {
    if (e[i] === '(') { i++; const v = soma(); if (e[i] !== ')') throw new Error(); i++; return v }
    if (e[i] === '-') { i++; return -numero() }
    const m = /^\d+(\.\d+)?/.exec(e.slice(i))
    if (!m) throw new Error()
    i += m[0].length
    return Number(m[0])
  }
  const produto = (): number => {
    let v = numero()
    while (e[i] === '*' || e[i] === '/') { const op = e[i++]; const d = numero(); v = op === '*' ? v * d : v / d }
    return v
  }
  const soma = (): number => {
    let v = produto()
    while (e[i] === '+' || e[i] === '-') { const op = e[i++]; const d = produto(); v = op === '+' ? v + d : v - d }
    return v
  }
  try {
    const v = soma()
    if (i !== e.length || !Number.isFinite(v)) return { erro: 'expressão inválida' }
    return { resultado: arred(v, 4) }
  } catch {
    return { erro: 'expressão inválida' }
  }
}

// ── Despacho ─────────────────────────────────────────────────────────────────

export type Dados = { orcamentos: VendaCopilot[]; leads: LeadCopilot[] }

/** Roda a ferramenta pedida pela IA. Argumento inválido vira erro legível, nunca exceção. */
export function rodarFerramenta(
  nome: string, args: Record<string, unknown>, dados: Dados, hoje = hojeCasa(), permissoes?: PermissoesCopilot,
): unknown {
  // Sem `permissoes` = tudo liberado (testes e uso interno); a Edge Function SEMPRE passa as do usuário.
  if (permissoes) {
    if (!ferramentaPermitida(nome, permissoes)) {
      return { erro: 'sem permissão para essa consulta: o seu acesso ao dash não inclui esses dados' }
    }
    const r = executar(nome, args, dados, hoje)
    return permissoes.margem ? r : semMargem(r)
  }
  return executar(nome, args, dados, hoje)
}

function executar(nome: string, args: Record<string, unknown>, dados: Dados, hoje: string): unknown {
  const periodo = (k = 'periodo') => periodoValido(args[k] as Partial<Periodo>)
  const semPeriodo = { erro: 'informe o período como {inicio, fim} em AAAA-MM-DD' }
  switch (nome) {
    case 'numeros_do_periodo': {
      const p = periodo()
      return p ? numerosDoPeriodo(dados.orcamentos, p, hoje) : semPeriodo
    }
    case 'comparar_periodos': {
      const a = periodo('atual'); const b = periodo('anterior')
      return a && b ? compararPeriodos(dados.orcamentos, a, b, hoje) : { erro: 'informe atual e anterior como {inicio, fim}' }
    }
    case 'serie_mensal':
      return serieMensal(dados.orcamentos, Number(args.meses ?? 6), hoje)
    case 'vendas_por_modelo': {
      const p = periodo()
      return p ? porModelo(dados.orcamentos, p) : semPeriodo
    }
    case 'resultado_por_canal': {
      const p = periodo()
      return p ? porCanal(dados.orcamentos, dados.leads, p) : semPeriodo
    }
    case 'leads_quentes':
      return leadsQuentes(dados.leads, dados.orcamentos, Number(args.limite ?? 10), hoje)
    case 'leads_parados':
      return leadsParados(dados.leads, dados.orcamentos, Number(args.dias ?? 7), Number(args.limite ?? 10), hoje)
    case 'ver_lead':
      return verLead(dados.leads, dados.orcamentos, String(args.termo ?? ''), hoje)
    case 'orcamentos_em_aberto':
      return orcamentosEmAberto(dados.orcamentos, {
        responsavel: typeof args.responsavel === 'string' ? args.responsavel : null,
        modelo: typeof args.modelo === 'string' ? args.modelo : null,
        limite: args.limite == null ? undefined : Number(args.limite),
        ordem: args.ordem === 'antigos' ? 'antigos' : 'valor',
      }, hoje)
    case 'desfechos_do_periodo': {
      const p = periodo()
      return p ? desfechosDoPeriodo(dados.orcamentos, p) : semPeriodo
    }
    case 'calcular':
      return calcular(String(args.expressao ?? ''))
    default:
      return { erro: `ferramenta desconhecida: ${nome}` }
  }
}
