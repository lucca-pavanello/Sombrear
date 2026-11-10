/**
 * Semanário — o dinheiro das vendas que a loja efetivou.
 * Entra aqui tudo que for marcado como venda na Planilha (fechado = true),
 * não importa a origem: agente de IA, balcão ou lançamento manual.
 * Mostra o que o cliente pagou, quanto vai para a empresa parceira e o que
 * sobra para a loja — com totais do período para fechar o mês.
 */
import { Fragment, Suspense, useMemo, useState } from 'react'
import { lazyComRecarga } from '@/lib/lazyComRecarga'
import {
  Check, CheckCircle2, ChevronDown, ChevronRight, Download, HandCoins, Layers, Link2, Loader2,
  PencilLine, Plus, Trash2, Wallet, X,
} from 'lucide-react'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import {
  useOrcamentos, usePedidos, useUpdatePedido, useVincularItensAoPedido, useExcluirPedido,
} from '@/hooks/useOrcamentos'
import { filterByPeriod, ondeAVendaFoiParar } from '@/hooks/usePeriodFilter'
import { ratear } from '@/lib/rateio'
import { CustomSelect } from '@/components/ui/CustomSelect'
import DatePicker from '@/components/ui/DatePicker'
import { useCountUp } from '@/hooks/useCountUp'
import { supabase, type Orcamento, type Pedido } from '@/lib/supabase'
import { Button, EmptyState } from '@/components/ui/primitives'
import { TEMA_TABELA, alinharSecoes, colunasCentro, colunasDireita, faixaMarca, rodapeMarca } from '@/lib/pdfMarca'
import SeloOrigem, { ORIGENS, SEM_ORIGEM, acharOrigem } from '@/components/agente/SeloOrigem'
import JanelaDados from '@/components/orcamentos/JanelaDados'
import ConfirmarExclusaoVenda from '@/components/orcamentos/ConfirmarExclusaoVenda'
import { CartaoCustoItem, TabelaCustoItem, descricaoItem } from '@/components/orcamentos/CustoItemAItem'
import { useProfile } from '@/hooks/useProfile'
import { ADMIN_EMAIL } from '@/lib/constants'
import { campoCompacto, tabela, kpi } from '@/components/shared/estilos'

const TabSimulador = lazyComRecarga(() => import('@/components/tabs/TabSimulador'))

const PERIODOS = [
  { value: 'mes', label: 'Este mês' },
  { value: 'semana', label: 'Últimos 7 dias' },
  { value: 'hoje', label: 'Hoje' },
  { value: 'ano', label: 'Este ano' },
  { value: 'todos', label: 'Tudo' },
  { value: 'custom', label: 'Escolher datas' },
]

/** Custo real da loja: nos itens da parceira é o que vai pra ela; nos demais, o custo gravado. */
const custoReal = (o: Orcamento) =>
  Number(o.valor_parceiro) > 0 ? Number(o.valor_parceiro) : Number(o.custo_tecido ?? 0)
const receita = (o: Orcamento) => Number(o.valor_venda ?? 0) + Number(o.instalacao ?? 0)
/** o que o cliente REALMENTE pagou (desconto/acréscimo na mão) — cai no calculado quando não houve ajuste */
const pago = (o: Orcamento) => o.valor_cobrado != null ? Number(o.valor_cobrado) : receita(o)
/** o que REALMENTE foi pago à parceira */
const pagoParceira = (o: Orcamento) =>
  o.valor_parceiro_pago != null ? Number(o.valor_parceiro_pago) : Number(o.valor_parceiro ?? 0)
/** o que sobrou pra loja nesta venda: o que entrou menos o que saiu de verdade */
const sobraItem = (o: Orcamento) =>
  pago(o) - (o.valor_parceiro_pago != null ? Number(o.valor_parceiro_pago) : custoReal(o))
const ajustado = (calc: number, real: number) => Math.abs(calc - real) >= 0.01
// data do pedido manda quando foi informada; senão, a de criação
const dataDe = (o: Orcamento) => o.data_pedido ? `${o.data_pedido}T12:00:00` : o.created_at
/** acha o "6x" dentro do texto real ("6x de R$ 350" ou "cartão 6x") */
const parcelasDe = (s: string | null | undefined) => s?.match(/(\d+)\s*x/i)?.[1] ?? null

/**
 * Pgto em forma curta, pro PDF: "4x" · "à vista" · "4x / 6x" (calculado / pago).
 * Só números, como a loja pediu — e sem o "−" que a fonte do PDF não tem.
 */
const pgtoCurto = (o: Orcamento): string => {
  const real = parcelasDe(o.forma_pagamento_real)
  const base = o.forma_pagamento === 'a_vista' ? 'à vista'
    : o.forma_pagamento === 'cartao_4x' || o.forma_pagamento === 'outro' ? '4x'   // o preço nasce pra 4x
    : null
  const juros = o.forma_pagamento_real?.match(/\+([\d.,]+)%/)?.[1]
  if (real && base) return `${real}x` === base ? base : `${base} / ${real}x${juros ? ` (+${juros}%)` : ''}`
  if (real) return `${real}x`
  if (o.forma_pagamento === 'outro') {
    // texto livre sem parcelas (ex.: "PIX") ainda aparece; sem nada, traço
    return o.forma_pagamento_real ? o.forma_pagamento_real.slice(0, 18) : '—'
  }
  return base ?? '—'
}

/**
 * Pagamento como REALMENTE saiu, pro PDF do fechamento (áudio da loja,
 * 17/08: "não precisa ficar comparando entre parênteses, aqui é a realidade
 * da venda"). Parcelas: o número real se houver; senão o combinado.
 */
const pgtoReal = (o: Orcamento): { forma: string; parcelas: number | null } => {
  const real = parcelasDe(o.forma_pagamento_real)
  if (real) return { forma: `${real}x no cartão`, parcelas: Number(real) }
  if (o.forma_pagamento === 'a_vista') return { forma: 'à vista', parcelas: null }
  if (o.forma_pagamento === 'cartao_4x') return { forma: '4x no cartão', parcelas: 4 }
  if (o.forma_pagamento === 'outro') {
    return { forma: (o.forma_pagamento_real ?? 'outro').slice(0, 24), parcelas: null }
  }
  return { forma: '—', parcelas: null }
}

/** "R$ 792,50 (R$ 750,00)" — calculado com o realmente pago entre parênteses */
function ValorComReal({ calc, real, classe }: { calc: number; real: number; classe?: string }) {
  if (!ajustado(calc, real)) return <span className={classe}>{formatCurrency(calc)}</span>
  return (
    <span className={classe}>
      <span className="text-muted-foreground/60 line-through decoration-1">{formatCurrency(calc)}</span>{' '}
      <strong>({formatCurrency(real)})</strong>
    </span>
  )
}

function Kpi({ rotulo, valor, hint, destaque, contar }: {
  rotulo: string; valor: number; hint?: string; destaque?: 'primary' | 'emerald' | 'amber'; contar: boolean
}) {
  const anim = useCountUp(valor, 700, contar)
  // mesma composição do card da Lista de orçamentos
  const tom = destaque === 'primary' ? 'primario' : destaque ?? 'neutro'
  return (
    <div className={cn(kpi.cartao, kpi.acento[tom])}>
      <div className="flex flex-col items-center text-center gap-0.5">
        <p className={cn(kpi.rotulo, 'w-full')}>{rotulo}</p>
        <p className={cn(kpi.valor, kpi.valorCor[tom])}>{formatCurrency(anim)}</p>
        {hint && <p className={cn(kpi.sub, 'w-full')}>{hint}</p>}
      </div>
    </div>
  )
}


/** Colunas da tabela principal: 10 de dados + 1 de ações.
 *  O checkbox do modo "Agrupar" mora dentro da célula Data, então a contagem é fixa. */
const N_COLUNAS = 11

