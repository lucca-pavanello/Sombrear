import { useState, useMemo, useEffect, useRef } from 'react'
import { Search, X, Plus, Pencil, PackageX, TrendingUp, Package, Filter, Download, ChevronUp, ChevronDown, ChevronsUpDown, Columns } from 'lucide-react'
import { exportCsv, exportXlsx } from '@/lib/exportUtils'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/utils'
import { useEstoqueProdutos, useDeactivateEstoqueProduto } from '@/hooks/useEstoqueProdutos'
import { useEstoqueLocalizacoes } from '@/hooks/useEstoqueLocalizacoes'
import { TIPOS_PRODUTO } from '@/lib/constants'
import { tbl } from './shared/tableStyles'
import { FilterPopover, isFilterActive } from './shared/FilterPopover'
import { FiltrosAtivosChips } from './shared/FiltrosAtivosChips'
import type { RangeState } from './shared/FilterPopover'
import type { EstoqueProduto, CoberturaMargemRow } from '@/lib/supabase'
import type { ToastType } from '@/hooks/useToast'
import { useCoberturaEstoque } from '@/hooks/useEstoqueCoberturaEstoque'

type TipoMov = 'entrada' | 'saida' | 'ajuste' | 'perda'

interface Props {
  toast: (type: ToastType, message: string) => void
  onNovoProduto: () => void
  onEditar: (p: EstoqueProduto) => void
  onMovimentar: (p: EstoqueProduto, tipo: TipoMov) => void
}

const TIPO_OPTIONS = [
  { value: 'tecido',    label: 'Tecido' },
  { value: 'ferragem',  label: 'Ferragem' },
  { value: 'acessorio', label: 'Acessório' },
]

const ABC_OPTIONS = [
  { value: 'A',         label: 'Classe A' },
  { value: 'B',         label: 'Classe B' },
  { value: 'C',         label: 'Classe C' },
  { value: 'sem_dados', label: 'Sem dados' },
]

const FILTER_TYPES: Record<string, 'multi' | 'range' | 'text'> = {
  tipo:          'multi',
  unidade:       'multi',
  estoque_atual: 'range',
  localizacao:   'multi',
  custo_medio:   'range',
  preco_venda:   'range',
  abc:           'multi',
}

const CHIP_LABELS: Record<string, string> = {
  tipo:          'Tipo',
  unidade:       'Unidade',
  estoque_atual: 'Estoque',
  localizacao:   'Localização',
  custo_medio:   'Custo médio',
  preco_venda:   'Preço venda',
  abc:           'ABC',
}

const BASE_CHIP_FORMAT: Record<string, (v: string) => string> = {
  tipo: (v) => TIPOS_PRODUTO[v] ?? v,
  abc:  (v) => v === 'sem_dados' ? 'Sem dados' : `Classe ${v}`,
}

function applyFilter(key: string, p: EstoqueProduto, state: unknown): boolean {
  if (key === 'tipo') {
    const s = state as string[]
    return s.length === 0 || s.includes(p.estoque_categorias?.tipo ?? '')
  }
  if (key === 'unidade') {
    const s = state as string[]
    return s.length === 0 || s.includes(p.unidade)
  }
  if (key === 'estoque_atual') {
    const s = state as RangeState
    if (s.apenasZerados) return p.quantidade_atual === 0
    const min = s.min !== '' && s.min !== undefined ? Number(s.min) : null
    const max = s.max !== '' && s.max !== undefined ? Number(s.max) : null
    if (min !== null && p.quantidade_atual < min) return false
    if (max !== null && p.quantidade_atual > max) return false
    return true
  }
  if (key === 'localizacao') {
    const s = state as string[]
    if (s.length === 0) return true
    const noLoc = s.includes('sem') && p.localizacao_id == null
    const hasLoc = p.localizacao_id != null && s.includes(p.localizacao_id)
    return noLoc || hasLoc
  }
  if (key === 'custo_medio') {
    const s = state as RangeState
    if (s.apenasZerados) return !p.custo_unitario || p.custo_unitario === 0
    if (p.custo_unitario == null) return s.incluirVazios ?? false
    const min = s.min !== '' && s.min !== undefined ? Number(s.min) : null
    const max = s.max !== '' && s.max !== undefined ? Number(s.max) : null
    if (min !== null && p.custo_unitario < min) return false
    if (max !== null && p.custo_unitario > max) return false
    return true
  }
  if (key === 'preco_venda') {
    const s = state as RangeState
    if (s.apenasZerados) return !p.preco_venda || p.preco_venda === 0
    if (p.preco_venda == null) return s.incluirVazios ?? false
    const min = s.min !== '' && s.min !== undefined ? Number(s.min) : null
    const max = s.max !== '' && s.max !== undefined ? Number(s.max) : null
    if (min !== null && p.preco_venda < min) return false
    if (max !== null && p.preco_venda > max) return false
    return true
  }
  if (key === 'abc') {
    const s = state as string[]
    if (s.length === 0) return true
    return s.includes(p.classificacao_abc ?? 'sem_dados')
  }
  return true
}

