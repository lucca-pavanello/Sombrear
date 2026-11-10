import React, { useState, useMemo, useEffect } from 'react'
import {
  Search, Plus, Pencil, ChevronUp, ChevronDown, ChevronsUpDown, Filter,
  Download, Scissors, Check, Bookmark, RotateCcw, Ruler, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { tbl } from './shared/tableStyles'
import { FilterPopover, isFilterActive, type RangeState } from './shared/FilterPopover'
import { FiltrosAtivosChips } from './shared/FiltrosAtivosChips'
import { exportCsv } from '@/lib/exportUtils'
import {
  useEstoqueSobras, useDefinirStatusSobra, STATUS_SOBRA, nomeSobra,
  type EstoqueSobra,
} from '@/hooks/useEstoqueSobras'
import NovaSobraForm from './NovaSobraForm'

interface Props {
  toast: (type: 'success' | 'error' | 'info', message: string, opts?: { duration?: number; undoAction?: () => void }) => void
}

const FILTER_TYPES: Record<string, 'multi' | 'range' | 'text'> = {
  familia: 'multi',
  abertura: 'multi',
  cor: 'multi',
  status: 'multi',
  largura_m: 'range',
  altura_m: 'range',
  area_m2: 'range',
}

const CHIP_LABELS: Record<string, string> = {
  familia: 'Tecido',
  abertura: 'Abertura',
  cor: 'Cor',
  status: 'Situação',
  largura_m: 'Largura',
  altura_m: 'Altura',
  area_m2: 'Área',
}

const PAGE_SIZE = 50
/** Rótulo do botão de ação: só do desktop pra cima; no celular fica só o ícone. */
const ROT_ACAO = 'hidden text-xs font-medium lg:inline'
const FILTER_KEY = 'sombrear-estoque-sobras-filtros'
const SORT_KEY = 'sombrear-estoque-sobras-sort'

type SortKey = 'familia' | 'cor' | 'largura_m' | 'altura_m' | 'area_m2' | 'status'

function loadFiltros(): Record<string, unknown> {
  try { const s = localStorage.getItem(FILTER_KEY); return s ? JSON.parse(s) : {} } catch { return {} }
}

const fmt = (n: number) => n.toFixed(2).replace('.', ',')

/** Aceita "1,20" e "1.20"; vazio ou invalido = sem filtro. */
function medida(v: string): number | null {
  const n = parseFloat(v.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Sobras — peças prontas que sobraram de produção e não vão ser refeitas.
 *
 * A tela existe pra responder UMA pergunta, que é a que o vendedor faz com o cliente na
 * linha: "tenho alguma coisa pronta que sirva pra esse vão?". Por isso o filtro de faixa
 * em largura, altura e área é o recurso central daqui, não um enfeite — sem ele a pessoa
 * teria que ler 153 linhas pra achar uma peça de 1,20 x 2,30.
 *
 * Vender NÃO decrementa quantidade: cada linha é uma peça única, então vender é mudar o
 * status. Nada é apagado — a peça vendida vira histórico com a data.
 */
export default function SobrasTable({ toast }: Props) {
  const [search, setSearch] = useState(() => {
    try { return localStorage.getItem(FILTER_KEY + '-search') ?? '' } catch { return '' }
  })
  const [filtros, setFiltros] = useState<Record<string, unknown>>(loadFiltros)
  const [openFilter, setOpenFilter] = useState<{ key: string; rect: DOMRect } | null>(null)
  const [incluirVendidas, setIncluirVendidas] = useState(false)
  const [vaoL, setVaoL] = useState('')
  const [vaoA, setVaoA] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editando, setEditando] = useState<EstoqueSobra | null>(null)
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>(() => {
    try {
      const s = localStorage.getItem(SORT_KEY)
      return s ? JSON.parse(s) : { key: 'area_m2', dir: 'desc' }
    } catch { return { key: 'area_m2', dir: 'desc' } }
  })

  const { data: sobras = [], isLoading } = useEstoqueSobras({ incluirVendidas })
  const statusMutation = useDefinirStatusSobra()

  const opcoes = useMemo(() => {
    const uniq = (get: (s: EstoqueSobra) => string | null) =>
      [...new Set(sobras.map(get).filter(Boolean) as string[])].sort()
        .map(v => ({ value: v, label: v }))
    return {
      familia: uniq(s => s.familia),
      abertura: uniq(s => s.abertura),
      cor: uniq(s => s.cor),
      status: Object.entries(STATUS_SOBRA).map(([value, v]) => ({ value, label: v.rotulo })),
    }
  }, [sobras])

  useEffect(() => { setPage(1) }, [search, filtros, incluirVendidas, vaoL, vaoA])
  useEffect(() => {
    try { localStorage.setItem(SORT_KEY, JSON.stringify(sort)) } catch { /* noop */ }
  }, [sort])
  useEffect(() => {
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(filtros))
      localStorage.setItem(FILTER_KEY + '-search', search)
    } catch { /* noop */ }
  }, [filtros, search])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    const naFaixa = (valor: number, estado: RangeState | undefined) => {
      if (!estado) return true
      const { min, max } = estado
      const temMin = min !== '' && min !== undefined
      const temMax = max !== '' && max !== undefined
      if (temMin && valor < Number(min)) return false
      if (temMax && valor > Number(max)) return false
      return true
    }
    const L = medida(vaoL)
    const A = medida(vaoA)
    return sobras.filter(s => {
      // Medida do vão: só peça disponível que cubra largura E altura (medidas já são finais)
      if (L !== null || A !== null) {
        if (s.status !== 'disponivel') return false
        if (L !== null && s.largura_m < L) return false
        if (A !== null && s.altura_m < A) return false
      }
      if (q && !`${nomeSobra(s)} ${s.observacao ?? ''} ${s.origem ?? ''}`.toLowerCase().includes(q)) return false
      for (const campo of ['familia', 'cor', 'status'] as const) {
        const sel = filtros[campo] as string[] | undefined
        if (sel?.length && !sel.includes(s[campo])) return false
      }
      const ab = filtros['abertura'] as string[] | undefined
      if (ab?.length && !ab.includes(s.abertura ?? '')) return false
      if (!naFaixa(s.largura_m, filtros['largura_m'] as RangeState)) return false
      if (!naFaixa(s.altura_m, filtros['altura_m'] as RangeState)) return false
      if (!naFaixa(s.area_m2, filtros['area_m2'] as RangeState)) return false
      return true
    })
  }, [sobras, search, filtros, vaoL, vaoA])

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1
    const k = sort.key
    if (k === 'largura_m' || k === 'altura_m' || k === 'area_m2') return (a[k] - b[k]) * dir
    // texto com localeCompare pt-BR: sem isso acento ordena errado ("Ângela" depois de "Zeca")
    return String(a[k]).localeCompare(String(b[k]), 'pt-BR', { sensitivity: 'base' }) * dir
  }), [filtered, sort])

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const areaTotal = useMemo(() => sorted.reduce((s, x) => s + x.area_m2, 0), [sorted])

  function toggleSort(k: SortKey) {
    setSort(s => s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' })
    setPage(1)
  }
  function sortIcon(k: SortKey) {
    if (sort.key !== k) return <ChevronsUpDown className="h-3 w-3 opacity-40" />
    return sort.dir === 'asc'
      ? <ChevronUp className="h-3 w-3 text-primary" />
      : <ChevronDown className="h-3 w-3 text-primary" />
  }
  function setFiltro(col: string, val: unknown) { setFiltros(prev => ({ ...prev, [col]: val })) }
  function handleRemoveChip(colKey: string, value?: string) {
    if (value !== undefined) {
      const atual = (filtros[colKey] as string[]) ?? []
      setFiltros(prev => ({ ...prev, [colKey]: atual.filter(v => v !== value) }))
    } else {
      setFiltros(prev => { const c = { ...prev }; delete c[colKey]; return c })
    }
  }
  function toggleFilter(key: string, e: React.MouseEvent<HTMLTableCellElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    setOpenFilter(prev => prev?.key === key ? null : { key, rect })
  }

  async function definirStatus(s: EstoqueSobra, status: EstoqueSobra['status']) {
    try {
      const anterior = s.status
      await statusMutation.mutateAsync({ id: s.id, status })
      const msg = status === 'vendida' ? 'vendida' : status === 'reservada' ? 'reservada' : 'de volta como disponível'
      const texto = `${nomeSobra(s)} ${fmt(s.largura_m)}×${fmt(s.altura_m)} marcada como ${msg}.`
      if (status === 'vendida' || status === 'reservada') {
        toast('success', texto, {
          duration: 8000,
          undoAction: () => {
            statusMutation.mutateAsync({ id: s.id, status: anterior })
              .then(() => toast('info', `Desfeito: a peça voltou como ${STATUS_SOBRA[anterior].rotulo.toLowerCase()}.`))
              .catch(() => toast('error', 'Não consegui desfazer. Ajuste a peça manualmente.'))
          },
        })
      } else {
        toast('success', texto)
      }
    } catch {
      toast('error', 'Não consegui atualizar a peça.')
    }
  }

  /** Exporta o que está filtrado e ordenado — todas as páginas, não só a atual. */
  function linhasExport() {
    return sorted.map(s => ({
      Tecido: s.familia,
      Abertura: s.abertura ?? '',
      Cor: s.cor,
      'Largura (m)': fmt(s.largura_m),
      'Altura (m)': fmt(s.altura_m),
      'Área (m²)': fmt(s.area_m2),
      Situação: STATUS_SOBRA[s.status].rotulo,
      Observação: s.observacao ?? '',
      Origem: s.origem ?? '',
    }))
  }

  const thFiltro = (key: string, label: string, sortKey?: SortKey, tipo: 'multi' | 'range' = 'multi') => (
    <th
      className={cn(tbl.th, 'group cursor-pointer select-none hover:bg-muted/60')}
      onClick={e => toggleFilter(key, e)}
    >
      <div className="flex w-full items-center justify-between gap-0.5">
        <span className="flex-1 text-left">{label}</span>
        {sortKey && (
          <button
            onClick={e => { e.stopPropagation(); toggleSort(sortKey) }}
            className="shrink-0 rounded p-0.5 transition-colors hover:bg-primary/10"
            title={`Ordenar por ${label.toLowerCase()}`}
          >
            {sortIcon(sortKey)}
          </button>
        )}
        <Filter className={cn('h-3 w-3 shrink-0 transition-colors',
          isFilterActive(tipo, filtros[key])
            ? 'fill-primary/30 text-primary'
            : 'text-muted-foreground/30 group-hover:text-muted-foreground/60')} />
      </div>
      <FilterPopover
        open={openFilter?.key === key}
        anchorRect={openFilter?.key === key ? openFilter.rect : null}
        label={label}
        filterType={tipo}
        options={tipo === 'multi' ? (opcoes[key as keyof typeof opcoes] ?? []) : undefined}
        value={filtros[key] ?? (tipo === 'multi' ? [] : {})}
        onChange={v => setFiltro(key, v)}
        onClose={() => setOpenFilter(null)}
      />
    </th>
  )

  return (
    <div className={tbl.container}>
      <div className={tbl.toolbar}>
        <div className={tbl.searchWrap}>
          <Search className={tbl.searchIcon} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por tecido, cor ou observação…"
            aria-label="Buscar sobra"
            className={tbl.searchInput}
          />
        </div>

        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={incluirVendidas}
            onChange={e => setIncluirVendidas(e.target.checked)}
            className="h-3.5 w-3.5 accent-current"
          />
          Mostrar vendidas
        </label>

        <button
          onClick={() => exportCsv(`sobras-${new Date().toISOString().slice(0, 10)}.csv`, linhasExport())}
          disabled={!sorted.length}
          title="Baixar em CSV tudo que está filtrado"
          className="shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
        </button>

        <button
          onClick={() => { setEditando(null); setFormOpen(true) }}
          className={cn(tbl.addBtn, 'shrink-0')}
        >
          <Plus className="h-4 w-4" /> Nova sobra
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-1.5 pb-2 text-xs font-semibold text-foreground">
          <Ruler className="h-4 w-4 text-primary" aria-hidden="true" />
          Medida do vão
        </div>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Largura (m)</span>
          <input value={vaoL} onChange={e => setVaoL(e.target.value)} inputMode="decimal" placeholder="1,20" aria-label="Largura do vão em metros"
            className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" />
        </label>
        <span className="pb-2 text-muted-foreground" aria-hidden="true">×</span>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Altura (m)</span>
          <input value={vaoA} onChange={e => setVaoA(e.target.value)} inputMode="decimal" placeholder="2,30" aria-label="Altura do vão em metros"
            className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" />
        </label>
        <p className="min-w-[200px] flex-1 pb-2 text-xs text-muted-foreground">
          {medida(vaoL) !== null || medida(vaoA) !== null
            ? <>Mostrando só peças <strong className="text-foreground">disponíveis</strong> iguais ou maiores que o vão: <strong className="tabular-nums text-foreground">{sorted.length}</strong> encontrada{sorted.length !== 1 ? 's' : ''}.</>
            : 'Digite a medida do vão do cliente para ver só as peças que servem.'}
        </p>
        {(vaoL || vaoA) && (
          <button type="button" onClick={() => { setVaoL(''); setVaoA('') }}
            className="mb-2 flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-3 w-3" /> Limpar medida
          </button>
        )}
      </div>

      <FiltrosAtivosChips
        filtros={filtros}
        filterTypes={FILTER_TYPES}
        labels={CHIP_LABELS}
        onRemove={handleRemoveChip}
        onClearAll={() => setFiltros({})}
      />

      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full text-sm" style={{ minWidth: '1040px' }}>
          <thead>
            <tr className={tbl.theadRow}>
              {thFiltro('familia', 'Tecido', 'familia')}
              {thFiltro('abertura', 'Abertura')}
              {thFiltro('cor', 'Cor', 'cor')}
              {thFiltro('largura_m', 'Largura', 'largura_m', 'range')}
              {thFiltro('altura_m', 'Altura', 'altura_m', 'range')}
              {thFiltro('area_m2', 'Área', 'area_m2', 'range')}
              {thFiltro('status', 'Situação', 'status')}
              <th className={tbl.th}>Observação</th>
              <th className={cn(tbl.th, 'border-r-0')}>Ações</th>
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className={tbl.tbodyRow}>
                  <td colSpan={9} className={tbl.td}>
                    <div className="h-4 w-full animate-pulse rounded bg-muted/60" />
                  </td>
                </tr>
              ))
            ) : paginated.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center">
                  <Scissors className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
                  <p className="text-sm font-medium">
                    {sobras.length === 0 ? 'Nenhuma sobra cadastrada' : 'Nada com esse recorte'}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {sobras.length === 0
                      ? 'Cadastre as peças que sobraram pra equipe conseguir vendê-las.'
                      : 'Ajuste os filtros ou limpe o recorte para ver as outras peças.'}
                  </p>
                </td>
              </tr>
            ) : (
              paginated.map(s => (
                <tr key={s.id} className={tbl.tbodyRow}>
                  <td className={cn(tbl.td, 'font-medium')}>{s.familia}</td>
                  <td className={tbl.td}>{s.abertura ?? '—'}</td>
                  <td className={tbl.td}>{s.cor}</td>
                  <td className={cn(tbl.td, 'tabular-nums')}>{fmt(s.largura_m)}</td>
                  <td className={cn(tbl.td, 'tabular-nums')}>{fmt(s.altura_m)}</td>
                  <td className={cn(tbl.td, 'tabular-nums font-medium')}>{fmt(s.area_m2)}</td>
                  <td className={tbl.td}>
                    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold', STATUS_SOBRA[s.status].cor)}>
                      {STATUS_SOBRA[s.status].rotulo}
                    </span>
                  </td>
                  <td className={cn(tbl.td, 'max-w-[220px] truncate text-left text-xs text-muted-foreground')} title={s.observacao ?? s.origem ?? ''}>
                    {s.observacao ?? ''}
                  </td>
                  <td className={tbl.actionTd}>
                    <div className="flex items-center justify-center gap-1">
                      {s.status === 'disponivel' && (
                        <>
                          <button onClick={() => definirStatus(s, 'vendida')} title="Marcar como vendida"
                            className={cn(tbl.actionBtn, 'gap-1 lg:!w-auto lg:px-2.5 hover:bg-emerald-500/10 hover:text-emerald-600')}>
                            <Check className="h-4 w-4" /><span className={ROT_ACAO}>Vendida</span>
                          </button>
                          <button onClick={() => definirStatus(s, 'reservada')} title="Reservar"
                            className={cn(tbl.actionBtn, 'gap-1 lg:!w-auto lg:px-2.5 hover:bg-amber-500/10 hover:text-amber-600')}>
                            <Bookmark className="h-4 w-4" /><span className={ROT_ACAO}>Reservar</span>
                          </button>
                        </>
                      )}
                      {s.status !== 'disponivel' && (
                        <button onClick={() => definirStatus(s, 'disponivel')} title="Voltar para disponível"
                          className={cn(tbl.actionBtn, 'gap-1 lg:!w-auto lg:px-2.5 hover:bg-primary/10 hover:text-primary')}>
                          <RotateCcw className="h-4 w-4" /><span className={ROT_ACAO}>Disponível</span>
                        </button>
                      )}
                      <button onClick={() => { setEditando(s); setFormOpen(true) }} title="Editar"
                        className={cn(tbl.actionBtn, 'gap-1 lg:!w-auto lg:px-2.5 hover:bg-primary/10 hover:text-primary')}>
                        <Pencil className="h-4 w-4" /><span className={ROT_ACAO}>Editar</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>

          <tfoot>
            <tr className={tbl.tfootRow}>
              <td colSpan={9} className={tbl.tfootCell}>
                <div className="flex items-center justify-between gap-3">
                  <span className="normal-case">
                    {sorted.length} peça{sorted.length !== 1 ? 's' : ''} · {fmt(areaTotal)} m² no total
                    {sorted.length > PAGE_SIZE && (
                      <> · mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)}</>
                    )}
                  </span>
                  {totalPages > 1 && (
                    <span className="flex items-center gap-2 normal-case">
                      <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                        className="rounded-lg border p-1.5 transition-colors hover:bg-muted disabled:opacity-40">← Ant</button>
                      <span className="tabular-nums text-muted-foreground">{page} / {totalPages}</span>
                      <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                        className="rounded-lg border p-1.5 transition-colors hover:bg-muted disabled:opacity-40">Próx →</button>
                    </span>
                  )}
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <NovaSobraForm open={formOpen} onClose={() => setFormOpen(false)} toast={toast} editando={editando} />
    </div>
  )
}
