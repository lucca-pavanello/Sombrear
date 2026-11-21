import React, { useState, useRef, useEffect, useMemo } from 'react'
import {
  useCrmLeads, useOrcamentosIA, useOrcamentosChat, useAtendimentoPorLead, useMensagensForaDoHorario, useMarcarConvertido, useDefinirOrigem, estaComEquipe,
  isLeadHistorico, mapaLeadsPorTelefone, acharLeadPorTelefone, normalizarTelefone,
  STATUS_CONVERTIDO, type CrmLead, type OrcamentoIA,
} from '@/hooks/useAgenteIA'
import { useOrcamentos } from '@/hooks/useOrcamentos'
import { cn, formatCurrency, valorNumerico } from '@/lib/utils'
import { Button } from '@/components/ui/primitives'
import SeloOrigem, {
  ORIGENS, SEM_ORIGEM, CANAIS_DO_DADO, GOOGLE_SITE, acharOrigem, acharCanal, contarGoogleSite, DivisaoGoogleSite,
} from '@/components/agente/SeloOrigem'
import SeloStatus, { precisaDeHumano } from '@/components/agente/SeloStatus'
import SeloComEquipe from '@/components/agente/SeloComEquipe'
import { CustomSelect } from '@/components/ui/CustomSelect'
import { useCountUp } from '@/hooks/useCountUp'
import {
  Bot, DollarSign, FileText, Moon, Users, CalendarCheck,
  ChevronDown, ChevronUp, ChevronsUpDown, Phone, ChevronRight,
  MessageSquare, CheckCircle2, Bell, Check, HandCoins,
  Clock, MessageCircle,  ChevronLeft,
  Minimize2, Maximize2, FilePlus2, ExternalLink, Headset, Eye,
  Search, X, Download,
} from 'lucide-react'
import { useConfigAutomacoes, useDefinirConfigAutomacao, IA_RESPONDE } from '@/hooks/useConfigAutomacoes'
import { Chave } from '@/components/agente/FollowupControle'
import DatePicker from '@/components/ui/DatePicker'
import AvisoErro from '@/components/shared/AvisoErro'
import NovoOrcamentoForm from '@/components/orcamentos/NovoOrcamentoForm'
import InsightsAmanda from '@/components/agente/InsightsAmanda'
import ClassificadorConversas, { SeloClassificacao } from '@/components/agente/ClassificadorConversas'
import FollowupControle from '@/components/agente/FollowupControle'
import { useProfile } from '@/hooks/useProfile'
import { ADMIN_EMAIL } from '@/lib/constants'
import { filterByPeriod } from '@/hooks/usePeriodFilter'
import { useToast } from '@/hooks/useToast'
import Toaster from '@/components/ui/Toaster'
import { HORA_INICIO, HORA_FIM, ESPERA_HORAS, LEADS_PAGE_SIZE, ORCS_PAGE_SIZE, MODELOS, CHATWOOT_BASE_URL } from '@/lib/constants'

/** quantas linhas cada lista mostra fechada */
const PREVIA_LISTA = 3

/** rodapé da lista fechada: abre a lista inteira, paginada */
function VerTodos({ total, rotulo, onClick }: { total: number; rotulo: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex w-full items-center justify-center gap-1.5 rounded-b-xl border-t px-5 py-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground">
      <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
      Ver {total === 1 ? '' : `todos os ${total} `}{rotulo}
    </button>
  )
}
import { tabela, segmentado, kpi, campoBusca } from '@/components/shared/estilos'
import { useDebounce } from '@/hooks/useDebounce'
import { exportCsv } from '@/lib/exportUtils'
import { ehConvertido, leadsQueCompraram, recebeuPreco } from '@/lib/analises/conversao'
import { chavePedido, dataVenda, ehTeste, ehVenda, receita } from '@/lib/analises/venda'
import { calcularFunilAtendimento } from '@/lib/analises/funilAtendimento'
import { FunilAtendimento } from '@/components/agente/FunilAtendimento'
import { diaDaCasa } from '@/lib/fusoCasa'

// ── Horário comercial ────────────────────────────────────────────────────────

function formatWaNumber(whatsapp: string): string {
  const digits = whatsapp.replace(/\D/g, '')
  return digits.startsWith('55') ? digits : `55${digits}`
}

function chatwootUrl(lead: CrmLead): string | null {
  if (!lead.id_conta_chatwoot || !lead.id_conversa_chatwoot) return null
  return `${CHATWOOT_BASE_URL}/app/accounts/${lead.id_conta_chatwoot}/conversations/${lead.id_conversa_chatwoot}`
}

// Monta o pré-preenchimento do NovoOrcamentoForm a partir de um lead do agente
function leadToOrcamentoInitial(l: CrmLead) {
  const medidas = l.medidas_coletadas?.match(/(\d+[.,]?\d*)\s*[x×]\s*(\d+[.,]?\d*)/i)
  const modeloMatch = MODELOS.find((m) => l.modelo_interesse?.toLowerCase().includes(m.toLowerCase()))
  const qtd = parseInt(l.quantidade ?? '', 10)
  // "R$ 1.234,56" → "1234.56" (pré-preenche o valor de venda com o último valor cotado pela IA)
  const valorCotado = l.ultimo_valor_cotado
    ? parseFloat(l.ultimo_valor_cotado.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'))
    : NaN
  return {
    valor_venda: Number.isFinite(valorCotado) && valorCotado > 0 ? String(valorCotado) : '',
    responsavel: 'Stella',
    cliente: l.nome ?? '',
    telefone: l.whatsapp ?? '',
    ambiente: l.ambiente ?? '',
    modelo: modeloMatch ?? MODELOS[0],
    tecido: l.tecido_cor ?? '',
    quantidade: Number.isInteger(qtd) && qtd >= 1 ? String(qtd) : '1',
    largura: medidas ? medidas[1].replace(',', '.') : '',
    altura: medidas ? medidas[2].replace(',', '.') : '',
    acabamentos: l.acabamento_desejado ?? '',
    observacoes: [
      'Criado a partir de lead do Agente IA (WhatsApp).',
      l.modelo_interesse && !modeloMatch ? `Modelo de interesse: ${l.modelo_interesse}` : null,
      l.medidas_coletadas && !medidas ? `Medidas coletadas: ${l.medidas_coletadas}` : null,
      l.ultimo_valor_cotado ? `Último valor cotado pela IA: ${l.ultimo_valor_cotado}` : null,
      l.precisa_instalacao ? `Instalação: ${l.precisa_instalacao}` : null,
      l.endereco_cep ? `CEP: ${l.endereco_cep}` : null,
    ].filter(Boolean).join('\n'),
  }
}

function isForaDoHorario(dateStr: string | null) {
  if (!dateStr) return false
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return false
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: 'numeric',
    weekday: 'short',
    hour12: false,
  }).formatToParts(d)
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10)
  const weekday = parts.find(p => p.type === 'weekday')?.value?.toLowerCase() ?? ''
  const isWeekend = weekday.startsWith('sáb') || weekday.startsWith('dom')
  return isWeekend || hour < HORA_INICIO || hour >= HORA_FIM
}

function horasDecorridas(ts: string | null | undefined): number {
  if (!ts) return 0
  return (Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60)
}

// ── Formatação ───────────────────────────────────────────────────────────────
function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
function fmtTime(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

// ── Sistema de cores de status (paleta da marca) ──────────────────────────────


/** viaVenda = achou uma venda fechada da LOJA (fora do chat) com o telefone deste lead. */
function isConvertido(s: string | null, viaVenda = false) {
  const v = s?.toLowerCase().trim() ?? ''
  return v === STATUS_CONVERTIDO || v === 'fechado' || viaVenda
}
function isAguardando(s: string | null) {
  // inclui o estágio "4" do agente: ele já fez o que podia, agora é humano
  return precisaDeHumano(s)
}

// ── Componentes auxiliares ───────────────────────────────────────────────────
const PERIODOS = [
  { value: 'todos',  label: 'Tudo' },
  { value: 'hoje',   label: 'Hoje' },
  { value: 'semana', label: 'Semana' },
  { value: 'mes',    label: 'Mês' },
  { value: 'custom', label: 'Período' },
]

function PeriodTabs({
  value, onChange, customFrom, customTo, onFromChange, onToChange,
}: {
  value: string
  onChange: (v: string) => void
  customFrom: string
  customTo: string
  onFromChange: (v: string) => void
  onToChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className={segmentado.trilho}>
        {PERIODOS.map(({ value: v, label }) => (
          <button key={v} onClick={() => onChange(v)}
            className={cn(segmentado.item, value === v ? segmentado.ativo : segmentado.inativo)}>
            {label}
          </button>
        ))}
      </div>
      {value === 'custom' && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">De</span>
          <DatePicker value={customFrom} onChange={onFromChange} placeholder="Data inicial" max={customTo || undefined} />
          <span className="text-xs font-medium text-muted-foreground">até</span>
          <DatePicker value={customTo} onChange={onToChange} placeholder="Data final" min={customFrom || undefined} />
        </div>
      )}
    </div>
  )
}

