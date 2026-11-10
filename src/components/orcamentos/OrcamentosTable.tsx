import { useState, useEffect, useRef, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { comTransicao } from '@/lib/viewTransition'
import { Download, ChevronUp, ChevronDown, ChevronsUpDown, StickyNote, Square, CheckSquare, FileDown, ChevronLeft, ChevronRight, FileX, Copy, Check, Columns3, Maximize2, Minimize2 } from 'lucide-react'
import AvatarInitials from '@/components/shared/AvatarInitials'
import EmptyState from '@/components/shared/EmptyState'
import type { Orcamento } from '@/lib/supabase'
import { formatCurrency, cn, calcularMargem, formatDate } from '@/lib/utils'
import { useProfile } from '@/hooks/useProfile'
import { ADMIN_EMAIL } from '@/lib/constants'

import EditOrcamentoForm from './EditOrcamentoForm'
import { TEMA_TABELA, alinharSecoes, faixaMarca, rodapeMarca } from '@/lib/pdfMarca'
import { useUpdateOrcamento } from '@/hooks/useOrcamentos'
import { PAGE_SIZE } from '@/lib/constants'
import { useFlip } from '@/hooks/useFlip'
import { tabela } from '@/components/shared/estilos'
import type { ToastType } from '@/hooks/useToast'
import { haptic } from '@/lib/haptic'

type ToastFn = (type: ToastType, message: string, opts?: { duration?: number; undoAction?: () => void }) => void

const BIG_DEAL_THRESHOLD = 5000

function fireConfetti(originX: number, originY: number, bigDeal = false) {
  const canvas = document.createElement('canvas')
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9998;'
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')!
  const colors = ['#E8701A', '#F59E0B', '#FDBA74', '#34D399', '#60A5FA', '#A78BFA', '#F472B6']
  const count = bigDeal ? 110 : 55
  const speed = bigDeal ? 15.6 : 13
  const particles = Array.from({ length: count }, () => ({
    x: originX, y: originY,
    vx: (Math.random() - 0.5) * speed,
    vy: -Math.random() * speed - 3,
    size: Math.random() * (bigDeal ? 8 : 6) + 3,
    color: colors[Math.floor(Math.random() * colors.length)],
    rotation: Math.random() * Math.PI * 2,
    rotV: (Math.random() - 0.5) * 0.28,
    life: 1,
  }))
  let frame = 0
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    let alive = false
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy
      p.vy += 0.48; p.vx *= 0.99
      p.rotation += p.rotV; p.life -= 0.017
      if (p.life <= 0) continue
      alive = true
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rotation)
      ctx.globalAlpha = p.life
      ctx.fillStyle = p.color
      ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.55)
      ctx.restore()
    }
    frame++
    if (alive && frame < 130) requestAnimationFrame(animate)
    else if (document.body.contains(canvas)) document.body.removeChild(canvas)
  }
  requestAnimationFrame(animate)
}

function FechadoCheckbox({ orcamento, toast }: { orcamento: Orcamento; toast: ToastFn }) {
  const { mutate: update, isPending } = useUpdateOrcamento()
  const { data: profile } = useProfile()

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    const wasFechado = !!orcamento.fechado
    const novoEstado = !wasFechado
    if (novoEstado) {
      const rect = e.currentTarget.getBoundingClientRect()
      const bigDeal = (orcamento.valor_venda ?? 0) + (orcamento.instalacao ?? 0) >= BIG_DEAL_THRESHOLD
      fireConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2, bigDeal)
      haptic('success')
    }
    // Mantém a tela Acompanhar coerente: fechar aqui também registra o desfecho "fechou";
    // desmarcar limpa o desfecho só se era esse (um "perdido"/"sumiu" não é desta caixa).
    const anterior = {
      fechado: orcamento.fechado ?? false,
      desfecho: orcamento.desfecho ?? null,
      desfecho_em: orcamento.desfecho_em ?? null,
      desfecho_por: orcamento.desfecho_por ?? null,
    }
    const patch = novoEstado
      ? { fechado: true, desfecho: 'fechou', desfecho_em: new Date().toISOString(), desfecho_por: profile?.email ?? null }
      : wasFechado && orcamento.desfecho === 'fechou'
        ? { fechado: false, desfecho: null, desfecho_em: null, desfecho_por: null }
        : { fechado: false }
    update({ id: orcamento.id, ...patch }, {
      onSuccess: () => {
        toast('success', `${orcamento.cliente ?? orcamento.responsavel} — ${novoEstado ? 'marcado como fechado' : 'reaberto'}`, {
          duration: 5000,
          undoAction: () => update({ id: orcamento.id, ...anterior }),
        })
      },
    })
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <button
        onClick={handleClick}
        disabled={isPending}
        className={cn(
          'flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold transition-all duration-200',
          orcamento.fechado
            ? 'bg-green-500/10 text-green-600 dark:text-green-400'
            : 'bg-muted text-muted-foreground hover:bg-muted/60',
          isPending && 'opacity-50'
        )}
      >
        {orcamento.fechado ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
        {orcamento.fechado ? 'Fechado' : 'Em aberto'}
      </button>
    </div>
  )
}


