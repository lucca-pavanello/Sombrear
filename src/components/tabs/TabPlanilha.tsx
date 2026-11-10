import { useState, useEffect, useMemo } from 'react'
import { Plus, ChevronDown, ChevronUp } from 'lucide-react'
import type { Orcamento } from '@/lib/supabase'
import { useDebounce } from '@/hooks/useDebounce'
import { filterByPeriod } from '@/hooks/usePeriodFilter'
import OrcamentosTable from '@/components/orcamentos/OrcamentosTable'
import NovoOrcamentoForm from '@/components/orcamentos/NovoOrcamentoForm'
import FiltersBar from '@/components/orcamentos/FiltersBar'
import SkeletonCard from '@/components/shared/SkeletonCard'
import TabCalculoCusto from '@/components/tabs/TabCalculoCusto'
import { segmentado } from '@/components/shared/estilos'
import { cn } from '@/lib/utils'
import type { ToastType } from '@/hooks/useToast'

const FILTER_KEY = 'sombrear-planilha-filters'

function loadFilters() {
  try {
    const s = localStorage.getItem(FILTER_KEY)
    return s ? JSON.parse(s) : {}
  } catch { return {} }
}

interface Props {
  data: Orcamento[]
  loading: boolean
  /** falha ao ler os orçamentos — só repassada à visão de custos */
  error?: boolean
  toast: (type: ToastType, message: string, opts?: { duration?: number; undoAction?: () => void }) => void
}