export default function TabFechamento() {
  const { data: todos = [], isLoading, refetch } = useOrcamentos()
  const { data: pedidos = [] } = usePedidos()
  const atualizarPedido = useUpdatePedido()
  const vincularItens = useVincularItensAoPedido()
  const excluirPedidoMut = useExcluirPedido()
  const pedidosMap = useMemo(() => new Map(pedidos.map(p => [p.id, p])), [pedidos])
  // apagar venda é só do admin — o RLS repete a regra, aqui só evita o botão morto
  const { data: profile } = useProfile()
  const isAdmin = profile?.email === ADMIN_EMAIL || profile?.is_admin === true
  const [calculando, setCalculando] = useState(false)
  const [periodo, setPeriodo] = useState('mes')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [baixando, setBaixando] = useState(false)
  const [editando, setEditando] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState<{ cobrado: string; parceira: string; formaReal: string; parcelasReal: string; origem: string; dataPedido: string; dataEntrega: string; numeroPedido: string }>(
    { cobrado: '', parceira: '', formaReal: '', parcelasReal: '', origem: '', dataPedido: '', dataEntrega: '', numeroPedido: '' })
  const [erroAjuste, setErroAjuste] = useState<string | null>(null)
  /* a venda salva que saiu do período visível — sem este aviso ela só "some" (ver
     ondeAVendaFoiParar); guarda para onde ela foi para o botão poder levar até lá */
  const [vendaSumiu, setVendaSumiu] = useState<
    { cliente: string; de: string; ate: string; mes: string } | null>(null)
  const [salvandoAjuste, setSalvandoAjuste] = useState(false)
  const [reconstruindo, setReconstruindo] = useState<string | null>(null)
  // exclusão passa por modal: mexe em faturamento, não pode sair num clique torto
  const [confirmandoExcluir, setConfirmandoExcluir] = useState<string | null>(null)
  const [excluindo, setExcluindo] = useState<string | null>(null)
  const [erroExcluir, setErroExcluir] = useState<string | null>(null)
  const [erroReconstruir, setErroReconstruir] = useState<Record<string, string>>({})

  // ── grupos de pedido (itens com o mesmo pedido_id viram um pedido só) ──
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [editandoPedido, setEditandoPedido] = useState<string | null>(null)
  const [rascunhoPedido, setRascunhoPedido] = useState({ numeroPedido: '', dataPedido: '', dataEntrega: '', origem: '', cobrado: '', parceira: '' })
  const [erroAjustePedido, setErroAjustePedido] = useState<string | null>(null)
  const [salvandoAjustePedido, setSalvandoAjustePedido] = useState(false)
  const [confirmandoExcluirPedido, setConfirmandoExcluirPedido] = useState<string | null>(null)
  const [excluindoPedidoId, setExcluindoPedidoId] = useState<string | null>(null)
  const [erroExcluirPedido, setErroExcluirPedido] = useState<string | null>(null)
  // "agrupar soltos" — seleção manual pra vincular itens sem pedido_id (legado ou vindos sem vínculo)
  const [selecionando, setSelecionando] = useState(false)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [agrupando, setAgrupando] = useState(false)
  const [erroAgrupar, setErroAgrupar] = useState<string | null>(null)
  const [numeroNovoPedido, setNumeroNovoPedido] = useState('')
  // PDF: a loja escolhe o que entra (ex.: o sindicato fica fora do PDF, mas continua no Semanário)
  const [montandoPdf, setMontandoPdf] = useState(false)
  const [foraDoPdf, setForaDoPdf] = useState<Set<string>>(new Set())

  /**
   * Recalcula a quebra por item de uma venda que entrou sem ela (WhatsApp).
   * O servidor só grava se o número reproduzir o que já estava salvo.
   */
  const reconstruir = async (id: string) => {
    setReconstruindo(id)
    setErroReconstruir(e => ({ ...e, [id]: '' }))
    try {
      const { data, error } = await supabase.functions.invoke('simular', {
        body: { acao: 'detalhar', id },
      })
      if (error) throw error
      if (data?.erro) { setErroReconstruir(e => ({ ...e, [id]: data.erro })); return }
      await refetch()
    } catch (err) {
      setErroReconstruir(e => ({
        ...e, [id]: err instanceof Error ? err.message : 'Não deu para reconstruir agora.',
      }))
    } finally {
      setReconstruindo(null)
    }
  }

  function abrirAjuste(o: Orcamento) {
    if (editando === o.id) { setEditando(null); return }
    setEditando(o.id)
    setErroAjuste(null)
    setRascunho({
      cobrado: String((o.valor_cobrado != null ? Number(o.valor_cobrado) : receita(o)).toFixed(2)),
      parceira: String((o.valor_parceiro_pago != null ? Number(o.valor_parceiro_pago) : Number(o.valor_parceiro ?? 0)).toFixed(2)),
      // texto composto ("6x de R$ … · +x% de juros — nota") volta separado:
      // o número pro campo de parcelas, a nota pro campo livre
      ...(() => {
        const bruto = o.forma_pagamento_real ?? ''
        const composto = bruto.match(/^(\d+)x de [^—]*?(?:— (.*))?$/)
        if (composto) return { parcelasReal: composto[1], formaReal: (composto[2] ?? '').trim() }
        return { parcelasReal: parcelasDe(bruto) ?? '', formaReal: bruto }
      })(),
      origem: acharOrigem(o.origem).id === SEM_ORIGEM.id ? '' : acharOrigem(o.origem).id,
      dataPedido: o.data_pedido ?? '',
      dataEntrega: o.data_entrega ?? '',
      numeroPedido: o.numero_pedido ?? '',
    })
  }

  /** Os três valores são ligados: sobra = cliente − parceira. Mexeu na sobra, o
      preço do cliente acompanha (a parceira é custo, não se negocia por aqui). */
  function mudarSobra(valor: string) {
    const sobraNova = parseFloat(valor.replace(',', '.'))
    const parceira = parseFloat(rascunho.parceira.replace(',', '.')) || 0
    if (!Number.isFinite(sobraNova)) return
    setRascunho(r => ({ ...r, cobrado: (parceira + sobraNova).toFixed(2) }))
  }

  /**
   * Apaga a venda — guardando a linha inteira na lixeira antes.
   * Vale pra registro feito errado; o dado continua recuperável.
   */
  async function excluirVenda(o: Orcamento) {
    setExcluindo(o.id)
    setErroExcluir(null)
    try {
      const { data: perfil } = await supabase.auth.getUser()
      const { error: erroLixeira } = await supabase.from('orcamentos_excluidos').insert({
        orcamento_id: o.id,
        excluido_por: perfil?.user?.email ?? null,
        motivo: 'excluída pelo Semanário',
        dados: o,
      })
      if (erroLixeira) throw erroLixeira

      const { error } = await supabase.from('orcamentos').delete().eq('id', o.id)
      if (error) throw error

      setConfirmandoExcluir(null)
      setEditando(null)
      await refetch()
    } catch (err) {
      setErroExcluir(err instanceof Error ? err.message : 'Não deu para excluir')
    } finally {
      setExcluindo(null)
    }
  }

  async function salvarAjuste(o: Orcamento) {
    if (!rascunho.dataPedido) {
      setErroAjuste('Preencha a data do pedido antes de salvar — sem ela, a venda pode cair no período errado do relatório.')
      return
    }
    setErroAjuste(null)
    setSalvandoAjuste(true)
    try {
      const numero = (s: string) => {
        const v = parseFloat(s.replace(',', '.'))
        return Number.isFinite(v) && v > 0 ? v : null
      }
      /* mesmo formato que o Simulador grava: "6x de R$ 330,67 · +6,0% de juros"
         — o juro sai da diferença entre o cobrado e o preço calculado */
      const nReal = Math.round(numero(rascunho.parcelasReal) ?? 0)
      const cobradoEf = numero(rascunho.cobrado) ?? pago(o)
      let formaRealFinal = rascunho.formaReal.trim()
      if (nReal >= 2 && cobradoEf > 0) {
        const base = receita(o)
        const juros = base > 0 && cobradoEf > base + 0.009
          ? ` · +${(((cobradoEf - base) / base) * 100).toFixed(1)}% de juros`
          : ''
        const auto = `${nReal}x de ${formatCurrency(cobradoEf / nReal)}${juros}`
        formaRealFinal = formaRealFinal ? `${auto} — ${formaRealFinal}` : auto
      }
      /* o .select() não é enfeite: sem ele, uma linha barrada pela RLS volta 204 com
         zero linhas e error nulo, e o código comemora um salvar que não aconteceu */
      const { data, error } = await supabase.from('orcamentos').update({
        valor_cobrado: numero(rascunho.cobrado),
        valor_parceiro_pago: numero(rascunho.parceira),
        forma_pagamento_real: formaRealFinal || null,
        origem: rascunho.origem || null,
        data_pedido: rascunho.dataPedido || null,
        data_entrega: rascunho.dataEntrega || null,
        numero_pedido: rascunho.numeroPedido.trim() || null,
      }).eq('id', o.id).select('id')
      if (error) throw error
      if (!data || data.length === 0) throw new Error('Nada foi gravado — a venda não foi encontrada ou você não tem permissão para alterá-la.')
      const destino = ondeAVendaFoiParar(
        dataDe({ ...o, data_pedido: rascunho.dataPedido || null }),
        periodo, de || undefined, ate || undefined,
      )
      setEditando(null)
      await refetch()
      setVendaSumiu(destino && { cliente: o.cliente ?? '', ...destino })
    } catch (err) {
      setErroAjuste(err instanceof Error ? err.message : 'Não deu para salvar')
    } finally {
      setSalvandoAjuste(false)
    }
  }

  const vendas = useMemo(() => {
    const fechados = todos.filter(o => o.fechado === true)
    return filterByPeriod(fechados, periodo, dataDe, de || undefined, ate || undefined)
      .sort((a, b) => new Date(dataDe(b)).getTime() - new Date(dataDe(a)).getTime())
  }, [todos, periodo, de, ate])

  const totais = useMemo(() => {
    const bruto = vendas.reduce((s, o) => s + pago(o), 0)
    const parceira = vendas.reduce((s, o) => s + pagoParceira(o), 0)
    const custo = vendas.reduce((s, o) => s + (o.valor_parceiro_pago != null ? Number(o.valor_parceiro_pago) : custoReal(o)), 0)
    const ajustes = vendas.filter(o => o.valor_cobrado != null || o.valor_parceiro_pago != null).length
    // o que teria sido sem desconto/acréscimo dado na mão — serve de régua na negociação
    const brutoCalc = vendas.reduce((s, o) => s + receita(o), 0)
    const custoCalc = vendas.reduce((s, o) => s + custoReal(o), 0)
    return {
      bruto, parceira, custo, sobra: bruto - custo, ajustes,
      sobraCalc: brutoCalc - custoCalc,
      pctReal: bruto > 0 ? ((bruto - custo) / bruto) * 100 : 0,
      pctCalc: brutoCalc > 0 ? ((brutoCalc - custoCalc) / brutoCalc) * 100 : 0,
    }
  }, [vendas])

  type Grupo = { chave: string; pedidoId: string | null; pedido: Pedido | null; itens: Orcamento[] }

  /** Itens com o mesmo pedido_id viram um grupo só; sem pedido_id, cada um é seu próprio grupo. */
  const grupos = useMemo(() => {
    const porPedido = new Map<string, Orcamento[]>()
    const resultado: Grupo[] = []
    for (const o of vendas) {
      if (o.pedido_id) {
        const arr = porPedido.get(o.pedido_id)
        if (arr) { arr.push(o); continue }
        porPedido.set(o.pedido_id, [o])
      } else {
        resultado.push({ chave: o.id, pedidoId: null, pedido: null, itens: [o] })
      }
    }
    for (const [pedidoId, itens] of porPedido) {
      resultado.push({ chave: pedidoId, pedidoId, pedido: pedidosMap.get(pedidoId) ?? null, itens })
    }
    const dataGrupo = (g: Grupo) => g.pedido?.data_pedido ? `${g.pedido.data_pedido}T12:00:00` : dataDe(g.itens[0])
    return resultado.sort((a, b) => new Date(dataGrupo(b)).getTime() - new Date(dataGrupo(a)).getTime())
  }, [vendas, pedidosMap])

  /**
   * Totais do pedido. Além do dinheiro, devolve a porcentagem de sobra — a real
   * (com os ajustes de mão) e a calculada (como o sistema tinha previsto), do
   * mesmo jeito que a linha de uma venda solta mostra "57% · seria 59%".
   */
  function totaisGrupo(itens: Orcamento[]) {
    const bruto = itens.reduce((s, o) => s + pago(o), 0)
    const parceira = itens.reduce((s, o) => s + pagoParceira(o), 0)
    const custo = itens.reduce((s, o) => s + (o.valor_parceiro_pago != null ? Number(o.valor_parceiro_pago) : custoReal(o)), 0)
    const brutoCalc = itens.reduce((s, o) => s + receita(o), 0)
    const custoCalc = itens.reduce((s, o) => s + custoReal(o), 0)
    return {
      bruto, parceira, sobra: bruto - custo,
      pctReal: bruto > 0 ? ((bruto - custo) / bruto) * 100 : 0,
      pctCalc: brutoCalc > 0 ? ((brutoCalc - custoCalc) / brutoCalc) * 100 : 0,
    }
  }

  function abrirAjustePedido(g: Grupo) {
    if (editandoPedido === g.pedidoId) { setEditandoPedido(null); return }
    setEditandoPedido(g.pedidoId)
    setErroAjustePedido(null)
    const t = totaisGrupo(g.itens)
    setRascunhoPedido({
      numeroPedido: g.pedido?.numero_pedido ?? g.itens[0].numero_pedido ?? '',
      dataPedido: g.pedido?.data_pedido ?? g.itens[0].data_pedido ?? '',
      // a entrega mora em cada item; o pedido é entregue junto, então vale a do primeiro
      dataEntrega: g.itens[0].data_entrega ?? '',
      origem: acharOrigem(g.pedido?.origem ?? g.itens[0].origem).id === SEM_ORIGEM.id ? '' : acharOrigem(g.pedido?.origem ?? g.itens[0].origem).id,
      cobrado: t.bruto.toFixed(2),
      parceira: t.parceira.toFixed(2),
    })
  }

  async function salvarAjustePedido(g: Grupo) {
    if (!g.pedidoId) return
    if (!rascunhoPedido.dataPedido) {
      setErroAjustePedido('Preencha a data do pedido antes de salvar — sem ela, a venda pode cair no período errado do relatório.')
      return
    }
    setErroAjustePedido(null)
    setSalvandoAjustePedido(true)
    try {
      const numero = (s: string) => {
        const v = parseFloat(s.replace(',', '.'))
        return Number.isFinite(v) && v > 0 ? v : null
      }
      await atualizarPedido.mutateAsync({
        id: g.pedidoId,
        numero_pedido: rascunhoPedido.numeroPedido.trim() || null,
        data_pedido: rascunhoPedido.dataPedido || null,
        origem: rascunhoPedido.origem || null,
      })
      // rateia o total (cliente pagou / à parceira) proporcional ao peso calculado de cada item
      const cobradoTotal = numero(rascunhoPedido.cobrado)
      const parceiraTotal = numero(rascunhoPedido.parceira)
      const cobrados = cobradoTotal != null ? ratear(cobradoTotal, g.itens.map(o => receita(o))) : null
      const parceiras = parceiraTotal != null ? ratear(parceiraTotal, g.itens.map(o => Number(o.valor_parceiro ?? 0))) : null
      for (let i = 0; i < g.itens.length; i++) {
        // a data de entrega vale para o pedido inteiro — vai em todos os itens
        const patch: Record<string, number | string | null> = { data_entrega: rascunhoPedido.dataEntrega || null }
        if (cobrados) patch.valor_cobrado = cobrados[i]
        if (parceiras) patch.valor_parceiro_pago = parceiras[i]
        const { data, error } = await supabase.from('orcamentos').update(patch)
          .eq('id', g.itens[i].id).select('id')
        if (error) throw error
        if (!data || data.length === 0) throw new Error(`O item ${i + 1} do pedido não foi gravado — sem permissão ou linha inexistente. Confira os valores antes de tentar de novo.`)
      }
      const destino = ondeAVendaFoiParar(
        `${rascunhoPedido.dataPedido}T12:00:00`, periodo, de || undefined, ate || undefined,
      )
      setEditandoPedido(null)
      await refetch()
      setVendaSumiu(destino && { cliente: g.itens[0].cliente ?? '', ...destino })
    } catch (err) {
      setErroAjustePedido(err instanceof Error ? err.message : 'Não deu para salvar')
    } finally {
      setSalvandoAjustePedido(false)
    }
  }

  async function excluirPedido(g: Grupo) {
    if (!g.pedidoId) return
    setExcluindoPedidoId(g.pedidoId)
    setErroExcluirPedido(null)
    try {
      await excluirPedidoMut.mutateAsync({ pedidoId: g.pedidoId, itens: g.itens })
      setConfirmandoExcluirPedido(null)
      setEditandoPedido(null)
      await refetch()
    } catch (err) {
      setErroExcluirPedido(err instanceof Error ? err.message : 'Não deu para excluir')
    } finally {
      setExcluindoPedidoId(null)
    }
  }

  function toggleSelecionado(id: string) {
    setSelecionados(prev => {
      const novo = new Set(prev)
      if (novo.has(id)) novo.delete(id); else novo.add(id)
      return novo
    })
  }

  async function agruparSelecionados() {
    if (selecionados.size < 2) return
    setAgrupando(true)
    try {
      await vincularItens.mutateAsync({
        ids: [...selecionados],
        pedido: { numero_pedido: numeroNovoPedido.trim() || null, data_pedido: null, origem: null },
      })
      setSelecionados(new Set())
      setSelecionando(false)
      setNumeroNovoPedido('')
      await refetch()
    } catch (err) {
      setErroAgrupar(err instanceof Error ? err.message : 'Não deu para agrupar')
    } finally {
      setAgrupando(false)
    }
  }

  // o que vai no PDF: as vendas do período menos as que a loja desmarcou
  const gruposPdf = useMemo(() => grupos.filter(g => !foraDoPdf.has(g.chave)), [grupos, foraDoPdf])
  const totaisPdf = useMemo(() => totaisGrupo(gruposPdf.flatMap(g => g.itens)), [gruposPdf])

  function alternarNoPdf(chave: string) {
    setForaDoPdf(prev => {
      const novo = new Set(prev)
      if (novo.has(chave)) novo.delete(chave); else novo.add(chave)
      return novo
    })
  }

  async function exportarPdf() {
    if (baixando || gruposPdf.length === 0) return
    setBaixando(true)
    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'), import('jspdf-autotable'),
      ])
      const doc = new jsPDF({ orientation: 'landscape' })
      const rotuloPeriodo = PERIODOS.find(p => p.value === periodo)?.label ?? ''
      const qtdPdf = gruposPdf.reduce((s, g) => s + g.itens.length, 0)
      const inicioY = faixaMarca(doc, 'Semanário de vendas',
        `${rotuloPeriodo}${de || ate ? ` (${de} a ${ate})` : ''} · ${qtdPdf} venda(s)`)

      /* A loja pediu (áudio 17/08): só a realidade da venda — quanto o cliente
         pagou, a parcela, a forma, quanto foi pra parceira e quanto sobrou.
         Sem "(orçado em …)", sem "4x / 6x". */
      autoTable(doc, {
        startY: inicioY,
        head: [['Data', 'Pedido', 'Cliente', 'Produto', 'Cliente pagou', 'Parcela', 'Pagamento', 'À parceira', 'Sobra']],
        body: gruposPdf.flatMap(g => {
          const linhas = g.itens.map((o, i) => {
            const pg = pgtoReal(o)
            const parcela = pg.parcelas && pg.parcelas > 1 ? formatCurrency(pago(o) / pg.parcelas) : '—'
            // pedido com vários itens: data/pedido/cliente só na primeira linha do grupo — evita repetir
            const primeira = i === 0
            return [
              primeira ? formatDate(g.pedido?.data_pedido ? `${g.pedido.data_pedido}T12:00:00` : dataDe(o)) : '',
              primeira ? (g.pedido?.numero_pedido ?? o.numero_pedido ?? '—') : '',
              primeira ? (o.cliente ?? '—') : '',
              [o.modelo, o.tecido].filter(Boolean).join(' · ')
                + (o.largura && o.altura ? `\n${String(o.largura).replace('.', ',')}×${String(o.altura).replace('.', ',')}m` : ''),
              formatCurrency(pago(o)),
              parcela,
              pg.forma,
              formatCurrency(pagoParceira(o)),
              formatCurrency(sobraItem(o)),
            ]
          })
          if (g.itens.length < 2) return linhas
          const t = totaisGrupo(g.itens)
          return [...linhas, [
            '', '', '', 'Total do pedido', formatCurrency(t.bruto), '', '', formatCurrency(t.parceira), formatCurrency(t.sobra),
          ]]
        }),
        foot: [['', '', '', 'TOTAIS',
          formatCurrency(totaisPdf.bruto), '', '', formatCurrency(totaisPdf.parceira), formatCurrency(totaisPdf.sobra)]],
        ...TEMA_TABELA,
        columnStyles: { ...colunasDireita([4, 5, 7, 8]), ...colunasCentro([1, 6]) },
        didParseCell: alinharSecoes({ 1: 'center', 4: 'right', 5: 'right', 6: 'center', 7: 'right', 8: 'right' }),
        margin: { left: 14, right: 14, bottom: 20 },
      })
      rodapeMarca(doc)
      doc.save(`fechamento-sombrear-${new Date().toISOString().slice(0, 10)}.pdf`)
    } finally {
      setBaixando(false)
    }
  }

  /** Uma venda — usada tanto pra item solto quanto pra sub-linha dentro de um pedido agrupado. */
  function itemFragment(o: Orcamento, opts?: { sub?: boolean }) {
    const bruto = receita(o)
    const parceira = Number(o.valor_parceiro ?? 0)
    const sobra = sobraItem(o)
    const emEdicao = editando === o.id
    const sobraRascunho =
      (parseFloat(rascunho.cobrado.replace(',', '.')) || 0) -
      (parseFloat(rascunho.parceira.replace(',', '.')) || 0)
    return (
      <Fragment key={o.id}>
      <tr className={cn(tabela.tr, opts?.sub && 'bg-muted/5', emEdicao && 'bg-primary/[0.04]')}>
        <td className="whitespace-nowrap px-3 py-3 text-center text-xs text-muted-foreground tabular-nums">
          <span className="flex items-center justify-center gap-2">
            {selecionando && (
              <input type="checkbox" className="h-3.5 w-3.5 accent-primary"
                checked={selecionados.has(o.id)} onChange={() => toggleSelecionado(o.id)} />
            )}
            <span>{formatDate(o.data_pedido ? `${o.data_pedido}T12:00:00` : o.created_at)}</span>
          </span>
        </td>
        <td className="whitespace-nowrap px-3 py-3 text-center text-xs font-semibold text-foreground/70 tabular-nums">
          {o.numero_pedido ?? <span className="font-normal text-muted-foreground/40">—</span>}
        </td>
        <td className="min-w-[8rem] px-3 py-3 text-center font-medium text-foreground">
          <span className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
            <span className={cn(opts?.sub && 'pl-3')}>{o.cliente ?? '—'}</span>
            {o.origem && <SeloOrigem origem={o.origem} />}
          </span>
        </td>
        <td className={cn('min-w-[9rem] px-3 py-3 text-center text-muted-foreground', opts?.sub && 'pl-7')}>
          <span className="block text-foreground">{o.modelo ?? '—'}</span>
          {o.tecido && <span className="text-xs">{o.tecido}</span>}
        </td>
        <td className="whitespace-nowrap px-3 py-3 text-center text-xs text-muted-foreground tabular-nums">
          {o.largura && o.altura ? `${o.largura}×${o.altura}m` : '—'}
          {Number(o.quantidade) > 1 && <span className="ml-1">× {o.quantidade}</span>}
        </td>
        <td className={cn('whitespace-nowrap px-3 py-3 text-center font-semibold tabular-nums text-foreground')}>
          <ValorComReal calc={bruto} real={pago(o)} />
        </td>
        <td className="whitespace-nowrap px-3 py-3 text-center">
          {(o.forma_pagamento_real || o.forma_pagamento) ? (
            <span className={cn('text-xs font-medium',
              pgtoCurto(o).includes('/') ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}
              title={o.forma_pagamento_real ?? undefined}>
              {pgtoCurto(o)}
            </span>
          ) : <span className="text-muted-foreground/40">—</span>}
        </td>
        <td className={cn('whitespace-nowrap px-3 py-3 text-center tabular-nums text-amber-600 dark:text-amber-400')}>
          {parceira > 0 || o.valor_parceiro_pago != null
            ? <ValorComReal calc={parceira} real={pagoParceira(o)} />
            : <span className="text-muted-foreground/40">—</span>}
        </td>
        <td className="whitespace-nowrap px-3 py-3 text-center font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
          {formatCurrency(sobra)}
        </td>
        <td className="whitespace-nowrap px-3 py-3 text-center tabular-nums">
          {(() => {
            const sobraCalc = bruto - custoReal(o)
            const pctReal = pago(o) > 0 ? (sobra / pago(o)) * 100 : 0
            const pctCalc = bruto > 0 ? (sobraCalc / bruto) * 100 : 0
            const mudou = Math.abs(pctReal - pctCalc) >= 0.5
            return (
              <span className={cn('block text-xs', mudou ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
                {pctReal.toFixed(0)}%{mudou && <span className="block text-[10px]">seria {pctCalc.toFixed(0)}%</span>}
              </span>
            )
          })()}
        </td>
        <td className="px-1 py-3 text-right">
          <span className="flex items-center justify-end gap-1">
            <button type="button" onClick={() => abrirAjuste(o)}
              title="Ver o custo item a item e ajustar valores"
              className={cn('rounded-md p-1.5 transition-colors hover:bg-muted hover:text-foreground',
                emEdicao ? 'bg-primary/10 text-primary' : 'text-muted-foreground/50')}>
              <PencilLine className="h-3.5 w-3.5" />
            </button>
            {isAdmin && (
              <button type="button" onClick={() => setConfirmandoExcluir(o.id)}
                title="Excluir esta venda"
                className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </span>
        </td>
      </tr>
      {emEdicao && (
        <tr>
          <td colSpan={N_COLUNAS} className="bg-muted/20 px-4 py-4">
            {/* Painel inline (mora dentro de um <td>): quem centraliza é o mx-auto
                com largura máxima. Sem isso o card de custo estica de ponta a ponta
                num monitor largo e o formulário de 320px fica espremido no canto.
                minmax(0,1fr) segura a tabela interna (min-w-[420px]) dentro da coluna. */}
            <div className="mx-auto grid w-full max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <CartaoCustoItem orcamento={o}
                reconstruindo={reconstruindo === o.id}
                erro={erroReconstruir[o.id]}
                onReconstruir={() => reconstruir(o.id)} />

              <div className="rounded-lg border border-border bg-card p-3">
                <p className="mb-2 text-center text-[11px] font-bold uppercase tracking-wider text-foreground/45">
                  Ajustar valores
                </p>
                <div className="space-y-2">
                  <label className="block">
                    <span className="block text-center text-[11px] text-muted-foreground">Cliente pagou</span>
                    <input className={cn(campoCompacto, 'mt-0.5 text-center text-sm tabular-nums')}
                      inputMode="decimal" value={rascunho.cobrado}
                      onChange={e => setRascunho(r => ({ ...r, cobrado: e.target.value }))} />
                  </label>
                  <label className="block">
                    <span className="block text-center text-[11px] text-muted-foreground">À parceira</span>
                    <input className={cn(campoCompacto, 'mt-0.5 text-center text-sm tabular-nums')}
                      inputMode="decimal" value={rascunho.parceira}
                      onChange={e => setRascunho(r => ({ ...r, parceira: e.target.value }))} />
                  </label>
                  <label className="block">
                    <span className="block text-center text-[11px] text-muted-foreground">De onde veio este cliente</span>
                    <select
                      className={cn(campoCompacto, 'mt-0.5 text-center text-sm')}
                      value={rascunho.origem}
                      onChange={e => setRascunho(r => ({ ...r, origem: e.target.value }))}
                    >
                      <option value="">Não informada</option>
                      {ORIGENS.map(op => <option key={op.id} value={op.id}>{op.rotulo}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="block text-center text-[11px] text-muted-foreground">Em quantas vezes saiu?</span>
                    <input className={cn(campoCompacto, 'mt-0.5 text-center text-sm tabular-nums')}
                      inputMode="numeric" placeholder="4"
                      value={rascunho.parcelasReal}
                      onChange={e => setRascunho(r => ({ ...r, parcelasReal: e.target.value }))} />
                    {(() => {
                      const n = Math.round(parseFloat(rascunho.parcelasReal) || 0)
                      const v = parseFloat(rascunho.cobrado.replace(',', '.')) || 0
                      if (n < 2 || v <= 0) return null
                      const base = receita(o)
                      const juros = base > 0 && v > base + 0.009
                        ? ` · +${(((v - base) / base) * 100).toFixed(1)}% de juros`
                        : ''
                      return (
                        <span className="mt-1 block text-center text-[11px] text-muted-foreground">
                          Fica registrado: <b className="text-foreground/80">{n}x de {formatCurrency(v / n)}{juros}</b>
                        </span>
                      )
                    })()}
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="block text-center text-[11px] text-muted-foreground">Data do pedido</span>
                      <DatePicker value={rascunho.dataPedido}
                        onChange={v => { setRascunho(r => ({ ...r, dataPedido: v })); if (v) setErroAjuste(null) }}
                        placeholder="dd/mm/aaaa" className="mt-0.5 w-full" triggerClassName="text-center" />
                    </label>
                    <label className="block">
                      <span className="block text-center text-[11px] text-muted-foreground">Data de entrega</span>
                      <DatePicker value={rascunho.dataEntrega}
                        onChange={v => setRascunho(r => ({ ...r, dataEntrega: v }))}
                        placeholder="dd/mm/aaaa" className="mt-0.5 w-full" triggerClassName="text-center" />
                    </label>
                    <label className="col-span-2 block">
                      <span className="block text-center text-[11px] text-muted-foreground">Nº do pedido</span>
                      <input className={cn(campoCompacto, 'mt-0.5 text-center text-sm')}
                        placeholder="ex.: 337" maxLength={20}
                        value={rascunho.numeroPedido}
                        onChange={e => setRascunho(r => ({ ...r, numeroPedido: e.target.value }))} />
                    </label>
                  </div>
                  <label className="block">
                    <span className="block text-center text-[11px] text-muted-foreground">Observação do pagamento (opcional)</span>
                    <input className={cn(campoCompacto, 'mt-0.5 text-center text-sm')}
                      placeholder="ex.: no link, PIX + cartão"
                      maxLength={120}
                      value={rascunho.formaReal}
                      onChange={e => setRascunho(r => ({ ...r, formaReal: e.target.value }))} />
                  </label>
                  <label className="block">
                    <span className="block text-center text-[11px] text-muted-foreground">Sobra da loja (ajusta o valor do cliente)</span>
                    <input className="mt-0.5 w-full rounded-md border border-emerald-500/40 bg-background px-2 py-1.5 text-center text-sm font-semibold tabular-nums text-emerald-700 outline-none focus:ring-2 focus:ring-emerald-500/15 dark:text-emerald-400"
                      inputMode="decimal"
                      value={sobraRascunho.toFixed(2)}
                      onChange={e => mudarSobra(e.target.value)} />
                  </label>
                </div>
                {erroAjuste && (
                  <p className="mt-2 text-center text-[11px] font-medium text-destructive">{erroAjuste}</p>
                )}
                {/* min-w em vez de flex-1: era o flex-1 que fazia o Salvar ocupar a
                    linha inteira quando o painel vira coluna única (abaixo de lg) */}
                <div className="mt-3 flex items-center justify-center gap-x-3">
                  <Button variant="brand" size="sm" className="min-w-[8rem]"
                    loading={salvandoAjuste} onClick={() => salvarAjuste(o)}>
                    {!salvandoAjuste && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                    Salvar
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { setEditando(null); setErroAjuste(null) }}
                    aria-label="Cancelar ajuste">
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
      </Fragment>
    )
  }

  return (
    <>
      {/* Cabeçalho */}
      <div className="mb-6 flex flex-col items-center text-center gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-foreground/40">Dashboard</span>
          <ChevronRight className="h-3 w-3 text-foreground/30" />
          <span className="text-xs font-medium text-primary">Semanário</span>
        </div>
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Semanário</h2>
          <p className="mt-0.5 text-sm text-foreground/50">
            As vendas efetivadas, quanto vai para a parceira e o que sobra para a loja.
          </p>
        </div>
      </div>

      {/* Filtros + ações */}
      <div className="mb-4 flex flex-wrap items-center justify-center gap-2 rounded-xl border bg-card px-3 py-2.5 shadow-sm">
        <CustomSelect className="w-44 py-2" value={periodo}
          onChange={v => { setPeriodo(v); setVendaSumiu(null); if (v !== 'custom') { setDe(''); setAte('') } }} options={PERIODOS} />
        <DatePicker value={de} onChange={v => { setDe(v); if (v) setPeriodo('custom') }}
          placeholder="De" triggerClassName="py-2" className="w-36" />
        <DatePicker value={ate} onChange={v => { setAte(v); if (v) setPeriodo('custom') }}
          placeholder="Até" min={de || undefined} triggerClassName="py-2" className="w-36" />
        <Button variant="brand" onClick={() => setCalculando(v => !v)}>
          <Plus className={cn('h-4 w-4 transition-transform duration-200', calculando && 'rotate-45')}
            aria-hidden="true" />
          {calculando ? 'Fechar calculadora' : 'Nova venda'}
        </Button>
        <Button variant={montandoPdf ? 'primary' : 'outline'} onClick={() => setMontandoPdf(v => !v)}
          disabled={vendas.length === 0}>
          <Download className="h-4 w-4" aria-hidden="true" />
          {montandoPdf ? 'Fechar PDF' : 'PDF'}
        </Button>
        <Button variant={selecionando ? 'primary' : 'outline'}
          onClick={() => { setSelecionando(v => !v); setSelecionados(new Set()); setErroAgrupar(null) }}>
          <Link2 className="h-4 w-4" aria-hidden="true" />
          {selecionando ? 'Cancelar agrupar' : 'Agrupar itens'}
        </Button>
      </div>

      {/* Salvou, mas a venda saiu desta lista. Sem isto ela apenas some da tela e quem
          está fechando lança tudo de novo — o pedido 175 virou seis linhas assim. */}
      {vendaSumiu && (
        <div className="mb-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2.5 shadow-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <p className="text-xs text-foreground/80">
            <b className="font-semibold">Salvo.</b> A venda
            {vendaSumiu.cliente && <> de <b className="font-semibold">{vendaSumiu.cliente}</b></>}
            {' '}saiu desta lista porque a data do pedido é de{' '}
            <b className="font-semibold">{vendaSumiu.mes}</b>. Ela não se perdeu — está lá.
          </p>
          <Button variant="outline" size="sm"
            onClick={() => {
              setPeriodo('custom'); setDe(vendaSumiu.de); setAte(vendaSumiu.ate)
              setVendaSumiu(null)
            }}>
            Ver {vendaSumiu.mes}
          </Button>
          <button type="button" onClick={() => setVendaSumiu(null)}
            title="Fechar aviso"
            className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Monta o PDF: desmarcar uma venda tira ela só do PDF — o Semanário continua igual */}
      {montandoPdf && (
        <div className="mb-4 flex flex-col items-center gap-2.5 rounded-xl border border-primary/25 bg-primary/[0.03] px-3 py-3 shadow-sm">
          <p className="text-xs text-muted-foreground">
            Desmarque o que <b className="text-foreground/80">não deve ir no PDF</b>. Aqui no Semanário nada muda.
          </p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {grupos.map(g => {
              const dentro = !foraDoPdf.has(g.chave)
              return (
                <label key={g.chave}
                  className={cn(
                    'flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                    dentro ? 'border-primary/30 bg-background text-foreground' : 'border-border bg-muted/40 text-muted-foreground line-through',
                  )}>
                  <input type="checkbox" className="h-3.5 w-3.5 accent-primary"
                    checked={dentro} onChange={() => alternarNoPdf(g.chave)} />
                  <span className="font-medium">{g.itens[0].cliente ?? '—'}</span>
                  <span className="tabular-nums text-muted-foreground">{formatCurrency(totaisGrupo(g.itens).bruto)}</span>
                </label>
              )
            })}
          </div>
          <Button variant="brand" size="sm" onClick={exportarPdf} loading={baixando}
            disabled={gruposPdf.length === 0}>
            {!baixando && <Download className="h-3.5 w-3.5" aria-hidden="true" />}
            Baixar PDF · {gruposPdf.length} de {grupos.length} · {formatCurrency(totaisPdf.bruto)}
          </Button>
        </div>
      )}

      {selecionando && (
        <div className="mb-4 flex flex-wrap items-center justify-center gap-2 rounded-xl border border-primary/25 bg-primary/[0.03] px-3 py-2.5 shadow-sm">
          <p className="text-xs text-muted-foreground">
            Marque as linhas do mesmo pedido (itens digitados separados por engano) —{' '}
            <b className="text-foreground/80">{selecionados.size} selecionada{selecionados.size !== 1 ? 's' : ''}</b>
          </p>
          <input className="w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            placeholder="Nº do pedido" maxLength={20}
            value={numeroNovoPedido} onChange={e => setNumeroNovoPedido(e.target.value)} />
          <Button variant="brand" size="sm" loading={agrupando}
            disabled={selecionados.size < 2} onClick={agruparSelecionados}>
            <Layers className="h-3.5 w-3.5" aria-hidden="true" />
            Agrupar em um pedido
          </Button>
          {erroAgrupar && (
            <p className="w-full text-center text-[11px] font-medium text-destructive">{erroAgrupar}</p>
          )}
        </div>
      )}

      {/* Calculadora — a venda cai direto neste fechamento */}
      {calculando && (
        <div className="mb-4 rounded-xl border border-primary/25 bg-primary/[0.03] p-4 shadow-sm sm:p-5">
          <Suspense fallback={<p className="py-8 text-center text-sm text-muted-foreground">Carregando calculadora…</p>}>
            <TabSimulador modoVenda aoSalvar={() => refetch()} />
          </Suspense>
        </div>
      )}

      {/* Totais */}
      <div className="kpi-cascade mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi rotulo="Vendas no período" valor={totais.bruto} contar={!isLoading}
          hint={`${vendas.length} venda${vendas.length !== 1 ? 's' : ''} fechada${vendas.length !== 1 ? 's' : ''}` +
            (totais.ajustes ? ` · ${totais.ajustes} com ajuste manual` : '')} destaque="primary" />
        <Kpi rotulo="A pagar à parceira" valor={totais.parceira} contar={!isLoading}
          hint="produção das persianas de tecido" destaque="amber" />
        <Kpi rotulo="Custo total" valor={totais.custo} contar={!isLoading}
          hint="inclui itens fora da parceira" />
        <Kpi rotulo="Sobra para a loja" valor={totais.sobra} contar={!isLoading}
          hint={totais.bruto > 0
            ? `${totais.pctReal.toFixed(0)}% do faturamento` +
              (Math.abs(totais.pctReal - totais.pctCalc) >= 0.5 ? ` · sem os ajustes seria ${totais.pctCalc.toFixed(0)}%` : '')
            : undefined}
          destaque="emerald" />
      </div>

      {/* Tabela */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : vendas.length === 0 ? (
          <EmptyState icon={CheckCircle2} titulo="Nenhuma venda fechada neste período"
            dica="Marque o orçamento como venda na Planilha (coluna Fechado) que ele aparece aqui — venha da IA, do balcão ou de lançamento manual."
            className="px-6 py-14" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm [&_td+td]:border-l [&_th+th]:border-l [&_td]:border-border/40 [&_th]:border-border/40">
              <thead>
                <tr className={tabela.theadRow}>
                  <th className={cn(tabela.th, 'px-3', 'text-center')}>Data</th>
                  <th className={cn(tabela.th, 'px-3', 'text-center')}>Pedido</th>
                  <th className={cn(tabela.th, 'px-3', 'text-center')}>Cliente</th>
                  <th className={cn(tabela.th, 'px-3', 'text-center')}>Produto</th>
                  <th className={cn(tabela.th, 'px-3', 'text-center')}>Medidas</th>
                  <th className={cn(tabela.th, 'px-3', 'text-center')}>Cliente pagou</th>
                  <th className={cn(tabela.th, 'px-3', 'text-center')}>Pagamento</th>
                  <th className={cn(tabela.th, 'px-3', 'text-center')}>À parceira</th>
                  <th className={cn(tabela.th, 'px-3', 'text-center')}>Sobra</th>
                  <th className={cn(tabela.th, 'px-3', 'text-center')}>%</th>
                  <th className="px-1 py-3 text-right"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {grupos.map(g => {
                  if (g.itens.length === 1) return itemFragment(g.itens[0])
                  const t = totaisGrupo(g.itens)
                  const abertoG = abertos.has(g.chave)
                  const emEdicaoPedido = editandoPedido === g.pedidoId
                  const primeiro = g.itens[0]
                  const origemGrupo = g.pedido?.origem ?? primeiro.origem
                  return (
                    <Fragment key={g.chave}>
                      <tr className={cn(tabela.tr, 'bg-muted/10', emEdicaoPedido && 'bg-primary/[0.04]')}>
                        <td className="whitespace-nowrap px-3 py-3 text-center text-xs text-muted-foreground tabular-nums">
                          {formatDate(g.pedido?.data_pedido ? `${g.pedido.data_pedido}T12:00:00` : dataDe(primeiro))}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-center text-xs font-semibold text-foreground/70 tabular-nums">
                          {g.pedido?.numero_pedido ?? primeiro.numero_pedido ?? '—'}
                        </td>
                        <td className="min-w-[8rem] px-3 py-3 text-center font-medium text-foreground">
                          <span className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
                            <span>{primeiro.cliente ?? '—'}</span>
                            {origemGrupo && <SeloOrigem origem={origemGrupo} />}
                          </span>
                        </td>
                        <td className="min-w-[9rem] px-3 py-3 text-center text-muted-foreground">
                          <button type="button"
                            onClick={() => setAbertos(prev => {
                              const novo = new Set(prev)
                              if (novo.has(g.chave)) novo.delete(g.chave); else novo.add(g.chave)
                              return novo
                            })}
                            className="mx-auto flex items-center gap-1 font-semibold text-foreground transition-colors hover:text-primary">
                            <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', abertoG && 'rotate-180')} aria-hidden="true" />
                            {g.itens.length} itens
                          </button>
                          <span className="block text-xs">
                            {[...new Set(g.itens.map(i => i.modelo).filter(Boolean))].join(', ')}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center text-xs text-muted-foreground">—</td>
                        <td className={cn('whitespace-nowrap px-3 py-3 text-center font-semibold tabular-nums text-foreground')}>
                          {formatCurrency(t.bruto)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-center">
                          {(() => {
                            const formas = [...new Set(g.itens
                              .filter(i => i.forma_pagamento_real || i.forma_pagamento)
                              .map(i => pgtoCurto(i)))]
                            if (formas.length === 0) return <span className="text-muted-foreground/40">—</span>
                            if (formas.length === 1) {
                              return <span className={cn('text-xs font-medium',
                                formas[0].includes('/') ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>{formas[0]}</span>
                            }
                            return <span className="text-xs font-medium text-amber-600 dark:text-amber-400" title={formas.join(' · ')}>Misto</span>
                          })()}
                        </td>
                        <td className={cn('whitespace-nowrap px-3 py-3 text-center tabular-nums text-amber-600 dark:text-amber-400')}>
                          {formatCurrency(t.parceira)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-center font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(t.sobra)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-center tabular-nums">
                          {(() => {
                            const mudouG = Math.abs(t.pctReal - t.pctCalc) >= 0.5
                            return (
                              <span className={cn('block text-xs', mudouG ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
                                {t.pctReal.toFixed(0)}%{mudouG && <span className="block text-[10px]">seria {t.pctCalc.toFixed(0)}%</span>}
                              </span>
                            )
                          })()}
                        </td>
                        <td className="px-1 py-3 text-right">
                          <span className="flex items-center justify-end gap-1">
                            <button type="button" onClick={() => abrirAjustePedido(g)}
                              title="Ver o custo item a item e ajustar valores"
                              className={cn('rounded-md p-1.5 transition-colors hover:bg-muted hover:text-foreground',
                                emEdicaoPedido ? 'bg-primary/10 text-primary' : 'text-muted-foreground/50')}>
                              <PencilLine className="h-3.5 w-3.5" />
                            </button>
                            {isAdmin && (
                              <button type="button" onClick={() => setConfirmandoExcluirPedido(g.pedidoId)}
                                title="Excluir pedido inteiro"
                                className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </span>
                        </td>
                      </tr>
                      {emEdicaoPedido && (
                        <tr>
                          <td colSpan={N_COLUNAS} className="bg-muted/20 px-4 py-4">
                            <div className="mx-auto grid w-full max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                            {/* Esquerda: como a conta foi feita, item a item — igual à venda solta,
                                só que empilhado, porque o pedido tem mais de um item. */}
                            <div className="rounded-lg border border-border bg-card p-3">
                              <p className="mb-2 text-center text-[11px] font-bold uppercase tracking-wider text-foreground/45">
                                Custo item a item
                              </p>
                              <div className="max-h-[26rem] space-y-3 overflow-y-auto">
                                {g.itens.map((o, i) => (
                                  <div key={o.id} className={cn(i > 0 && 'border-t border-border/50 pt-3')}>
                                    <p className="mb-1.5 text-[11px] font-semibold text-foreground/70">{descricaoItem(o)}</p>
                                    <TabelaCustoItem orcamento={o} contexto="item"
                                      reconstruindo={reconstruindo === o.id}
                                      erro={erroReconstruir[o.id]}
                                      onReconstruir={() => reconstruir(o.id)} />
                                    <p className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">
                                      Cliente pagou {formatCurrency(pago(o))} · à parceira {formatCurrency(pagoParceira(o))} ·
                                      sobra <b className="text-emerald-600 dark:text-emerald-400">{formatCurrency(sobraItem(o))}</b>
                                      {' '}({(pago(o) > 0 ? (sobraItem(o) / pago(o)) * 100 : 0).toFixed(0)}%)
                                    </p>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-3 flex items-baseline justify-between border-t border-border pt-2">
                                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                                  Total do pedido
                                </span>
                                <span className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                                  {formatCurrency(t.sobra)}{' '}
                                  {(() => {
                                    const mudouG = Math.abs(t.pctReal - t.pctCalc) >= 0.5
                                    return (
                                      <span className={cn('text-[11px] font-semibold',
                                        mudouG ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
                                        {t.pctReal.toFixed(0)}%{mudouG && <> · seria {t.pctCalc.toFixed(0)}%</>}
                                      </span>
                                    )
                                  })()}
                                </span>
                              </div>
                            </div>

                            {/* Direita: os campos do pedido, na mesma posição da venda solta */}
                            <div className="rounded-lg border border-border bg-card p-3">
                              <p className="mb-1 text-center text-[11px] font-bold uppercase tracking-wider text-foreground/45">
                                Ajustar pedido
                              </p>
                              <p className="mb-2 text-center text-[11px] text-muted-foreground">
                                {g.itens.length} itens — o total é rateado proporcionalmente entre eles.
                              </p>
                              <div className="space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                  <label className="block">
                                    <span className="block text-center text-[11px] text-muted-foreground">Cliente pagou (total)</span>
                                    <input className={cn(campoCompacto, 'mt-0.5 text-center text-sm tabular-nums')}
                                      inputMode="decimal" value={rascunhoPedido.cobrado}
                                      onChange={e => setRascunhoPedido(r => ({ ...r, cobrado: e.target.value }))} />
                                  </label>
                                  <label className="block">
                                    <span className="block text-center text-[11px] text-muted-foreground">À parceira (total)</span>
                                    <input className={cn(campoCompacto, 'mt-0.5 text-center text-sm tabular-nums')}
                                      inputMode="decimal" value={rascunhoPedido.parceira}
                                      onChange={e => setRascunhoPedido(r => ({ ...r, parceira: e.target.value }))} />
                                  </label>
                                </div>
                                <label className="block">
                                  <span className="block text-center text-[11px] text-muted-foreground">De onde veio este cliente</span>
                                  <select className={cn(campoCompacto, 'mt-0.5 text-center text-sm')}
                                    value={rascunhoPedido.origem}
                                    onChange={e => setRascunhoPedido(r => ({ ...r, origem: e.target.value }))}>
                                    <option value="">Não informada</option>
                                    {ORIGENS.map(op => <option key={op.id} value={op.id}>{op.rotulo}</option>)}
                                  </select>
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                  <label className="block">
                                    <span className="block text-center text-[11px] text-muted-foreground">Data do pedido</span>
                                    <DatePicker value={rascunhoPedido.dataPedido}
                                      onChange={v => { setRascunhoPedido(r => ({ ...r, dataPedido: v })); if (v) setErroAjustePedido(null) }}
                                      placeholder="dd/mm/aaaa" className="mt-0.5 w-full" triggerClassName="text-center" />
                                  </label>
                                  <label className="block">
                                    <span className="block text-center text-[11px] text-muted-foreground">Data de entrega</span>
                                    <DatePicker value={rascunhoPedido.dataEntrega}
                                      onChange={v => setRascunhoPedido(r => ({ ...r, dataEntrega: v }))}
                                      placeholder="dd/mm/aaaa" className="mt-0.5 w-full" triggerClassName="text-center" />
                                  </label>
                                  <label className="col-span-2 block">
                                    <span className="block text-center text-[11px] text-muted-foreground">Nº do pedido</span>
                                    <input className={cn(campoCompacto, 'mt-0.5 text-center text-sm')}
                                      placeholder="ex.: 337" maxLength={20}
                                      value={rascunhoPedido.numeroPedido}
                                      onChange={e => setRascunhoPedido(r => ({ ...r, numeroPedido: e.target.value }))} />
                                  </label>
                                </div>
                              </div>
                              {erroAjustePedido && (
                                <p className="mt-2 text-center text-[11px] font-medium text-destructive">{erroAjustePedido}</p>
                              )}
                              <div className="mt-3 flex items-center justify-center gap-x-3">
                                <Button variant="brand" size="sm" className="min-w-[8rem]"
                                  loading={salvandoAjustePedido} onClick={() => salvarAjustePedido(g)}>
                                  {!salvandoAjustePedido && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                                  Salvar
                                </Button>
                                <Button variant="outline" size="sm"
                                  onClick={() => { setEditandoPedido(null); setErroAjustePedido(null) }}
                                  aria-label="Cancelar ajuste do pedido">
                                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                                </Button>
                              </div>
                            </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      {abertoG && g.itens.map(o => itemFragment(o, { sub: true }))}
                    </Fragment>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/40 font-bold">
                  <td colSpan={5} className="px-3 py-3 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    Total do período
                  </td>
                  <td className={cn('whitespace-nowrap px-3 py-3 text-center tabular-nums text-foreground')}>{formatCurrency(totais.bruto)}</td>
                  <td className="px-3 py-3" />
                  <td className={cn('whitespace-nowrap px-3 py-3 text-center tabular-nums text-amber-600 dark:text-amber-400')}>{formatCurrency(totais.parceira)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-center tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(totais.sobra)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-center tabular-nums">
                    <span className={cn('block text-xs font-semibold',
                      Math.abs(totais.pctReal - totais.pctCalc) >= 0.5 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
                      {totais.pctReal.toFixed(0)}%
                      {Math.abs(totais.pctReal - totais.pctCalc) >= 0.5 && <span className="block text-[10px] font-medium">seria {totais.pctCalc.toFixed(0)}%</span>}
                    </span>
                  </td>
                  <td className="px-1 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Wallet className="h-3 w-3" /> "Cliente pagou" inclui a instalação quando houver.</span>
        <span className="inline-flex items-center gap-1"><PencilLine className="h-3 w-3" /> Deu desconto ou acréscimo na mão? Clique no lápis da linha: o valor calculado fica riscado e o realmente pago aparece entre parênteses — os totais usam o real.</span>
        <span className="inline-flex items-center gap-1"><HandCoins className="h-3 w-3" /> "À parceira" é o custo de produção das persianas de tecido (PV, PH Alumínio e PH 50mm não passam por ela).</span>
      </div>

      <JanelaDados className="mt-4" />

      {(() => {
        // só admin chega aqui, mas a checagem repete: o estado sobrevive a um
        // rebaixamento de permissão no meio da sessão
        const alvo = isAdmin ? vendas.find(v => v.id === confirmandoExcluir) : undefined
        if (!alvo) return null
        return (
          <ConfirmarExclusaoVenda
            cliente={alvo.cliente}
            valor={pago(alvo)}
            data={alvo.created_at}
            excluindo={excluindo === alvo.id}
            erro={erroExcluir}
            onConfirmar={() => excluirVenda(alvo)}
            onCancelar={() => { setConfirmandoExcluir(null); setErroExcluir(null) }}
          />
        )
      })()}

      {(() => {
        // O `confirmandoExcluirPedido` precisa existir ANTES de procurar o grupo:
        // venda avulsa também tem `pedidoId: null`, então `null === null` casava
        // com a primeira venda solta da lista e o modal abria sozinho — e não
        // fechava, porque cancelar devolve o estado pra null, que era a condição
        // que o abria.
        const g = isAdmin && confirmandoExcluirPedido
          ? grupos.find(x => x.pedidoId === confirmandoExcluirPedido)
          : undefined
        if (!g) return null
        const t = totaisGrupo(g.itens)
        return (
          <ConfirmarExclusaoVenda
            cliente={`${g.itens[0].cliente ?? 'Sem nome'} (${g.itens.length} itens)`}
            valor={t.bruto}
            data={dataDe(g.itens[0])}
            excluindo={excluindoPedidoId === g.pedidoId}
            erro={erroExcluirPedido}
            onConfirmar={() => excluirPedido(g)}
            onCancelar={() => { setConfirmandoExcluirPedido(null); setErroExcluirPedido(null) }}
          />
        )
      })()}
    </>
  )
}