// ─── Pagination ───────────────────────────────────────────────────────────────
const PAGE_SIZE = 50

// ─── Filter persistence ───────────────────────────────────────────────────────
const FILTER_KEY = 'sombrear-estoque-produtos-filtros'
function loadProdutoFilters() {
  try { const s = localStorage.getItem(FILTER_KEY); return s ? JSON.parse(s) : {} } catch { return {} }
}

// ─── Sort persistence ─────────────────────────────────────────────────────────
const SORT_KEY_P = 'sombrear-estoque-produtos-sort'
type SortKeyP = 'nome' | 'quantidade_atual' | 'custo_unitario' | 'preco_venda' | 'classificacao_abc'

// ─── Column visibility ────────────────────────────────────────────────────────
const PROD_COLS_KEY = 'sombrear-estoque-produtos-cols'
const COL_DEFAULTS_P = {
  localizacao: true,
  custo: true,
  preco: true,
  abc: true,
  cobertura: false,
  margem: false,
}
type ColIdP = keyof typeof COL_DEFAULTS_P
const COL_LABELS_P: Record<ColIdP, string> = {
  localizacao: 'Localização',
  custo: 'Custo Médio',
  preco: 'Preço Venda',
  abc: 'ABC',
  cobertura: 'Cobertura',
  margem: 'Margem',
}

function loadColVisP(): typeof COL_DEFAULTS_P {
  try {
    const s = localStorage.getItem(PROD_COLS_KEY)
    return s ? { ...COL_DEFAULTS_P, ...JSON.parse(s) } : { ...COL_DEFAULTS_P }
  } catch { return { ...COL_DEFAULTS_P } }
}