function KpiCard({ label, value, icon: Icon, sub, attention, destaque, delay }: {
  label: string; value: string | number; icon: React.ElementType
  alcance?: boolean; attention?: boolean; destaque?: boolean; sub?: string; delay: number
}) {
  // mesma composição do card da Lista de orçamentos: centrado, chip em cima.
  // Cartão neutro e número escuro: com 10 cards, fundo e número laranja em todos viravam
  // uma parede de cor e nada se destacava. A cor fica no ícone; o âmbar só no que pede ação.
  const tom = attention ? 'amber' : 'primario'
  return (
    <div
      className={cn('animate-in fade-in-0 slide-in-from-bottom-4 duration-500 hover:shadow-md cursor-default',
        kpi.cartao, kpi.acento.neutro)}
      style={{ animationFillMode: 'both', animationDelay: `${delay}ms` }}
    >
      <div className="flex flex-col items-center text-center gap-0.5">
        <div className={cn(kpi.chip, kpi.chipCor[tom])}><Icon className="h-4 w-4" /></div>
        <p className={cn(kpi.rotulo, 'w-full')}>{label}</p>
        <p className={cn(kpi.valor, attention ? kpi.valorCor.amber : destaque ? kpi.valorCor.primario : kpi.valorCor.neutro, 'truncate')}>{value}</p>
        {sub && <p className={cn(kpi.sub, 'w-full')}>{sub}</p>}
      </div>
    </div>
  )
}

type LeadSortKey = 'created_at' | 'nome' | 'timestamp_ultima_msg' | 'origem' | 'valor' | 'status'
type LeadSort = { key: LeadSortKey; dir: 'asc' | 'desc' }

type OrcSort  = { key: 'created_at' | 'modelo' | 'valor'; dir: 'asc' | 'desc' }

// ── Componente principal ─────────────────────────────────────────────────────
/** Chip de canal: mostra quantos leads vieram dali e filtra a tela inteira */
function FiltroOrigem({ id, rotulo, total, ativo, onClick, divisao }: {
  id: string
  rotulo: string
  total: number
  ativo: boolean
  onClick: () => void
  /** só no Google + Site: quantos de cada um, pequeno, dentro do chip */
  divisao?: { google: number; site: number }
}) {
  const o = id === 'todas' ? null : acharOrigem(id)
  const Icone = o?.icone
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-all active:scale-95',
        ativo
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
      )}
    >
      {Icone && <Icone className="h-3 w-3 shrink-0" aria-hidden="true" />}
      {rotulo}
      <span className={cn('tabular-nums', ativo ? 'text-primary' : 'text-foreground/45')}>{total}</span>
      {divisao && <DivisaoGoogleSite {...divisao} className="ml-0.5 font-normal" />}
    </button>
  )
}

/** Rótulo de bloco do painel do lead — um estilo só pra todos */
/**
 * Liga/desliga a voz da IA sem desativar o workflow — desativar mataria o webhook e o
 * CRM pararia de receber as conversas. Em "só observando" ela continua registrando tudo.
 * Só admin vê (e a RLS de config_automacoes só deixa admin escrever).
 */
function InterruptorIA({ toast }: { toast: (t: 'success' | 'error' | 'info', m: string) => void }) {
  const { data: config } = useConfigAutomacoes()
  const { mutate: definir, isPending } = useDefinirConfigAutomacao()
  if (!config || config[IA_RESPONDE] == null) return null

  const respondendo = config[IA_RESPONDE] !== '0'
  const alternar = (ligar: boolean) => definir(
    { chave: IA_RESPONDE, valor: ligar ? '1' : '0' },
    {
      onSuccess: () => toast('success', ligar
        ? 'IA voltou a responder os clientes.'
        : 'IA em modo observação — segue registrando as conversas, sem responder.'),
      onError: (err) => toast('error', err instanceof Error ? err.message : 'Não consegui mudar o modo da IA.'),
    },
  )

  return (
    <div className={cn(
      'flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 shadow-sm',
      respondendo ? 'bg-card' : 'border-amber-500/40 bg-amber-500/[0.07]',
    )}>
      <div className="flex items-center gap-2.5">
        <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          respondendo ? 'bg-primary/10 text-primary' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400')}>
          {respondendo ? <Bot className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </div>
        <div>
          <p className="text-sm font-semibold">{respondendo ? 'IA respondendo os clientes' : 'IA só observando'}</p>
          <p className="text-xs text-muted-foreground">
            {respondendo
              ? 'Atende sozinha e passa pra equipe quando precisa'
              : 'Recebe e registra as conversas no CRM, mas não responde ninguém'}
          </p>
        </div>
      </div>
      <Chave ligado={respondendo} onChange={alternar} ocupado={isPending} />
    </div>
  )
}

function RotuloPainel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-center text-[11px] font-bold uppercase tracking-widest text-foreground/45">
      {children}
    </p>
  )
}

/** Campo do painel: some quando está vazio, sem deixar buraco no grid */
function CampoLead({ rotulo, valor, destaque }: {
  rotulo: string
  valor: string | number | null | undefined
  destaque?: boolean
}) {
  if (valor == null || valor === '') return null
  return (
    <div className="min-w-0 text-center">
      <dt className="mb-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
      <dd className={cn('truncate text-sm', destaque ? 'font-bold tabular-nums text-primary' : 'font-medium')}
        title={String(valor)}>
        {valor}
      </dd>
    </div>
  )
}

