import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, CircleCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { cartao, kpi } from '@/components/shared/estilos'
import EmptyState from '@/components/shared/EmptyState'
import SectionHeader from '@/components/shared/SectionHeader'

/**
 * Peças visuais das telas Análises e Ações do Estoque.
 * Só apresentação: nenhuma busca de dados aqui.
 * Cor da marca só em ícone/texto — nunca em fundo de card.
 */

/* ── Cartão (sempre aberto) ─────────────────────────────────────────────── */

const badgeCor = {
  neutro: 'border-border bg-muted/40 text-muted-foreground',
  info: 'border-primary/25 bg-primary/[0.06] text-primary',
  aviso: 'border-amber-500/30 bg-amber-500/[0.06] text-amber-700 dark:text-amber-400',
  urgente: 'border-red-500/30 bg-red-500/[0.06] text-red-700 dark:text-red-400',
  ok: 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-400',
} as const

export type BadgeTom = keyof typeof badgeCor

export function CartaoPainel({
  icon: Icon, title, subtitle, badge, acao, children, className,
}: {
  icon: LucideIcon
  title: string
  subtitle?: string
  badge?: { label: string; tom: BadgeTom }
  /** botão/controle à direita do cabeçalho */
  acao?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn(cartao, 'flex min-w-0 flex-col overflow-hidden', className)}>
      <header className="flex items-start gap-3 border-b border-border px-4 py-3.5 sm:px-5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-sm font-semibold leading-tight text-foreground">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {badge && (
            <span className={cn('inline-flex h-6 items-center rounded-full border px-2.5 text-xs font-medium', badgeCor[badge.tom])}>
              {badge.label}
            </span>
          )}
          {acao}
        </div>
      </header>
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  )
}

/* ── Card de KPI do resumo ──────────────────────────────────────────────── */

export function KpiResumo({
  icon: Icon, rotulo, valor, sub, acento = 'neutro', carregando,
}: {
  icon: LucideIcon
  rotulo: string
  valor: string
  sub: string
  acento?: keyof typeof kpi.acento
  carregando?: boolean
}) {
  const vazio = valor === '—'
  return (
    <div className={cn(kpi.cartao, kpi.acento[vazio ? 'neutro' : acento], 'text-center')}>
      <span className={cn(kpi.chip, kpi.chipCor[vazio ? 'neutro' : acento])}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <p className={kpi.rotulo}>{rotulo}</p>
      {carregando ? (
        <div className="mx-auto mt-2 h-7 w-20 animate-pulse rounded bg-muted" />
      ) : (
        <p className={cn(kpi.valor, vazio ? 'text-muted-foreground/50' : kpi.valorCor[acento], 'truncate')}>{valor}</p>
      )}
      <p className={cn(kpi.sub, 'whitespace-normal leading-snug')}>{sub}</p>
    </div>
  )
}

/* ── Estado vazio compacto, sempre com "o que falta" e "onde resolver" ─── */

export function VazioCartao({
  icon, title, description, action,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      description={description}
      action={action}
      className="px-4 py-10"
    />
  )
}

export function CarregandoBloco({ altura = 'h-40' }: { altura?: string }) {
  return <div className={cn('m-4 animate-pulse rounded-lg bg-muted/50', altura)} />
}

/* ── Barra de progresso ─────────────────────────────────────────────────── */

export function BarraProgresso({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(100, pct))
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={Math.round(p)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn('h-full rounded-full transition-all duration-500', p >= 100 ? 'bg-emerald-500' : p > 0 ? 'bg-amber-500' : 'bg-transparent')}
        style={{ width: `${p}%` }}
      />
    </div>
  )
}

/* ── Avisos dentro de um cartão ─────────────────────────────────────────── */

export function AvisoDados({
  texto, acao,
}: {
  texto: ReactNode
  acao?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-amber-500/20 bg-amber-500/[0.05] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 dark:bg-amber-500/[0.08]">
      <p className="flex items-start gap-2 text-sm text-foreground/80">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <span>{texto}</span>
      </p>
      {acao && (
        <button
          type="button"
          onClick={acao.onClick}
          className="shrink-0 self-start rounded-lg bg-muted px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-muted/70 sm:self-auto"
        >
          {acao.label}
        </button>
      )}
    </div>
  )
}

export function TudoCerto({ texto }: { texto: string }) {
  return (
    <p className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-emerald-700 dark:text-emerald-400">
      <CircleCheck className="h-4 w-4" aria-hidden="true" />
      {texto}
    </p>
  )
}

/* ── Grupo de cartões com cabeçalho numerado (mesmo padrão do Calcular) ─── */

export function GrupoPainel({
  step, titulo, dica, children,
}: { step: string; titulo: string; dica?: string; children: ReactNode }) {
  return (
    <div className="space-y-4">
      <SectionHeader step={step} title={titulo} hint={dica} />
      {children}
    </div>
  )
}
