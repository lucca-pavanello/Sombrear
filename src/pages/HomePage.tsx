import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ClipboardCheck, ArrowRight, BarChart2, Bot, Calculator, CircleDollarSign, Wallet, Package, ShieldCheck, FileText, CheckCircle2, Clock, TrendingUp, Command } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import { useOrcamentos } from '@/hooks/useOrcamentos'
import { useCrmLeads } from '@/hooks/useAgenteIA'
import { usePresence } from '@/hooks/usePresence'
import { useCommandPalette } from '@/hooks/useCommandPalette'
import { useCountUp } from '@/hooks/useCountUp'
import CommandPalette from '@/components/shared/CommandPalette'
import AvatarInitials from '@/components/shared/AvatarInitials'
import { formatCurrency, cn } from '@/lib/utils'
import { comTransicao } from '@/lib/viewTransition'
import { ADMIN_EMAIL, ESTOQUE_EMAIL } from '@/lib/constants'

const CARD_CLS = 'group w-full md:w-[calc(50%-0.75rem)] lg:w-[calc(33.333%-1rem)] bg-card border border-border rounded-2xl md:rounded-3xl p-6 md:p-10 shadow-sm hover:shadow-2xl hover:border-primary/40 hover:-translate-y-1 transition-all flex flex-col items-center text-center relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60'
const ICON_WRAP_CLS = 'h-14 w-14 md:h-20 md:w-20 rounded-2xl md:rounded-3xl bg-primary/10 flex items-center justify-center mb-4 md:mb-6 group-hover:bg-primary group-hover:scale-105 transition-all'
const ICON_CLS = 'h-7 w-7 md:h-10 md:w-10 text-primary group-hover:text-white transition-colors'

type Badge = { label: string; tone: 'primary' | 'amber' }

function AreaCard({ titulo, descricao, icon: Icon, onClick, badge, animIcone, delay = 0, viajando }: {
  titulo: string; descricao: string; icon: typeof Calculator; onClick: () => void
  badge?: Badge; animIcone?: string; delay?: number
  /** true enquanto este ícone é o shared element da transição de saída */
  viajando?: boolean
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const rafRef = useRef(0)

  function onMove(e: React.MouseEvent) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (rafRef.current) return
    const el = ref.current
    if (!el) return
    const { clientX, clientY } = e
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      const r = el.getBoundingClientRect()
      const px = (clientX - r.left) / r.width
      const py = (clientY - r.top) / r.height
      el.style.setProperty('--tilt-y', `${(px - 0.5) * 6}deg`)
      el.style.setProperty('--tilt-x', `${(0.5 - py) * 5}deg`)
      el.style.setProperty('--glow-x', `${px * 100}%`)
      el.style.setProperty('--glow-y', `${py * 100}%`)
    })
  }
  function onLeave() {
    const el = ref.current
    if (!el) return
    el.style.setProperty('--tilt-x', '0deg')
    el.style.setProperty('--tilt-y', '0deg')
  }

  return (
    <button ref={ref} onClick={onClick} onMouseMove={onMove} onMouseLeave={onLeave}
      className={cn(CARD_CLS, 'home-enter tilt-card')}
      style={{ '--enter-delay': `${delay}ms` } as React.CSSProperties}>
      {badge && (
        <span className={cn(
          'absolute top-4 right-4 rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums',
          badge.tone === 'amber'
            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
            : 'bg-primary/12 text-primary'
        )}>
          {badge.label}
        </span>
      )}
      <div className={ICON_WRAP_CLS}
        style={viajando ? ({ viewTransitionName: 'icone-area' } as React.CSSProperties) : undefined}>
        <Icon className={cn(ICON_CLS, animIcone)} />
      </div>
      <h2 className="text-lg md:text-2xl font-bold text-foreground mb-2 md:mb-3">{titulo}</h2>
      <p className="text-sm text-muted-foreground leading-relaxed mb-4 md:mb-8 max-w-xs mx-auto">{descricao}</p>
      <div className="mt-auto inline-flex items-center text-sm font-medium text-primary">
        Acessar
        <ArrowRight className="h-4 w-4 ml-1 group-hover:translate-x-1 transition-transform" />
      </div>
    </button>
  )
}

