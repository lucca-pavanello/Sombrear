import { useState, useRef, useEffect, useCallback, useMemo, useId } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search, Check, PackageSearch } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { EstoqueProduto } from '@/lib/supabase'

/**
 * Seletor de material: chips de categoria + busca por nome/código + lista com saldo.
 * Mesmo esquema de portal/posição fixa do CustomSelect, então funciona dentro de
 * linha de tabela, de modal e no celular (painel limitado à largura da tela).
 */

const UNIDADE_LABEL: Record<string, string> = { m: 'm', m2: 'm²', un: 'un', kg: 'kg' }

export function unidadeLabel(u: string | undefined | null): string {
  return (u && UNIDADE_LABEL[u]) || u || ''
}

export function formatSaldo(p: Pick<EstoqueProduto, 'quantidade_atual' | 'unidade'>): string {
  const n = Number(p.quantidade_atual) || 0
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${unidadeLabel(p.unidade)}`
}

function semAcento(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

interface Props {
  produtos: EstoqueProduto[]
  value: string
  onChange: (id: string, produto: EstoqueProduto) => void
  placeholder?: string
  invalido?: boolean
  disabled?: boolean
  /** Mostra o saldo dentro do botão (padrão: sim). */
  mostrarSaldo?: boolean
  className?: string
}

export default function SeletorMaterial({
  produtos, value, onChange, placeholder = 'Escolher material…', invalido, disabled, mostrarSaldo = true, className,
}: Props) {
  const [open, setOpen] = useState(false)
  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState<string>('') // '' = todas
  const [focado, setFocado] = useState(0)
  const [style, setStyle] = useState<React.CSSProperties>({})

  const idBase = useId()
  const botaoRef = useRef<HTMLButtonElement>(null)
  const painelRef = useRef<HTMLDivElement>(null)
  const buscaRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const selecionado = produtos.find((p) => p.id === value)

  // Categorias que têm material, com contagem
  const categorias = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of produtos) {
      const n = p.estoque_categorias?.nome ?? 'Sem categoria'
      m.set(n, (m.get(n) ?? 0) + 1)
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
  }, [produtos])

  const filtrados = useMemo(() => {
    const q = semAcento(busca.trim())
    return produtos.filter((p) => {
      if (categoria && (p.estoque_categorias?.nome ?? 'Sem categoria') !== categoria) return false
      if (!q) return true
      return semAcento(p.nome).includes(q) || semAcento(p.codigo ?? '').includes(q)
    })
  }, [produtos, busca, categoria])

  const posicionar = useCallback(() => {
    if (!botaoRef.current) return
    const rect = botaoRef.current.getBoundingClientRect()
    const margem = 8
    const largura = Math.min(Math.max(rect.width, 340), window.innerWidth - margem * 2)
    const left = Math.max(margem, Math.min(rect.left, window.innerWidth - largura - margem))
    const alturaPainel = 400
    const abaixo = window.innerHeight - rect.bottom
    const sobe = abaixo < alturaPainel && rect.top > abaixo
    setStyle({
      position: 'fixed',
      left,
      width: largura,
      zIndex: 9999,
      maxHeight: Math.max(240, Math.min(alturaPainel, (sobe ? rect.top : abaixo) - 16)),
      boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)',
      ...(sobe ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
    })
  }, [])

  function abrir() {
    if (disabled) return
    if (!open) {
      posicionar()
      setBusca('')
      setCategoria(selecionado?.estoque_categorias?.nome ?? '')
      setFocado(0)
    }
    setOpen((v) => !v)
  }

  function escolher(p: EstoqueProduto) {
    onChange(p.id, p)
    setOpen(false)
    botaoRef.current?.focus()
  }

  useEffect(() => { if (open) requestAnimationFrame(() => buscaRef.current?.focus()) }, [open])
  useEffect(() => { setFocado(0) }, [busca, categoria])
  useEffect(() => {
    if (open) itemRefs.current[focado]?.scrollIntoView({ block: 'nearest' })
  }, [focado, open])

  useEffect(() => {
    if (!open) return
    function fora(e: MouseEvent) {
      const t = e.target as Node
      if (botaoRef.current?.contains(t) || painelRef.current?.contains(t)) return
      setOpen(false)
    }
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); botaoRef.current?.focus(); return }
      // setas/Enter só valem na busca ou na lista; num chip de categoria o Enter é do chip
      const alvo = e.target as Node | null
      const naBusca = alvo === buscaRef.current
      const naLista = alvo instanceof Element && !!alvo.closest('[role="listbox"]')
      if (!naBusca && !naLista) return
      if (e.key === 'ArrowDown') { e.preventDefault(); setFocado((i) => Math.min(i + 1, filtrados.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setFocado((i) => Math.max(i - 1, 0)) }
      if (e.key === 'Enter' && filtrados[focado]) { e.preventDefault(); escolher(filtrados[focado]) }
    }
    const reposicionar = () => posicionar()
    document.addEventListener('mousedown', fora)
    window.addEventListener('keydown', tecla, true)
    window.addEventListener('scroll', reposicionar, true)
    window.addEventListener('resize', reposicionar)
    return () => {
      document.removeEventListener('mousedown', fora)
      window.removeEventListener('keydown', tecla, true)
      window.removeEventListener('scroll', reposicionar, true)
      window.removeEventListener('resize', reposicionar)
    }
  }, [open, filtrados, focado, posicionar]) // eslint-disable-line react-hooks/exhaustive-deps

  const semSaldo = selecionado && Number(selecionado.quantidade_atual) <= 0

  return (
    <>
      <button
        ref={botaoRef}
        type="button"
        disabled={disabled}
        onClick={abrir}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'w-full min-h-10 flex items-center gap-2 rounded-md border px-3 py-1.5 text-left text-sm outline-none transition-colors',
          'bg-gray-50 dark:bg-muted/40',
          open ? 'border-orange-500 ring-1 ring-orange-500'
            : invalido ? 'border-red-400'
            : 'border-gray-200 dark:border-border hover:border-muted-foreground/40',
          disabled && 'opacity-50 cursor-not-allowed',
          className,
        )}
      >
        {selecionado ? (
          <span className="flex-1 min-w-0">
            <span className="block truncate font-medium text-foreground">{selecionado.nome}</span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {selecionado.codigo ? `${selecionado.codigo} · ` : ''}
              {selecionado.estoque_categorias?.nome ?? 'Sem categoria'}
              {mostrarSaldo && (
                <>
                  {' · '}
                  <span className={cn('font-semibold', semSaldo ? 'text-red-600' : 'text-foreground/70')}>
                    em estoque: {formatSaldo(selecionado)}
                  </span>
                </>
              )}
            </span>
          </span>
        ) : (
          <span className="flex-1 text-center text-muted-foreground/60 truncate">{placeholder}</span>
        )}
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform', open && 'rotate-180')} />
      </button>

      {open && createPortal(
        <div
          ref={painelRef}
          style={style}
          role="dialog"
          aria-label="Escolher material"
          className="flex flex-col overflow-hidden rounded-xl border border-border/80 bg-card animate-in fade-in-0 zoom-in-95 duration-100"
        >
          <div className="h-0.5 shrink-0 bg-gradient-to-r from-primary/60 via-primary to-primary/60" />

          {/* Busca */}
          <div className="shrink-0 px-3 pt-2.5 pb-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
              <input
                ref={buscaRef}
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome ou código…"
                aria-label="Buscar material"
                role="combobox"
                aria-expanded="true"
                aria-controls={`${idBase}-lista`}
                aria-activedescendant={filtrados[focado] ? `${idBase}-op-${filtrados[focado].id}` : undefined}
                className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-2 text-base sm:text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
            </div>
          </div>

          {/* Chips de categoria */}
          <div className="shrink-0 flex gap-1.5 overflow-x-auto px-3 pb-2" role="group" aria-label="Categoria">
            {[['', produtos.length] as [string, number], ...categorias].map(([nome, n]) => {
              const ativo = categoria === nome
              return (
                <button
                  key={nome || 'todas'}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => setCategoria(nome)}
                  className={cn(
                    'shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors',
                    ativo
                      ? 'border-primary text-primary bg-card ring-1 ring-primary/30'
                      : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/50',
                  )}
                >
                  {nome || 'Todas'} <span className="font-normal opacity-70">{n}</span>
                </button>
              )
            })}
          </div>

          {/* Lista */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain border-t border-border/40 py-1" role="listbox" id={`${idBase}-lista`}>
            {filtrados.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                <PackageSearch className="mx-auto mb-2 h-5 w-5 opacity-50" />
                Nenhum material encontrado.
                {(busca || categoria) && (
                  <button
                    type="button"
                    onClick={() => { setBusca(''); setCategoria('') }}
                    className="block mx-auto mt-1 underline underline-offset-2 hover:text-foreground"
                  >
                    limpar filtros
                  </button>
                )}
              </div>
            ) : (
              filtrados.map((p, idx) => {
                const sel = p.id === value
                const sem = Number(p.quantidade_atual) <= 0
                return (
                  <button
                    key={p.id}
                    id={`${idBase}-op-${p.id}`}
                    ref={(el) => { itemRefs.current[idx] = el }}
                    type="button"
                    role="option"
                    aria-selected={sel}
                    onClick={() => escolher(p)}
                    onMouseEnter={() => setFocado(idx)}
                    className={cn(
                      'w-full flex items-center gap-3 border-l-2 border-transparent px-3 py-2 text-left transition-colors',
                      sel ? 'bg-muted !border-primary' : idx === focado ? 'bg-muted/60' : 'hover:bg-muted/40',
                    )}
                  >
                    <span className="flex-1 min-w-0">
                      <span className={cn('block truncate text-sm font-medium', sel && 'text-primary')}>{p.nome}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {p.codigo ? `${p.codigo} · ` : ''}{p.estoque_categorias?.nome ?? 'Sem categoria'} · {unidadeLabel(p.unidade)}
                      </span>
                    </span>
                    <span className={cn('shrink-0 text-xs font-semibold tabular-nums', sem ? 'text-red-600' : 'text-foreground/70')}>
                      {formatSaldo(p)}
                    </span>
                    {sel && <Check className="h-4 w-4 shrink-0 text-primary" strokeWidth={3} />}
                  </button>
                )
              })
            )}
          </div>

          <div className="shrink-0 border-t border-border/40 px-3 py-1.5 text-[10px] text-muted-foreground/70">
            {filtrados.length} de {produtos.length} materiais · ↑↓ navega · Enter escolhe · Esc fecha
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