export default function EstoqueProdutosTable({ toast, onNovoProduto, onEditar, onMovimentar }: Props) {
  const [search, setSearch] = useState(() => { try { return localStorage.getItem(FILTER_KEY + '-search') ?? '' } catch { return '' } })
  const [filtros, setFiltros] = useState<Record<string, unknown>>(loadProdutoFilters)
  const [openFilter, setOpenFilter] = useState<{ key: string; rect: DOMRect } | null>(null)
  const [mostrarInativos, setMostrarInativos] = useState(false)
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<{ key: SortKeyP; dir: 'asc' | 'desc' }>(() => {
    try {
      const s = localStorage.getItem(SORT_KEY_P)
      return s ? JSON.parse(s) : { key: 'nome', dir: 'asc' }
    } catch { return { key: 'nome', dir: 'asc' } }
  })
  const [colVis, setColVis] = useState<typeof COL_DEFAULTS_P>(loadColVisP)
  const [colMenuOpen, setColMenuOpen] = useState(false)
  const colMenuRef = useRef<HTMLDivElement>(null)

  const { data: produtos = [], isLoading } = useEstoqueProdutos({ includeInactive: mostrarInativos })
  const { data: localizacoes = [] } = useEstoqueLocalizacoes()
  const deactivate = useDeactivateEstoqueProduto()
  const { data: coberturaRows = [] } = useCoberturaEstoque()

  useEffect(() => {
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(filtros))
      localStorage.setItem(FILTER_KEY + '-search', search)
    } catch { /* noop */ }
  }, [filtros, search])

  useEffect(() => { setPage(1) }, [search, filtros])

  useEffect(() => {
    try { localStorage.setItem(SORT_KEY_P, JSON.stringify(sort)) }
    catch { /* noop */ }
  }, [sort])

  useEffect(() => {
    try { localStorage.setItem(PROD_COLS_KEY, JSON.stringify(colVis)) }
    catch { /* noop */ }
  }, [colVis])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) {
        setColMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const coberturaMap = useMemo(() => {
    const m = new Map<string, CoberturaMargemRow>()
    for (const r of coberturaRows) m.set(r.produto_id, r)
    return m
  }, [coberturaRows])

  const unidadeOptions = useMemo(() => {
    const unique = [...new Set(produtos.map(p => p.unidade))].sort()
    return unique.map(u => ({ value: u, label: u.toUpperCase() }))
  }, [produtos])

  const localizacaoOptions = useMemo(() => [
    { value: 'sem', label: 'Sem localização' },
    ...localizacoes.map(l => ({ value: l.id, label: `${l.codigo} – ${l.setor}` })),
  ], [localizacoes])

  const chipFormatMap = useMemo(() => ({
    ...BASE_CHIP_FORMAT,
    localizacao: (v: string) => {
      if (v === 'sem') return 'Sem localização'
      return localizacaoOptions.find(o => o.value === v)?.label ?? v
    },
  }), [localizacaoOptions])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return produtos.filter(p => {
      if (q && !p.nome.toLowerCase().includes(q) && !p.codigo?.toLowerCase().includes(q)) return false
      for (const [key, state] of Object.entries(filtros)) {
        if (!state) continue
        if (Array.isArray(state) && state.length === 0) continue
        if (!applyFilter(key, p, state)) return false
      }
      return true
    })
  }, [produtos, search, filtros])

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1
    switch (sort.key) {
      case 'nome':
        return a.nome.localeCompare(b.nome, 'pt-BR') * dir
      case 'quantidade_atual':
        return (a.quantidade_atual - b.quantidade_atual) * dir
      case 'custo_unitario':
        return ((a.custo_unitario ?? -Infinity) - (b.custo_unitario ?? -Infinity)) * dir
      case 'preco_venda':
        return ((a.preco_venda ?? -Infinity) - (b.preco_venda ?? -Infinity)) * dir
      case 'classificacao_abc': {
        const ord: Record<string, number> = { A: 0, B: 1, C: 2, sem_dados: 3 }
        return ((ord[a.classificacao_abc ?? 'sem_dados'] ?? 3) - (ord[b.classificacao_abc ?? 'sem_dados'] ?? 3)) * dir
      }
      default: return 0
    }
  }), [filtered, sort])

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const paginated  = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function getExportRows() {
    return sorted.map(p => ({
      'Nome': p.nome,
      'SKU': p.codigo ?? '',
      'Categoria': p.estoque_categorias?.nome ?? '',
      'Tipo': p.estoque_categorias?.tipo ?? '',
      'Localização': p.localizacao?.codigo ?? '',
      'Estoque Atual': p.quantidade_atual,
      'Estoque Mín': p.quantidade_minima ?? '',
      'Custo Unitário': p.custo_unitario ?? '',
      'Preço Venda': p.preco_venda ?? '',
      'Unidade': p.unidade,
      'ABC': p.classificacao_abc ?? '',
      'Ativo': p.ativo ? 'Sim' : 'Não',
    }))
  }

  function setFiltro(col: string, val: unknown) {
    setFiltros(prev => ({ ...prev, [col]: val }))
  }

  function handleRemoveChip(colKey: string, value?: string) {
    if (value !== undefined) {
      const current = (filtros[colKey] as string[]) ?? []
      setFiltros(prev => ({ ...prev, [colKey]: current.filter(v => v !== value) }))
    } else {
      setFiltros(prev => { const c = { ...prev }; delete c[colKey]; return c })
    }
  }

  function colIsActive(key: string) {
    return isFilterActive(FILTER_TYPES[key] ?? 'multi', filtros[key])
  }

  function toggleFilter(key: string, e: React.MouseEvent<HTMLTableCellElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    setOpenFilter(prev => prev?.key === key ? null : { key, rect })
  }

  function toggleSort(k: SortKeyP) {
    setSort(s => s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' })
    setPage(1)
  }

  function sortIcon(k: SortKeyP) {
    if (sort.key !== k) return <ChevronsUpDown className="h-3 w-3 opacity-40" />
    return sort.dir === 'asc'
      ? <ChevronUp className="h-3 w-3 text-primary" />
      : <ChevronDown className="h-3 w-3 text-primary" />
  }

  async function handleDesativar(p: EstoqueProduto) {
    if (!window.confirm(`Desativar "${p.nome}"? O material não aparecerá mais no estoque.`)) return
    try {
      await deactivate.mutateAsync(p.id)
      toast('success', `Material "${p.nome}" desativado.`)
    } catch {
      toast('error', 'Erro ao desativar material.')
    }
  }

  return (
    <>
      {/* ── Toolbar ── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pb-2 justify-center">
        <div className={tbl.searchWrap}>
          <Search className={tbl.searchIcon} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou SKU…"
            className={cn(tbl.searchInput, 'pr-8')}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none self-center">
          <button
            type="button"
            role="switch"
            aria-checked={mostrarInativos}
            onClick={() => setMostrarInativos(v => !v)}
            className={cn(
              'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
              mostrarInativos ? 'bg-primary' : 'bg-muted-foreground/30',
            )}
          >
            <span className={cn(
              'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
              mostrarInativos ? 'translate-x-[18px]' : 'translate-x-0.5',
            )} />
          </button>
          <span className="text-sm text-muted-foreground">Mostrar inativos</span>
        </label>
        <div className="flex items-center gap-1">
          {/* Column visibility */}
          <div className="relative" ref={colMenuRef}>
            <button
              onClick={() => setColMenuOpen(v => !v)}
              title="Colunas visíveis"
              className={cn(
                'flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all',
                colMenuOpen
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Columns className="h-3.5 w-3.5" /> Colunas
            </button>
            {colMenuOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 rounded-xl border bg-popover shadow-lg p-2 flex flex-col gap-0.5 min-w-[160px]">
                {(Object.keys(COL_DEFAULTS_P) as ColIdP[]).map(id => (
                  <label key={id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted cursor-pointer text-xs select-none">
                    <input
                      type="checkbox"
                      checked={colVis[id]}
                      onChange={() => setColVis(v => ({ ...v, [id]: !v[id] }))}
                      className="rounded"
                    />
                    {COL_LABELS_P[id]}
                  </label>
                ))}
              </div>
            )}
          </div>
          {/* Export */}
          <button onClick={() => exportCsv(`materiais-${Date.now()}.csv`, getExportRows())}
            disabled={sorted.length === 0}
            className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-all disabled:opacity-40"
            title={`Exportar ${sorted.length} materiais como CSV`}>
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
          <button onClick={() => exportXlsx(`materiais-${Date.now()}.xlsx`, getExportRows())}
            disabled={sorted.length === 0}
            className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-all disabled:opacity-40"
            title={`Exportar ${sorted.length} materiais como XLSX`}>
            <Download className="h-3.5 w-3.5" /> XLSX
          </button>
        </div>
        <button onClick={onNovoProduto} className={cn(tbl.addBtn, 'w-full sm:w-auto justify-center')}>
          <Plus className="h-4 w-4" />
          Novo material
        </button>
      </div>

      {/* ── Chips ── */}
      <FiltrosAtivosChips
        filtros={filtros}
        filterTypes={FILTER_TYPES}
        labels={CHIP_LABELS}
        formatLabel={chipFormatMap}
        onRemove={handleRemoveChip}
        onClearAll={() => setFiltros({})}
      />

      {/* ── Tabela ── */}
      <div className={tbl.container}>
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm" style={{ minWidth: '960px' }}>
            <thead>
              <tr className={tbl.theadRow}>
                {/* SKU */}
                <th className={cn(tbl.th, 'pl-6')}>SKU</th>

                {/* Nome — sortable */}
                <th
                  onClick={() => toggleSort('nome')}
                  className={cn(tbl.th, 'cursor-pointer select-none hover:bg-muted/40 transition-colors')}
                  title="Ordenar por nome"
                >
                  <span className="flex items-center gap-1">Nome {sortIcon('nome')}</span>
                </th>

                {/* Tipo */}
                <th
                  className={cn(tbl.th, 'cursor-pointer hover:bg-muted/60 select-none group hidden md:table-cell')}
                  onClick={(e) => toggleFilter('tipo', e)}
                >
                  <FiltroHeader label="Tipo" active={colIsActive('tipo')} />
                  <FilterPopover open={openFilter?.key === 'tipo'} anchorRect={openFilter?.key === 'tipo' ? openFilter.rect : null}
                    label="Tipo" filterType="multi" options={TIPO_OPTIONS}
                    value={filtros['tipo'] ?? []} onChange={(v) => setFiltro('tipo', v)} onClose={() => setOpenFilter(null)} />
                </th>

                {/* Unidade */}
                <th
                  className={cn(tbl.th, 'cursor-pointer hover:bg-muted/60 select-none group hidden lg:table-cell')}
                  onClick={(e) => toggleFilter('unidade', e)}
                >
                  <FiltroHeader label="Unidade" active={colIsActive('unidade')} />
                  <FilterPopover open={openFilter?.key === 'unidade'} anchorRect={openFilter?.key === 'unidade' ? openFilter.rect : null}
                    label="Unidade" filterType="multi" options={unidadeOptions}
                    value={filtros['unidade'] ?? []} onChange={(v) => setFiltro('unidade', v)} onClose={() => setOpenFilter(null)} />
                </th>

                {/* Estoque atual — filter + sort */}
                <th
                  className={cn(tbl.th, 'cursor-pointer hover:bg-muted/60 select-none group')}
                  onClick={(e) => toggleFilter('estoque_atual', e)}
                >
                  <div className="flex items-center justify-between gap-0.5 w-full">
                    <span className="flex-1 text-left">Estoque atual</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleSort('quantidade_atual') }}
                      className="shrink-0 rounded p-0.5 hover:bg-primary/10 transition-colors"
                      title="Ordenar por estoque"
                    >
                      {sortIcon('quantidade_atual')}
                    </button>
                    <Filter className={cn('h-3 w-3 shrink-0 transition-colors',
                      colIsActive('estoque_atual') ? 'text-primary fill-primary/30' : 'text-muted-foreground/30 group-hover:text-muted-foreground/60'
                    )} />
                  </div>
                  <FilterPopover open={openFilter?.key === 'estoque_atual'} anchorRect={openFilter?.key === 'estoque_atual' ? openFilter.rect : null}
                    label="Estoque atual" filterType="range"
                    rangeOpts={{ showApenasZerados: true, apenasZeradosLabel: 'Apenas valor zero' }}
                    value={filtros['estoque_atual'] ?? {}} onChange={(v) => setFiltro('estoque_atual', v)} onClose={() => setOpenFilter(null)} />
                </th>

                {/* Localização — optional + filter */}
                {colVis.localizacao && (
                  <th
                    className={cn(tbl.th, 'cursor-pointer hover:bg-muted/60 select-none group hidden lg:table-cell')}
                    onClick={(e) => toggleFilter('localizacao', e)}
                  >
                    <FiltroHeader label="Localização" active={colIsActive('localizacao')} />
                    <FilterPopover open={openFilter?.key === 'localizacao'} anchorRect={openFilter?.key === 'localizacao' ? openFilter.rect : null}
                      label="Localização" filterType="multi" options={localizacaoOptions}
                      value={filtros['localizacao'] ?? []} onChange={(v) => setFiltro('localizacao', v)} onClose={() => setOpenFilter(null)} />
                  </th>
                )}

                {/* Custo médio — optional + filter + sort */}
                {colVis.custo && (
                  <th
                    className={cn(tbl.th, 'cursor-pointer hover:bg-muted/60 select-none group hidden xl:table-cell')}
                    onClick={(e) => toggleFilter('custo_medio', e)}
                  >
                    <div className="flex items-center justify-between gap-0.5 w-full">
                      <span className="flex-1 text-left">Custo médio</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleSort('custo_unitario') }}
                        className="shrink-0 rounded p-0.5 hover:bg-primary/10 transition-colors"
                        title="Ordenar por custo"
                      >
                        {sortIcon('custo_unitario')}
                      </button>
                      <Filter className={cn('h-3 w-3 shrink-0 transition-colors',
                        colIsActive('custo_medio') ? 'text-primary fill-primary/30' : 'text-muted-foreground/30 group-hover:text-muted-foreground/60'
                      )} />
                    </div>
                    <FilterPopover open={openFilter?.key === 'custo_medio'} anchorRect={openFilter?.key === 'custo_medio' ? openFilter.rect : null}
                      label="Custo médio" hint="Custo Médio Ponderado — atualizado a cada nova entrada." filterType="range"
                      rangeOpts={{ showIncluirVazios: true, incluirVaziosLabel: 'Incluir sem custo definido' }}
                      value={filtros['custo_medio'] ?? {}} onChange={(v) => setFiltro('custo_medio', v)} onClose={() => setOpenFilter(null)} />
                  </th>
                )}

                {/* Preço venda — optional + filter + sort */}
                {colVis.preco && (
                  <th
                    className={cn(tbl.th, 'cursor-pointer hover:bg-muted/60 select-none group hidden xl:table-cell')}
                    onClick={(e) => toggleFilter('preco_venda', e)}
                  >
                    <div className="flex items-center justify-between gap-0.5 w-full">
                      <span className="flex-1 text-left">Preço venda</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleSort('preco_venda') }}
                        className="shrink-0 rounded p-0.5 hover:bg-primary/10 transition-colors"
                        title="Ordenar por preço"
                      >
                        {sortIcon('preco_venda')}
                      </button>
                      <Filter className={cn('h-3 w-3 shrink-0 transition-colors',
                        colIsActive('preco_venda') ? 'text-primary fill-primary/30' : 'text-muted-foreground/30 group-hover:text-muted-foreground/60'
                      )} />
                    </div>
                    <FilterPopover open={openFilter?.key === 'preco_venda'} anchorRect={openFilter?.key === 'preco_venda' ? openFilter.rect : null}
                      label="Preço venda" filterType="range"
                      rangeOpts={{ showIncluirVazios: true, incluirVaziosLabel: 'Incluir sem preço definido' }}
                      value={filtros['preco_venda'] ?? {}} onChange={(v) => setFiltro('preco_venda', v)} onClose={() => setOpenFilter(null)} />
                  </th>
                )}

                {/* ABC — optional + filter + sort */}
                {colVis.abc && (
                  <th
                    className={cn(tbl.th, 'cursor-pointer hover:bg-muted/60 select-none group hidden sm:table-cell')}
                    onClick={(e) => toggleFilter('abc', e)}
                  >
                    <div className="flex items-center justify-between gap-0.5 w-full">
                      <span className="flex-1 text-left">ABC</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleSort('classificacao_abc') }}
                        className="shrink-0 rounded p-0.5 hover:bg-primary/10 transition-colors"
                        title="Ordenar por classe ABC"
                      >
                        {sortIcon('classificacao_abc')}
                      </button>
                      <Filter className={cn('h-3 w-3 shrink-0 transition-colors',
                        colIsActive('abc') ? 'text-primary fill-primary/30' : 'text-muted-foreground/30 group-hover:text-muted-foreground/60'
                      )} />
                    </div>
                    <FilterPopover open={openFilter?.key === 'abc'} anchorRect={openFilter?.key === 'abc' ? openFilter.rect : null}
                      label="ABC" hint="Classificação de Pareto — A=80% da receita, B=15%, C=5%." filterType="multi" options={ABC_OPTIONS}
                      value={filtros['abc'] ?? []} onChange={(v) => setFiltro('abc', v)} onClose={() => setOpenFilter(null)} />
                  </th>
                )}

                {/* Cobertura — optional */}
                {colVis.cobertura && (
                  <th className={cn(tbl.th, 'text-center hidden xl:table-cell')}>Cobertura</th>
                )}

                {/* Margem — optional */}
                {colVis.margem && (
                  <th className={cn(tbl.th, 'text-center hidden xl:table-cell')}>Margem</th>
                )}

                {/* Ações */}
                <th className={cn(tbl.th, 'pr-6 border-r-0')}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={12} className="px-4 py-4">
                    <div className="flex flex-col gap-2">
                      {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-14 rounded-lg skeleton-shimmer" />)}
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-6 py-12 text-center">
                    <Package className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm font-medium text-muted-foreground">
                      {search ? 'Nenhum material encontrado' : 'Nenhum material cadastrado ainda'}
                    </p>
                    {!search && Object.keys(filtros).length === 0 && (
                      <button
                        onClick={onNovoProduto}
                        className="mt-3 rounded-xl bg-brand-gradient px-4 py-2 text-sm font-semibold text-white shadow-brand hover:opacity-90 active:scale-95 transition-all"
                      >
                        + Novo material
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                paginated.map(p => {
                  const abc = p.classificacao_abc ?? 'sem_dados'
                  const inativo = !p.ativo
                  return (
                    <tr key={p.id} className={cn(tbl.tbodyRow, inativo && 'opacity-50')}>
                      <td className={cn(tbl.td, 'pl-6 font-mono text-xs text-muted-foreground whitespace-nowrap')}>
                        {p.codigo ?? '—'}
                      </td>
                      <td className={tbl.td}>
                        <div className="flex items-center justify-center gap-2">
                          <span className="font-medium text-foreground">{p.nome}</span>
                          {inativo && (
                            <span className="rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                              Inativo
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={cn(tbl.td, 'text-muted-foreground hidden md:table-cell')}>
                        {TIPOS_PRODUTO[p.estoque_categorias?.tipo ?? ''] ?? '—'}
                      </td>
                      <td className={cn(tbl.td, 'text-muted-foreground uppercase hidden lg:table-cell')}>
                        {p.unidade}
                      </td>
                      <td className={cn(tbl.td, 'text-center font-semibold whitespace-nowrap')}>
                        {p.quantidade_atual.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                        <span className="ml-1 text-xs font-normal text-muted-foreground/60">{p.unidade}</span>
                      </td>
                      {colVis.localizacao && (
                        <td className={cn(tbl.td, 'font-mono text-xs text-muted-foreground hidden lg:table-cell whitespace-nowrap')}>
                          {p.localizacao?.codigo ?? <span className="text-muted-foreground/40">—</span>}
                        </td>
                      )}
                      {colVis.custo && (
                        <td className={cn(tbl.td, 'text-center whitespace-nowrap hidden xl:table-cell')}>
                          {p.custo_unitario != null ? formatCurrency(p.custo_unitario) : <span className="text-muted-foreground/60">—</span>}
                        </td>
                      )}
                      {colVis.preco && (
                        <td className={cn(tbl.td, 'text-center whitespace-nowrap hidden xl:table-cell')}>
                          {p.preco_venda != null ? formatCurrency(p.preco_venda) : <span className="text-muted-foreground/60">—</span>}
                        </td>
                      )}
                      {colVis.abc && (
                        <td className={cn(tbl.td, 'text-center hidden sm:table-cell')}>
                          {abc === 'sem_dados' ? '—' : abc}
                        </td>
                      )}
                      {colVis.cobertura && (
                        <td className={cn(tbl.td, 'text-center whitespace-nowrap hidden xl:table-cell')}>
                          {(() => {
                            const dias = coberturaMap.get(p.id)?.cobertura_dias ?? null
                            return dias !== null
                              ? <span className="tabular-nums">{dias.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}<span className="ml-1 text-xs text-muted-foreground/60">d</span></span>
                              : <span className="text-muted-foreground/40">—</span>
                          })()}
                        </td>
                      )}
                      {colVis.margem && (
                        <td className={cn(tbl.td, 'text-center whitespace-nowrap hidden xl:table-cell')}>
                          {(() => {
                            const margem = coberturaMap.get(p.id)?.margem_percentual ?? null
                            if (margem === null) return <span className="text-muted-foreground/40">—</span>
                            const cor = margem < 0 ? 'text-red-600' : margem < 20 ? 'text-amber-600' : 'text-green-700 dark:text-green-400'
                            return <span className={cn('tabular-nums font-medium', cor)}>{margem.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span>
                          })()}
                        </td>
                      )}
                      <td className={cn(tbl.actionTd, 'pr-6')}>
                        <div className={cn(tbl.actionGroup, 'justify-center')}>
                          <ActionBtn icon={<TrendingUp className="h-4 w-4" />} label="Registrar entrada"
                            className="hover:text-primary hover:bg-primary/10" onClick={() => onMovimentar(p, 'entrada')} />
                          <ActionBtn icon={<Pencil className="h-4 w-4" />} label="Editar"
                            className="hover:text-foreground hover:bg-muted/60" onClick={() => onEditar(p)} />
                          {p.ativo && (
                            <ActionBtn icon={<PackageX className="h-4 w-4" />} label="Desativar"
                              className="hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30" onClick={() => handleDesativar(p)} />
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr className={tbl.tfootRow}>
                  <td colSpan={12} className={cn(tbl.tfootCell, 'pl-6')}>
                    <div className="flex items-center justify-between gap-4">
                      <span>
                        {sorted.length > PAGE_SIZE
                          ? <>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} de {sorted.length} {sorted.length !== 1 ? 'materiais' : 'material'}{sorted.length < produtos.length ? <> <span className="text-muted-foreground/50">(de {produtos.length} total)</span></> : null}</>
                          : sorted.length < produtos.length
                            ? <>{sorted.length} <span className="text-muted-foreground/50">de {produtos.length}</span> {sorted.length !== 1 ? 'materiais' : 'material'}</>
                            : <>Total — {sorted.length} {sorted.length !== 1 ? 'materiais' : 'material'}</>
                        }
                      </span>
                      {totalPages > 1 && (
                        <div className="flex items-center gap-2 text-xs">
                          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                            className="rounded px-2 py-1 hover:bg-muted disabled:opacity-40 transition-colors">← Ant</button>
                          <span className="text-muted-foreground">{page} / {totalPages}</span>
                          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                            className="rounded px-2 py-1 hover:bg-muted disabled:opacity-40 transition-colors">Próx →</button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FiltroHeader({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center justify-between gap-1.5 w-full">
      <span>{label}</span>
      <Filter className={cn(
        'h-3 w-3 shrink-0 transition-colors',
        active ? 'text-primary fill-primary/30' : 'text-muted-foreground/30 group-hover:text-muted-foreground/60',
      )} />
    </div>
  )
}

function ActionBtn({ icon, label, onClick, className }: {
  icon: React.ReactNode; label: string; onClick: () => void; className?: string
}) {
  return (
    <button title={label} onClick={onClick}
      className={cn('rounded-lg h-8 w-8 p-0 flex items-center justify-center text-muted-foreground/60 transition-colors', className)}>
      {icon}
    </button>
  )
}
