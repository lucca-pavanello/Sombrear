import { useEffect, useState, useRef, Suspense, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { lazyComRecarga } from '@/lib/lazyComRecarga'
import { useNavigate, useLocation } from 'react-router-dom'
import { ClipboardCheck, FileText, Bot, Calculator, Wallet, Sun, Moon, LogOut, ShieldCheck, BarChart2, ClipboardList, Package, Volume2, VolumeX, Sparkles, Tv2, TrendingUp, Users, X, LayoutDashboard, PackagePlus, ShoppingCart, MapPin, Truck, Zap, Settings, AlertTriangle, CircleDollarSign, Scissors, Store } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/hooks/useTheme'
import { useOrcamentos } from '@/hooks/useOrcamentos'
import { useAgenteIARealtime } from '@/hooks/useAgenteIA'
import { useProfile, usePendingCount } from '@/hooks/useProfile'
import { useEstoqueProdutosAlerta } from '@/hooks/useEstoqueProdutos'
import { useToast } from '@/hooks/useToast'
import { useCommandPalette } from '@/hooks/useCommandPalette'
import Toaster from '@/components/ui/Toaster'
import CommandPalette from '@/components/shared/CommandPalette'
import EditProfileModal from '@/components/profile/EditProfileModal'
import AvatarInitials from '@/components/shared/AvatarInitials'
import SkeletonCard from '@/components/shared/SkeletonCard'
import TopLoadingBar from '@/components/shared/TopLoadingBar'
import { cn } from '@/lib/utils'
import { comTransicao } from '@/lib/viewTransition'
import { ADMIN_EMAIL, ESTOQUE_EMAIL } from '@/lib/constants'
import { useUiSound } from '@/hooks/useUiSound'
import { usePresence } from '@/hooks/usePresence'
import { haptic } from '@/lib/haptic'
import AICopilot from '@/components/shared/AICopilot'
import PresentationMode from '@/components/shared/PresentationMode'
import { useChatStore } from '@/components/estoque/chat/store'
import { isAIEstoqueEnabled } from '@/components/estoque/chat/featureFlag'
import JanelaDados from '@/components/orcamentos/JanelaDados'

const TabOrcamentos   = lazyComRecarga(() => import('@/components/tabs/TabOrcamentos'))
const TabPlanilha     = lazyComRecarga(() => import('@/components/tabs/TabPlanilha'))
// a aba Agente IA com as suas duas visões (Visão geral e Revisão diária)
const TabAgenteIA     = lazyComRecarga(() => import('@/components/agente/AbaAgente'))
const TabCotacao      = lazyComRecarga(() => import('@/components/tabs/TabCotacao'))
const TabCustos       = lazyComRecarga(() => import('@/components/tabs/TabCustos'))

const TabAnalises     = lazyComRecarga(() => import('@/components/tabs/TabAnalises'))
const TabSimulador    = lazyComRecarga(() => import('@/components/tabs/TabSimulador'))
const TabFechamento   = lazyComRecarga(() => import('@/components/tabs/TabFechamento'))
const TabRelatorios   = lazyComRecarga(() => import('@/components/tabs/TabRelatorios'))
const TabAcompanhar   = lazyComRecarga(() => import('@/components/tabs/TabAcompanhar'))
const TabEstoque      = lazyComRecarga(() => import('@/components/tabs/TabEstoque'))
const PainelAdmin     = lazyComRecarga(() => import('@/components/admin/PainelAdmin'))
const PermissoesView  = lazyComRecarga(() => import('@/components/admin/PermissoesView'))
const TabPrecos       = lazyComRecarga(() => import('@/components/admin/TabPrecos'))

const VALID_TABS = ['calcular-orcamento', 'planilha', 'calculo-custo', 'agente-ia', 'orcamentos', 'admin', 'analises', 'estoque', 'relatorios', 'precos', 'simulador', 'fechamento', 'acompanhar']
const DEFAULT_TAB = 'calcular-orcamento'
function AskIATabBtn({ onMouseDown, onClick, active }: {
  onMouseDown: (e: React.MouseEvent<HTMLButtonElement>) => void
  onClick: () => void
  active: boolean
}) {
  return (
    <button
      onClick={onClick}
      onMouseDown={onMouseDown}
      title="Perguntar à IA"
      type="button"
      className={cn(
        'flex-[1.5] min-w-0 relative flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-all duration-100 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        'bg-brand-gradient hover:brightness-110 text-white shadow-brand',
        active && 'ring-2 ring-primary/40 ring-offset-1',
      )}
    >
      <Sparkles className="h-4 w-4 shrink-0" />
      <span className="hidden sm:inline truncate">Perguntar à IA</span>
    </button>
  )
}

// Área Estoque: abre o chat de estoque (drawer montado no TabEstoque)
function ChatIATabBtn({ onMouseDown }: { onMouseDown: (e: React.MouseEvent<HTMLButtonElement>) => void }) {
  const { abrir, aberto } = useChatStore()
  return <AskIATabBtn onMouseDown={onMouseDown} onClick={abrir} active={aberto} />
}

const SECTION_LABELS: Record<string, string> = {
  'orcamento': 'Orçamentos',
  'calcular-orcamento': 'Orçamentos',
  'planilha': 'Orçamentos',
  'calculo-custo': 'Orçamentos',
  'agente-ia': 'Agente IA',
  'orcamentos': 'Orçamentos',
  'analises': 'Relatórios',
  'relatorios': 'Relatórios',
  'acompanhar': 'Orçamentos',
  'estoque': 'Estoque',
  'admin': 'Admin',
  'precos': 'Tabela de Preços',
  'simulador': 'Orçamentos',
  'fechamento': 'Semanário',
}

export default function Dashboard() {
  // — state primeiro, sempre, para conformidade com Rules of Hooks —
  const [unreadCount, setUnreadCount] = useState(0)
  const [profileModalOpen, setProfileModalOpen] = useState(false)
  const [showSplash, setShowSplash] = useState(true)
  const [splashFading, setSplashFading] = useState(false)
  const [tabIndicator, setTabIndicator] = useState({ left: 0, width: 0 })
  const [orcPulse, setOrcPulse] = useState(false)
  const [scrollY, setScrollY] = useState(0)
  const [copilotOpen, setCopilotOpen] = useState(false)
  const [presentationOpen, setPresentationOpen] = useState(false)
  const [tabVersions, setTabVersions] = useState<Record<string, number>>({})
  const [tabDir, setTabDir] = useState<'left' | 'right'>('right')
  const [adminSubDir, setAdminSubDir] = useState<'right' | 'left'>('right')
  const [focusResponsavel, setFocusResponsavel] = useState<string | null>(
    () => { try { return localStorage.getItem('sombrear-focus-responsavel') ?? null } catch { return null } }
  )
  const [focusOpen, setFocusOpen] = useState(false)
  const [tabUpdatePulse, setTabUpdatePulse] = useState<Set<string>>(new Set())
  // Ícone que viaja: a Home marca qual área recebeu o clique; o ícone de destino "recebe" o voo
  const [vtIcone, setVtIcone] = useState<string | null>(() => {
    try {
      const v = sessionStorage.getItem('sombrear-vt-icone')
      sessionStorage.removeItem('sombrear-vt-icone')
      return v
    } catch { return null }
  })
  const prevUnreadRef = useRef(0)
  const prevAdminSubRef = useRef('usuarios')
  const tabBarRef = useRef<HTMLDivElement>(null)
  const focusRef = useRef<HTMLDivElement>(null)

  const uiSound = useUiSound()

  const [mountedTabs, setMountedTabs] = useState<Set<string>>(() => {
    const raw = window.location.pathname.replace(/^\//, '') || DEFAULT_TAB
    const initial = (raw === 'estoque' || raw.startsWith('estoque/')) ? 'estoque'
      : (raw === 'admin' || raw.startsWith('admin/')) ? 'admin'
      : raw.startsWith('orcamentos/') ? (raw.split('/')[1] || DEFAULT_TAB)
      : VALID_TABS.includes(raw) ? raw
      : DEFAULT_TAB
    return new Set([initial])
  })

  // — router —
  const navigate = useNavigate()
  const location = useLocation()

  // — dados e tema —
  const { isDark, toggle } = useTheme()
  const { toasts, toast, dismiss } = useToast()
  const { open: paletteOpen, close: closePalette } = useCommandPalette()
  const { data: profile, isLoading: profileLoading } = useProfile()
  const { data: pendingCount = 0 } = usePendingCount()
  const isAdmin = profile?.email === ADMIN_EMAIL || profile?.is_admin === true
  const canOrcamento = isAdmin || profile?.pode_orcamento === true
  const canEstoque = isAdmin || profile?.pode_estoque === true || profile?.email === ESTOQUE_EMAIL
  const canAgenteIA = isAdmin || profile?.pode_agente_ia === true
  const canPrecos = isAdmin || profile?.pode_precos === true
  const canFechamento = isAdmin || profile?.pode_fechamento === true
  // Badge de alertas só para quem tem acesso ao módulo — evita query desperdiçada
  const { data: estoqueAlertas = [] } = useEstoqueProdutosAlerta({ enabled: canEstoque })
  const { data: orcamentos = [], isLoading, isError, refetch } = useOrcamentos(
    (novo) => {
      toast('success', `Novo orçamento: ${novo.cliente ?? novo.responsavel ?? 'sem identificação'}`)
      if (!document.hasFocus()) setUnreadCount((n) => n + 1)
    },
    () => {
      // Pulsa as tabs de dados quando um orçamento é atualizado/deletado via realtime
      ;['orcamentos', 'planilha'].forEach(id => {
        setTabUpdatePulse(prev => new Set([...prev, id]))
        setTimeout(() => setTabUpdatePulse(prev => { const n = new Set(prev); n.delete(id); return n }), 800)
      })
    }
  )

  // Leads novos do WhatsApp aparecem sozinhos (toast + pulse na aba Agente IA)
  useAgenteIARealtime({
    enabled: canAgenteIA,
    onNewLead: (lead) => {
      toast('info', `Novo lead do WhatsApp: ${lead.nome ?? lead.whatsapp ?? 'sem identificação'}`)
      if (!document.hasFocus()) setUnreadCount((n) => n + 1)
      setTabUpdatePulse(prev => new Set([...prev, 'agente-ia']))
      setTimeout(() => setTabUpdatePulse(prev => { const n = new Set(prev); n.delete('agente-ia'); return n }), 800)
    },
  })

  const rawPath = location.pathname.replace(/^\//, '')
  const isEstoquePath = rawPath === 'estoque' || rawPath.startsWith('estoque/')
  const isAdminPath = rawPath === 'admin' || rawPath.startsWith('admin/')
  const estoqueSub = isEstoquePath ? (rawPath.split('/')[1] || 'visao-geral') : 'visao-geral'
  const adminSub = isAdminPath ? (rawPath.split('/')[1] || 'usuarios') : 'usuarios'
  const isOrcamentoPath = rawPath === 'orcamentos' || rawPath.startsWith('orcamentos/')
  const orcamentoSub = isOrcamentoPath ? (rawPath.split('/')[1] || DEFAULT_TAB) : null
  const tabFromUrl = isEstoquePath ? 'estoque'
    : isAdminPath ? 'admin'
    : isOrcamentoPath ? (orcamentoSub ?? DEFAULT_TAB)
    : (rawPath || DEFAULT_TAB)
  const ORCAMENTO_TABS = ['calcular-orcamento', 'simulador', 'planilha', 'calculo-custo', 'orcamentos', 'acompanhar']
  const RELATORIOS_TABS = ['relatorios', 'analises']
  // Enquanto o perfil carrega, não redireciona — evita flash para admins acessando /admin diretamente
  const activeTab = VALID_TABS.includes(tabFromUrl)
    && (tabFromUrl !== 'admin' || isAdmin || profileLoading)
    && (tabFromUrl !== 'precos' || canPrecos || profileLoading)
    && (tabFromUrl !== 'estoque' || canEstoque || profileLoading)
    && (tabFromUrl !== 'agente-ia' || canAgenteIA || profileLoading)
    && (tabFromUrl !== 'fechamento' || canFechamento || profileLoading)
    && (!RELATORIOS_TABS.includes(tabFromUrl) || canOrcamento || canFechamento || profileLoading)
    && (!ORCAMENTO_TABS.includes(tabFromUrl) || canOrcamento || profileLoading)
    ? tabFromUrl
    : DEFAULT_TAB
  const others = usePresence(profile ?? null, activeTab)

  const focusedOrcamentos = useMemo(
    () => focusResponsavel ? orcamentos.filter(o => o.responsavel === focusResponsavel) : orcamentos,
    [orcamentos, focusResponsavel]
  )

  const responsaveisUnicos = useMemo(
    () => [...new Set(orcamentos.map(o => o.responsavel))].filter(Boolean).sort(),
    [orcamentos]
  )

  function setFocus(nome: string | null) {
    setFocusResponsavel(nome)
    setFocusOpen(false)
    try {
      if (nome) localStorage.setItem('sombrear-focus-responsavel', nome)
      else localStorage.removeItem('sombrear-focus-responsavel')
    } catch { /* noop */ }
  }

  function timeAgo(ms: number): string {
    const s = Math.floor((Date.now() - ms) / 1000)
    if (s < 60) return `há ${s}s`
    const m = Math.floor(s / 60)
    if (m < 60) return `há ${m}min`
    return `há ${Math.floor(m / 60)}h`
  }

  useEffect(() => {
    const ADMIN_ORDER = ['usuarios', 'permissoes']
    const prev = prevAdminSubRef.current
    if (prev !== adminSub) {
      setAdminSubDir(ADMIN_ORDER.indexOf(adminSub) > ADMIN_ORDER.indexOf(prev) ? 'right' : 'left')
      prevAdminSubRef.current = adminSub
    }
  }, [adminSub])

  // Depois que o voo termina, solta o nome (evita shared element duplicado em transições futuras)
  useEffect(() => {
    if (!vtIcone) return
    const t = setTimeout(() => setVtIcone(null), 600)
    return () => clearTimeout(t)
  }, [vtIcone])
  // Voo de volta: ao clicar em ← Início, o ícone da área atual vira o shared element
  const [vtVolta, setVtVolta] = useState(false)
  const vtStyle = (cond: boolean) =>
    cond ? ({ viewTransitionName: 'icone-area' } as React.CSSProperties) : undefined

  function voltarInicio() {
    const area = isEstoqueArea ? 'estoque'
      : isAdminArea ? 'admin'
      : activeTab === 'agente-ia' ? 'agente-ia'
      : activeTab === 'precos' ? 'precos'
      : activeTab === 'fechamento' ? 'fechamento'
      : RELATORIOS_TABS.includes(activeTab) ? 'relatorios'
      : isOrcamentoArea ? 'orcamento' : null
    if (area) {
      try { sessionStorage.setItem('sombrear-vt-icone', area) } catch { /* voa sem aviso */ }
      flushSync(() => setVtVolta(true))
    }
    comTransicao(() => navigate('/'))
  }

  function handleTabChange(id: string) {
    const nextIdx = TABS.findIndex(t => t.id === id)
    const prevIdx = TABS.findIndex(t => t.id === activeTab)
    setTabDir(nextIdx >= prevIdx ? 'right' : 'left')
    uiSound.play('tab')
    haptic('light')
    setUnreadCount(0)
    setTabVersions(prev => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))
    const path = id === 'orcamento' ? `/orcamentos/${DEFAULT_TAB}`
      : ORCAMENTO_TABS.includes(id) ? `/orcamentos/${id}`
      : `/${id}`
    navigate(path)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleThemeToggle(e: React.MouseEvent) {
    const x = e.clientX
    const y = e.clientY
    type DocVT = Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }
    const doc = document as DocVT
    if (!doc.startViewTransition) { toggle(); return }
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
    const vt = doc.startViewTransition(() => { toggle() })
    vt.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 400, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' },
      )
    })
  }

  function handleTabRipple(e: React.MouseEvent<HTMLButtonElement>) {
    const btn = e.currentTarget
    const rect = btn.getBoundingClientRect()
    const ripple = document.createElement('span')
    ripple.className = 'tab-ripple'
    ripple.style.left = `${e.clientX - rect.left}px`
    ripple.style.top  = `${e.clientY - rect.top}px`
    btn.appendChild(ripple)
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true })
  }

  useEffect(() => {
    const section = SECTION_LABELS[activeTab] ?? 'Sombrear'
    document.title = unreadCount > 0 ? `(${unreadCount}) Sombrear - ${section}` : `Sombrear - ${section}`
  }, [unreadCount, activeTab])

  useEffect(() => {
    function handleFocus() { setUnreadCount(0) }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [])

  // Toasts emitidos fora da árvore React (ex.: QueryCache onError em main.tsx)
  useEffect(() => {
    function onAppToast(e: Event) {
      const d = (e as CustomEvent<{ type?: 'success' | 'error' | 'info'; message?: string }>).detail
      if (d?.message) toast(d.type ?? 'info', d.message)
    }
    window.addEventListener('app-toast', onAppToast)
    return () => window.removeEventListener('app-toast', onAppToast)
  }, [toast])

  // Atalhos de teclado globais
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const active = document.activeElement
      const inField = active && (
        active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.tagName === 'SELECT' ||
        (active as HTMLElement).isContentEditable
      )
      if (inField) return
      // '/' → foca o campo de busca
      if (e.key === '/') {
        e.preventDefault()
        const el = document.getElementById('filter-search-input') as HTMLInputElement | null
        el?.focus()
        el?.select()
      }
      // 'n' → abre novo orçamento (apenas nas tabs planilha e orcamentos)
      if ((e.key === 'n' || e.key === 'N') && (activeTab === 'planilha' || activeTab === 'orcamentos')) {
        const btn = document.getElementById('novo-orcamento-btn') as HTMLButtonElement | null
        btn?.click()
      }
      // 'p' → modo apresentação
      if (e.key === 'p' || e.key === 'P') {
        setPresentationOpen(v => !v)
      }
      // 'f' → abre/fecha seletor de Modo Foco
      if (e.key === 'f' || e.key === 'F') {
        setFocusOpen(v => !v)
      }
      // 'Escape' → sai do Modo Foco (se estiver ativo e sem outros modais abertos)
      if (e.key === 'Escape' && focusResponsavel && !profileModalOpen && !copilotOpen && !presentationOpen) {
        setFocus(null)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [activeTab, focusResponsavel, profileModalOpen, copilotOpen, presentationOpen])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (focusRef.current && !focusRef.current.contains(e.target as Node)) setFocusOpen(false)
    }
    if (focusOpen) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [focusOpen])

  useEffect(() => {
    setMountedTabs(prev => {
      if (prev.has(activeTab)) return prev
      // Não monta abas restritas enquanto o perfil está carregando ou sem permissão
      if (activeTab === 'admin' && (profileLoading || !isAdmin)) return prev
      if (activeTab === 'precos' && (profileLoading || !canPrecos)) return prev
      if (activeTab === 'agente-ia' && (profileLoading || !canAgenteIA)) return prev
      if (activeTab === 'simulador' && (profileLoading || !canOrcamento)) return prev
      if (activeTab === 'estoque' && (profileLoading || !canEstoque)) return prev
      return new Set([...prev, activeTab])
    })
  }, [activeTab, isAdmin, canEstoque, canPrecos, canAgenteIA, canOrcamento, profileLoading])

  // URLs antigas continuam funcionando: Agente IA e Tabela de Preços viraram áreas próprias,
  // e o custo dos materiais saiu do Estoque para Orçamentos › Custos (27/10)
  useEffect(() => {
    if (rawPath === 'orcamentos/agente-ia') navigate('/agente-ia', { replace: true })
    if (rawPath === 'admin/precos') navigate('/precos', { replace: true })
    if (rawPath === 'estoque/custos') navigate('/orcamentos/calculo-custo', { replace: true })
  }, [rawPath, navigate])

  useEffect(() => {
    // Preload apenas dos chunks que o perfil do usuário pode realmente abrir —
    // evita baixar Estoque/Admin (e suas libs) para quem só usa orçamentos
    if (profileLoading) return
    const preload = () => {
      if (canOrcamento) {
        import('@/components/tabs/TabOrcamentos')
        import('@/components/tabs/TabPlanilha')
        import('@/components/tabs/TabCotacao')
        import('@/components/tabs/TabAnalises')
        import('@/components/tabs/TabCustos')
      }
      if (canAgenteIA) import('@/components/agente/AbaAgente')
      if (isAdmin) import('@/components/admin/PainelAdmin')
      if (canPrecos) import('@/components/admin/TabPrecos')
      if (canEstoque) import('@/components/tabs/TabEstoque')
    }
    if ('requestIdleCallback' in window) {
      const id = (window as Window & { requestIdleCallback: (cb: () => void, opts?: object) => number })
        .requestIdleCallback(preload, { timeout: 3000 })
      return () => (window as Window & { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(id)
    } else {
      const t = setTimeout(preload, 2000)
      return () => clearTimeout(t)
    }
  }, [profileLoading, canOrcamento, canEstoque, canAgenteIA, canPrecos, isAdmin])

  // ── Splash screen: some quando dados carregam ──
  useEffect(() => {
    if (!isLoading && showSplash) {
      setSplashFading(true)
      const t = setTimeout(() => setShowSplash(false), 400)
      return () => clearTimeout(t)
    }
  }, [isLoading, showSplash])


  // ── Badge pulse no tab Orçamentos quando novo orçamento chega ──
  useEffect(() => {
    if (unreadCount > prevUnreadRef.current) {
      setOrcPulse(true)
      const t = setTimeout(() => setOrcPulse(false), 600)
      return () => clearTimeout(t)
    }
    prevUnreadRef.current = unreadCount
  }, [unreadCount])

  // ── Parallax background orbs ──
  useEffect(() => {
    function onScroll() { setScrollY(window.scrollY) }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // ── Favicon badge ──
  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 64; canvas.height = 64
    const ctx = canvas.getContext('2d')!
    // Draw orange rounded square
    const r = 12
    const [x, y, w, h] = [2, 2, 60, 60]
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r)
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r)
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r)
    ctx.closePath()
    ctx.fillStyle = '#E8701A'
    ctx.fill()
    ctx.fillStyle = 'white'
    ctx.font = 'bold 40px system-ui'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('S', 32, 35)
    if (unreadCount > 0) {
      ctx.beginPath()
      ctx.arc(51, 13, 13, 0, Math.PI * 2)
      ctx.fillStyle = '#EF4444'
      ctx.fill()
      ctx.fillStyle = 'white'
      ctx.font = 'bold 13px system-ui'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(unreadCount > 9 ? '9+' : String(unreadCount), 51, 13)
    }
    let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.href = canvas.toDataURL()
  }, [unreadCount])


  // ── Sliding tab indicator ──
  useEffect(() => {
    const bar = tabBarRef.current
    if (!bar) return
    requestAnimationFrame(() => {
      const indicatorTab = isEstoquePath ? estoqueSub : isAdminPath ? adminSub : activeTab
      const activeBtn = bar.querySelector(`[data-tab="${indicatorTab}"]`) as HTMLButtonElement | null
      if (!activeBtn) return
      const barRect = bar.getBoundingClientRect()
      const btnRect = activeBtn.getBoundingClientRect()
      setTabIndicator({
        left: btnRect.left - barRect.left + bar.scrollLeft,
        width: btnRect.width,
      })
      // mobile: a barra rola na horizontal — garante a aba ativa visível
      if (bar.scrollWidth > bar.clientWidth) {
        activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
      }
    })
  }, [activeTab, estoqueSub, isEstoquePath, adminSub, isAdminPath])

  const TABS = useMemo(() => [
    ...(canOrcamento ? [{ id: 'orcamento', label: 'Orçamentos', icon: FileText, badge: unreadCount }] : []),
    ...(canEstoque ? [{ id: 'estoque', label: 'Estoque', icon: Package, badge: estoqueAlertas.length }] : []),
    ...(isAdmin ? [{ id: 'admin', label: 'Admin', icon: ShieldCheck, badge: pendingCount }] : []),
  ], [isAdmin, canOrcamento, canEstoque, pendingCount, estoqueAlertas.length, unreadCount])

  const RELATORIOS_SUBTABS = useMemo(() => [
    { id: 'relatorios', label: 'Por canal', icon: BarChart2  },
    { id: 'analises',   label: 'Análises',  icon: TrendingUp },
  ], [])

  const ADMIN_SUBTABS = useMemo(() => [
    { id: 'usuarios',   label: 'Usuários',   icon: Users },
    { id: 'permissoes', label: 'Permissões', icon: ShieldCheck },
  ], [])

  const ESTOQUE_SUBTABS = useMemo(() => [
    { id: 'visao-geral',  label: 'Visão Geral',  icon: LayoutDashboard },
    { id: 'entradas',     label: 'Entradas',      icon: PackagePlus     },
    { id: 'vendas',       label: 'Vendas',        icon: ShoppingCart    },
    { id: 'produtos',     label: 'Produtos',      icon: Package         },
    { id: 'fornecedores', label: 'Fornecedores',  icon: Truck           },
    { id: 'localizacoes', label: 'Localizações',  icon: MapPin          },
    { id: 'sobras',       label: 'Sobras',        icon: Scissors        },
    { id: 'mercado-livre', label: 'Mercado Livre', icon: Store          },
    { id: 'analises',     label: 'Análises',      icon: BarChart2       },
    { id: 'acoes',        label: 'Ações',         icon: Zap             },
    { id: 'configuracao', label: 'Config.',        icon: Settings        },
  ], [])

  /* Quantos orçamentos recentes ainda esperam resposta. De propósito só os
     dos últimos 7 dias: com 492 em aberto, um contador do total viraria um
     "9+" permanente — ruído. Assim o número é sempre o que dá pra recuperar. */
  const aguardandoResposta = useMemo(
    () => orcamentos.filter(o => !o.desfecho && !o.fechado
      && Date.now() - new Date(o.created_at).getTime() <= 7 * 86_400_000).length,
    [orcamentos])

  const ORCAMENTO_SUBTABS = useMemo(() => [
    { id: 'calcular-orcamento', label: 'Calcular',  icon: Calculator    },
    { id: 'simulador',          label: 'Simulador', icon: Zap           },
    { id: 'planilha',           label: 'Planilha',  icon: ClipboardList },
    { id: 'calculo-custo',      label: 'Custos',    icon: ClipboardList },
    { id: 'orcamentos',         label: 'Lista',     icon: FileText      },
    { id: 'acompanhar',         label: 'Acompanhar', icon: ClipboardCheck, badge: aguardandoResposta },
  ], [aguardandoResposta])

  const isEstoqueArea = isEstoquePath
  const isAdminArea = isAdminPath && isAdmin
  const isOrcamentoArea = isOrcamentoPath || ORCAMENTO_TABS.includes(rawPath)
  const isRelatoriosArea = RELATORIOS_TABS.includes(activeTab) && !isOrcamentoPath

  function MagneticBtn({ children, style, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    const [off, setOff] = useState({ x: 0, y: 0 })
    function onMove(e: React.MouseEvent<HTMLButtonElement>) {
      const r = e.currentTarget.getBoundingClientRect()
      setOff({ x: (e.clientX - (r.left + r.width / 2)) * 0.38, y: (e.clientY - (r.top + r.height / 2)) * 0.38 })
    }
    function onLeave() { setOff({ x: 0, y: 0 }) }
    const isResting = off.x === 0 && off.y === 0
    return (
      <button
        {...props}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        style={{ transform: `translate(${off.x}px,${off.y}px)`, transition: isResting ? 'transform 300ms ease' : 'transform 80ms ease', ...style }}
      >
        {children}
      </button>
    )
  }

  function TabSkeleton() {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <SkeletonCard /><SkeletonCard /><SkeletonCard />
        <SkeletonCard /><SkeletonCard /><SkeletonCard />
      </div>
    )
  }

  function SkeletonForm() {
    return (
      <div className="space-y-4">
        <div className="h-7 w-48 rounded-lg skeleton-shimmer" />
        {[1,2,3,4].map(i => (
          <div key={i} className="rounded-xl border bg-card p-4 space-y-3">
            <div className="h-2.5 w-24 rounded skeleton-shimmer" />
            <div className="h-10 w-full rounded-lg skeleton-shimmer" />
          </div>
        ))}
        <div className="rounded-xl border bg-card p-5 space-y-3">
          <div className="h-2.5 w-32 rounded skeleton-shimmer" />
          <div className="h-8 w-40 rounded-lg skeleton-shimmer" />
        </div>
      </div>
    )
  }

  function SkeletonTable() {
    return (
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <div className="h-9 flex-1 max-w-xs rounded-lg skeleton-shimmer" />
          <div className="h-9 w-32 rounded-xl skeleton-shimmer" />
        </div>
        <div className="divide-y divide-border">
          {[1,2,3,4,5,6,7,8].map(i => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <div className="h-3 w-12 rounded skeleton-shimmer shrink-0" />
              <div className="h-3 flex-1 rounded skeleton-shimmer" />
              <div className="h-3 w-20 rounded skeleton-shimmer shrink-0" />
              <div className="h-3 w-16 rounded skeleton-shimmer shrink-0" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  function SkeletonKPITable() {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-7">
          <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <div className="h-9 flex-1 max-w-xs rounded-lg skeleton-shimmer" />
            <div className="h-9 w-32 rounded-xl skeleton-shimmer" />
          </div>
          <div className="divide-y divide-border">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <div className="h-3 w-12 rounded skeleton-shimmer shrink-0" />
                <div className="h-3 flex-1 rounded skeleton-shimmer" />
                <div className="h-3 w-20 rounded skeleton-shimmer shrink-0" />
                <div className="h-3 w-16 rounded skeleton-shimmer shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  function SkeletonCharts() {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border bg-card shadow-sm p-4 h-64 skeleton-shimmer" />
          <div className="rounded-xl border bg-card shadow-sm p-4 h-64 skeleton-shimmer" />
        </div>
        <div className="rounded-xl border bg-card shadow-sm p-4 h-48 skeleton-shimmer" />
      </div>
    )
  }

  return (
    <>
    {/* ── Splash Screen ── */}
    {showSplash && (
      <div
        className={cn(
          'fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background',
          splashFading && 'splash-overlay-out',
        )}
      >
        <div className="splash-icon-pulse flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-gradient shadow-brand">
          <span className="font-display text-3xl font-bold text-white">S</span>
        </div>
        <h2 className="mt-5 font-display text-xl font-bold text-foreground">Sombrear</h2>
        <p className="mt-1 text-sm text-muted-foreground">Carregando dados…</p>
        <div className="mt-6 h-1 w-48 overflow-hidden rounded-full bg-muted">
          <div className="splash-progress-bar h-1 rounded-full bg-primary" />
        </div>
      </div>
    )}

    <div className="min-h-dvh bg-background">
      {/* Background: dot grid + orbs de glassmorphism */}
      <div className="dot-grid fixed inset-0 -z-10 pointer-events-none" />
      <div
        className="fixed -z-10 pointer-events-none -top-40 -right-40 h-[550px] w-[550px] rounded-full bg-primary/[0.06] dark:bg-primary/[0.10] blur-3xl"
        style={{ transform: `translateY(${scrollY * 0.15}px)` }}
      />
      <div
        className="fixed -z-10 pointer-events-none -bottom-40 -left-40 h-[650px] w-[650px] rounded-full bg-amber-400/[0.05] dark:bg-amber-400/[0.08] blur-3xl"
        style={{ transform: `translateY(${-scrollY * 0.10}px)` }}
      />

      {/* Header */}
      <header className="header-aurora sticky top-0 z-50 border-b border-primary/15 bg-gradient-to-r from-card via-card to-primary/[0.04] backdrop-blur-md shadow-sm">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-gradient shadow-brand">
              <span className="font-display text-base font-bold text-white">S</span>
            </div>
            <div>
              <h1 className="font-display text-lg font-bold leading-none text-foreground">Sombrear</h1>
            </div>
          </div>

          <div className="flex items-center gap-1">

            {/* ── Grupo 1: Data ── */}
            <span className="hidden sm:block text-xs text-muted-foreground tabular-nums px-1">
              {new Date().toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })}
            </span>

            <span className="hidden sm:block h-4 w-px bg-border/50 mx-1.5" />

            {/* ── Grupo 2: Social — Presence + Foco ── */}
            {others.length > 0 && (
              <div className="hidden sm:flex items-center mr-1 relative group/presence">
                {others.slice(0, 3).map((u, idx) => (
                  <div key={u.id} className="relative ring-2 ring-emerald-400 rounded-full" style={{ marginLeft: idx === 0 ? 0 : '-6px', zIndex: 3 - idx }}>
                    <AvatarInitials name={u.name} size="sm" />
                    <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-400 ring-1 ring-background animate-pulse" />
                  </div>
                ))}
                {others.length > 3 && (
                  <span className="ml-0.5 text-[10px] font-semibold text-muted-foreground">+{others.length - 3}</span>
                )}
                {/* Hover card */}
                <div className="absolute top-full right-0 mt-2 z-50 hidden group-hover/presence:flex flex-col gap-1.5 min-w-[200px] rounded-xl border border-border bg-card shadow-elevated p-2.5 animate-in fade-in slide-in-from-top-1 duration-150">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-1.5 pb-1">Online agora</p>
                  {others.map(u => (
                    <div key={u.id} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-muted/60 transition-colors">
                      <AvatarInitials name={u.name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-foreground truncate">{u.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {SECTION_LABELS[u.tab] ?? u.tab}{u.at ? ` · ${timeAgo(u.at)}` : ''}
                        </p>
                      </div>
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Modo Foco */}
            <div ref={focusRef} className="relative">
              <MagneticBtn
                onClick={() => setFocusOpen(v => !v)}
                className={cn(
                  'rounded-lg p-2 transition-colors duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                  focusResponsavel
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
                title="Modo Foco (F)"
                aria-label="Modo Foco"
              >
                <Users className="h-4 w-4" />
              </MagneticBtn>
              {focusOpen && responsaveisUnicos.length > 0 && (
                <div className="absolute top-full right-0 mt-1 z-50 min-w-[160px] rounded-xl border border-border bg-card shadow-elevated py-1 animate-in fade-in slide-in-from-top-1 duration-150">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-3 py-1.5">Focar em</p>
                  {responsaveisUnicos.map(nome => (
                    <button
                      key={nome}
                      onClick={() => setFocus(focusResponsavel === nome ? null : nome)}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted transition-colors',
                        focusResponsavel === nome && 'text-primary font-semibold bg-primary/5'
                      )}
                    >
                      <AvatarInitials name={nome} size="sm" />
                      {nome}
                      {focusResponsavel === nome && <span className="ml-auto text-[10px] text-primary/60">ativo</span>}
                    </button>
                  ))}
                  {focusResponsavel && (
                    <button
                      onClick={() => setFocus(null)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-muted border-t border-border/50"
                    >
                      <X className="h-3 w-3" />Sair do modo foco
                    </button>
                  )}
                </div>
              )}
            </div>

            <span className="h-4 w-px bg-border/50 mx-1.5" />

            {/* ── Grupo 3: Ferramentas — Apresentação, Copilot, Som, Tema ── */}
            <MagneticBtn
              onClick={() => setPresentationOpen(true)}
              className="hidden sm:inline-flex rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              aria-label="Modo Apresentação"
              title="Modo Apresentação (P)"
            >
              <Tv2 className="h-4 w-4" />
            </MagneticBtn>

            <MagneticBtn
              onClick={() => setCopilotOpen(v => !v)}
              className={cn(
                'rounded-lg p-2 transition-colors duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                copilotOpen
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
              aria-label="Copilot IA"
              title="Copilot Sombrear (IA)"
            >
              <Sparkles className="h-4 w-4" />
            </MagneticBtn>

            <MagneticBtn
              onClick={uiSound.toggle}
              className="hidden sm:inline-flex rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              aria-label={uiSound.enabled ? 'Desativar sons' : 'Ativar sons'}
              title={uiSound.enabled ? 'Sons ativos' : 'Sons desativados'}
            >
              {uiSound.enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </MagneticBtn>

            <MagneticBtn
              onClick={handleThemeToggle}
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              aria-label={isDark ? 'Ativar modo claro' : 'Ativar modo escuro'}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </MagneticBtn>

            <span className="h-4 w-px bg-border/50 mx-1.5" />

            {/* ── Grupo 4: Usuário — Admin badge, Avatar, Sair ── */}
            {isAdmin && pendingCount > 0 && (
              <button
                onClick={() => handleTabChange('admin')}
                className="relative rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground hover:scale-110 transition-all duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                title="Aprovações pendentes"
                aria-label="Aprovações pendentes"
              >
                <ShieldCheck className="h-4 w-4" />
                <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">
                  {pendingCount}
                </span>
              </button>
            )}

            {profile && (
              <button
                onClick={() => setProfileModalOpen(true)}
                className="relative rounded-full hover:ring-2 hover:ring-primary/60 hover:ring-offset-2 hover:ring-offset-background transition-all duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                title="Meu perfil"
                aria-label="Meu perfil"
              >
                <AvatarInitials name={profile.full_name || profile.email} size="sm" />
                {isAdmin && (
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary ring-1 ring-background">
                    <ShieldCheck className="h-2 w-2 text-white" />
                  </span>
                )}
              </button>
            )}

            <MagneticBtn
              onClick={() => supabase.auth.signOut()}
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              title="Sair"
              aria-label="Sair"
            >
              <LogOut className="h-4 w-4" />
            </MagneticBtn>
          </div>
        </div>
      </header>

      {/* Modo Foco banner */}
      {focusResponsavel && (
        <div className="border-b border-primary/20 bg-primary/5 px-4 md:px-6 py-2 flex items-center gap-3">
          <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse shrink-0" />
          <span className="text-xs font-semibold text-primary/80 uppercase tracking-widest">Modo Foco</span>
          <AvatarInitials name={focusResponsavel} size="sm" />
          <span className="font-semibold text-sm text-foreground flex-1">{focusResponsavel}</span>
          <span className="text-xs text-muted-foreground hidden sm:block">
            {focusedOrcamentos.length} orçamento{focusedOrcamentos.length !== 1 ? 's' : ''} · apenas dados deste responsável
          </span>
          <button
            onClick={() => setFocus(null)}
            className="rounded-lg p-1.5 text-primary/60 hover:bg-primary/10 hover:text-primary transition-colors"
            title="Sair do Modo Foco (Esc)"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <TopLoadingBar />

      {/* Banner de erro: sem ele, uma falha na query principal renderizava o dash vazio em silêncio */}
      {isError && (
        <div className="mx-auto max-w-[1600px] px-4 pt-4 md:px-6">
          <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            <p className="flex-1 text-sm text-foreground">Não foi possível carregar os orçamentos. Verifique sua conexão.</p>
            <button
              onClick={() => refetch()}
              className="rounded-lg bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[1600px] px-4 py-4 md:px-6 md:py-6">
        {/* Tabs */}
        <div ref={tabBarRef} className="mb-6 relative flex gap-1 rounded-xl bg-muted/60 p-1 overflow-x-auto scrollbar-none">
          {/* Botão Início */}
          <button
            onClick={voltarInicio}
            className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-card/50 transition-all duration-100 whitespace-nowrap active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            title="Voltar ao início"
          >
            <span className="hidden sm:inline">← Início</span>
            <span className="sm:hidden">←</span>
          </button>
          <span className="w-px self-stretch bg-border/50 mx-0.5" />
          {/* Sliding underline indicator */}
          {tabIndicator.width > 0 && (
            <div
              className="tab-indicator pointer-events-none absolute bottom-1.5 left-0 h-0.5 w-24 rounded-full bg-primary/70"
              style={{
                transform: `translateX(${tabIndicator.left + 6}px) scaleX(${Math.max(tabIndicator.width - 12, 0) / 96})`,
                transformOrigin: 'left center',
              }}
            />
          )}
          {isEstoqueArea && ESTOQUE_SUBTABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                data-tab={id}
                onClick={() => {
                  uiSound.play('tab')
                  haptic('light')
                  navigate(`/estoque/${id}`)
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
                onMouseDown={handleTabRipple}
                title={label}
                className={cn(
                  'relative flex shrink-0 min-w-[60px] md:flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-all duration-100 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                  estoqueSub === id
                    ? 'bg-card text-primary shadow-elevated'
                    : 'text-muted-foreground hover:text-foreground hover:bg-card/50',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" style={vtStyle((vtIcone === 'estoque' || vtVolta) && estoqueSub === id)} />
                <span className="hidden sm:inline truncate">{label}</span>
              </button>
            ))
          }
          {isEstoqueArea && isAIEstoqueEnabled() && (
            <ChatIATabBtn onMouseDown={handleTabRipple} />
          )}
          {isAdminArea && ADMIN_SUBTABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              data-tab={id}
              onClick={() => {
                uiSound.play('tab')
                haptic('light')
                navigate(`/admin/${id}`)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              onMouseDown={handleTabRipple}
              title={label}
              className={cn(
                'relative flex flex-1 min-w-0 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-all duration-100 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                adminSub === id
                  ? 'bg-card text-primary shadow-elevated'
                  : 'text-muted-foreground hover:text-foreground hover:bg-card/50',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" style={vtStyle((vtIcone === 'admin' || vtVolta) && adminSub === id)} />
              <span className="hidden sm:inline truncate">{label}</span>
            </button>
          ))}
          {/* ORÇAMENTO SUBTABS */}
          {isOrcamentoArea && ORCAMENTO_SUBTABS.map(({ id, label, icon: Icon, badge }) => (
            <button
              key={id}
              data-tab={id}
              onClick={() => {
                uiSound.play('tab')
                haptic('light')
                navigate(`/orcamentos/${id}`)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              onMouseDown={handleTabRipple}
              title={label}
              className={cn(
                'relative flex shrink-0 min-w-[60px] md:flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-all duration-100 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                activeTab === id
                  ? 'bg-card text-primary shadow-elevated'
                  : 'text-muted-foreground hover:text-foreground hover:bg-card/50',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" style={vtStyle((vtIcone === 'orcamento' || vtVolta) && activeTab === id)} />
              <span className="hidden sm:inline truncate">{label}</span>
              {!!badge && badge > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
              {tabUpdatePulse.has(id) && (
                <span className="absolute inset-0 rounded-lg border-2 border-primary/50 pointer-events-none animate-[tabPulseHalo_800ms_ease-out_forwards]" />
              )}
            </button>
          ))}
          {isOrcamentoArea && (
            <AskIATabBtn
              onMouseDown={handleTabRipple}
              onClick={() => setCopilotOpen(v => !v)}
              active={copilotOpen}
            />
          )}

          {/* RELATÓRIOS SUBTABS */}
          {isRelatoriosArea && RELATORIOS_SUBTABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              data-tab={id}
              onClick={() => {
                uiSound.play('tab')
                haptic('light')
                navigate(`/${id}`)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              onMouseDown={handleTabRipple}
              title={label}
              className={cn(
                'relative flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-100 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                activeTab === id
                  ? 'bg-card text-primary shadow-elevated'
                  : 'text-muted-foreground hover:text-foreground hover:bg-card/50',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" style={vtStyle((vtIcone === 'relatorios' || vtVolta) && activeTab === id)} />
              <span className="hidden sm:inline truncate">{label}</span>
            </button>
          ))}
          {/* ÁREAS SOLO: dentro delas só existe a própria área — navegação entre áreas é pelo Início */}
          {(activeTab === 'agente-ia' || activeTab === 'precos' || activeTab === 'fechamento') ? (
            <button
              data-tab={activeTab}
              className="relative flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap bg-card text-primary shadow-elevated cursor-default"
            >
              {activeTab === 'fechamento'
                ? <><Wallet className="h-4 w-4 shrink-0" style={vtStyle(vtIcone === 'fechamento' || (vtVolta && activeTab === 'fechamento'))} />Semanário</>
                : activeTab === 'agente-ia'
                ? <><Bot className="h-4 w-4 shrink-0" style={vtStyle(vtIcone === 'agente-ia' || (vtVolta && activeTab === 'agente-ia'))} />Agente IA</>
                : <><CircleDollarSign className="h-4 w-4 shrink-0" style={vtStyle(vtIcone === 'precos' || (vtVolta && activeTab === 'precos'))} />Tabela de Preços</>}
            </button>
          ) : (
          /* SECTION TABS (fallback) */
          !isOrcamentoArea && !isEstoqueArea && !isAdminArea && !isRelatoriosArea && (
            TABS.map(({ id, label, icon: Icon, badge }) => (
              <button
                key={id}
                data-tab={id}
                onClick={() => handleTabChange(id)}
                onMouseDown={handleTabRipple}
                title={label}
                className={cn(
                  'relative flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-all duration-100 whitespace-nowrap active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                  activeTab === id
                    ? 'bg-card text-primary shadow-elevated'
                    : 'text-muted-foreground hover:text-foreground hover:bg-card/50',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">{label}</span>
                {badge > 0 && (
                  <span className="flex h-4 min-w-[1rem] px-1 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
                {id === 'orcamento' && orcPulse && (
                  <span className="badge-ping-once absolute inset-0 rounded-lg border-2 border-primary/60 pointer-events-none" />
                )}
              </button>
            ))
          ))}
        </div>

        <div>
          {mountedTabs.has('calcular-orcamento') && (
            <Suspense fallback={<SkeletonForm />}>
              <div className={activeTab === 'calcular-orcamento' ? (tabDir === 'right' ? 'tab-active-right' : 'tab-active-left') : 'tab-hidden'}>
                <TabCotacao />
              </div>
            </Suspense>
          )}
          {mountedTabs.has('planilha') && (
            <Suspense fallback={<SkeletonTable />}>
              <div className={activeTab === 'planilha' ? (tabDir === 'right' ? 'tab-active-right' : 'tab-active-left') : 'tab-hidden'}>
                <TabPlanilha data={focusedOrcamentos} loading={isLoading} toast={toast} />
              </div>
            </Suspense>
          )}
          {mountedTabs.has('agente-ia') && (
            <Suspense fallback={<SkeletonKPITable />}>
              <div className={activeTab === 'agente-ia' ? (tabDir === 'right' ? 'tab-active-right' : 'tab-active-left') : 'tab-hidden'}>
                <TabAgenteIA resetKey={tabVersions['agente-ia']} />
              </div>
            </Suspense>
          )}
          {mountedTabs.has('fechamento') && (
            <Suspense fallback={<SkeletonKPITable />}>
              <div className={activeTab === 'fechamento' ? (tabDir === 'right' ? 'tab-active-right' : 'tab-active-left') : 'tab-hidden'}>
                <TabFechamento />
              </div>
            </Suspense>
          )}
          {mountedTabs.has('simulador') && (
            <Suspense fallback={<SkeletonForm />}>
              <div className={activeTab === 'simulador' ? (tabDir === 'right' ? 'tab-active-right' : 'tab-active-left') : 'tab-hidden'}>
                <TabSimulador />
              </div>
            </Suspense>
          )}
          {mountedTabs.has('orcamentos') && (
            <Suspense fallback={<SkeletonKPITable />}>
              <div className={activeTab === 'orcamentos' ? (tabDir === 'right' ? 'tab-active-right' : 'tab-active-left') : 'tab-hidden'}>
                <TabOrcamentos data={focusedOrcamentos} loading={isLoading} resetKey={tabVersions['orcamentos']} />
                <JanelaDados className="mt-4" />
              </div>
            </Suspense>
          )}
          {mountedTabs.has('acompanhar') && (
            <Suspense fallback={<SkeletonKPITable />}>
              <div className={activeTab === 'acompanhar' ? (tabDir === 'right' ? 'tab-active-right' : 'tab-active-left') : 'tab-hidden'}>
                <TabAcompanhar />
              </div>
            </Suspense>
          )}
          {mountedTabs.has('relatorios') && (
            <Suspense fallback={<SkeletonKPITable />}>
              <div className={activeTab === 'relatorios' ? (tabDir === 'right' ? 'tab-active-right' : 'tab-active-left') : 'tab-hidden'}>
                <TabRelatorios />
              </div>
            </Suspense>
          )}
          {mountedTabs.has('calculo-custo') && (
            <Suspense fallback={<SkeletonTable />}>
              <div className={activeTab === 'calculo-custo' ? (tabDir === 'right' ? 'tab-active-right' : 'tab-active-left') : 'tab-hidden'}>
                <TabCustos podeVerMateriais={isAdmin} isLoading={isLoading} error={isError} toast={toast} />
              </div>
            </Suspense>
          )}
          {mountedTabs.has('analises') && (
            <Suspense fallback={<SkeletonCharts />}>
              <div className={activeTab === 'analises' ? (tabDir === 'right' ? 'tab-active-right' : 'tab-active-left') : 'tab-hidden'}>
                <TabAnalises data={focusedOrcamentos} isLoading={isLoading} error={isError} resetKey={tabVersions['analises']} focoResponsavel={focusResponsavel ?? undefined} />
              </div>
            </Suspense>
          )}
          {mountedTabs.has('estoque') && canEstoque && (
            <Suspense fallback={<TabSkeleton />}>
              <div className={activeTab === 'estoque' ? (tabDir === 'right' ? 'tab-active-right' : 'tab-active-left') : 'tab-hidden'}>
                <TabEstoque toast={toast} resetKey={tabVersions['estoque']} subTab={estoqueSub} />
              </div>
            </Suspense>
          )}
          {mountedTabs.has('precos') && canPrecos && (
            <Suspense fallback={<TabSkeleton />}>
              <div className={activeTab === 'precos' ? (tabDir === 'right' ? 'tab-active-right' : 'tab-active-left') : 'tab-hidden'}>
                <TabPrecos toast={toast} />
              </div>
            </Suspense>
          )}
          {mountedTabs.has('admin') && isAdmin && (
            <Suspense fallback={<TabSkeleton />}>
              <div className={activeTab === 'admin' ? (tabDir === 'right' ? 'tab-active-right' : 'tab-active-left') : 'tab-hidden'}>
                <div key={adminSub} className={adminSubDir === 'right' ? 'tab-active-right' : 'tab-active-left'}>
                  {adminSub === 'usuarios'   && <PainelAdmin toast={toast} />}
                  {adminSub === 'permissoes' && <PermissoesView toast={toast} />}
                </div>
              </div>
            </Suspense>
          )}
        </div>
      </main>

      {profileModalOpen && profile && (
        <EditProfileModal
          mode="self"
          targetProfile={profile}
          onClose={() => setProfileModalOpen(false)}
          toast={toast}
        />
      )}

      <CommandPalette open={paletteOpen} onClose={closePalette} orcamentos={orcamentos} />

      <Toaster toasts={toasts} onDismiss={dismiss} />

      <AICopilot open={copilotOpen} onClose={() => setCopilotOpen(false)} responsavel={focusResponsavel} />
      <PresentationMode open={presentationOpen} onClose={() => setPresentationOpen(false)} data={focusedOrcamentos} />
    </div>
    </>
  )
}
