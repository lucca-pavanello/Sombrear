import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Orcamento } from '@/lib/supabase'
import { useDebounce } from '@/hooks/useDebounce'
import { filterByPeriod } from '@/hooks/usePeriodFilter'
import KPIGrid from '@/components/orcamentos/KPIGrid'
import OrcamentosFechadosCard from '@/components/orcamentos/OrcamentosFechadosCard'
import FiltersBar from '@/components/orcamentos/FiltersBar'
import ResponsavelChart from '@/components/charts/ResponsavelChart'
import ModelosChart from '@/components/charts/ModelosChart'
import RankingResponsavel from '@/components/orcamentos/RankingResponsavel'
import SkeletonCard from '@/components/shared/SkeletonCard'

const FILTER_KEY = 'sombrear-orcamentos-filters'

function loadFilters() {
  try {
    const s = localStorage.getItem(FILTER_KEY)
    return s ? JSON.parse(s) : {}
  } catch { return {} }
}

interface Props {
  data: Orcamento[]
  loading: boolean
  resetKey?: number
  /** false quando embutido em outra tela: não lê nem escreve a URL (evita apagar a query de outras abas). */
  sincronizarUrl?: boolean
}

export default function TabOrcamentos({ data, loading, resetKey, sincronizarUrl = true }: Props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const saved = loadFilters()
  const doUrl = (k: string) => (sincronizarUrl ? searchParams.get(k) : null)
  const [search, setSearch] = useState('')
  const [responsavel, setResponsavel] = useState(doUrl('responsavel') ?? saved.responsavel ?? 'todos')
  const [modelo, setModelo] = useState(doUrl('modelo') ?? saved.modelo ?? 'todos')
  const [fechadoFilter, setFechadoFilter] = useState(doUrl('fechado') ?? saved.fechado ?? 'todos')
  const [periodo, setPeriodo] = useState(doUrl('periodo') ?? saved.periodo ?? 'todos')
  const [dateFrom, setDateFrom] = useState(doUrl('dateFrom') ?? saved.dateFrom ?? '')
  const [dateTo, setDateTo] = useState(doUrl('dateTo') ?? saved.dateTo ?? '')

  const debouncedSearch = useDebounce(search, 220)

  // Sync filters to URL query string
  useEffect(() => {
    if (!sincronizarUrl) return
    const params: Record<string, string> = {}
    if (responsavel !== 'todos') params.responsavel = responsavel
    if (modelo !== 'todos') params.modelo = modelo
    if (fechadoFilter !== 'todos') params.fechado = fechadoFilter
    if (periodo !== 'todos') params.periodo = periodo
    if (dateFrom) params.dateFrom = dateFrom
    if (dateTo) params.dateTo = dateTo
    setSearchParams(params, { replace: true })
  }, [responsavel, modelo, fechadoFilter, periodo, dateFrom, dateTo, setSearchParams, sincronizarUrl])

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
    const searchLower = debouncedSearch.toLowerCase()
    const byPeriod = filterByPeriod(data, periodo, (o) => o.created_at, dateFrom, dateTo)
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

  const smartInsight = useMemo(() => {
    if (filtered.length > 0 || data.length === 0) return null
    if (debouncedSearch) {
      const inBase = data.filter(o =>
        [o.cliente, o.responsavel].some(v => v?.toLowerCase().includes(debouncedSearch.toLowerCase()))
      ).length
      if (inBase > 0)
        return `Há ${inBase} orçamento${inBase > 1 ? 's' : ''} com "${debouncedSearch}" na base — tente limpar os outros filtros`
      return `Nenhum resultado para "${debouncedSearch}" na base de dados`
    }
    if (responsavel !== 'todos')
      return `${responsavel} não tem orçamentos com os filtros atuais`
    if (modelo !== 'todos')
      return `Nenhum orçamento do modelo "${modelo}" com os filtros atuais`
    return 'Os filtros ativos não retornaram resultados'
  }, [filtered.length, data, debouncedSearch, responsavel, modelo])

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="kpi-cascade grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
        <div className="rounded-xl border bg-card shadow-sm animate-pulse">
          <div className="border-b px-5 py-4"><div className="h-5 w-48 rounded bg-muted" /></div>
          <div className="p-5 space-y-3">
            {[...Array(3)].map((_, i) => <div key={i} className="h-10 rounded bg-muted" />)}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <KPIGrid data={filtered} resetKey={resetKey} />

      <hr className="border-border/25" />

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
        storageKey="sombrear-filters-open-orcamentos"
      />

      {smartInsight && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 text-center space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <p className="text-sm font-semibold text-foreground">Nenhum resultado encontrado</p>
          <p className="text-xs text-primary/70 max-w-sm mx-auto">{smartInsight}</p>
          <button
            onClick={clearFilters}
            className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
          >
            Limpar filtros
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <RankingResponsavel data={filtered} />
        <ResponsavelChart data={filtered} resetKey={resetKey} loading={loading} />
        <ModelosChart data={filtered} loading={loading} />
      </div>

      <hr className="border-border/25" />

      <OrcamentosFechadosCard data={filtered} />
    </div>
  )
}
