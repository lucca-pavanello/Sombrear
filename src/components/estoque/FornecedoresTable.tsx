import { useState, useMemo, useEffect } from 'react'
import { Search, Plus, Pencil, Truck, Filter, Download, ChevronUp, ChevronDown, ChevronsUpDown, Phone, Mail, MessageCircle } from 'lucide-react'
import { exportCsv, exportXlsx } from '@/lib/exportUtils'
import { cn } from '@/lib/utils'
import { useEstoqueFornecedores, useUpdateFornecedor } from '@/hooks/useEstoqueFornecedores'
import { useAllFornecedorCategorias } from '@/hooks/useFornecedorCategorias'
import { useAllFornecedorDescontos } from '@/hooks/useFornecedorDescontos'
import NovoFornecedorForm from './NovoFornecedorForm'
import { tbl } from './shared/tableStyles'
import { FilterPopover, isFilterActive } from './shared/FilterPopover'
import { FiltrosAtivosChips } from './shared/FiltrosAtivosChips'
import type { RangeState } from './shared/FilterPopover'
import type { EstoqueFornecedor, FornecedorCategoria, FornecedorDescontoCombo } from '@/lib/supabase'
import type { ToastType } from '@/hooks/useToast'

const FILTER_TYPES: Record<string, 'multi' | 'range' | 'text'> = {
  prazo_entrega: 'range',
}

const CHIP_LABELS: Record<string, string> = {
  prazo_entrega: 'Prazo entrega',
}

interface Props {
  toast: (type: ToastType, message: string) => void
}

const PAGE_SIZE = 50

const FILTER_KEY = 'sombrear-estoque-fornecedores-filtros'
function loadFornecedorFilters() {
  try { const s = localStorage.getItem(FILTER_KEY); return s ? JSON.parse(s) : {} } catch { return {} }
}

const SORT_KEY_F = 'sombrear-estoque-fornecedores-sort'
type SortKeyF = 'nome' | 'prazo_entrega_dias'

const COLS = 8

const NOME_TIPO: Record<string, string> = { Tecido: 'Tecido', Ferragem: 'Ferragem', Acessorio: 'Acessório' }
const nomeTipo = (t: string) => NOME_TIPO[t] ?? t