function Highlight({ text, query }: { text: string | null | undefined; query: string }) {
  const safe = text ?? '—'
  if (!query || !text) return <>{safe}</>
  const idx = safe.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <>{safe}</>
  return (
    <>
      {safe.slice(0, idx)}
      <mark className="rounded bg-primary/20 px-0.5 text-primary not-italic">{safe.slice(idx, idx + query.length)}</mark>
      {safe.slice(idx + query.length)}
    </>
  )
}

function exportCSV(data: Orcamento[]) {
  const headers = ['#', 'Data', 'Cliente', 'Telefone', 'Responsável', 'Ambiente', 'Modelo', 'Tecido', 'Qtd', 'Valor', 'Instalação', 'Custo (R$)', 'Margem (%)', 'Fechado']
  const rows = data.map((o, i) => {
    const m = calcMargem(o)
    return [
      i + 1,
      formatDate(o.created_at),
      o.cliente ?? '',
      o.telefone ?? '',
      o.responsavel,
      o.ambiente ?? '',
      o.modelo,
      o.tecido,
      o.quantidade,
      o.valor_venda ?? '',
      o.instalacao ?? '',
      o.custo_tecido ?? '',
      m != null ? m.toFixed(1) : '',
      o.fechado ? 'Sim' : 'Não',
    ]
  })
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `orcamentos-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function exportXLSX(data: Orcamento[]) {
  // Import dinâmico: vendor-xlsx só baixa quando o usuário exporta
  const XLSX = await import('xlsx')
  const rows = data.map((o, i) => ({
    '#': i + 1,
    Data: formatDate(o.created_at),
    Cliente: o.cliente ?? '',
    Telefone: o.telefone ?? '',
    Responsável: o.responsavel,
    Ambiente: o.ambiente ?? '',
    Modelo: o.modelo,
    Tecido: o.tecido,
    Quantidade: o.quantidade,
    'Valor Venda': o.valor_venda ?? '',
    'Valor Instalação': o.instalacao ?? '',
    'Custo (R$)': o.custo_tecido ?? '',
    'Margem (%)': calcMargem(o) != null ? (calcMargem(o) as number).toFixed(1) : '',
    Fechado: o.fechado ? 'Sim' : 'Não',
    Observações: o.observacoes ?? '',
  }))
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Orçamentos')
  XLSX.writeFile(wb, `orcamentos-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

async function exportPDF(data: Orcamento[], isFiltered: boolean) {
  // Import dinâmico: vendor-pdf só baixa quando o usuário exporta
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const doc = new jsPDF({ orientation: 'landscape' })
  const inicioY = faixaMarca(doc, 'Orçamentos',
    `${isFiltered ? 'Com filtros aplicados · ' : ''}${data.length} registro${data.length !== 1 ? 's' : ''}`)

  const totalVenda = data.reduce((s, o) => s + (o.valor_venda ?? 0), 0)
  const totalInst = data.reduce((s, o) => s + (o.instalacao ?? 0), 0)
  const totalGeral = totalVenda + totalInst
  const fechados = data.filter((o) => o.fechado === true).length

  autoTable(doc, {
    startY: inicioY,
    head: [['#', 'Data', 'Cliente', 'Responsável', 'Ambiente', 'Modelo', 'Tecido', 'Qtd', 'Valor Venda', 'Instalação', 'Total', 'Custo', 'Margem', 'Fechado']],
    body: data.map((o, i) => {
      const m = calcMargem(o)
      return [
        `#${i + 1}`,
        formatDate(o.created_at),
        o.cliente ?? '—',
        o.responsavel,
        o.ambiente ?? '—',
        o.modelo,
        o.tecido,
        String(o.quantidade),
        o.valor_venda ? formatCurrency(o.valor_venda) : '—',
        o.instalacao ? formatCurrency(o.instalacao) : '—',
        formatCurrency((o.valor_venda ?? 0) + (o.instalacao ?? 0)),
        o.custo_tecido ? formatCurrency(o.custo_tecido) : '—',
        m != null ? m.toFixed(1) + '%' : '—',
        o.fechado ? 'Sim' : 'Não',
      ]
    }),
    foot: [['', '', '', '', '', '', `${fechados} fechados`, '', formatCurrency(totalVenda), formatCurrency(totalInst), formatCurrency(totalGeral), '', '', '']],
    ...TEMA_TABELA,
    headStyles: { ...TEMA_TABELA.headStyles, fontSize: 8 },
    bodyStyles: { fontSize: 7.5 },
    footStyles: { ...TEMA_TABELA.footStyles, fontSize: 8 },
    columnStyles: { 8: { halign: 'center' }, 9: { halign: 'center' }, 10: { halign: 'center', fontStyle: 'bold' }, 11: { halign: 'center' }, 12: { halign: 'center' } },
    didParseCell: alinharSecoes({ 8: 'center', 9: 'center', 10: 'center', 11: 'center', 12: 'center' }),
    margin: { left: 8, right: 8 },
  })

  rodapeMarca(doc)
  doc.save(`orcamentos-${new Date().toISOString().slice(0, 10)}.pdf`)
}

function calcMargem(o: Orcamento) {
  if (o.margem != null) return o.margem
  const receita = (o.valor_venda ?? 0) + (o.instalacao ?? 0)
  return o.custo_tecido && o.custo_tecido > 0
    ? calcularMargem(receita, o.custo_tecido)
    : null
}

type SortKey = 'created_at' | 'cliente' | 'responsavel' | 'valor_venda' | 'margem'

interface Props {
  data: Orcamento[]
  toast: ToastFn
  isFiltered?: boolean
  search?: string
  onClearFilters?: () => void
  filterKey?: string
  totalCount?: number
}

const ORC_COLS_KEY  = 'sombrear-orcamentos-cols'
const ORC_SORT_KEY  = 'sombrear-orcamentos-sort'

type ColId = 'num' | 'data' | 'cliente' | 'responsavel' | 'ambiente' | 'modelo' | 'tecido' | 'qtd' | 'valor' | 'margem' | 'custo' | 'custoAcab' | 'status' | 'fechado'

// `somenteAdmin`: custo de compra não é coisa de vendedor — a coluna nem aparece no seletor
const COL_DEFS: { id: ColId; label: string; key?: SortKey; optional: boolean; align: 'center' | 'right'; somenteAdmin?: boolean }[] = [
  { id: 'num',         label: '#',          optional: false, align: 'center' },
  { id: 'data',        label: 'Data',       key: 'created_at', optional: false, align: 'center' },
  { id: 'cliente',     label: 'Cliente',    key: 'cliente',    optional: false, align: 'center' },
  { id: 'responsavel', label: 'Responsável',key: 'responsavel',optional: false, align: 'center' },
  { id: 'ambiente',    label: 'Ambiente',   optional: true,  align: 'center' },
  { id: 'modelo',      label: 'Modelo',     optional: false, align: 'center' },
  { id: 'tecido',      label: 'Tecido',     optional: true,  align: 'center' },
  { id: 'qtd',         label: 'Qtd',        optional: true,  align: 'center' },
  { id: 'valor',       label: 'Valor',      key: 'valor_venda', optional: false, align: 'center' },
  { id: 'margem',      label: 'Margem',     key: 'margem',     optional: false, align: 'center' },
  { id: 'custo',       label: 'Custo total',optional: true,  align: 'center', somenteAdmin: true },
  { id: 'custoAcab',   label: 'Custo acab.',optional: true,  align: 'center', somenteAdmin: true },
  { id: 'status',      label: 'Status n8n', optional: true,  align: 'center' },
  { id: 'fechado',     label: 'Fechado',    optional: false, align: 'center' },
]

const COL_DEFAULTS: Record<ColId, boolean> = {
  num: true, data: true, cliente: true, responsavel: true,
  ambiente: true, modelo: true, tecido: true, qtd: true,
  valor: true, margem: true, custo: false, custoAcab: false, status: false, fechado: true,
}

function loadColVis(): Record<ColId, boolean> {
  try {
    const s = localStorage.getItem(ORC_COLS_KEY)
    return s ? { ...COL_DEFAULTS, ...JSON.parse(s) } : { ...COL_DEFAULTS }
  } catch { return { ...COL_DEFAULTS } }
}

export default function OrcamentosTable({ data, toast, isFiltered, search = '', onClearFilters, filterKey, totalCount }: Props) {
  const [editing, setEditing] = useState<Orcamento | null>(null)
  // Linha → detalhe: a linha clicada vira o shared element e "expande" no painel de edição
  const [vtOrcId, setVtOrcId] = useState<Orcamento['id'] | null>(null)
  function abrirEdicao(o: Orcamento) {
    flushSync(() => setVtOrcId(o.id))
    comTransicao(() => setEditing(o))
  }
  // A volta: o painel encolhe de volta até a linha de origem (nome só entra na
  // linha DENTRO da transição — nunca junto com o painel, senão o par duplica)
  function fecharEdicao() {
    const id = editing?.id
    comTransicao(() => {
      setEditing(null)
      if (id != null) setVtOrcId(id)
    })
  }
  useEffect(() => {
    if (vtOrcId == null) return
    const t = setTimeout(() => setVtOrcId(null), 600)
    return () => clearTimeout(t)
  }, [vtOrcId])
  const vtLinha = (id: Orcamento['id']) =>
    vtOrcId === id ? ({ viewTransitionName: 'detalhe-orc' } as React.CSSProperties) : undefined
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>(() => {
    try {
      const s = localStorage.getItem(ORC_SORT_KEY)
      return s ? JSON.parse(s) : { key: 'created_at', dir: 'desc' }
    } catch { return { key: 'created_at', dir: 'desc' } }
  })
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null)
  const [colVis, setColVis] = useState<Record<ColId, boolean>>(loadColVis)
  const [colsOpen, setColsOpen] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [glowPos, setGlowPos] = useState<{ x: number; y: number } | null>(null)
  const colsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try { localStorage.setItem(ORC_COLS_KEY, JSON.stringify(colVis)) }
    catch { /* noop */ }
  }, [colVis])

  useEffect(() => {
    try { localStorage.setItem(ORC_SORT_KEY, JSON.stringify(sort)) }
    catch { /* noop */ }
  }, [sort])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (colsRef.current && !colsRef.current.contains(e.target as Node)) setColsOpen(false)
    }
    if (colsOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [colsOpen])

  const { data: perfil } = useProfile()
  const isAdmin = perfil?.email === ADMIN_EMAIL || perfil?.is_admin === true
  const colsDisponiveis = COL_DEFS.filter(c => !c.somenteAdmin || isAdmin)
  const vis = (id: ColId) => colVis[id] !== false && (isAdmin || !COL_DEFS.find(c => c.id === id)?.somenteAdmin)
  const visibleCols = colsDisponiveis.filter(c => vis(c.id))

  function copyPhone(e: React.MouseEvent, phone: string) {
    e.stopPropagation()
    navigator.clipboard.writeText(phone)
      .then(() => {
        setCopiedPhone(phone)
        setTimeout(() => setCopiedPhone((prev) => prev === phone ? null : prev), 2000)
      })
      .catch(() => { toast('error', 'Falha ao copiar telefone.') })
  }
  const [page, setPage] = useState(1)
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set())
  const prevFechadoMap = useRef<Map<string, boolean>>(new Map())
  const flashTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => { setPage(1) }, [filterKey])
  useEffect(() => { setPage(1) }, [sort])

  useEffect(() => {
    if (!isFocused) return
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') setIsFocused(false) }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isFocused])

  function handleTableMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    setGlowPos({ x: e.clientX - rect.left, y: e.clientY - rect.top + e.currentTarget.scrollTop })
  }

  useEffect(() => {
    const newFlash = new Set<string>()
    data.forEach((o) => {
      const prev = prevFechadoMap.current.get(o.id)
      if (o.fechado && prev === false) newFlash.add(o.id)
      prevFechadoMap.current.set(o.id, !!o.fechado)
    })
    if (newFlash.size > 0) {
      setFlashIds((prev) => new Set([...prev, ...newFlash]))
      newFlash.forEach((id) => {
        if (flashTimers.current.has(id)) clearTimeout(flashTimers.current.get(id)!)
        const timer = setTimeout(() => {
          setFlashIds((prev) => { const next = new Set(prev); next.delete(id); return next })
          flashTimers.current.delete(id)
        }, 700)
        flashTimers.current.set(id, timer)
      })
    }
  }, [data])

  // Limpa timers apenas na desmontagem — não a cada update de data
  useEffect(() => {
    return () => {
      flashTimers.current.forEach((t) => clearTimeout(t))
      flashTimers.current.clear()
    }
  }, [])

  function toggleSort(key: SortKey) {
    setSort((s) => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
  }

  const sorted = useMemo(() => [...data].sort((a, b) => {
    let av: string | number, bv: string | number
    if (sort.key === 'created_at') { av = a.created_at; bv = b.created_at }
    else if (sort.key === 'cliente') { av = a.cliente ?? ''; bv = b.cliente ?? '' }
    else if (sort.key === 'responsavel') { av = a.responsavel; bv = b.responsavel }
    else if (sort.key === 'margem') {
      const ma = calcMargem(a); const mb = calcMargem(b)
      if (ma === null && mb === null) return 0
      if (ma === null) return 1
      if (mb === null) return -1
      av = ma; bv = mb
    }
    else { av = a.valor_venda ?? -1; bv = b.valor_venda ?? -1 }
    if (av < bv) return sort.dir === 'asc' ? -1 : 1
    if (av > bv) return sort.dir === 'asc' ? 1 : -1
    return 0
  }), [data, sort])

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // ao trocar a ordenação, as linhas deslizam da posição antiga pra nova
  const flipRef = useFlip<HTMLTableSectionElement>([sort.key, sort.dir])

  function SortIcon({ k }: { k: SortKey }) {
    if (sort.key !== k) return <ChevronsUpDown className="h-3 w-3 opacity-40" />
    return sort.dir === 'asc' ? <ChevronUp className="h-3 w-3 text-primary" /> : <ChevronDown className="h-3 w-3 text-primary" />
  }

  const now = Date.now()
  const RECENT_THRESHOLD_MS = 2 * 60 * 60 * 1000 // 2 horas

  return (
    <>
      {isFocused && (
        <div
          className="fixed inset-0 z-[499] bg-background/80 backdrop-blur-sm"
          onClick={() => setIsFocused(false)}
        />
      )}
      <div className={cn(
        isFocused
          ? 'fixed inset-4 z-[500] flex flex-col overflow-hidden rounded-2xl border-2 bg-card shadow-2xl'
          : 'rounded-xl border-2 bg-card shadow-sm'
      )}>
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="font-display text-sm font-medium tracking-wide">Todos os Orçamentos</h2>
          <div className="flex items-center gap-2">
            {/* Seletor de colunas */}
            <div ref={colsRef} className="relative">
              <button
                onClick={() => setColsOpen(v => !v)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-150 active:scale-95',
                  colsOpen ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
                title="Mostrar/ocultar colunas"
              >
                <Columns3 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Colunas</span>
              </button>
              {colsOpen && (
                <div className="absolute right-0 top-full mt-1.5 z-50 w-44 rounded-xl border border-border bg-card shadow-elevated p-2 flex flex-col gap-0.5">
                  {colsDisponiveis.filter(c => c.optional).map(c => (
                    <label key={c.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium cursor-pointer hover:bg-muted/60 transition-colors select-none">
                      <input
                        type="checkbox"
                        checked={vis(c.id)}
                        onChange={() => setColVis(v => ({ ...v, [c.id]: !v[c.id] }))}
                        className="accent-primary h-3.5 w-3.5"
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
            {/* Focus mode toggle */}
            <button
              onClick={() => setIsFocused(v => !v)}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150 active:scale-95"
              title={isFocused ? 'Sair do modo foco (Esc)' : 'Modo foco'}
            >
              {isFocused ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{isFocused ? 'Sair' : 'Foco'}</span>
            </button>
            {/* Exports */}
            <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
              <button onClick={() => exportCSV(sorted)} disabled={data.length === 0} title={`Exportar ${sorted.length} registros como CSV`} className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground hover:scale-105 active:scale-95 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100">
                <Download className="h-3.5 w-3.5" />CSV
              </button>
              <button onClick={() => exportXLSX(sorted)} disabled={data.length === 0} title={`Exportar ${sorted.length} registros como XLSX`} className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground hover:scale-105 active:scale-95 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100">
                <Download className="h-3.5 w-3.5" />XLSX
              </button>
              <button onClick={() => exportPDF(sorted, !!isFiltered)} disabled={data.length === 0} title={`Exportar ${sorted.length} registros como PDF`} className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground hover:scale-105 active:scale-95 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100">
                <FileDown className="h-3.5 w-3.5" />PDF
              </button>
            </div>
          </div>
        </div>

        {data.length === 0 ? (
          <EmptyState
            icon={FileX}
            animated
            title={isFiltered ? 'Nenhum resultado encontrado' : 'Nenhum orçamento ainda'}
            description={isFiltered ? 'Tente ajustar ou limpar os filtros' : 'Clique em "+ Novo Orçamento" para começar'}
            action={isFiltered && onClearFilters ? { label: 'Limpar todos os filtros', onClick: onClearFilters } : undefined}
          />
        ) : (
          <>
            <div
              className={cn('hidden md:block overflow-auto relative', isFocused ? 'flex-1' : 'max-h-[70vh]')}
              onMouseMove={handleTableMouseMove}
              onMouseLeave={() => setGlowPos(null)}
            >
              {glowPos && (
                <div
                  className="pointer-events-none absolute inset-0 z-10"
                  style={{ background: `radial-gradient(circle 200px at ${glowPos.x}px ${glowPos.y}px, hsl(var(--primary)/0.055) 0%, transparent 70%)` }}
                />
              )}
              <table className="w-full text-sm" style={{ minWidth: '920px' }}>
                <thead>
                  <tr>
                    {visibleCols.map(({ id, label, key, align }) => (
                      <th
                        key={id}
                        onClick={() => key && toggleSort(key)}
                        aria-label={key ? `Ordenar por ${label}` : undefined}
                        className={cn(
                          tabela.th, 'select-none border-y border-border',
                          align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left',
                          id === 'num' ? 'w-10' : '',
                          key && tabela.thOrdenavel
                        )}
                        style={{
                          position: 'sticky',
                          top: 0,
                          backgroundColor: 'hsl(var(--muted))',
                          zIndex: id === 'num' ? 30 : id === 'fechado' ? 30 : 10,
                          ...(id === 'num' ? { left: 0, boxShadow: '4px 0 6px -1px rgba(0,0,0,0.12)' } : {}),
                          ...(id === 'fechado' ? { right: 0, boxShadow: '-4px 0 6px -1px rgba(0,0,0,0.12)' } : {}),
                        }}
                      >
                        <span className={cn('flex items-center gap-1', align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : '')}>
                          {label}
                          {key && <SortIcon k={key} />}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody ref={flipRef}>
                  {paginated.map((o, i) => {
                    const diasAberto = !o.fechado ? Math.floor((now - new Date(o.created_at).getTime()) / 86400000) : 0
                    const receita = (o.valor_venda ?? 0) + (o.instalacao ?? 0)
                    const margem = calcMargem(o)
                    const semCusto = receita > 0 && (!o.custo_tecido || o.custo_tecido === 0)
                    const temCustoSemReceita = (!o.valor_venda) && o.custo_tecido && o.custo_tecido > 0
                    const globalIndex = (page - 1) * PAGE_SIZE + i + 1
                    const hasFlash = flashIds.has(o.id)
                    return (
                      <tr
                        key={o.id}
                        data-flip-id={o.id}
                        onClick={() => abrirEdicao(o)}
                        className={cn(
                          'border-b last:border-0 transition-colors duration-150 cursor-pointer group row-animate-in',
                          o.fechado && !hasFlash && 'row-fechado',
                          hasFlash && 'animate-row-close'
                        )}
                        style={{ animationDelay: `${i * 25}ms`, ...vtLinha(o.id) }}
                      >
                        {/* sticky left */}
                        <td className="px-2 py-3 text-center w-10 relative" style={{ position: 'sticky', left: 0, zIndex: 20, backgroundColor: 'hsl(var(--card))', boxShadow: '4px 0 6px -2px rgba(0,0,0,0.12)' }}>
                          {(now - new Date(o.created_at).getTime()) < RECENT_THRESHOLD_MS && (
                            <span className="absolute left-1 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-emerald-400 animate-pulse" title="Recente (< 2h)" />
                          )}
                          <span className="inline-flex items-center justify-center h-5 min-w-[1.4rem] rounded-md px-1.5 text-[10px] font-bold tabular-nums bg-primary/10 dark:bg-primary/25 text-primary">
                            {globalIndex}
                          </span>
                        </td>
                        <td className={cn('px-4 py-3 text-muted-foreground text-xs', i % 2 === 1 ? 'bg-muted/[0.15]' : '', 'group-hover:bg-primary/[0.04]')}>
                          <span className="flex flex-col leading-tight gap-0.5">
                            <span>{formatDate(o.created_at)}</span>
                            {diasAberto > 0 && (
                              <span className={cn('font-medium', diasAberto > 7 ? 'text-primary' : 'text-muted-foreground/60')}>
                                {diasAberto}d aberto
                              </span>
                            )}
                          </span>
                        </td>
                        <td className={cn('px-4 py-3 font-medium', i % 2 === 1 ? 'bg-muted/[0.15]' : '', 'group-hover:bg-primary/[0.04]')}>
                          <span className="flex items-center gap-1.5">
                            <span className="flex flex-col">
                              <Highlight text={o.cliente} query={search} />
                              {o.telefone && (
                                <button
                                  onClick={(e) => copyPhone(e, o.telefone!)}
                                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                                  title="Copiar telefone"
                                >
                                  {copiedPhone === o.telefone ? (
                                    <><Check className="h-2.5 w-2.5 text-emerald-500" /><span className="text-emerald-500 font-medium">Copiado!</span></>
                                  ) : (
                                    <><Copy className="h-2.5 w-2.5 opacity-50" />{o.telefone}</>
                                  )}
                                </button>
                              )}
                            </span>
                            {o.observacoes && <span title={o.observacoes}><StickyNote className="h-3 w-3 shrink-0 text-muted-foreground" /></span>}
                          </span>
                        </td>
                        <td className={cn('px-4 py-3', i % 2 === 1 ? 'bg-muted/[0.15]' : '', 'group-hover:bg-primary/[0.04]')}>
                          <span className="flex items-center gap-2">
                            <AvatarInitials name={o.responsavel} />
                            <Highlight text={o.responsavel} query={search} />
                          </span>
                        </td>
                        {vis('ambiente') && <td className={cn('px-4 py-3', i % 2 === 1 ? 'bg-muted/[0.15]' : '', 'group-hover:bg-primary/[0.04]')}>
                          {o.ambiente
                            ? <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{o.ambiente}</span>
                            : <span className="text-muted-foreground/20 text-xs">—</span>
                          }
                        </td>}
                        <td className={cn('px-4 py-3', i % 2 === 1 ? 'bg-muted/[0.15]' : '', 'group-hover:bg-primary/[0.04]')}>{o.modelo}</td>
                        {vis('tecido') && <td className={cn('px-4 py-3 text-muted-foreground', i % 2 === 1 ? 'bg-muted/[0.15]' : '', 'group-hover:bg-primary/[0.04]')}>{o.tecido || <span className="opacity-30">—</span>}</td>}
                        {vis('qtd') && <td className={cn('px-4 py-3 text-center', i % 2 === 1 ? 'bg-muted/[0.15]' : '', 'group-hover:bg-primary/[0.04]')}>{o.quantidade}</td>}
                        <td className={cn('px-4 py-3 text-center', i % 2 === 1 ? 'bg-muted/[0.15]' : '', 'group-hover:bg-primary/[0.04]')}>
                          <span className="flex flex-col items-end leading-tight tabular-nums">
                            <span>{o.valor_venda ? formatCurrency(o.valor_venda) : <span className="text-muted-foreground/30">—</span>}</span>
                            {o.instalacao ? (
                              <span className="text-xs text-primary/70">+{formatCurrency(o.instalacao)} inst.</span>
                            ) : null}
                          </span>
                        </td>
                        <td className={cn('px-4 py-3 text-center', i % 2 === 1 ? 'bg-muted/[0.15]' : '', 'group-hover:bg-primary/[0.04]')}>
                          {margem !== null ? (
                            <span className={cn(
                              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
                              margem >= 30 ? 'bg-primary/10 text-primary'
                                : margem >= 15 ? 'bg-muted text-foreground'
                                : 'bg-destructive/10 text-destructive'
                            )}>
                              {margem.toFixed(1)}%
                            </span>
                          ) : semCusto ? (
                            <span className="text-xs text-muted-foreground/40 italic">sem custo</span>
                          ) : temCustoSemReceita ? (
                            <span className="text-xs text-muted-foreground/50 italic" title="Informe o valor de venda para calcular a margem">
                              custo {formatCurrency(o.custo_tecido || 0)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/20">—</span>
                          )}
                        </td>
                        {vis('custo') && <td className={cn('px-4 py-3 text-center tabular-nums', i % 2 === 1 ? 'bg-muted/[0.15]' : '', 'group-hover:bg-primary/[0.04]')}>
                          {o.custo_tecido ? formatCurrency(o.custo_tecido) : <span className="text-muted-foreground/30">—</span>}
                        </td>}
                        {vis('custoAcab') && <td className={cn('px-4 py-3 text-center tabular-nums', i % 2 === 1 ? 'bg-muted/[0.15]' : '', 'group-hover:bg-primary/[0.04]')}>
                          {o.custo_acabamento ? formatCurrency(o.custo_acabamento) : <span className="text-muted-foreground/30">—</span>}
                        </td>}
                        {/* status n8n */}
                        {vis('status') && <td className={cn('px-4 py-3', i % 2 === 1 ? 'bg-muted/[0.15]' : '', 'group-hover:bg-primary/[0.04]')}>
                          {o.status === 'ENVIADO' ? (
                            <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">Enviado</span>
                          ) : o.status === 'CALCULADO' ? (
                            <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">Calculado</span>
                          ) : (
                            <span className="text-xs text-muted-foreground/20">—</span>
                          )}
                        </td>}
                        {/* sticky right */}
                        <td className="px-4 py-3" style={{ position: 'sticky', right: 0, zIndex: 20, backgroundColor: 'hsl(var(--card))', boxShadow: '-4px 0 6px -2px rgba(0,0,0,0.12)' }}><FechadoCheckbox orcamento={o} toast={toast} /></td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border" style={{ backgroundColor: 'hsl(var(--muted))' }}>
                    <td colSpan={visibleCols.findIndex(c => c.id === 'valor')} className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {isFiltered && totalCount != null && sorted.length < totalCount
                        ? <>{sorted.length} <span className="text-muted-foreground/50">de {totalCount}</span> orçamento{sorted.length !== 1 ? 's' : ''}</>
                        : <>Total — {sorted.length} orçamento{sorted.length !== 1 ? 's' : ''}</>
                      }
                    </td>
                    <td className="px-4 py-2.5 text-sm font-bold text-primary text-center">
                      {formatCurrency(sorted.reduce((s, o) => s + (o.valor_venda ?? 0) + (o.instalacao ?? 0), 0))}
                    </td>
                    <td colSpan={visibleCols.length - visibleCols.findIndex(c => c.id === 'valor') - 1} />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Mobile */}
            <div className="md:hidden divide-y">
              {paginated.map((o, i) => {
                const diasAberto = !o.fechado ? Math.floor((now - new Date(o.created_at).getTime()) / 86400000) : 0
                const globalIndex = (page - 1) * PAGE_SIZE + i + 1
                const hasFlash = flashIds.has(o.id)
                return (
                  <div
                    key={o.id}
                    onClick={() => abrirEdicao(o)}
                    style={vtLinha(o.id)}
                    className={cn(
                      'px-4 py-4 cursor-pointer hover:bg-muted/20 transition-colors',
                      o.fechado && !hasFlash && 'row-fechado',
                      hasFlash && 'animate-row-close'
                    )}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <AvatarInitials name={o.responsavel} />
                          <span className="text-xs font-mono text-muted-foreground">#{globalIndex}</span>
                          <p className="font-semibold text-sm truncate">
                            <Highlight text={o.cliente ?? 'Sem cliente'} query={search} />
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 pl-8">
                          <Highlight text={o.responsavel} query={search} /> · {formatDate(o.created_at)}
                          {diasAberto > 0 && (
                            <span className={cn('ml-1.5 font-medium', diasAberto > 7 ? 'text-primary' : '')}>
                              · {diasAberto}d aberto
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="ml-2 shrink-0">
                                        <FechadoCheckbox orcamento={o} toast={toast} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between pl-8">
                      <span className="text-xs text-muted-foreground">
                        {o.ambiente && <span className="mr-1.5 inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{o.ambiente}</span>}
                        {o.modelo} · {o.tecido}
                      </span>
                      <div className="flex flex-col items-end">
                        {o.valor_venda
                          ? <span className="text-sm font-bold text-primary">{formatCurrency(o.valor_venda)}</span>
                          : <span className="text-xs text-muted-foreground">Sem valor</span>
                        }
                        {(() => {
                          const m = calcMargem(o)
                          if (m == null) return null
                          return (
                            <span className={cn(
                              'text-[10px] font-semibold',
                              m >= 30 ? 'text-primary' : m >= 15 ? 'text-muted-foreground' : 'text-destructive'
                            )}>
                              {m.toFixed(1)}%
                            </span>
                          )
                        })()}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t px-5 py-3">
                <span className="text-xs text-muted-foreground">
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} de {sorted.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => p - 1)}
                    disabled={page === 1}
                    className="rounded-lg border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="px-2 text-xs font-medium tabular-nums">{page} / {totalPages}</span>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page === totalPages}
                    className="rounded-lg border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {editing && (
        <EditOrcamentoForm
          orcamento={editing}
          onClose={fecharEdicao}
          toast={toast}
        />
      )}
    </>
  )
}