export default function TabAgenteIA({ resetKey }: { resetKey?: number } = {}) {
  // isPending, não isLoading: se a 1ª leitura falha com a aba em segundo plano, o React Query pausa
  // a nova tentativa e isLoading vira false sem dado nenhum. A tela mostrava zeros como se fossem fato.
  const { data: leads = [], isPending: loadingCrm, isError: errorCrm, refetch: refetchCrm } = useCrmLeads()
  const { data: orcamentosIA = [], isPending: loadingOrc, isError: errorOrc, refetch: refetchOrc } = useOrcamentosIA()
  // orçamento mandado no chat, pela IA ou pela equipe (0026)
  const { data: orcamentosChat = [] } = useOrcamentosChat()
  const { data: atendimentoLista = [] } = useAtendimentoPorLead()
  const { data: msgsForaLista = [] } = useMensagensForaDoHorario()
  // Vendas REAIS da loja (Semanário/Acompanhar) — usadas só pra achar, pelo telefone,
  // um lead que fechou fora do chat (balcão, telefone) sem ninguém marcar "Converteu" nele.
  const { data: orcamentosLoja = [] } = useOrcamentos()
  const { mutate: marcarConvertido, isPending: marcando } = useMarcarConvertido()
  const { mutate: definirOrigem, isPending: salvandoOrigem } = useDefinirOrigem()
  const { toasts, toast, dismiss } = useToast()
  const { data: perfil } = useProfile()
  const ehAdmin = perfil?.email === ADMIN_EMAIL || perfil?.is_admin === true

  const [periodo, setPeriodo] = useState('todos')
  // filtro de canal: o gestor de tráfego entra por aqui
  const [origemFiltro, setOrigemFiltro] = useState('todas')
  const [busca, setBusca] = useState('')
  const buscaDebounced = useDebounce(busca, 220)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [leadSort, setLeadSort] = useState<LeadSort>({ key: 'created_at', dir: 'desc' })
  const [orcSort,  setOrcSort]  = useState<OrcSort>({  key: 'created_at', dir: 'desc' })
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [mobileConfirmId, setMobileConfirmId] = useState<string | null>(null)
  const [leadsPage, setLeadsPage] = useState(1)
  const [orcsPage, setOrcsPage] = useState(1)
  // as duas listas abrem fechadas, mostrando só as 3 mais recentes; abertas, paginam de 12
  const [leadsCollapsed, setLeadsCollapsed] = useState(true)
  const [orcsCollapsed, setOrcsCollapsed] = useState(true)
  const [leadOrcamento, setLeadOrcamento] = useState<CrmLead | null>(null)
  const [orcFechado, setOrcFechado] = useState(false)

  // Orçamentos da IA indexados por lead (cliente_id FK + identificador_whats)
  const orcsPorLead = useMemo(() => {
    const map = new Map<string, OrcamentoIA[]>()
    const add = (key: string, o: OrcamentoIA) => {
      const arr = map.get(key)
      if (arr) { if (!arr.some(x => x.id === o.id)) arr.push(o) }
      else map.set(key, [o])
    }
    for (const o of orcamentosIA) {
      if (o.cliente_id) add(`id:${o.cliente_id}`, o)
      const wa = o.identificador_whats?.replace(/\D/g, '')
      if (wa) add(`wa:${wa}`, o)
    }
    return map
  }, [orcamentosIA])

  function orcsDoLead(lead: CrmLead): OrcamentoIA[] {
    const byId = orcsPorLead.get(`id:${lead.id}`) ?? []
    const wa = (lead.whatsapp ?? lead.identificador_usuario ?? '').replace(/\D/g, '')
    const byWa = wa ? (orcsPorLead.get(`wa:${wa}`) ?? []) : []
    const seen = new Set<string>()
    return [...byId, ...byWa].filter(o => (seen.has(o.id) ? false : (seen.add(o.id), true)))
  }

  /* De quem é cada orçamento — o caminho inverso de orcsDoLead */
  const leadPorOrc = useMemo(() => {
    const map = new Map<string, CrmLead>()
    for (const lead of leads) {
      for (const o of orcsDoLead(lead)) if (!map.has(o.id)) map.set(o.id, lead)
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, orcsPorLead])

  const initialOrcamento = useMemo(
    () => (leadOrcamento ? leadToOrcamentoInitial(leadOrcamento) : undefined),
    [leadOrcamento]
  )

  // Reset pages when filters or sort changes
  useEffect(() => { setLeadsPage(1) }, [periodo, leadSort, customFrom, customTo, origemFiltro, buscaDebounced])
  useEffect(() => { setOrcsPage(1) }, [periodo, orcSort, customFrom, customTo])
  useEffect(() => { setExpandedId(null) }, [leadsPage])

  // Track first data load — skip count-up re-animation on period changes
  const hasLoadedRef = useRef(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  useEffect(() => {
    if (!loadingCrm && !loadingOrc && !hasLoadedRef.current) {
      hasLoadedRef.current = true
      const t = setTimeout(() => setHasLoaded(true), 1200)
      return () => clearTimeout(t)
    }
  }, [loadingCrm, loadingOrc])

  // Conversas históricas do WhatsApp da loja (status_lead='historico') existem para a
  // leitura da IA — ficam FORA dos KPIs, do funil e da lista da operação viva da Stella,
  // senão meses de conversa antiga distorceriam as métricas do atendimento atual.
  const { leadsVivos, historicos } = useMemo(() => ({
    leadsVivos: leads.filter(l => !isLeadHistorico(l)),
    historicos: leads.filter(isLeadHistorico),
  }), [leads])

  // Telefone → lead, pra achar quem fechou no balcão sem passar pelo botão "Converteu".
  const leadPorTelefone = useMemo(() => mapaLeadsPorTelefone(leads), [leads])
  // só venda feita no dia em que o lead chegou ou depois (src/lib/analises/conversao.ts)
  const convertidosPorTelefone = useMemo(
    () => leadsQueCompraram(orcamentosLoja, tel => acharLeadPorTelefone(leadPorTelefone, tel)),
    [orcamentosLoja, leadPorTelefone])

  // O período do lead é a ATIVIDADE (última mensagem), não a criação da linha:
  // um cliente antigo que volta a escrever hoje precisa aparecer em "hoje" — a linha
  // dele pode ter sido criada meses atrás (importação do histórico da loja).
  const dataAtividade = (l: CrmLead): string => {
    const ultima = l.timestamp_ultima_msg ? new Date(l.timestamp_ultima_msg).getTime() : NaN
    const criada = new Date(l.created_at).getTime()
    return Number.isFinite(ultima) && ultima > criada ? (l.timestamp_ultima_msg as string) : l.created_at
  }

  const doPeriodo = useMemo(
    () => filterByPeriod(leadsVivos, periodo, dataAtividade, customFrom || undefined, customTo || undefined),
    [leadsVivos, periodo, customFrom, customTo]
  )

  /* Quantos leads por canal — alimenta os chips e serve de leitura rápida */
  const porOrigem = useMemo(() => {
    const mapa = new Map<string, number>()
    for (const l of doPeriodo) {
      const id = acharCanal(l.origem).id
      mapa.set(id, (mapa.get(id) ?? 0) + 1)
    }
    return mapa
  }, [doPeriodo])
  const divisaoGoogleSite = useMemo(() => contarGoogleSite(doPeriodo, l => l.origem), [doPeriodo])

  const filtrados = useMemo(
    () => origemFiltro === 'todas'
      ? doPeriodo
      : doPeriodo.filter(l => acharCanal(l.origem).id === origemFiltro),
    [doPeriodo, origemFiltro]
  )
  // o chip de canal vale também para os orçamentos: o canal é o do lead dono do orçamento
  const orcFiltrados = useMemo(() => {
    const doPer = filterByPeriod(orcamentosIA, periodo, (o) => o.created_at, customFrom || undefined, customTo || undefined)
    if (origemFiltro === 'todas') return doPer
    return doPer.filter(o => acharCanal(leadPorOrc.get(o.id)?.origem).id === origemFiltro)
  }, [orcamentosIA, periodo, customFrom, customTo, origemFiltro, leadPorOrc])

  // KPIs
  const { aguardando, convertidos, comMedicao, foraLeads, foraMsgs, mensagensTotais, valorTotal } = useMemo(() => ({
    aguardando:      filtrados.filter((l) => isAguardando(l.status_lead)),
    convertidos:     filtrados.filter((l) => ehConvertido(l, convertidosPorTelefone)),
    // medição é da equipe: a Amanda não oferece horário de visita, então só vale o que a
    // equipe marcou no WhatsApp (resumo das conversas, 0027). Lucca, 02/10.
    comMedicao:      filtrados.filter((l) => !!l.medicao_equipe?.trim()),
    foraLeads:       filtrados.filter((l) => isForaDoHorario(l.created_at)),
    foraMsgs:        filtrados.filter((l) => isForaDoHorario(l.timestamp_ultima_msg)),
    mensagensTotais: filtrados.filter((l) => !!l.timestamp_ultima_msg).length,
    valorTotal:      orcFiltrados.reduce((s, o) =>
      s + (o.valor_venda_total_base ?? 0) + (o.valor_venda_acabamento_total ?? 0) + (o.valor_colocacao ?? 0), 0),
  }), [filtrados, orcFiltrados, convertidosPorTelefone])

  // conversas que uma atendente assumiu: a IA está calada e quem toca é gente
  const comEquipe = useMemo(() => filtrados.filter(estaComEquipe), [filtrados])

  const idsConvertidos = useMemo(() => new Set(convertidos.map(l => l.id)), [convertidos])

  // Mensagens de clientes que chegaram fora do comercial no período (0028). Antes o card
  // contava leads cuja ÚLTIMA mensagem foi fora do horário, e passava do "Pessoas fora do
  // horário" sem explicação. "Na hora" = a Amanda respondeu em até 5 minutos.
  const msgsFora = useMemo(() => {
    const porId = new Map(leadsVivos.map(l => [l.id, l]))
    const doPer = filterByPeriod(msgsForaLista, periodo, (m) => m.recebida_em, customFrom || undefined, customTo || undefined)
      .filter(m => {
        const lead = m.lead_id ? porId.get(m.lead_id) : undefined
        return !!lead && (origemFiltro === 'todas' || acharCanal(lead.origem).id === origemFiltro)
      })
    const iaNaHora = doPer.filter(m => m.respondida_por === 'ia' && (m.minutos_ate_resposta ?? Infinity) <= 5).length
    return { total: doPer.length, iaNaHora }
  }, [msgsForaLista, leadsVivos, periodo, customFrom, customTo, origemFiltro])

  // Valor cotado: o ÚLTIMO orçamento de cada lead mandado no período, pela IA ou pela
  // equipe. Último, e não a soma, porque a loja reenvia o orçamento revisado e somar
  // contaria a mesma venda duas vezes. O canal segue o chip do topo.
  const cotacao = useMemo(() => {
    const porId = new Map(leadsVivos.map(l => [l.id, l]))
    const doPer = filterByPeriod(orcamentosChat, periodo, (o) => o.enviado_em, customFrom || undefined, customTo || undefined)
      .filter(o => {
        const lead = o.lead_id ? porId.get(o.lead_id) : undefined
        return !!lead && (origemFiltro === 'todas' || acharCanal(lead.origem).id === origemFiltro)
      })
    const ultimo = new Map<string, number>()
    const ia = new Set<string>()
    const equipe = new Set<string>()
    // a lista vem do mais novo para o mais antigo: o primeiro de cada lead é o último enviado
    for (const o of doPer) {
      const id = o.lead_id as string
      if (!ultimo.has(id)) ultimo.set(id, o.valor ?? 0)
      ;(o.autor === 'ia' ? ia : equipe).add(id)
    }
    let valor = 0
    for (const v of ultimo.values()) valor += v
    return { valor, leads: ultimo.size, ia: ia.size, equipe: equipe.size }
  }, [orcamentosChat, leadsVivos, periodo, customFrom, customTo, origemFiltro])
  // Quanto os convertidos do período realmente pagaram: as vendas da loja casadas pelo
  // telefone, feitas no dia em que o lead chegou ou depois (mesma regra do "Convertidos").
  // Quem foi marcado no botão "Converteu" sem venda lançada no Semanário soma zero aqui.
  const { valorFechado, pedidosFechados } = useMemo(() => {
    let total = 0
    const pedidos = new Set<string>()
    for (const o of orcamentosLoja) {
      if (!ehVenda(o) || ehTeste(o)) continue
      const lead = acharLeadPorTelefone(leadPorTelefone, o.telefone)
      if (!lead || !idsConvertidos.has(lead.id)) continue
      const diaVenda = diaDaCasa(dataVenda(o))
      const diaLead = diaDaCasa(lead.created_at)
      if (!diaVenda || !diaLead || diaVenda < diaLead) continue
      total += receita(o)
      pedidos.add(chavePedido(o))
    }
    return { valorFechado: total, pedidosFechados: pedidos.size }
  }, [orcamentosLoja, leadPorTelefone, idsConvertidos])

  // Funil do atendimento (02/10): cada etapa com o seu dono, cada lead uma vez por etapa.
  // Mesmo conjunto de leads dos KPIs (período + canal).
  const funil = useMemo(() => calcularFunilAtendimento({
    leads: filtrados,
    atendimento: new Map(atendimentoLista.map(a => [a.lead_id, a])),
    orcamentosChat,
    idsConvertidos,
    vendaNoFechamento: convertidosPorTelefone,
    cotouForaDoChat: l => recebeuPreco(l.ultimo_valor_cotado) || orcsDoLead(l).length > 0,
  }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [filtrados, atendimentoLista, orcamentosChat, idsConvertidos, convertidosPorTelefone, orcsPorLead])

  const animLeads      = useCountUp(filtrados.length, 700, hasLoaded, resetKey)
  const animConv       = useCountUp(convertidos.length, 750, hasLoaded, resetKey)
  const animValor      = useCountUp(cotacao.valor, 900, hasLoaded, resetKey)
  const animMed        = useCountUp(comMedicao.length, 750, hasLoaded, resetKey)
  const animForaLeads  = useCountUp(foraLeads.length, 700, hasLoaded, resetKey)
  const animMsgs       = useCountUp(mensagensTotais, 750, hasLoaded, resetKey)
  const animForaMsgs   = useCountUp(msgsFora.total, 700, hasLoaded, resetKey)
  const animFechado    = useCountUp(valorFechado, 900, hasLoaded, resetKey)
  const animComEquipe  = useCountUp(comEquipe.length, 700, hasLoaded, resetKey)

  const alcanceKpis = [
    { label: 'Pessoas respondidas',      value: Math.round(animLeads),     icon: Users,         alcance: true,  sub: 'atendidas pelo agente' },
    { label: 'Pessoas fora do horário',  value: Math.round(animForaLeads), icon: Moon,          alcance: true,  sub: 'entraram fora do comercial' },
    { label: 'Com conversa',             value: Math.round(animMsgs),      icon: MessageSquare, alcance: true,  sub: 'leads que trocaram mensagem' },
    { label: 'Msgs fora do horário',     value: Math.round(animForaMsgs),  icon: MessageCircle, alcance: true,
      sub: msgsFora.total > 0 ? `a Amanda respondeu ${msgsFora.iaNaHora} na hora` : 'de clientes, fora do comercial' },
  ]

  // 01/10 (Lucca): o Operacional fica no que diz resultado. "Aguardando atendimento" já tem
  // a faixa logo acima, e "Em espera" repetia a mesma ideia; o valor fechado entra ao lado
  // do cotado, porque o que a loja quer saber é quanto rendeu, não só quanto foi orçado.
  const opKpis: { label: string; value: string | number; icon: React.ElementType; sub: string; destaque?: boolean }[] = [
    { label: 'Convertidos',            value: Math.round(animConv),    icon: CheckCircle2,  sub: `de ${filtrados.length} leads` },
    { label: 'Valor fechado',          value: valorFechado > 0 ? formatCurrency(animFechado) : '—', icon: HandCoins, destaque: true,
      sub: pedidosFechados > 0 ? `${pedidosFechados} pedido${pedidosFechados !== 1 ? 's' : ''} lançado${pedidosFechados !== 1 ? 's' : ''}` : 'nenhuma venda lançada' },
    { label: 'Valor cotado',           value: cotacao.valor > 0 ? formatCurrency(animValor) : '—', icon: DollarSign,
      sub: cotacao.leads > 0 ? `${cotacao.leads} lead${cotacao.leads !== 1 ? 's' : ''} · IA ${cotacao.ia} · equipe ${cotacao.equipe}` : 'nenhum orçamento no período' },
    { label: 'Medições agendadas',     value: Math.round(animMed),     icon: CalendarCheck,
      sub: comMedicao.length > 0 ? 'marcadas pela equipe' : 'nenhuma no período' },
    { label: 'Com a equipe',           value: Math.round(animComEquipe), icon: Headset, sub: 'atendimento humano assumiu' },
  ]

  /**
   * Busca só da TABELA — de propósito não entra nos KPIs, no funil nem no card da Amanda.
   * Procurar um cliente é navegação; se mexesse nos indicadores, o número do funil mudaria
   * enquanto alguém digita, o que não faz sentido nenhum.
   *
   * Telefone casa por dígitos normalizados: quem digita "17 99704-1997" precisa achar o
   * lead gravado como "5517997041997".
   */
  const leadsVisiveis = useMemo(() => {
    const termo = buscaDebounced.trim().toLowerCase()
    if (!termo) return filtrados
    const digitos = termo.replace(/\D/g, '')
    return filtrados.filter(l => {
      if (digitos.length >= 4 && normalizarTelefone(l.whatsapp).includes(normalizarTelefone(digitos))) return true
      return [l.nome, l.modelo_interesse, l.ambiente, l.tecido_cor]
        .some(v => v?.toLowerCase().includes(termo))
    })
  }, [filtrados, buscaDebounced])

  const sortedLeads = useMemo(() => {
    const sinal = leadSort.dir === 'asc' ? 1 : -1
    return [...leadsVisiveis].sort((a, b) => {
      // quem está esperando atendimento humano fica no topo, acima de qualquer ordenação
      // escolhida: é fila de gente esperando, não preferência de visualização
      const wa = isAguardando(a.status_lead) ? -1 : 0
      const wb = isAguardando(b.status_lead) ? -1 : 0
      if (wa !== wb) return wa - wb

      // Valor é número disfarçado de texto — comparar como string colocaria
      // "R$ 1.100,00" antes de "R$ 900,00". Sem valor vai sempre pro fim, nas duas
      // direções: linha vazia no topo não é informação, é ruído.
      if (leadSort.key === 'valor') {
        const av = valorNumerico(a.ultimo_valor_cotado)
        const bv = valorNumerico(b.ultimo_valor_cotado)
        if (Number.isNaN(av) && Number.isNaN(bv)) return 0
        if (Number.isNaN(av)) return 1
        if (Number.isNaN(bv)) return -1
        return (av - bv) * sinal
      }

      let av: string, bv: string
      if (leadSort.key === 'nome') { av = a.nome ?? ''; bv = b.nome ?? '' }
      else if (leadSort.key === 'timestamp_ultima_msg') { av = a.timestamp_ultima_msg ?? ''; bv = b.timestamp_ultima_msg ?? '' }
      // ordena pelo RÓTULO normalizado do canal, não pelo texto cru: assim "google" e
      // "google_ads" ficam juntos em vez de separados por causa da grafia
      else if (leadSort.key === 'origem') { av = acharOrigem(a.origem).rotulo; bv = acharOrigem(b.origem).rotulo }
      else if (leadSort.key === 'status') { av = a.status_lead ?? ''; bv = b.status_lead ?? '' }
      else { av = a.created_at; bv = b.created_at }

      // Datas são ISO, então comparação de string funciona e é mais barata. Texto vai de
      // localeCompare, senão acento e caixa ordenam errado ("Ângela" caía depois de "Zeca").
      const ehData = leadSort.key === 'created_at' || leadSort.key === 'timestamp_ultima_msg'
      const cmp = ehData
        ? (av < bv ? -1 : av > bv ? 1 : 0)
        : av.localeCompare(bv, 'pt-BR', { sensitivity: 'base' })
      return cmp * sinal
    })
  }, [leadsVisiveis, leadSort])

  const sortedOrcs = useMemo(() => {
    return [...orcFiltrados].sort((a, b) => {
      let av: string | number, bv: string | number
      if (orcSort.key === 'modelo') { av = a.modelo ?? ''; bv = b.modelo ?? '' }
      else if (orcSort.key === 'valor') {
        av = (a.valor_venda_total_base ?? 0) + (a.valor_venda_acabamento_total ?? 0) + (a.valor_colocacao ?? 0)
        bv = (b.valor_venda_total_base ?? 0) + (b.valor_venda_acabamento_total ?? 0) + (b.valor_colocacao ?? 0)
      } else { av = a.created_at; bv = b.created_at }
      if (av < bv) return orcSort.dir === 'asc' ? -1 : 1
      if (av > bv) return orcSort.dir === 'asc' ? 1 : -1
      return 0
    })
  }, [orcFiltrados, orcSort])

  const totalLeadPages = Math.ceil(sortedLeads.length / LEADS_PAGE_SIZE)
  const paginatedLeads = useMemo(
    () => leadsCollapsed
      ? sortedLeads.slice(0, PREVIA_LISTA)
      : sortedLeads.slice((leadsPage - 1) * LEADS_PAGE_SIZE, leadsPage * LEADS_PAGE_SIZE),
    [sortedLeads, leadsPage, leadsCollapsed]
  )

  const totalOrcPages = Math.ceil(sortedOrcs.length / ORCS_PAGE_SIZE)
  const paginatedOrcs = useMemo(
    () => orcsCollapsed
      ? sortedOrcs.slice(0, PREVIA_LISTA)
      : sortedOrcs.slice((orcsPage - 1) * ORCS_PAGE_SIZE, orcsPage * ORCS_PAGE_SIZE),
    [sortedOrcs, orcsPage, orcsCollapsed]
  )

  /**
   * Exporta o que está na tela DEPOIS de período, canal, busca e ordenação — e todas as
   * páginas, não só a atual. Exportar a página é o erro clássico aqui: quem filtra "Google"
   * quer os 17, que hoje estão espalhados em 5 páginas de 20.
   */
  function exportarLeads() {
    if (!sortedLeads.length) return
    const canal = origemFiltro === 'todas' ? 'todos-canais' : origemFiltro
    const hoje = new Date().toISOString().slice(0, 10)
    exportCsv(`leads-${canal}-${hoje}.csv`, sortedLeads.map(l => ({
      entrada: new Date(l.created_at).toLocaleDateString('pt-BR'),
      nome: l.nome ?? '',
      origem: acharOrigem(l.origem).rotulo,
      whatsapp: l.whatsapp ?? '',
      modelo: l.modelo_interesse ?? '',
      ambiente: l.ambiente ?? '',
      ultimo_valor: l.ultimo_valor_cotado ?? '',
      ultima_mensagem: l.timestamp_ultima_msg ? new Date(l.timestamp_ultima_msg).toLocaleString('pt-BR') : '',
      status: l.status_lead ?? '',
    })))
    toast('success', `${sortedLeads.length} lead${sortedLeads.length !== 1 ? 's' : ''} exportado${sortedLeads.length !== 1 ? 's' : ''}.`)
  }

  // ── Th helpers ───────────────────────────────────────────────────────────────
  function LeadTh({ label, k }: { label: string; k?: LeadSortKey }) {
    const active = k && leadSort.key === k
    return (
      <th className={cn(tabela.th, tabela.regua, 'text-center', k && tabela.thOrdenavel)}
        onClick={() => k && setLeadSort(s => s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'desc' })}>
        <span className="inline-flex items-center gap-1 justify-center">
          {label}
          {k && (active
            ? (leadSort.dir === 'asc' ? <ChevronUp className="h-3 w-3 text-primary" /> : <ChevronDown className="h-3 w-3 text-primary" />)
            : <ChevronsUpDown className="h-3 w-3 opacity-40" />)}
        </span>
      </th>
    )
  }

  function OrcTh({ label, k }: { label: string; k?: 'created_at' | 'modelo' | 'valor' }) {
    const active = k && orcSort.key === k
    return (
      <th className={cn(tabela.th, tabela.regua, 'text-center', k && tabela.thOrdenavel)}
        onClick={() => k && setOrcSort(s => s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'desc' })}>
        <span className="inline-flex items-center gap-1 justify-center">
          {label}
          {k && (active
            ? (orcSort.dir === 'asc' ? <ChevronUp className="h-3 w-3 text-primary" /> : <ChevronDown className="h-3 w-3 text-primary" />)
            : <ChevronsUpDown className="h-3 w-3 opacity-40" />)}
        </span>
      </th>
    )
  }

  // esqueleto com a forma e a ordem reais (padrão EsqueletoVisaoGeral do Garimpo):
  // interruptor, filtro, os dois grupos de KPI, funil e a lista
  if (loadingCrm || loadingOrc) {
    const linha = (fonte: string, largura: string) => (
      <span className={cn('flex h-[1lh] items-center', fonte)}><span className={cn('h-[0.7em] rounded skeleton-shimmer', largura)} /></span>
    )
    const cartaoKpi = (i: number) => (
      <div key={i} className={cn(kpi.cartao, kpi.acento.neutro, 'flex flex-col items-center gap-0.5 text-center')}>
        <span className={cn(kpi.chip, 'h-7 w-7 skeleton-shimmer')} />
        {linha(kpi.rotulo, 'w-24')}
        <span className={cn(kpi.valor, 'flex h-[1lh] items-center')}><span className="h-[0.8em] w-12 rounded skeleton-shimmer" /></span>
        {linha(kpi.sub, 'w-20')}
      </div>
    )
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Carregando o Agente IA">
        {ehAdmin && <div className="h-[66px] rounded-xl border bg-card shadow-sm" />}
        <div className="flex flex-col items-center gap-3">
          <span className="h-9 w-72 rounded-xl skeleton-shimmer" />
          <span className="h-[26px] w-96 max-w-full rounded-full skeleton-shimmer" />
        </div>
        <div className="space-y-3">
          {linha('text-[10px]', 'w-20')}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[0, 1, 2, 3, 4].map(cartaoKpi)}</div>
          {linha('pt-1 text-[10px]', 'w-28')}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map(cartaoKpi)}</div>
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          {linha('mb-3 text-sm', 'w-72 max-w-full')}
          <div className="grid grid-cols-[1fr_4.5rem_1fr] items-center gap-x-2 gap-y-2 sm:grid-cols-[1fr_9rem_1fr] sm:gap-x-3">
            {linha('text-[10px]', 'w-20')}<span />{linha('text-[10px] justify-end', 'w-14')}
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="contents">
                <div className="h-6 rounded-md skeleton-shimmer" />
                {linha('text-xs justify-center', 'w-16')}
                <div className="h-6 rounded-md skeleton-shimmer" />
              </div>
            ))}
          </div>
        </div>
        <div className="h-96 rounded-xl border bg-card shadow-sm" />
      </div>
    )
  }

  // sem nenhuma conversa lida, só o erro: os KPIs mostrariam zero como se fosse verdade
  if (errorCrm && leads.length === 0) {
    return (
      <div className="space-y-5">
        {ehAdmin && <InterruptorIA toast={toast} />}
        <AvisoErro mensagem="Não consegui ler as conversas agora." aoTentar={() => void refetchCrm()} className="py-8" />
        <Toaster toasts={toasts} onDismiss={dismiss} />
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {ehAdmin && <InterruptorIA toast={toast} />}

      {/* erro com dado velho em cache: o aviso vai no topo, por cima do dado (antes ficava
          lá embaixo, junto da tabela, e os números de cima pareciam frescos) */}
      {errorCrm && (
        <AvisoErro mensagem="Não consegui atualizar as conversas agora. Mostrando o que foi lido por último."
          aoTentar={() => void refetchCrm()} />
      )}

      {/* ── Período e canal no topo: eles controlam a página inteira (KPIs, funil, leitura
           da IA, insights e as listas). No meio da página, quem trocava o período não via
           os números de cima mudarem. ── */}
      <div className="space-y-3">
        <div className="flex justify-center">
          <PeriodTabs
            value={periodo}
            onChange={(v) => { setPeriodo(v); if (v !== 'custom') { setCustomFrom(''); setCustomTo('') } }}
            customFrom={customFrom}
            customTo={customTo}
            onFromChange={setCustomFrom}
            onToChange={setCustomTo}
          />
        </div>

        {/* O rótulo existe porque sem ele os chips passavam por legenda de cor: têm a mesma
            aparência dos selos de origem das linhas, que são só leitura. Gente abria a tela
            querendo "ver só os do Google" e não percebia que era só clicar. */}
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <span className="mr-0.5 text-xs font-medium text-muted-foreground">Filtrar por canal:</span>
          <FiltroOrigem id="todas" rotulo="Todos os canais" total={doPeriodo.length}
            ativo={origemFiltro === 'todas'} onClick={() => setOrigemFiltro('todas')} />
          {[...CANAIS_DO_DADO, SEM_ORIGEM]
            .filter(o => (porOrigem.get(o.id) ?? 0) > 0)
            .map(o => (
              <FiltroOrigem key={o.id} id={o.id} rotulo={o.rotulo} total={porOrigem.get(o.id) ?? 0}
                ativo={origemFiltro === o.id} onClick={() => setOrigemFiltro(o.id)}
                divisao={o.id === GOOGLE_SITE.id ? divisaoGoogleSite : undefined} />
            ))}
        </div>
      </div>

      {/* ── Quem espera gente agora: o que pede ação vem antes de qualquer número ── */}
      {aguardando.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-4 flex items-center gap-3">
          <Bell className="h-5 w-5 text-amber-500 shrink-0 animate-pulse" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
              {aguardando.length} lead{aguardando.length !== 1 ? 's' : ''} aguardando atendimento humano
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              A IA passou o orçamento e o cliente quer falar com um atendente. Aparecem no topo da lista de leads.
            </p>
          </div>
        </div>
      )}

      {/* ── KPIs: o Operacional lidera (Aguardando e Em espera em âmbar); o Alcance, volume
           do que a IA atendeu, vem depois. Mesmos cards, mesma cascata e contagem. ── */}
      <div key={periodo} className="space-y-3 animate-in fade-in-0 duration-200">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-0.5">Operacional</p>
        <div className="kpi-cascade grid grid-cols-2 gap-3 lg:grid-cols-5">
          {opKpis.map(({ label, value, icon, destaque, sub }, i) => (
            <KpiCard key={label} label={label} value={value} icon={icon}
              destaque={destaque} sub={sub} delay={i * 80} />
          ))}
        </div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-0.5 pt-1">Alcance do Agente</p>
        <div className="kpi-cascade grid grid-cols-2 gap-3 lg:grid-cols-4">
          {alcanceKpis.map(({ label, value, icon, alcance, sub }, i) => (
            <KpiCard key={label} label={label} value={value} icon={icon}
              alcance={alcance} sub={sub} delay={i * 80 + 480} />
          ))}
        </div>
      </div>

      {/* ── Funil de conversão ── */}
      <FunilAtendimento funil={funil} />

      {/* ── Veredito da IA por conversa (venda / negociação / perdida + motivo) ──
           inclui as históricas de propósito: são o material mais rico de leitura */}
      <ClassificadorConversas leads={[...filtrados, ...historicos]} toast={toast} />

      {/* ── Insights da Amanda: o que trava os clientes, contado por etiqueta ──
           recebe `leads` cru de propósito: o card tem base própria (aplica período e
           canal, mas não o corte de funil do isLeadHistorico) — o porquê está no arquivo */}
      <InsightsAmanda
        leads={leads}
        periodo={periodo}
        customFrom={customFrom || undefined}
        customTo={customTo || undefined}
        origemFiltro={origemFiltro}
        idOrigem={(l) => acharCanal(l.origem).id}
        compraram={convertidosPorTelefone}
        toast={toast}
      />

      {/* ── Follow-up automático (só admin controla) ── */}
      {ehAdmin && <FollowupControle toast={toast} />}

      {/* ── Tabela de Leads ── */}
      <div className="rounded-xl border bg-card shadow-sm">
        {/* Header centralizado — clicável para colapsar */}
        <button
          type="button"
          onClick={() => { setLeadsCollapsed(v => !v); setLeadsPage(1) }}
          aria-expanded={!leadsCollapsed}
          className="relative flex w-full items-center justify-center border-b px-5 py-4 hover:bg-muted/30 transition-colors rounded-t-xl"
        >
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <h2 className="font-display text-sm font-semibold tracking-wide">Leads do Agente IA</h2>
            <span className="text-xs text-muted-foreground">{leadsVisiveis.length} lead{leadsVisiveis.length !== 1 ? 's' : ''}</span>
          </div>
          <span className="absolute right-4 rounded-lg p-1.5 text-muted-foreground">
            {leadsCollapsed ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
          </span>
        </button>

        {(
          <>
            {/* Barra de ferramentas da tabela: busca, eco do filtro ativo e exportação.
                O eco existe porque o filtro de canal vive ACIMA do card — quem chega aqui
                vendo 17 linhas em vez de 87 não tinha como saber por quê, nem como voltar. */}
            {!leadsCollapsed && <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
              <div className="relative min-w-[200px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" aria-hidden="true" />
                <input
                  type="search"
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  placeholder="Buscar por nome ou telefone…"
                  aria-label="Buscar lead por nome ou telefone"
                  className={campoBusca}
                />
              </div>

              {origemFiltro !== 'todas' && (
                <button
                  type="button"
                  onClick={() => setOrigemFiltro('todas')}
                  title="Remover o filtro de canal"
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/15"
                >
                  {acharOrigem(origemFiltro).rotulo}
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              )}

              <button
                type="button"
                onClick={exportarLeads}
                disabled={leadsVisiveis.length === 0}
                title="Baixar em CSV tudo que está filtrado, não só esta página"
                className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Exportar
              </button>
            </div>}

            {leadsVisiveis.length === 0 ? (
            <div className="py-12 text-center space-y-1">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/60">
                <Bot className="h-6 w-6 text-muted-foreground/50" />
              </div>
              <p className="text-sm font-medium">
                {buscaDebounced ? 'Nenhum lead encontrado' : 'Nenhum lead aqui'}
              </p>
              <p className="text-sm text-muted-foreground">
                {buscaDebounced
                  ? `Nada casa com "${buscaDebounced}"${origemFiltro !== 'todas' ? ` no canal ${acharOrigem(origemFiltro).rotulo}` : ''}.`
                  : leads.length > 0 ? 'Tente outro período ou canal.' : 'Quando alguém falar com a Amanda no WhatsApp, aparece aqui na hora.'}
              </p>
            </div>
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={tabela.theadRow}>
                      <LeadTh label="Entrada"       k="created_at" />
                      <LeadTh label="Nome"           k="nome" />
                      <LeadTh label="Origem" k="origem" />
                      <th className={cn(tabela.th, tabela.regua, 'text-center')}>WhatsApp</th>
                      <th className={cn(tabela.th, tabela.regua, 'text-center')}>Modelo / Ambiente</th>
                      <LeadTh label="Último valor" k="valor" />
                      <LeadTh label="Últ. mensagem"  k="timestamp_ultima_msg" />
                      <LeadTh label="Status" k="status" />
                      <th className="whitespace-nowrap px-4 py-3 text-center text-xs font-semibold text-muted-foreground">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedLeads.map((lead, rowIdx) => {
                      const conv      = isConvertido(lead.status_lead, convertidosPorTelefone.has(lead.id))
                      const foraMsg   = isForaDoHorario(lead.timestamp_ultima_msg)
                      const foraEntr  = isForaDoHorario(lead.created_at)
                      const expanded  = expandedId === lead.id
                      const emEspera  = !conv && horasDecorridas(lead.timestamp_ultima_msg) > ESPERA_HORAS

                      return (
                        <React.Fragment key={lead.id}>
                          <tr
                            className={cn(
                              'border-b last:border-0 transition-colors cursor-pointer',
                              conv && 'opacity-60',
                              // sem banho âmbar na linha (01/10, Lucca: lista colorida demais): quem
                              // pede humano já tem o selo de status em âmbar e sobe pro topo da lista
                              expanded ? 'bg-muted/30'
                                : rowIdx % 2 === 1 ? 'bg-muted/[0.15]' : '',
                              expanded ? '' : 'hover:bg-muted/30',
                            )}
                            onClick={() => setExpandedId(expanded ? null : lead.id)}
                          >
                            <td className="px-4 py-3.5 text-center text-muted-foreground tabular-nums whitespace-nowrap border-r border-border/20">
                              <span className="block">{fmtDate(lead.created_at)}</span>
                              <span className="flex items-center justify-center gap-1 text-xs opacity-70">
                                {fmtTime(lead.created_at)}
                                {foraEntr && <Moon className="h-2.5 w-2.5 text-amber-500" />}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 text-center font-medium border-r border-border/20">
                              <span className="block">{lead.nome ?? '—'}</span>
                              <span className="mt-1 flex flex-wrap items-center justify-center gap-1">
                                <SeloClassificacao lead={lead} neutro />
                                {estaComEquipe(lead) && <SeloComEquipe />}
                              </span>
                            </td>
                            <td className="border-r border-border/20 px-4 py-3.5 text-center">
                              {/* clicar no selo filtra por aquele canal — é o gesto que a
                                  pessoa tenta ao ver a coluna e querer "só os do Google" */}
                              <button
                                type="button"
                                onClick={() => setOrigemFiltro(acharCanal(lead.origem).id)}
                                title={`Ver só os leads de ${acharCanal(lead.origem).rotulo}`}
                                className="rounded-full transition-opacity hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                              >
                                <SeloOrigem origem={lead.origem} campanha={lead.origem_campanha} neutro />
                              </button>
                            </td>
                            <td className="px-4 py-3.5 text-center border-r border-border/20" onClick={() => setExpandedId(expanded ? null : lead.id)}>
                              {lead.whatsapp ? (
                                <span className="flex items-center justify-center gap-1.5">
                                  <span className="text-muted-foreground text-xs flex items-center gap-1">
                                    <Phone className="h-3 w-3 shrink-0" />
                                    {lead.whatsapp}
                                  </span>
                                  <a
                                    href={`https://wa.me/${formatWaNumber(lead.whatsapp)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    title="Abrir no WhatsApp"
                                    className="flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                                  >
                                    <MessageCircle className="h-3 w-3 shrink-0" />
                                    WA
                                  </a>
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3.5 text-center border-r border-border/20" onClick={() => setExpandedId(expanded ? null : lead.id)}>
                              <span className="block font-medium">{lead.modelo_interesse ?? '—'}</span>
                              {lead.ambiente && <span className="text-xs text-muted-foreground">{lead.ambiente}</span>}
                            </td>
                            <td className="px-4 py-3.5 text-center font-medium tabular-nums border-r border-border/20" onClick={() => setExpandedId(expanded ? null : lead.id)}>
                              {lead.ultimo_valor_cotado && !isNaN(parseFloat(lead.ultimo_valor_cotado))
                                ? formatCurrency(parseFloat(lead.ultimo_valor_cotado))
                                : (lead.ultimo_valor_cotado ?? '—')}
                            </td>
                            <td className="px-4 py-3.5 text-center tabular-nums whitespace-nowrap border-r border-border/20" onClick={() => setExpandedId(expanded ? null : lead.id)}>
                              <span className="flex items-center justify-center gap-1 text-sm text-muted-foreground">
                                {emEspera && <Clock className="h-3 w-3 text-amber-500 shrink-0" />}
                                {fmtDate(lead.timestamp_ultima_msg)}
                              </span>
                              <span className="flex items-center justify-center gap-1 text-xs opacity-70">
                                {fmtTime(lead.timestamp_ultima_msg)}
                                {foraMsg && <MessageSquare className="h-2.5 w-2.5 text-amber-500" />}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 text-center border-r border-border/20" onClick={() => setExpandedId(expanded ? null : lead.id)}>
                              <SeloStatus status={lead.status_lead} motivo={lead.status_motivo} />
                            </td>
                            <td className="px-4 py-3.5 text-center">
                              <div className="inline-flex items-center gap-1.5 justify-center">
                                {!conv && (
                                  confirmId === lead.id ? (
                                    <div className="flex items-center justify-center gap-1">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          marcarConvertido(lead.id, {
                                            onError: () => toast('error', 'Erro ao marcar como convertido.'),
                                            onSuccess: () => {
                                              // já emenda o fechamento: form pré-preenchido salvando direto como fechado
                                              setOrcFechado(true)
                                              setLeadOrcamento(lead)
                                              toast('success', 'Convertido! Confira os dados e salve o orçamento fechado.')
                                            },
                                          })
                                          setConfirmId(null)
                                        }}
                                        disabled={marcando}
                                        className="rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-60 transition-colors"
                                      >
                                        {marcando ? '…' : <><Check className="inline h-3 w-3 mr-1" />Confirmar</>}
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setConfirmId(null) }}
                                        className="rounded-lg border px-2 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
                                      >
                                        Não
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setConfirmId(lead.id) }}
                                      title="Marca este lead como convertido no CRM. Para registrar o faturamento, feche o orçamento correspondente na aba Planilha."
                                      className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-colors"
                                    >
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                      Converteu
                                    </button>
                                  )
                                )}
                                {chatwootUrl(lead) && (
                                  <a
                                    href={chatwootUrl(lead)!}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    title="Abrir conversa no Chatwoot"
                                    className="rounded-lg border p-1.5 text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-colors"
                                  >
                                    <MessageSquare className="h-3.5 w-3.5" />
                                  </a>
                                )}
                                <button
                                  onClick={(e) => { e.stopPropagation(); setExpandedId(expanded ? null : lead.id) }}
                                  className="rounded p-1 hover:bg-muted transition-colors"
                                >
                                  <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
                                </button>
                              </div>
                            </td>
                          </tr>

                          {expanded && (
                            <tr key={`${lead.id}-exp`} className="border-b bg-muted/10">
                              <td colSpan={9} className="px-6 py-5">
                                <div className="mx-auto w-full max-w-4xl space-y-4">
                                {lead.resumo_conversa && (
                                  <div className="rounded-xl border bg-card p-4">
                                    <RotuloPainel>Resumo da conversa</RotuloPainel>
                                    {/* prosa longa fica presa em ~70ch: a tabela é larga demais pra ler corrido */}
                                    <p className="mx-auto max-w-[68ch] text-pretty text-center text-sm leading-relaxed text-foreground/75">
                                      {lead.resumo_conversa}
                                    </p>
                                  </div>
                                )}

                                {/* auto-fit: os campos preenchem a linha em vez de deixar buraco */}
                                <dl className="grid gap-x-6 gap-y-3 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
                                  <div className="min-w-0 text-center">
                                    <dt className="mb-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                                      Origem
                                    </dt>
                                    <dd onClick={e => e.stopPropagation()}>
                                      <CustomSelect
                                        value={acharOrigem(lead.origem).id === SEM_ORIGEM.id ? '' : acharOrigem(lead.origem).id}
                                        onChange={(v: string) => definirOrigem({ id: lead.id, origem: v || null })}
                                        options={[
                                          { value: '', label: 'Sem origem' },
                                          ...ORIGENS.map(o => ({ value: o.id, label: o.rotulo })),
                                        ]}
                                        className={cn('w-full py-1.5', salvandoOrigem && 'opacity-60')}
                                      />
                                    </dd>
                                  </div>
                                  <CampoLead rotulo="Campanha" valor={lead.origem_campanha} />
                                  <CampoLead rotulo="Por que está neste estágio" valor={lead.status_motivo} />
                                  <CampoLead rotulo="Medidas" valor={lead.medidas_coletadas} />
                                  <CampoLead rotulo="Tecido / Cor" valor={lead.tecido_cor} />
                                  <CampoLead rotulo="Acabamento" valor={lead.acabamento_desejado} />
                                  <CampoLead rotulo="Instalação" valor={lead.precisa_instalacao} />
                                  <CampoLead rotulo="Data medição" valor={lead.data_medicao_instalacao} destaque />
                                  <CampoLead rotulo="CEP" valor={lead.endereco_cep} />
                                  <CampoLead rotulo="Cidade" valor={lead.cidade} />
                                  <CampoLead rotulo="Tipo de imóvel" valor={lead.tipo_imovel} />
                                  <CampoLead rotulo="Quantidade" valor={lead.quantidade} />
                                  <CampoLead rotulo="Último valor cotado" valor={lead.ultimo_valor_cotado} destaque />
                                </dl>

                                {/* Orçamentos da IA vinculados a este lead */}
                                {(() => {
                                  const orcs = orcsDoLead(lead)
                                  if (orcs.length === 0) return null
                                  return (
                                    <div className="border-t border-border/40 pt-4">
                                      <RotuloPainel>Orçamentos da IA deste lead ({orcs.length})</RotuloPainel>
                                      <div className="flex flex-wrap justify-center gap-2">
                                        {orcs.map(o => {
                                          const total = (o.valor_venda_total_base ?? 0) + (o.valor_venda_acabamento_total ?? 0) + (o.valor_colocacao ?? 0)
                                          return (
                                            <span key={o.id}
                                              className="inline-flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-xs">
                                              <FileText className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
                                              <span className="font-medium">{o.modelo ?? '—'}</span>
                                              {o.largura && o.altura && (
                                                <span className="tabular-nums text-muted-foreground">{o.largura}×{o.altura}m</span>
                                              )}
                                              {/* valor sempre no mesmo lugar: sem ele as pastilhas ficavam desencontradas */}
                                              <span className={cn('ml-auto tabular-nums',
                                                total > 0 ? 'font-bold text-primary' : 'text-muted-foreground/40')}>
                                                {total > 0 ? formatCurrency(total) : 'sem valor'}
                                              </span>
                                              <span className="tabular-nums text-muted-foreground/60">{fmtDate(o.created_at)}</span>
                                            </span>
                                          )
                                        })}
                                      </div>
                                    </div>
                                  )
                                })()}

                                {/* Ações do lead */}
                                <div className="flex flex-wrap justify-center gap-2 border-t border-border/40 pt-4">
                                  <Button size="sm"
                                    onClick={(e) => { e.stopPropagation(); setOrcFechado(false); setLeadOrcamento(lead) }}>
                                    <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
                                    Criar orçamento com estes dados
                                  </Button>
                                  {chatwootUrl(lead) && (
                                    <a
                                      href={chatwootUrl(lead)!}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                                    >
                                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                      Ver conversa no Chatwoot
                                    </a>
                                  )}
                                </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile */}
              <div className="md:hidden divide-y">
                {paginatedLeads.map((lead) => {
                  const conv     = isConvertido(lead.status_lead, convertidosPorTelefone.has(lead.id))
                  const expanded = expandedId === lead.id
                  const emEspera = !conv && horasDecorridas(lead.timestamp_ultima_msg) > ESPERA_HORAS
                  return (
                    <div key={lead.id} className={cn(conv && 'opacity-60')}>
                      <div className="px-4 py-4">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div>
                            <p className="font-semibold text-sm">{lead.nome ?? 'Sem nome'}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              <SeloOrigem origem={lead.origem} campanha={lead.origem_campanha} neutro />
                              <SeloClassificacao lead={lead} neutro />
                              {estaComEquipe(lead) && <SeloComEquipe />}
                            </div>
                            {lead.whatsapp && (
                              <span className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-xs text-muted-foreground">{lead.whatsapp}</span>
                                <a
                                  href={`https://wa.me/${formatWaNumber(lead.whatsapp)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  title="Abrir no WhatsApp"
                                  className="flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                                >
                                  <MessageCircle className="h-3 w-3 shrink-0" />
                                  WA
                                </a>
                              </span>
                            )}
                          </div>
                          <SeloStatus status={lead.status_lead} motivo={lead.status_motivo} className="shrink-0" />
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            {emEspera && <Clock className="h-3 w-3 text-amber-500 shrink-0" />}
                            {fmtDate(lead.created_at)} {fmtTime(lead.created_at)}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {lead.ultimo_valor_cotado && !isNaN(parseFloat(lead.ultimo_valor_cotado)) && (
                              <span className="text-sm font-bold text-primary">{formatCurrency(parseFloat(lead.ultimo_valor_cotado))}</span>
                            )}
                            {!conv && (
                              mobileConfirmId === lead.id ? (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      marcarConvertido(lead.id, {
                                        onError: () => toast('error', 'Erro ao marcar como convertido.'),
                                        onSuccess: () => {
                                          setOrcFechado(true)
                                          setLeadOrcamento(lead)
                                          toast('success', 'Convertido! Confira os dados e salve o orçamento fechado.')
                                        },
                                      })
                                      setMobileConfirmId(null)
                                    }}
                                    disabled={marcando}
                                    className="rounded-lg bg-primary px-2 py-0.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-60 transition-colors"
                                  >
                                    {marcando ? '…' : <><Check className="inline h-3 w-3 mr-0.5" />Confirmar</>}
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setMobileConfirmId(null) }}
                                    className="rounded-lg border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
                                  >
                                    Não
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setMobileConfirmId(lead.id) }}
                                  title="Marca este lead como convertido no CRM. Para registrar o faturamento, feche o orçamento correspondente na aba Planilha."
                                  className="rounded-lg border px-2 py-0.5 text-xs font-medium text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
                                >
                                  <CheckCircle2 className="inline h-3 w-3 mr-0.5" />Converteu
                                </button>
                              )
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); setExpandedId(expanded ? null : lead.id) }}
                              aria-label={expanded ? 'Recolher detalhes' : 'Expandir detalhes'}
                              title={expanded ? 'Recolher' : 'Expandir'}
                            >
                              <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
                            </button>
                          </div>
                        </div>
                      </div>
                      {expanded && (
                        <div className="px-4 pb-4 border-t bg-muted/10 space-y-2">
                          {lead.resumo_conversa && <div className="pt-3"><p className="text-xs text-muted-foreground mb-1">Resumo</p><p className="text-sm text-muted-foreground">{lead.resumo_conversa}</p></div>}
                          <div className="grid grid-cols-2 gap-3 pt-2 text-sm">
                            {lead.modelo_interesse        && <div><p className="text-xs text-muted-foreground">Modelo</p><p className="font-medium">{lead.modelo_interesse}</p></div>}
                            {lead.tecido_cor              && <div><p className="text-xs text-muted-foreground">Tecido/Cor</p><p className="font-medium">{lead.tecido_cor}</p></div>}
                            {lead.medidas_coletadas       && <div><p className="text-xs text-muted-foreground">Medidas</p><p className="font-medium">{lead.medidas_coletadas}</p></div>}
                            {lead.data_medicao_instalacao && <div><p className="text-xs text-muted-foreground">Data medição</p><p className="font-medium text-primary">{lead.data_medicao_instalacao}</p></div>}
                          </div>
                          <div className="flex flex-wrap gap-2 pt-3">
                            <button
                              onClick={(e) => { e.stopPropagation(); setOrcFechado(false); setLeadOrcamento(lead) }}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 transition-colors active:scale-95"
                            >
                              <FilePlus2 className="h-3.5 w-3.5" />
                              Criar orçamento
                            </button>
                            {chatwootUrl(lead) && (
                              <a
                                href={chatwootUrl(lead)!}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                Conversa
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {leadsCollapsed && sortedLeads.length > PREVIA_LISTA && (
                <VerTodos total={sortedLeads.length} rotulo={sortedLeads.length === 1 ? 'lead' : 'leads'}
                  onClick={() => { setLeadsCollapsed(false); setLeadsPage(1) }} />
              )}

              {/* Footer centralizado */}
              {!leadsCollapsed && (foraLeads.length > 0 || foraMsgs.length > 0) && (
                <div className="border-t px-5 py-3 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
                  {foraLeads.length > 0 && (
                    <span className="flex items-center gap-1.5">
                      <Moon className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      <span><span className="font-semibold text-foreground">{foraLeads.length}</span> pessoa{foraLeads.length !== 1 ? 's' : ''} entraram fora do horário comercial</span>
                    </span>
                  )}
                  {foraMsgs.length > 0 && (
                    <span className="flex items-center gap-1.5">
                      <MessageSquare className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      <span><span className="font-semibold text-foreground">{foraMsgs.length}</span> última{foraMsgs.length !== 1 ? 's' : ''} mensagem{foraMsgs.length !== 1 ? 's' : ''} fora do horário</span>
                    </span>
                  )}
                </div>
              )}

              {/* Leads pagination */}
              {!leadsCollapsed && totalLeadPages > 1 && (
                <div className="flex items-center justify-between border-t px-5 py-3">
                  <span className="text-xs text-muted-foreground">
                    {(leadsPage - 1) * LEADS_PAGE_SIZE + 1}–{Math.min(leadsPage * LEADS_PAGE_SIZE, sortedLeads.length)} de {sortedLeads.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setLeadsPage(p => p - 1)} disabled={leadsPage === 1} className="rounded-lg border p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="px-2 text-xs font-medium tabular-nums">{leadsPage} / {totalLeadPages}</span>
                    <button onClick={() => setLeadsPage(p => p + 1)} disabled={leadsPage === totalLeadPages} className="rounded-lg border p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          </>
        )}
      </div>

      {/* ── Tabela de Orçamentos IA ── */}
      {errorOrc && (
        <AvisoErro mensagem="Não consegui ler os orçamentos da IA agora." aoTentar={() => void refetchOrc()} />
      )}
      <div className="rounded-xl border bg-card shadow-sm">
        {/* Header centralizado — clicável para colapsar */}
        <button
          type="button"
          onClick={() => { setOrcsCollapsed(v => !v); setOrcsPage(1) }}
          aria-expanded={!orcsCollapsed}
          className="relative flex w-full items-center justify-center border-b px-5 py-4 hover:bg-muted/30 transition-colors rounded-t-xl"
        >
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <h2 className="font-display text-sm font-semibold tracking-wide">Orçamentos gerados pela IA</h2>
            <span className="text-xs text-muted-foreground">{orcFiltrados.length} orçamento{orcFiltrados.length !== 1 ? 's' : ''}</span>
          </div>
          <span className="absolute right-4 rounded-lg p-1.5 text-muted-foreground">
            {orcsCollapsed ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
          </span>
        </button>

        {(
          orcFiltrados.length === 0 ? (
            <div className="py-12 text-center space-y-1">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/60">
                <Bot className="h-6 w-6 text-muted-foreground/50" />
              </div>
              <p className="text-sm font-medium">Nenhum orçamento neste período</p>
              <p className="text-sm text-muted-foreground">{orcamentosIA.length > 0 ? 'Tente outro período ou canal.' : 'Quando a Amanda passar um orçamento no WhatsApp, ele aparece aqui.'}</p>
            </div>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={tabela.theadRow}>
                      <OrcTh label="Data" k="created_at" />
                      <th className={cn(tabela.th, tabela.regua, 'text-center')}>Cliente</th>
                      <OrcTh label="Modelo" k="modelo" />
                      <th className={cn(tabela.th, tabela.regua, 'text-center')}>Medidas / Qtd</th>
                      <th className={cn(tabela.th, tabela.regua, 'text-center')}>Tecido / Acab.</th>
                      {/* custo e margem são de admin no dash inteiro — aqui não podia ser diferente */}
                      {ehAdmin && (
                        <th className={cn(tabela.th, tabela.regua, 'text-center')}>Custo</th>
                      )}
                      <th className={cn(tabela.th, tabela.regua, 'text-center')}>Produto</th>
                      <th className={cn(tabela.th, tabela.regua, 'text-center')}>Colocação</th>
                      <OrcTh label="Total" k="valor" />
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedOrcs.map((o, rowIdx) => {
                      const total = (o.valor_venda_total_base ?? 0) + (o.valor_venda_acabamento_total ?? 0) + (o.valor_colocacao ?? 0)
                      const dono = leadPorOrc.get(o.id)
                      const custoBase = o.custo_total_base != null ? formatCurrency(o.custo_total_base) : null
                      const custoAcab = o.custo_acabamento_total != null ? formatCurrency(o.custo_acabamento_total) : null
                      return (
                        <tr key={o.id} className={`border-b last:border-0 transition-colors ${rowIdx % 2 === 1 ? 'bg-muted/[0.15] hover:bg-muted/30' : 'hover:bg-primary/[0.04]'}`}>
                          <td className="px-4 py-3.5 text-center text-muted-foreground tabular-nums whitespace-nowrap border-r border-border/20">
                            <span className="block">{fmtDate(o.created_at)}</span>
                            <span className="text-xs opacity-70">{fmtTime(o.created_at)}</span>
                          </td>
                          <td className="border-r border-border/20 px-4 py-3.5 text-center">
                            {dono ? (
                              <>
                                <span className="block truncate font-medium" title={dono.nome ?? undefined}>
                                  {dono.nome ?? 'Sem nome'}
                                </span>
                                <SeloOrigem origem={dono.origem} campanha={dono.origem_campanha}
                                  className="mt-1" />
                              </>
                            ) : (
                              <span className="text-xs text-muted-foreground/50">sem lead vinculado</span>
                            )}
                          </td>
                          <td className="border-r border-border/20 px-4 py-3.5 text-center">
                            <span className="block font-medium">{o.modelo ?? '—'}</span>
                            {o.ambiente && <span className="text-xs text-muted-foreground">{o.ambiente}</span>}
                          </td>
                          <td className="px-4 py-3.5 text-center tabular-nums whitespace-nowrap border-r border-border/20">
                            <span className="block">
                              {o.largura && o.altura ? `${o.largura}×${o.altura}m` : '—'}
                              {o.quantidade && o.quantidade > 1 ? ` (×${o.quantidade})` : ''}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-center border-r border-border/20">
                            <span className="block">{o.tecido ?? '—'}</span>
                            {o.acabamento && <span className="text-xs text-muted-foreground">{o.acabamento}</span>}
                          </td>
                          {ehAdmin && (
                            <td className="border-r border-border/20 px-4 py-3.5 text-center tabular-nums text-muted-foreground">
                              {custoBase ? <span className="block">{custoBase}</span> : <span>—</span>}
                              {custoAcab && <span className="text-xs opacity-70">{custoAcab}</span>}
                            </td>
                          )}
                          <td className="border-r border-border/20 px-4 py-3.5 text-center tabular-nums">
                            {o.valor_venda_total_base != null
                              ? formatCurrency((o.valor_venda_total_base ?? 0) + (o.valor_venda_acabamento_total ?? 0))
                              : '—'}
                          </td>
                          <td className="px-4 py-3.5 text-center tabular-nums text-muted-foreground border-r border-border/20">{o.valor_colocacao != null ? formatCurrency(o.valor_colocacao) : '—'}</td>
                          <td className="px-4 py-3.5 text-center font-bold text-primary tabular-nums">{total > 0 ? formatCurrency(total) : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden divide-y">
                {paginatedOrcs.map((o) => {
                  const total = (o.valor_venda_total_base ?? 0) + (o.valor_venda_acabamento_total ?? 0) + (o.valor_colocacao ?? 0)
                  return (
                    <div key={o.id} className="px-4 py-4">
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {leadPorOrc.get(o.id)?.nome ?? o.modelo ?? '—'}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {[o.modelo, o.ambiente].filter(Boolean).join(' · ') || '—'}
                          </p>
                        </div>
                        {total > 0 && <span className="shrink-0 text-sm font-bold text-primary tabular-nums">{formatCurrency(total)}</span>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {o.largura && o.altura ? `${o.largura}×${o.altura}m · ` : ''}{o.tecido ?? ''}
                        {o.quantidade ? ` · ${o.quantidade}un` : ''} · {fmtDate(o.created_at)}
                      </p>
                    </div>
                  )
                })}
              </div>

              {orcsCollapsed && sortedOrcs.length > PREVIA_LISTA && (
                <VerTodos total={sortedOrcs.length} rotulo={sortedOrcs.length === 1 ? 'orçamento' : 'orçamentos'}
                  onClick={() => { setOrcsCollapsed(false); setOrcsPage(1) }} />
              )}

              {/* Footer centralizado */}
              {!orcsCollapsed && <div className="border-t px-5 py-3 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
                <span>Total cotado: <span className="font-semibold text-foreground">{formatCurrency(valorTotal)}</span></span>
                {orcFiltrados.length > 0 && (
                  <span>Ticket médio: <span className="font-semibold text-foreground">
                    {formatCurrency(valorTotal / orcFiltrados.length)}
                  </span></span>
                )}
                {orcFiltrados.some((o) => o.valor_colocacao) && (
                  <span>Colocação: <span className="font-semibold text-foreground">{formatCurrency(orcFiltrados.reduce((s, o) => s + (o.valor_colocacao ?? 0), 0))}</span></span>
                )}
              </div>}

              {/* Orcs pagination */}
              {!orcsCollapsed && totalOrcPages > 1 && (
                <div className="flex items-center justify-between border-t px-5 py-3">
                  <span className="text-xs text-muted-foreground">
                    {(orcsPage - 1) * ORCS_PAGE_SIZE + 1}–{Math.min(orcsPage * ORCS_PAGE_SIZE, sortedOrcs.length)} de {sortedOrcs.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setOrcsPage(p => p - 1)} disabled={orcsPage === 1} className="rounded-lg border p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="px-2 text-xs font-medium tabular-nums">{orcsPage} / {totalOrcPages}</span>
                    <button onClick={() => setOrcsPage(p => p + 1)} disabled={orcsPage === totalOrcPages} className="rounded-lg border p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )
        )}
      </div>
      {/* Lead → orçamento em 1 clique (fechado=true quando vem do botão Converteu) */}
      <NovoOrcamentoForm
        open={!!leadOrcamento}
        onClose={() => { setLeadOrcamento(null); setOrcFechado(false) }}
        toast={toast}
        initial={initialOrcamento}
        fonte="agente-ia"
        fechado={orcFechado}
      />

      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