function CardSkeleton() {
  return (
    <div className={cn(CARD_CLS, 'pointer-events-none')} aria-hidden>
      <div className="h-14 w-14 md:h-20 md:w-20 rounded-2xl md:rounded-3xl skeleton-shimmer mb-4 md:mb-6" />
      <div className="h-6 w-32 rounded-lg skeleton-shimmer mb-3" />
      <div className="h-3 w-48 rounded skeleton-shimmer mb-1.5" />
      <div className="h-3 w-40 rounded skeleton-shimmer mb-6" />
      <div className="mt-auto h-4 w-20 rounded skeleton-shimmer" />
    </div>
  )
}

function saudacao(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Boa madrugada'
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

function primeiroNome(profile: { full_name?: string | null; email?: string | null } | null | undefined): string {
  const raw = profile?.full_name?.trim() || profile?.email?.split('@')[0] || ''
  const nome = raw.split(/\s+/)[0]
  return nome ? nome.charAt(0).toUpperCase() + nome.slice(1) : ''
}

function tempoAtras(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'agora'
  const m = Math.floor(s / 60)
  if (m < 60) return `há ${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h}h`
  return `há ${Math.floor(h / 24)}d`
}

function PulsoPill({ icon: Icon, numero, fmt, rotulo, atencao, delay = 0, contar = true }: {
  icon: typeof FileText; numero: number; fmt?: (n: number) => string
  rotulo: string; atencao?: boolean; delay?: number; contar?: boolean
}) {
  const animado = useCountUp(numero, 700, !contar)
  const valor = fmt ? fmt(animado) : String(Math.round(animado))
  return (
    <div
      className={cn(
        'home-enter flex items-center gap-2 rounded-full border px-3.5 py-1.5 bg-card shadow-sm',
        atencao ? 'border-amber-500/40' : 'border-border'
      )}
      style={{ '--enter-delay': `${delay}ms` } as React.CSSProperties}
    >
      <Icon className={cn('h-3.5 w-3.5 shrink-0', atencao ? 'text-amber-500' : 'text-primary')} />
      <span className="text-sm font-bold tabular-nums text-foreground">{valor}</span>
      <span className="text-xs text-muted-foreground">{rotulo}</span>
    </div>
  )
}

export default function HomePage() {
  const navigate = useNavigate()
  const { data: profile, isLoading } = useProfile()
  const { data: orcamentos = [] } = useOrcamentos()
  const { data: leads = [] } = useCrmLeads()
  const others = usePresence(profile ?? null, 'inicio')
  const { open: paletteOpen, close: closePalette } = useCommandPalette()

  // Coreografia completa só na 1ª visita da sessão; depois, fade rápido (a Home não pode "fazer esperar")
  const [coreo] = useState<'home-choreo' | 'home-quick'>(() => {
    try {
      if (sessionStorage.getItem('sombrear-home-coreo')) return 'home-quick'
      sessionStorage.setItem('sombrear-home-coreo', '1')
      return 'home-choreo'
    } catch { return 'home-choreo' }
  })
  const contarPulso = coreo === 'home-choreo'
  const ir = (path: string) => comTransicao(() => navigate(path))

  // Ícone que viaja: na IDA marca o card clicado antes da transição e avisa o destino;
  // na VOLTA (← Início) o Dashboard deixa o aviso e o card correspondente "recebe" o voo.
  const [viajante, setViajante] = useState<string | null>(() => {
    try {
      const v = sessionStorage.getItem('sombrear-vt-icone')
      sessionStorage.removeItem('sombrear-vt-icone')
      return v
    } catch { return null }
  })
  useEffect(() => {
    if (!viajante) return
    const t = setTimeout(() => setViajante(null), 600)
    return () => clearTimeout(t)
  }, [viajante])
  function irArea(area: string, path: string) {
    try { sessionStorage.setItem('sombrear-vt-icone', area) } catch { /* segue sem voo */ }
    flushSync(() => setViajante(area))
    comTransicao(() => navigate(path))
  }

  // Parallax sutil das orbes de fundo (desativado com prefers-reduced-motion)
  const fundoRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    function onMove(e: MouseEvent) {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const x = (e.clientX / window.innerWidth - 0.5) * 24
        const y = (e.clientY / window.innerHeight - 0.5) * 16
        fundoRef.current?.style.setProperty('--par-x', `${x}px`)
        fundoRef.current?.style.setProperty('--par-y', `${y}px`)
      })
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => { window.removeEventListener('mousemove', onMove); if (raf) cancelAnimationFrame(raf) }
  }, [])

  useEffect(() => { document.title = 'Sombrear - Início' }, [])

  const isAdmin      = profile?.email === ADMIN_EMAIL || profile?.is_admin === true
  const canOrcamento = isAdmin || profile?.pode_orcamento === true
  const canEstoque   = isAdmin || profile?.pode_estoque === true || profile?.email === ESTOQUE_EMAIL
  const canAgenteIA  = isAdmin || profile?.pode_agente_ia === true
  const canPrecos    = isAdmin || profile?.pode_precos === true
  const canFechamento = isAdmin || profile?.pode_fechamento === true

  const noAccess = !isLoading && profile && !canOrcamento && !canEstoque && !canAgenteIA && !canPrecos && !canFechamento && !isAdmin

  // ── Pulso do dia ──
  const pulso = useMemo(() => {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
    const semana = new Date(hoje); semana.setDate(semana.getDate() - 6)
    const deHoje = orcamentos.filter(o => new Date(o.created_at) >= hoje)
    const fechadosSemana = orcamentos.filter(o => o.fechado && new Date(o.created_at) >= semana)
    const cotadoHoje = deHoje.reduce((s, o) => s + (o.valor_venda ?? 0) + (o.instalacao ?? 0), 0)
    const aguardando = leads.filter(l => {
      const v = l.status_lead?.toLowerCase().trim() ?? ''
      return v === 'aguardando_atendimento' || v === 'aguardando_atendente' || v === 'transferido'
    })
    // orçamentos recentes que ainda esperam um "fechou/não fechou/sumiu"
    const semResposta = orcamentos.filter(o => !o.desfecho && !o.fechado
      && new Date(o.created_at) >= semana).length
    return { deHoje: deHoje.length, cotadoHoje, fechadosSemana: fechadosSemana.length,
      aguardando: aguardando.length, semResposta }
  }, [orcamentos, leads])

  const recentes = useMemo(
    () => {
      // Um pedido multi-item vira várias rows no banco (1 por persiana) — agrupa
      // por cliente+responsável em janela de 15min pra lista não ecoar o mesmo pedido
      const ordenados = [...orcamentos]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      type Grupo = {
        id: string; cliente: string; responsavel: string; modelos: string[]
        itens: number; total: number; fechado: boolean; created_at: string
      }
      const grupos: Grupo[] = []
      for (const o of ordenados) {
        const t = new Date(o.created_at).getTime()
        const g = grupos.find(g =>
          g.cliente === (o.cliente ?? o.responsavel) &&
          g.responsavel === o.responsavel &&
          Math.abs(new Date(g.created_at).getTime() - t) < 15 * 60 * 1000
        )
        const total = (o.valor_venda ?? 0) + (o.instalacao ?? 0)
        if (g) {
          g.itens += 1
          g.total += total
          if (o.modelo && !g.modelos.includes(o.modelo)) g.modelos.push(o.modelo)
          g.fechado = g.fechado || o.fechado === true
        } else {
          grupos.push({
            id: o.id, cliente: o.cliente ?? o.responsavel, responsavel: o.responsavel,
            modelos: o.modelo ? [o.modelo] : [], itens: 1, total,
            fechado: o.fechado === true, created_at: o.created_at,
          })
        }
        if (grupos.length >= 8) break
      }
      return grupos.slice(0, 4)
    },
    [orcamentos]
  )

  // Só é "atividade" se aconteceu hoje — senão a seção assume que é histórico
  const temAtividadeHoje = recentes.length > 0 &&
    (Date.now() - new Date(recentes[0].created_at).getTime()) < 24 * 60 * 60 * 1000

  const nome = primeiroNome(profile)
  const dataLonga = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className={cn('relative min-h-dvh flex flex-col items-center justify-center bg-background px-4 py-10 overflow-hidden', coreo)}>
      {/* Aurora: dot grid + orbes da marca à deriva (mesma família visual do dash interno) */}
      <div ref={fundoRef} className="absolute inset-0 -z-10 pointer-events-none" aria-hidden>
        <div className="dot-grid absolute inset-0" />
        <div className="aurora-a absolute -top-44 -right-44 h-[560px] w-[560px] rounded-full bg-primary/[0.07] dark:bg-primary/[0.11] blur-3xl" />
        <div className="aurora-b absolute -bottom-48 -left-44 h-[640px] w-[640px] rounded-full bg-amber-400/[0.06] dark:bg-amber-400/[0.09] blur-3xl" />
      </div>

      {/* Logo + saudação */}
      <div className="text-center mb-8 md:mb-12">
        <div className="home-logo inline-flex h-16 w-16 md:h-24 md:w-24 rounded-2xl md:rounded-3xl bg-brand-gradient items-center justify-center mb-4 md:mb-6 shadow-brand">
          <span className="text-white text-3xl md:text-5xl font-bold font-display tracking-tight">S</span>
        </div>
        <h1 className="home-enter font-display text-2xl md:text-4xl font-bold text-foreground tracking-tight"
          style={{ '--enter-delay': '70ms' } as React.CSSProperties}>
          {nome ? `${saudacao()}, ${nome}` : 'Sombrear'}
        </h1>
        <p className="home-enter text-sm md:text-base text-muted-foreground mt-2 capitalize"
          style={{ '--enter-delay': '120ms' } as React.CSSProperties}>{dataLonga}</p>

        {/* Presença: quem mais está no sistema agora */}
        {others.length > 0 && (
          <div className="home-enter mt-3 inline-flex items-center gap-2 rounded-full bg-card border border-border px-3 py-1.5 shadow-sm"
            style={{ '--enter-delay': '170ms' } as React.CSSProperties}>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <div className="flex -space-x-1.5">
              {others.slice(0, 3).map(u => <AvatarInitials key={u.id} name={u.name} size="xs" />)}
            </div>
            <span className="text-xs text-muted-foreground">
              {others.length === 1 ? `${others[0].name.split(' ')[0]} está online` : `${others.length} pessoas online`}
            </span>
          </div>
        )}
      </div>

      {/* Pulso do dia — números contam de 0 na 1ª visita da sessão */}
      {(canOrcamento || canAgenteIA) && !noAccess && (
        <div className="flex flex-wrap justify-center gap-2 mb-8 md:mb-10">
          {canOrcamento && (
            <>
              <PulsoPill icon={FileText} numero={pulso.deHoje} contar={contarPulso} delay={200}
                rotulo={pulso.deHoje === 1 ? 'orçamento hoje' : 'orçamentos hoje'} />
              {pulso.cotadoHoje > 0 && (
                <PulsoPill icon={TrendingUp} numero={pulso.cotadoHoje} fmt={formatCurrency}
                  contar={contarPulso} delay={250} rotulo="cotado hoje" />
              )}
              <PulsoPill icon={CheckCircle2} numero={pulso.fechadosSemana} contar={contarPulso}
                delay={300} rotulo="fechados na semana" />
              {pulso.semResposta > 0 && (
                <PulsoPill icon={ClipboardCheck} numero={pulso.semResposta} contar={contarPulso}
                  delay={325} rotulo="esperando resposta" atencao />
              )}
            </>
          )}
          {canAgenteIA && pulso.aguardando > 0 && (
            <PulsoPill icon={Clock} numero={pulso.aguardando} contar={contarPulso} delay={350}
              rotulo="leads aguardando" atencao />
          )}
        </div>
      )}

      {noAccess ? (
        <div className="max-w-md w-full rounded-3xl border border-border bg-card p-12 text-center shadow-sm">
          <ShieldCheck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold text-foreground mb-2">Acesso pendente</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Sua conta ainda não possui permissões configuradas. Fale com o administrador do sistema.
          </p>
        </div>
      ) : isLoading ? (
        <div className="flex flex-wrap justify-center gap-4 md:gap-6 max-w-5xl w-full">
          <CardSkeleton /><CardSkeleton /><CardSkeleton />
        </div>
      ) : (
        <div className="flex flex-wrap justify-center gap-4 md:gap-6 max-w-5xl w-full">
          {canOrcamento && (
            <AreaCard titulo="Orçamento" icon={Calculator} animIcone="icon-press" delay={260}
              descricao="Calcular preços, gerar propostas, gerenciar planilhas de orçamento e custos."
              badge={pulso.deHoje > 0 ? { label: `${pulso.deHoje} hoje`, tone: 'primary' } : undefined}
              viajando={viajante === 'orcamento'}
              onClick={() => irArea('orcamento', '/orcamentos/calcular-orcamento')} />
          )}
          {canEstoque && (
            <AreaCard titulo="Estoque" icon={Package} animIcone="icon-sway" delay={330}
              descricao="Gerenciar produtos, fornecedores, registrar entradas, vendas e analisar performance."
              viajando={viajante === 'estoque'}
              onClick={() => irArea('estoque', '/estoque')} />
          )}
          {canAgenteIA && (
            <AreaCard titulo="Agente IA" icon={Bot} animIcone="icon-peek" delay={400}
              descricao="Acompanhar os leads do WhatsApp, conversas e orçamentos gerados pela IA."
              badge={pulso.aguardando > 0 ? { label: `${pulso.aguardando} aguardando`, tone: 'amber' } : undefined}
              viajando={viajante === 'agente-ia'}
              onClick={() => irArea('agente-ia', '/agente-ia')} />
          )}
          {canPrecos && (
            <AreaCard titulo="Tabela de Preços" icon={CircleDollarSign} animIcone="icon-coin" delay={470}
              descricao="Preços, promoções, simulador e o assistente — a fonte central dos orçamentos."
              viajando={viajante === 'precos'}
              onClick={() => irArea('precos', '/precos')} />
          )}
          {canFechamento && (
            <AreaCard titulo="Semanário" icon={Wallet} animIcone="icon-coin" delay={505}
              descricao="Vendas efetivadas, quanto vai para a parceira e o que sobra para a loja."
              viajando={viajante === 'fechamento'}
              onClick={() => irArea('fechamento', '/fechamento')} />
          )}
          {(canOrcamento || canFechamento) && (
            <AreaCard titulo="Relatórios" icon={BarChart2} animIcone="icon-press" delay={522}
              descricao="Funil por canal, análises e os resumos escritos pela IA — da semana ou do período que você pedir."
              viajando={viajante === 'relatorios'}
              onClick={() => irArea('relatorios', '/relatorios')} />
          )}
          {isAdmin && (
            <AreaCard titulo="Admin" icon={ShieldCheck} animIcone="icon-guard" delay={540}
              descricao="Gerenciar usuários, aprovar acessos e configurar permissões do sistema."
              viajando={viajante === 'admin'}
              onClick={() => irArea('admin', '/admin')} />
          )}
        </div>
      )}

      {/* Últimos orçamentos (rótulo honesto: só pulsa se houver algo de hoje) */}
      {canOrcamento && !noAccess && recentes.length > 0 && (
        <div className="home-enter mt-8 md:mt-10 w-full max-w-5xl"
          style={{ '--enter-delay': '620ms' } as React.CSSProperties}>
          <div className="rounded-2xl border border-border bg-card/60 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
              {temAtividadeHoje ? (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50 animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
              ) : (
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
              )}
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                {temAtividadeHoje ? 'Atividade de hoje' : 'Últimos orçamentos'}
              </p>
            </div>
            <div className="divide-y divide-border/50">
              {recentes.map(g => (
                <button
                  key={g.id}
                  onClick={() => ir('/orcamentos/planilha')}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
                >
                  <AvatarInitials name={g.responsavel} size="xs" />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    <span className="font-medium">{g.cliente}</span>
                    <span className="text-muted-foreground">
                      {' · '}{g.modelos.join(' + ') || '—'}{g.itens > 1 ? ` · ${g.itens} itens` : ''}
                    </span>
                  </span>
                  {g.fechado && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                  {g.total > 0 && (
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{formatCurrency(g.total)}</span>
                  )}
                  <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{tempoAtras(g.created_at)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <p className="home-enter mt-10 flex items-center gap-1.5 text-xs text-muted-foreground/60"
        style={{ '--enter-delay': '700ms' } as React.CSSProperties}>
        <Command className="h-3 w-3" />
        <kbd className="rounded border border-border bg-muted/50 px-1 py-0.5 text-[10px] font-semibold">K</kbd>
        busca rápida em qualquer tela · Sombrear — Sistema de Gestão
      </p>

      <CommandPalette open={paletteOpen} onClose={closePalette} orcamentos={orcamentos} />
    </div>
  )
}