export default function TabPlanilha({ data, loading, error, toast }: Props) {
  const saved = loadFilters()
  // Orçamentos (a tabela) ou Custos lançados (o custo de cada orçamento)
  const [vista, setVista] = useState<'orcamentos' | 'custos'>('orcamentos')
  const [formOpen, setFormOpen] = useState(false)
  const [tableOpen, setTableOpen] = useState(() => {
    try { return localStorage.getItem('sombrear-table-open-planilha') !== 'false' }
    catch { return true }
  })
  const [search, setSearch] = useState('')
  const [responsavel, setResponsavel] = useState(saved.responsavel ?? 'todos')
  const [modelo, setModelo] = useState(saved.modelo ?? 'todos')
  const [fechadoFilter, setFechadoFilter] = useState(saved.fechado ?? 'todos')
  const [periodo, setPeriodo] = useState(saved.periodo ?? 'todos')
  const [dateFrom, setDateFrom] = useState(saved.dateFrom ?? '')
  const [dateTo, setDateTo] = useState(saved.dateTo ?? '')

  const debouncedSearch = useDebounce(search, 220)

  useEffect(() => {
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify({ responsavel, modelo, fechado: fechadoFilter, periodo, dateFrom, dateTo }))
    } catch { /* quota exceeded ou localStorage desativado */ }
  }, [responsavel, modelo, fechadoFilter, periodo, dateFrom, dateTo])

  useEffect(() => {
    try { localStorage.setItem('sombrear-table-open-planilha', String(tableOpen)) }
    catch { /* noop */ }
  }, [tableOpen])

  function clearFilters() {
    setSearch('')
    setResponsavel('todos')
    setModelo('todos')
    setFechadoFilter('todos')
    setPeriodo('todos')
    setDateFrom('')
    setDateTo('')
  }

  const filtered = useMemo(() => {
    const byPeriod = filterByPeriod(data, periodo, (o) => o.created_at, dateFrom, dateTo)
    const searchLower = debouncedSearch.toLowerCase()
    return byPeriod.filter((o) => {
      const matchSearch = !debouncedSearch || [o.cliente, o.responsavel, o.modelo, o.tecido, o.telefone, o.ambiente]
        .some((v) => v?.toLowerCase().includes(searchLower))
      const matchResp = responsavel === 'todos' || o.responsavel === responsavel
      const matchModelo = modelo === 'todos' || o.modelo === modelo
      const matchStatus = fechadoFilter === 'todos'
        || (fechadoFilter === 'fechado' && o.fechado === true)
        || (fechadoFilter === 'aberto' && o.fechado !== true)
        || (fechadoFilter === 'sem-custo' && o.fechado === true && (!o.custo_tecido || o.custo_tecido === 0))
      return matchSearch && matchResp && matchModelo && matchStatus
    })
  }, [data, debouncedSearch, responsavel, modelo, fechadoFilter, periodo, dateFrom, dateTo])

  const responsaveis = useMemo(() => [...new Set(data.map((o) => o.responsavel))].filter(Boolean), [data])
  const modelos = useMemo(() => [...new Set(data.map((o) => o.modelo))].filter(Boolean), [data])
  const isFiltered = !!search || responsavel !== 'todos' || modelo !== 'todos' || fechadoFilter !== 'todos' || periodo !== 'todos' || !!dateFrom || !!dateTo

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border bg-card shadow-sm animate-pulse">
          <div className="border-b px-5 py-4"><div className="h-5 w-48 rounded bg-muted" /></div>
          <div className="p-5 space-y-3">
            {[...Array(6)].map((_, i) => <div key={i} className="h-10 rounded bg-muted" />)}
          </div>
        </div>
        <SkeletonCard />
      </div>
    )
  }

  const seletorVista = (
    <div className={cn(segmentado.trilho, 'mx-auto w-fit')}>
      {([['orcamentos', 'Orçamentos'], ['custos', 'Custos lançados']] as const).map(([id, rotulo]) => (
        <button key={id} onClick={() => setVista(id)} aria-pressed={vista === id}
          className={cn(segmentado.item, vista === id ? segmentado.ativo : segmentado.inativo)}>
          {rotulo}
        </button>
      ))}
    </div>
  )

  if (vista === 'custos') {
    return (
      <div className="space-y-4">
        {seletorVista}
        <TabCalculoCusto isLoading={loading} error={error} toast={toast} />
      </div>
    )
  }

  return (
    <>
      <div className="space-y-4">
        {seletorVista}
        {/* Título centralizado; os controles ficam na faixa de baixo */}
        <div className="text-center">
          <h2 className="font-display text-base font-semibold">Todos os Orçamentos</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {filtered.length} registro{filtered.length !== 1 ? 's' : ''}{isFiltered ? ' filtrados' : ''}
          </p>
        </div>

        <div className="flex items-center justify-between">
          <button
            onClick={() => setTableOpen(v => !v)}
            className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={tableOpen ? 'Minimizar tabela' : 'Expandir tabela'}
          >
            {tableOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {tableOpen ? 'Minimizar' : 'Expandir'}
          </button>
          <button
            id="novo-orcamento-btn"
            onClick={() => setFormOpen(true)}
            className="hidden md:flex items-center gap-2 rounded-lg bg-brand-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-brand hover:opacity-90 hover:scale-105 active:scale-95 transition-all duration-150"
          >
            <Plus className="h-4 w-4" />
            Novo Orçamento
            <kbd className="hidden lg:inline-flex items-center justify-center rounded border border-white/30 bg-white/15 px-1.5 py-0.5 text-[10px] font-mono font-normal leading-none">N</kbd>
          </button>
        </div>

        <FiltersBar
          search={search} onSearchChange={setSearch}
          responsavel={responsavel} onResponsavelChange={setResponsavel}
          modelo={modelo} onModeloChange={setModelo}
          fechado={fechadoFilter} onFechadoChange={setFechadoFilter}
          periodo={periodo} onPeriodoChange={setPeriodo}
          dateFrom={dateFrom} onDateFromChange={setDateFrom}
          dateTo={dateTo} onDateToChange={setDateTo}
          responsaveis={responsaveis}
          modelos={modelos}
          onClearFilters={clearFilters}
          storageKey="sombrear-filters-open-planilha"
        />

        {tableOpen && (
          <OrcamentosTable
            data={filtered}
            toast={toast}
            isFiltered={isFiltered}
            search={debouncedSearch}
            onClearFilters={clearFilters}
            totalCount={data.length}
            filterKey={[debouncedSearch, responsavel, modelo, fechadoFilter, periodo, dateFrom, dateTo].join('|')}
          />
        )}
      </div>

      {/* Mobile FAB */}
      <button
        onClick={() => setFormOpen(true)}
        className="fixed bottom-6 right-4 z-40 md:hidden flex h-14 w-14 items-center justify-center rounded-full bg-brand-gradient text-white hover:scale-110 active:scale-90 transition-all duration-200 fab-pulse"
        aria-label="Novo Orçamento"
      >
        <Plus className="h-6 w-6" />
      </button>

      <NovoOrcamentoForm toast={toast} open={formOpen} onClose={() => setFormOpen(false)} />
    </>
  )
}
