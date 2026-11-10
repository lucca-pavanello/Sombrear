import { useState, useMemo } from 'react'
import { ArrowLeftRight, MoveRight, Package, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react'
import {
  useEstoqueSugestoesMover,
  useTotalProdutosAnalisados,
  useMoverProduto,
} from '@/hooks/useEstoqueSugestoesMover'
import { useEstoqueLocalizacoes } from '@/hooks/useEstoqueLocalizacoes'
import { NIVEIS_ACESSO } from '@/lib/constants'
import { useFecharNoFundo } from '@/hooks/useFecharNoFundo'
import { ClasseABC } from './shared/ClasseABC'
import type { EstoqueSugestaoMover } from '@/lib/supabase'
import type { ToastType } from '@/hooks/useToast'
import { CustomSelect } from '@/components/ui/CustomSelect'

type ClasseFilter = 'todas' | 'A' | 'B' | 'C'

interface Props {
  toast: (type: ToastType, message: string) => void
}


export default function MoverItensView({ toast }: Props) {
  const [classeFilter, setClasseFilter] = useState<ClasseFilter>('todas')
  const [movendo, setMovendo] = useState<EstoqueSugestaoMover | null>(null)
  const [novaLocalizacaoId, setNovaLocalizacaoId] = useState('')

  const { data: sugestoes = [], isLoading } = useEstoqueSugestoesMover()
  const { data: totalAnalisado = 0 } = useTotalProdutosAnalisados()
  const { data: localizacoes = [] } = useEstoqueLocalizacoes()
  const moverMutation = useMoverProduto()
  const fundoProps = useFecharNoFundo(handleFecharDialog)

  const classeACount = sugestoes.filter((s) => s.classe_abc === 'A').length
  const classeCCount = sugestoes.filter((s) => s.classe_abc === 'C').length

  const filtered = useMemo(() => {
    if (classeFilter === 'todas') return sugestoes
    return sugestoes.filter((s) => s.classe_abc === classeFilter)
  }, [sugestoes, classeFilter])

  function handleAbrirDialog(s: EstoqueSugestaoMover) {
    setMovendo(s)
    setNovaLocalizacaoId('')
  }

  function handleFecharDialog() {
    setMovendo(null)
    setNovaLocalizacaoId('')
  }

  async function handleConfirmar() {
    if (!movendo || !novaLocalizacaoId) return
    try {
      await moverMutation.mutateAsync({
        produto_id: movendo.produto_id,
        localizacao_id: novaLocalizacaoId,
      })
      toast('success', `"${movendo.nome}" movido com sucesso.`)
      handleFecharDialog()
    } catch {
      toast('error', 'Erro ao mover produto.')
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="text-center">
        <h3 className="flex items-center justify-center gap-2 font-display text-base font-semibold">
          <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
          Sugestões de reorganização
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Produtos classe A em locais ruins e classe C em locais bons. Reorganizar melhora a eficiência da equipe.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          title="Total analisado"
          value={totalAnalisado}
          icon={<Package className="h-4 w-4 text-muted-foreground" />}
          subtitle="com localização e classe"
        />
        <KpiCard
          title="Sugestões ativas"
          value={sugestoes.length}
          icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}
          accent="default"
          subtitle="localização inadequada"
        />
        <KpiCard
          title="Classe A mal-alocados"
          value={classeACount}
          icon={<TrendingDown className="h-4 w-4 text-destructive" />}
          accent="default"
          subtitle="fora do balcão/acessível"
        />
        <KpiCard
          title="Classe C mal-alocados"
          value={classeCCount}
          icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
          accent="default"
          subtitle="fora do fundo/depósito"
        />
      </div>

      {/* Tabela */}
      <div className="rounded-xl border-2 bg-card shadow-sm overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <CustomSelect
            value={classeFilter}
            onChange={(v) => setClasseFilter(v as ClasseFilter)}
            options={[
              { value: 'todas', label: 'Todas as classes' },
              { value: 'A', label: 'Classe A' },
              { value: 'B', label: 'Classe B' },
              { value: 'C', label: 'Classe C' },
            ]}
            className="w-44"
          />
          <span className="ml-auto text-xs text-muted-foreground">
            {filtered.length} sugestão{filtered.length !== 1 ? 'ões' : ''}
          </span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: '760px' }}>
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">SKU</th>
                <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Nome</th>
                <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Classe</th>
                <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Localização atual</th>
                <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Nível atual</th>
                <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Nível sugerido</th>
                <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ação</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8">
                    <div className="flex flex-col gap-2">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-10 rounded-lg skeleton-shimmer" />
                      ))}
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <ArrowLeftRight className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm font-medium text-muted-foreground">
                      {sugestoes.length === 0
                        ? 'Nenhuma sugestão de reorganização'
                        : 'Nenhuma sugestão para esta classe'}
                    </p>
                    {sugestoes.length === 0 && (
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        Todos os produtos estão bem alocados ou sem localização definida
                      </p>
                    )}
                  </td>
                </tr>
              ) : (
                filtered.map((s) => (
                  <tr key={s.produto_id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {s.sku ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium">{s.nome}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ClasseABC classe={s.classe_abc} />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground hidden md:table-cell">
                      {s.localizacao_codigo}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground hidden lg:table-cell">
                      {NIVEIS_ACESSO[s.nivel_atual] ?? s.nivel_atual}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="flex items-center gap-1 text-sm text-foreground font-medium">
                        <MoveRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        {s.nivel_sugerido}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleAbrirDialog(s)}
                        className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors whitespace-nowrap"
                      >
                        Marcar como movido
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dialog: Mover produto */}
      {movendo && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialog-mover-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-[2px] px-4"
          {...fundoProps}
        >
          <div className="w-full max-w-sm bg-card rounded-2xl shadow-elevated">
            {/* Header */}
            <div className="border-b px-5 py-4">
              <h3 id="dialog-mover-title" className="font-display text-base font-semibold">
                Mover produto
              </h3>
              <p className="text-sm text-muted-foreground mt-0.5 truncate">{movendo.nome}</p>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-4">
              <div className="rounded-lg bg-muted/60 border border-border px-3 py-2">
                <p className="text-xs font-semibold text-foreground">
                  Nível sugerido: {movendo.nivel_sugerido}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {movendo.acao_sugerida}
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Nova localização *
                </label>
                <CustomSelect
                  value={novaLocalizacaoId}
                  onChange={setNovaLocalizacaoId}
                  options={localizacoes.map((l) => ({
                    value: l.id,
                    label: `${l.codigo} – ${l.setor} (${NIVEIS_ACESSO[l.nivel_acesso] ?? l.nivel_acesso})`,
                  }))}
                  placeholder="Selecione uma localização…"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t px-5 py-4 gap-3">
              <button
                type="button"
                onClick={handleFecharDialog}
                className="rounded-lg border px-4 py-2.5 text-sm font-semibold hover:bg-muted active:scale-95 transition-all"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmar}
                disabled={!novaLocalizacaoId || moverMutation.isPending}
                className="rounded-lg bg-brand-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-brand hover:opacity-90 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
              >
                {moverMutation.isPending ? 'Movendo…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function KpiCard({
  title, value, icon, subtitle, accent = 'default',
}: {
  title: string
  value: number
  icon: React.ReactNode
  subtitle?: string
  accent?: 'default' | 'amber' | 'red'
}) {
  const borderCls = {
    default: '',
    amber:   'border-amber-500/30 bg-amber-500/[0.05] dark:bg-amber-500/[0.08]',
    red:     'border-red-500/30 bg-red-500/[0.05] dark:bg-red-500/[0.08]',
  }[accent]

  return (
    <div className={`rounded-xl border-2 bg-card shadow-sm px-4 py-3 flex items-center gap-3 ${borderCls}`}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/60">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground truncate">
          {title}
        </p>
        <p className="text-xl font-bold leading-tight">{value}</p>
        {subtitle && (
          <p className="text-[10px] text-muted-foreground truncate">{subtitle}</p>
        )}
      </div>
    </div>
  )
}