function dinheiro(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function linkWhatsApp(tel: string): string | null {
  const d = tel.replace(/\D/g, '')
  if (d.length < 10 || d.length > 13) return null
  return `https://wa.me/${d.length <= 11 ? '55' + d : d}`
}

const traco = <span className="text-muted-foreground/40">—</span>

/** Monta o conteúdo de cada coluna uma vez, para a tabela (desktop) e os cartões (celular). */
function celulas(f: EstoqueFornecedor, cats: FornecedorCategoria[], descontos: FornecedorDescontoCombo[]) {
  const catsAtivas = cats.filter(c => c.ativo !== false)
  const wa = f.telefone ? linkWhatsApp(f.telefone) : null

  const nome = (
    <>
      <p className={cn('font-semibold', f.ativo ? 'text-foreground' : 'text-muted-foreground line-through')}>{f.nome}</p>
      {!f.ativo && <p className="text-[11px] text-muted-foreground">inativo</p>}
      {f.cnpj && <p className="font-mono text-[11px] text-muted-foreground">{f.cnpj}</p>}
    </>
  )

  const contato = (f.contato || f.telefone || f.email) ? (
    <div className="space-y-0.5 text-xs">
      {f.contato && <p className="font-medium text-foreground">{f.contato}</p>}
      {f.telefone && (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <Phone className="h-3 w-3 shrink-0" />
          <a href={`tel:${f.telefone.replace(/[^\d+]/g, '')}`} className="hover:text-foreground hover:underline">{f.telefone}</a>
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" title="Abrir no WhatsApp" aria-label="Abrir no WhatsApp"
              className="text-emerald-600 hover:text-emerald-700"><MessageCircle className="h-3.5 w-3.5" /></a>
          )}
        </p>
      )}
      {f.email && (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <Mail className="h-3 w-3 shrink-0" />
          <a href={`mailto:${f.email}`} className="truncate hover:text-foreground hover:underline">{f.email}</a>
        </p>
      )}
    </div>
  ) : traco

  const prazo = catsAtivas.length > 0 ? (
    <div className="flex flex-wrap gap-1">
      {catsAtivas.map(c => (
        <span key={c.id} className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-foreground/80 whitespace-nowrap">
          {nomeTipo(c.tipo_produto)} <span className="font-semibold tabular-nums">{c.lead_time_dias}d</span>
        </span>
      ))}
    </div>
  ) : f.prazo_entrega_dias != null ? (
    <span className="text-xs text-muted-foreground">
      <span className="font-semibold text-foreground/80 tabular-nums">{f.prazo_entrega_dias}d</span> (geral)
    </span>
  ) : traco

  const pgto = catsAtivas.filter(c => c.prazo_pagamento_dias != null)
  const pagamento = pgto.length === 0 ? traco
    : new Set(pgto.map(c => c.prazo_pagamento_dias)).size === 1 && pgto.length === catsAtivas.length
      ? <span className="text-xs font-medium tabular-nums">{pgto[0].prazo_pagamento_dias} dias</span>
      : (
        <div className="flex flex-wrap gap-1">
          {pgto.map(c => (
            <span key={c.id} className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-foreground/80 whitespace-nowrap">
              {nomeTipo(c.tipo_produto)} <span className="font-semibold tabular-nums">{c.prazo_pagamento_dias}d</span>
            </span>
          ))}
        </div>
      )

  const descontoCell = descontos.length === 0 ? traco : (
    <ul className="space-y-1 text-xs">
      {descontos.slice(0, 2).map(d => (
        <li key={d.id} className="text-foreground/80">
          <span className="font-semibold text-amber-700 dark:text-amber-400 tabular-nums">{d.percentual_desconto}%</span>
          {d.valor_minimo_pedido ? ` acima de ${dinheiro(Number(d.valor_minimo_pedido))}` : ''}
          {' em '}{d.categorias_combo.map(nomeTipo).join('+')}
        </li>
      ))}
      {descontos.length > 2 && <li className="text-muted-foreground">+ {descontos.length - 2} mais (editar para ver)</li>}
    </ul>
  )

  const obs = f.observacoes
    ? <p className="line-clamp-2 text-xs text-muted-foreground" title={f.observacoes}>{f.observacoes}</p>
    : traco

  return { nome, contato, prazo, pagamento, desconto: descontoCell, obs }
}

export default function FornecedoresTable({ toast }: Props) {
  const [search, setSearch] = useState(() => { try { return localStorage.getItem(FILTER_KEY + '-search') ?? '' } catch { return '' } })
  const [filtros, setFiltros] = useState<Record<string, unknown>>(loadFornecedorFilters)
  const [openFilter, setOpenFilter] = useState<{ key: string; rect: DOMRect } | null>(null)
  const [mostrarInativos, setMostrarInativos] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editando, setEditando] = useState<EstoqueFornecedor | null>(null)
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<{ key: SortKeyF; dir: 'asc' | 'desc' }>(() => {
    try {
      const s = localStorage.getItem(SORT_KEY_F)
      return s ? JSON.parse(s) : { key: 'nome', dir: 'asc' }
    } catch { return { key: 'nome', dir: 'asc' } }
  })

  const { data: fornecedores = [], isLoading } = useEstoqueFornecedores({ includeInactive: mostrarInativos })
  const { data: categoriasMap = {} } = useAllFornecedorCategorias()
  const { data: descontosMap = {} } = useAllFornecedorDescontos()
  const updateMutation = useUpdateFornecedor()

  useEffect(() => { setPage(1) }, [search, filtros])

  useEffect(() => {
    try { localStorage.setItem(SORT_KEY_F, JSON.stringify(sort)) }
    catch { /* noop */ }
  }, [sort])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return fornecedores
      .filter(f =>
        !q ||
        f.nome.toLowerCase().includes(q) ||
        (f.contato?.toLowerCase().includes(q) ?? false) ||
        (f.cnpj?.includes(q) ?? false),
      )
      .filter(f => {
        const state = filtros['prazo_entrega'] as RangeState | undefined
        if (!state) return true
        const { min, max, apenasZerados, incluirVazios } = state
        const hasMin = min !== '' && min !== undefined
        const hasMax = max !== '' && max !== undefined
        const isActive = hasMin || hasMax || apenasZerados
        if (!isActive) return true

        const dias = f.prazo_entrega_dias
        if (apenasZerados) return !dias || dias === 0
        if (!dias || dias === 0) return incluirVazios ?? false
        if (hasMin && dias < Number(min)) return false
        if (hasMax && dias > Number(max)) return false
        return true
      })
  }, [fornecedores, search, filtros])

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1
    if (sort.key === 'nome') return a.nome.localeCompare(b.nome, 'pt-BR') * dir
    return ((a.prazo_entrega_dias ?? -Infinity) - (b.prazo_entrega_dias ?? -Infinity)) * dir
  }), [filtered, sort])

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const paginated  = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function toggleSort(k: SortKeyF) {
    setSort(s => s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' })
    setPage(1)
  }

  function sortIcon(k: SortKeyF) {
    if (sort.key !== k) return <ChevronsUpDown className="h-3 w-3 opacity-40" />
    return sort.dir === 'asc'
      ? <ChevronUp className="h-3 w-3 text-primary" />
      : <ChevronDown className="h-3 w-3 text-primary" />
  }

  function getExportRows() {
    return filtered.map(f => ({
      'Nome': f.nome,
      'Contato': f.contato ?? '',
      'Email': f.email ?? '',
      'Telefone': f.telefone ?? '',
      'CNPJ': f.cnpj ?? '',
      'Prazo Entrega (dias)': f.prazo_entrega_dias ?? '',
      'Ativo': f.ativo ? 'Sim' : 'Não',
    }))
  }

  function setFiltro(col: string, val: unknown) {
    setFiltros(prev => ({ ...prev, [col]: val }))
  }

  function handleRemoveChip(colKey: string) {
    setFiltros(prev => { const c = { ...prev }; delete c[colKey]; return c })
  }

  function toggleFilter(key: string, e: React.MouseEvent<HTMLTableCellElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    setOpenFilter(prev => prev?.key === key ? null : { key, rect })
  }

  function handleNovo() { setEditando(null); setFormOpen(true) }
  function handleEditar(f: EstoqueFornecedor) { setEditando(f); setFormOpen(true) }

  async function handleDesativar(f: EstoqueFornecedor) {
    try {
      await updateMutation.mutateAsync({ id: f.id, ativo: false })
      toast('success', `Fornecedor "${f.nome}" removido.`)
    } catch {
      toast('error', 'Erro ao remover fornecedor.')
    }
  }

  useEffect(() => {
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(filtros))
      localStorage.setItem(FILTER_KEY + '-search', search)
    } catch { /* noop */ }
  }, [filtros, search])

  const mostrarCards = !isLoading && filtered.length > 0
  const hasFilters = Object.values(filtros).some(v => v && isFilterActive('range', v))

  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pb-3 justify-center">
        <div className={tbl.searchWrap}>
          <Search className={tbl.searchIcon} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar fornecedor por nome, contato ou CNPJ…"
            className={tbl.searchInput}
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none self-center">
          <button
            type="button" role="switch" aria-checked={mostrarInativos}
            onClick={() => setMostrarInativos(v => !v)}
            className={cn(
              'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
              mostrarInativos ? 'bg-primary' : 'bg-muted-foreground/30',
            )}
          >
            <span className={cn('inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
              mostrarInativos ? 'translate-x-[18px]' : 'translate-x-0.5')} />
          </button>
          <span className="text-sm text-muted-foreground">Mostrar inativos</span>
        </label>
        <div className="flex items-center gap-1">
          <button onClick={() => exportCsv(`fornecedores-${Date.now()}.csv`, getExportRows())}
            disabled={filtered.length === 0}
            className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-all disabled:opacity-40"
            title={`Exportar ${filtered.length} fornecedores como CSV`}>
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
          <button onClick={() => exportXlsx(`fornecedores-${Date.now()}.xlsx`, getExportRows())}
            disabled={filtered.length === 0}
            className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-all disabled:opacity-40"
            title={`Exportar ${filtered.length} fornecedores como XLSX`}>
            <Download className="h-3.5 w-3.5" /> XLSX
          </button>
        </div>
        <button onClick={handleNovo} className={cn(tbl.addBtn, 'w-full sm:w-auto justify-center')}>
          <Plus className="h-4 w-4" />
          Novo Fornecedor
        </button>
      </div>

      {/* ── Chips ── */}
      <FiltrosAtivosChips
        filtros={filtros}
        filterTypes={FILTER_TYPES}
        labels={CHIP_LABELS}
        onRemove={handleRemoveChip}
        onClearAll={() => setFiltros({})}
      />

      {/* Table */}
      <div className={tbl.container}>
        {/* Celular: um cartão por fornecedor (a tabela larga fica só do md pra cima) */}
        {mostrarCards && (
          <div className="md:hidden">
            <ul className="divide-y divide-border/60">
              {paginated.map(f => {
                const c = celulas(f, categoriasMap[f.id] ?? [], descontosMap[f.id] ?? [])
                const rot = 'mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'
                return (
                  <li key={f.id} className="space-y-2.5 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">{c.nome}</div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button onClick={() => handleEditar(f)} className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground">
                          <Pencil className="h-3.5 w-3.5" /> Editar
                        </button>
                        <button onClick={() => handleDesativar(f)} disabled={updateMutation.isPending} title="Remover" aria-label="Remover fornecedor"
                          className="rounded-md px-2 py-1.5 text-xs font-bold text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:opacity-50">✕</button>
                      </div>
                    </div>
                    <div>{c.contato}</div>
                    <div><p className={rot}>Prazo de entrega</p>{c.prazo}</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><p className={rot}>Pagamento</p>{c.pagamento}</div>
                      <div><p className={rot}>Desconto</p>{c.desconto}</div>
                    </div>
                    {f.observacoes && <div><p className={rot}>Observações</p>{c.obs}</div>}
                  </li>
                )
              })}
            </ul>
            <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
              <span>{sorted.length} fornecedor{sorted.length !== 1 ? 'es' : ''}</span>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="rounded px-2 py-1 hover:bg-muted disabled:opacity-40">← Ant</button>
                  <span>{page} / {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="rounded px-2 py-1 hover:bg-muted disabled:opacity-40">Próx →</button>
                </div>
              )}
            </div>
          </div>
        )}
        <div className="overflow-auto max-h-[70vh]">
          <table className={cn('w-full text-sm', mostrarCards && 'hidden md:table')} style={{ minWidth: '1000px' }}>
            <thead>
              <tr className={tbl.theadRow}>
                <th
                  onClick={() => toggleSort('nome')}
                  className={cn(tbl.th, 'cursor-pointer select-none hover:bg-muted/40 transition-colors')}
                  title="Ordenar por nome"
                >
                  <span className="flex items-center gap-1">Fornecedor / Contato {sortIcon('nome')}</span>
                </th>
                <th className={tbl.th}>Contato</th>
                <th
                  className={cn(tbl.th, 'cursor-pointer hover:bg-muted/60 select-none group')}
                  onClick={e => toggleFilter('prazo_entrega', e)}
                >
                  <div className="flex items-center justify-between gap-0.5 w-full">
                    <span className="flex-1 text-left">Prazo entrega</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleSort('prazo_entrega_dias') }}
                      className="shrink-0 rounded p-0.5 hover:bg-primary/10 transition-colors"
                      title="Ordenar por prazo"
                    >
                      {sortIcon('prazo_entrega_dias')}
                    </button>
                    <Filter className={cn('h-3 w-3 shrink-0 transition-colors',
                      isFilterActive('range', filtros['prazo_entrega'])
                        ? 'text-primary fill-primary/30'
                        : 'text-muted-foreground/30 group-hover:text-muted-foreground/60'
                    )} />
                  </div>
                  <FilterPopover
                    open={openFilter?.key === 'prazo_entrega'}
                    anchorRect={openFilter?.key === 'prazo_entrega' ? openFilter.rect : null}
                    label="Prazo entrega" hint="Dias corridos até a entrega do pedido."
                    filterType="range"
                    rangeOpts={{ showIncluirVazios: true, incluirVaziosLabel: 'Incluir sem prazo definido' }}
                    value={filtros['prazo_entrega'] ?? {}}
                    onChange={v => setFiltro('prazo_entrega', v)}
                    onClose={() => setOpenFilter(null)}
                  />
                </th>
                <th className={tbl.th}>Pagamento</th>
                <th className={tbl.th}>Desconto</th>
                <th className={tbl.th}>Observações</th>
                <th className={cn(tbl.th, 'border-r-0')}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={COLS} className="px-4 py-4">
                    <div className="flex flex-col gap-2">
                      {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-14 rounded-lg skeleton-shimmer" />)}
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={COLS} className="px-4 py-12 text-center">
                    <Truck className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm font-medium text-muted-foreground">
                      {search || hasFilters ? 'Nenhum fornecedor com esse filtro. Tente outra combinação.' : 'Nenhum fornecedor cadastrado'}
                    </p>
                    {!search && !hasFilters && (
                      <button
                        onClick={handleNovo}
                        className="mt-3 rounded-xl bg-brand-gradient px-4 py-2 text-sm font-semibold text-white shadow-brand hover:opacity-90 active:scale-95 transition-all"
                      >
                        + Novo Fornecedor
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                paginated.map(f => {
                  const c = celulas(f, categoriasMap[f.id] ?? [], descontosMap[f.id] ?? [])
                  return (
                    <tr key={f.id} className={cn(tbl.tbodyRow, 'align-top')}>
                      <td className={tbl.td}>{c.nome}</td>
                      <td className={tbl.td}>{c.contato}</td>
                      <td className={tbl.td}>{c.prazo}</td>
                      <td className={tbl.td}>{c.pagamento}</td>
                      <td className={tbl.td}>{c.desconto}</td>
                      <td className={cn(tbl.td, 'max-w-[220px]')}>{c.obs}</td>
                      <td className={tbl.actionTd}>
                        <div className={cn(tbl.actionGroup, 'justify-center')}>
                          <button onClick={() => handleEditar(f)} title="Editar"
                            className={cn(tbl.actionBtn, 'hover:text-foreground hover:bg-muted/60')}>
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button onClick={() => handleDesativar(f)} title="Remover"
                            disabled={updateMutation.isPending}
                            className={cn(tbl.actionBtn, 'hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50')}>
                            <span className="text-xs font-bold leading-none">✕</span>
                          </button>
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
                  <td colSpan={COLS} className={tbl.tfootCell}>
                    <div className="flex items-center justify-between gap-4">
                      <span>
                        {sorted.length > PAGE_SIZE
                          ? <>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} de {sorted.length} fornecedor{sorted.length !== 1 ? 'es' : ''}{sorted.length < fornecedores.length ? <> <span className="text-muted-foreground/50">(de {fornecedores.length} total)</span></> : null}</>
                          : sorted.length < fornecedores.length
                            ? <>{sorted.length} <span className="text-muted-foreground/50">de {fornecedores.length}</span> fornecedor{sorted.length !== 1 ? 'es' : ''}</>
                            : <>Total — {sorted.length} fornecedor{sorted.length !== 1 ? 'es' : ''}</>
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

      <NovoFornecedorForm open={formOpen} onClose={() => setFormOpen(false)} toast={toast} editando={editando} />
    </>
  )
}
