import { Fragment, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { tabela } from '@/components/shared/estilos'
import {
  Blinds, Calculator, CheckCircle2, ChevronDown, CircleDollarSign, Cog, Download, FileSpreadsheet, FileText, Layers, Loader2, Pencil, Percent, Printer, Ruler, Search, Settings2, Sparkles, Tag, TriangleAlert, Wrench,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCountUp } from '@/hooks/useCountUp'
import PrecosGrid, { ColunaDef } from './PrecosGrid'
import PrecosIA from './PrecosIA'
import { GRUPOS, TABELAS as TABELAS_EXPORT, baixarPrecosExcel, baixarPrecosPDF } from '@/lib/exportarPrecos'
import { CustomSelect } from '@/components/ui/CustomSelect'
import DatePicker from '@/components/ui/DatePicker'
import {
  statusPromocao, usePrecosArtigos, usePrecosBandos, usePrecosBandosParams, usePrecosBarraFaixas, usePrecosColocacao,
  usePrecosFerragemComponentes, usePrecosFerragemEscada, usePrecosFerragemFamilias,
  usePrecosMotorComponentes, usePrecosMotorEstrutura, usePrecosMutations, usePrecosParametros,
  usePrecosPh50, usePrecosPromocoes, usePrecosRomanaMatriz, usePrecosTecidoModelos, usePrecosTecidos,
  usePrecosCortinaTecidos, usePrecosCortinaValores,
  MODELOS_PERSIANA,
} from '@/hooks/usePrecos'
import { useCustoTecidoCortina } from '@/hooks/useCustoTecidoCortina'
import { margemDoTecido } from '@/lib/catalogo/margem'

interface Props { toast: (type: 'success' | 'error', message: string) => void }

const fmtBRL = (v: unknown) =>
  `R$ ${(Math.round((Number(v ?? 0) + 1e-9) * 100) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtNum = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR')

// ordem lógica: IA + promoções | produtos (tecidos e modelos) | estrutura (ferragem, acabamento, motor) | markups
const SECOES = [
  { id: 'ia',         label: 'Assistente',     icon: Sparkles,  fimGrupo: false },
  { id: 'promocoes',  label: 'Promoções',      icon: Percent,   fimGrupo: true },
  { id: 'tecidos',    label: 'Tecidos',        icon: Layers,    fimGrupo: false },
  { id: 'artigos',    label: 'PV / PH Alumínio', icon: Blinds,  fimGrupo: false },
  { id: 'ph50',       label: 'PH 50mm',        icon: Blinds,    fimGrupo: true },
  { id: 'ferragens',  label: 'Ferragens',      icon: Wrench,    fimGrupo: false },
  { id: 'bandos',     label: 'Bandôs',         icon: Tag,       fimGrupo: false },
  { id: 'barra',      label: 'Barra Niv.',     icon: Ruler,     fimGrupo: false },
  { id: 'colocacao',  label: 'Instalação',     icon: Cog,       fimGrupo: false },
  { id: 'motor',      label: 'Motor',          icon: Cog,       fimGrupo: false },
  { id: 'cortinas',   label: 'Cortinas',       icon: Blinds,    fimGrupo: true },
  { id: 'parametros', label: 'Parâmetros',     icon: Settings2, fimGrupo: false },
] as const

type SecaoId = typeof SECOES[number]['id']

export default function TabPrecos({ toast }: Props) {
  const navigate = useNavigate()
  const [secao, setSecao] = useState<SecaoId>('ia')
  const [promoPrefill, setPromoPrefill] = useState<string | null>(null)
  const { updateRow, insertRow, deleteRow } = usePrecosMutations()

  const salvar = (table: string) => async (
    match: Record<string, unknown>, patch: Record<string, unknown>, antes?: Record<string, unknown>,
  ) => {
    try { await updateRow(table, match, patch, antes); toast('success', 'Salvo!') }
    catch { toast('error', 'Erro ao salvar — confira os dados') }
  }
  const excluir = (table: string) => async (match: Record<string, unknown>, antes?: Record<string, unknown>) => {
    try { await deleteRow(table, match, antes); toast('success', 'Excluído') }
    catch { toast('error', 'Erro ao excluir') }
  }
  const adicionar = (table: string) => async (row: Record<string, unknown>) => {
    try { await insertRow(table, row); toast('success', 'Adicionado!') }
    catch { toast('error', 'Erro ao adicionar — confira os dados') }
  }

  const { data: kpiTecidos } = usePrecosTecidos()
  const { data: kpiPromos } = usePrecosPromocoes()
  const { data: kpiParams } = usePrecosParametros()
  const { data: kpiFamilias } = usePrecosFerragemFamilias()
  const promosAtivas = (kpiPromos ?? []).filter(p => statusPromocao(p) === 'ativa').length
  const promosVencendo = (kpiPromos ?? []).filter(p => statusPromocao(p) === 'ativa'
    && (new Date(p.fim + 'T23:59:59').getTime() - Date.now()) / 86400000 <= 3).length
  const syncEpoch = Number((kpiParams ?? []).find(p => p.chave === 'ultimo_sync_epoch')?.valor ?? 0)
  const minSync = syncEpoch > 0 ? Math.max(0, Math.round((Date.now() - syncEpoch) / 60000)) : null
  const syncOk = minSync != null && minSync <= 45
  const parametrosVisiveis = (kpiParams ?? []).filter(p => p.chave !== 'ultimo_sync_epoch').length

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold">Tabela de Preços</h2>
          <p className="text-xs text-muted-foreground">
            Fonte central de preços e promoções. Esta tela é a fonte da verdade — o motor de orçamento lê direto daqui.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BotaoBaixarTabelas toast={toast} />
        </div>
      </div>

      {/* Saúde do sistema: a cliente bate o olho e sabe que está tudo em ordem */}
      <div className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border-2 px-4 py-2.5 text-sm',
        syncOk ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5',
      )}>
        {syncOk
          ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          : <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600" />}
        <span className="font-semibold">
          {minSync == null ? 'Planilha ainda não sincronizada'
            : syncOk ? 'Tudo em ordem'
            : 'Sincronização atrasada'}
        </span>
        {minSync != null && (
          <span className="text-muted-foreground">
            planilha sincronizada {minSync === 0 ? 'agora mesmo' : `há ${minSync >= 60 ? `${Math.floor(minSync / 60)}h${minSync % 60 ? ` ${minSync % 60}min` : ''}` : `${minSync} min`}`}
          </span>
        )}
        <span className="text-muted-foreground">
          {promosAtivas === 0 ? 'nenhuma promoção ativa' : `${promosAtivas} promoção${promosAtivas > 1 ? 'ões' : ''} ativa${promosAtivas > 1 ? 's' : ''}`}
        </span>
        {promosVencendo > 0 && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-600">
            {promosVencendo} vence{promosVencendo > 1 ? 'm' : ''} em breve
          </span>
        )}
      </div>

      <div className="kpi-cascade grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Tecidos', value: new Set((kpiTecidos ?? []).map(t => t.nome)).size },
          { label: 'Promoções ativas', value: promosAtivas },
          { label: 'Famílias de ferragem', value: (kpiFamilias ?? []).length },
          { label: 'Parâmetros', value: parametrosVisiveis },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl border-2 border-primary/20 bg-primary/10 dark:bg-primary/15 p-4 shadow-sm flex flex-col items-center text-center gap-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">{label}</p>
            <p className="font-display text-2xl font-bold text-primary tabular-nums"><KpiContagem n={value} /></p>
          </div>
        ))}
      </div>

      {/* Simulador virou área própria (balcão) — atalho no lugar */}
      <button
        onClick={() => navigate('/orcamentos/simulador')}
        className="flex w-full items-center gap-2.5 rounded-xl border-2 bg-card px-5 py-4 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
          <Calculator className="h-3.5 w-3.5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-semibold tracking-wide">Simulador de orçamento</p>
          <p className="text-xs text-muted-foreground">agora é uma área própria — feita pro balcão, com salvar em um toque</p>
        </div>
        <span className="text-xs font-semibold text-primary">Abrir →</span>
      </button>

      <div className="flex flex-wrap items-stretch gap-1 rounded-xl bg-muted/50 p-1">
        {SECOES.map(({ id, label, icon: Icon, fimGrupo }) => (
          <Fragment key={id}>
            <button onClick={() => setSecao(id)} title={label}
              className={cn(
                'relative flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-all duration-100 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                secao === id ? 'bg-card text-primary shadow-elevated' : 'text-muted-foreground hover:text-foreground hover:bg-card/50',
              )}>
              <Icon className="h-4 w-4 shrink-0" />{label}
            </button>
            {fimGrupo && <div className="mx-1 my-1.5 w-px bg-border" />}
          </Fragment>
        ))}
      </div>

      {secao === 'ia' && <PrecosIA toast={toast} />}
      {secao === 'tecidos' && (
        <SecaoTecidos salvar={salvar} excluir={excluir} adicionar={adicionar}
          onCriarPromocao={nome => { setPromoPrefill(nome); setSecao('promocoes') }} />
      )}
      {secao === 'promocoes' && <SecaoPromocoes toast={toast} prefill={promoPrefill} />}
      {secao === 'artigos' && <SecaoArtigos salvar={salvar} excluir={excluir} adicionar={adicionar} />}
      {secao === 'ph50' && <SecaoPh50 salvar={salvar} excluir={excluir} adicionar={adicionar} />}
      {secao === 'ferragens' && <SecaoFerragens salvar={salvar} />}
      {secao === 'bandos' && <SecaoBandos salvar={salvar} excluir={excluir} adicionar={adicionar} />}
      {secao === 'barra' && <SecaoBarra salvar={salvar} />}
      {secao === 'colocacao' && <SecaoColocacao salvar={salvar} excluir={excluir} adicionar={adicionar} />}
      {secao === 'motor' && <SecaoMotor salvar={salvar} />}
      {secao === 'cortinas' && <SecaoCortinas salvar={salvar} excluir={excluir} adicionar={adicionar} />}
      {secao === 'parametros' && <SecaoParametros salvar={salvar} />}
    </div>
  )
}

/** Número de KPI que conta de 0 na montagem da aba */
function KpiContagem({ n }: { n: number }) {
  const v = useCountUp(n, 650)
  return <>{Math.round(v)}</>
}

/* ─── helpers de seção ───────────────────────────────────── */
type SalvarFn = (table: string) => (match: Record<string, unknown>, patch: Record<string, unknown>, antes?: Record<string, unknown>) => Promise<void>
type ExcluirFn = (table: string) => (match: Record<string, unknown>, antes?: Record<string, unknown>) => Promise<void>
type AdicionarFn = (table: string) => (row: Record<string, unknown>) => Promise<void>
interface SecaoProps { salvar: SalvarFn; excluir?: ExcluirFn; adicionar?: AdicionarFn }

function Carregando() {
  return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
}

const CATEGORIAS_TECIDO = [
  { value: 'blackout', label: 'Blackout' },
  { value: 'tela_solar_1', label: 'Tela Solar 1%' }, { value: 'tela_solar_3', label: 'Tela Solar 3%' },
  { value: 'tela_solar', label: 'Tela Solar (genérico — evitar)' },
  { value: 'decorativo', label: 'Decorativo' }, { value: 'outro', label: 'Outro' },
] as const

function SecaoTecidos({ salvar, excluir, adicionar, onCriarPromocao }: SecaoProps & { onCriarPromocao: (nome: string) => void }) {
  const { data, isLoading } = usePrecosTecidos()
  const { data: promocoes } = usePrecosPromocoes()
  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState('')

  const promoAtiva = useMemo(() => {
    const mapa = new Map<string, number>()
    for (const p of promocoes ?? []) {
      if (statusPromocao(p) === 'ativa') mapa.set(p.alvo_nome, Math.max(mapa.get(p.alvo_nome) ?? 0, Number(p.desconto_pct)))
    }
    return mapa
  }, [promocoes])

  const linhas = useMemo(() => (data ?? [])
    .filter(t => !categoria || t.tipo === categoria)
    .filter(t => !busca || t.nome.toLowerCase().includes(busca.toLowerCase()))
    .map(t => ({ ...t, promo: promoAtiva.has(t.nome) ? `🏷️ −${fmtNum(promoAtiva.get(t.nome))}%` : '' })),
  [data, categoria, busca, promoAtiva])

  const colunas: ColunaDef[] = [
    { key: 'nome', label: 'Tecido', tipo: 'texto' },
    { key: 'tipo', label: 'Categoria', tipo: 'select', options: [...CATEGORIAS_TECIDO] },
    { key: 'largura', label: 'Largura (m)', tipo: 'numero', formato: fmtNum },
    { key: 'preco', label: 'Preço/m²', tipo: 'numero', formato: fmtBRL },
    { key: 'promo', label: 'Promoção', tipo: 'texto', readonly: true },
  ]
  if (isLoading) return <Carregando />
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar tecido…"
            className="w-56 rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[{ value: '', label: 'Todos' }, ...CATEGORIAS_TECIDO].map(c => {
            const n = c.value === ''
              ? new Set((data ?? []).map(t => t.nome)).size
              : new Set((data ?? []).filter(t => t.tipo === c.value).map(t => t.nome)).size
            return (
              <button key={c.value} onClick={() => setCategoria(c.value)}
                className={cn('rounded-full px-3 py-1 text-xs font-semibold transition-colors active:scale-95',
                  categoria === c.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}>
                {c.label} · {n}
              </button>
            )
          })}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        A categoria alimenta buscas como “blackout mais barato”. Cada largura de rolo é uma linha.
        O ícone <Percent className="inline h-3 w-3" /> cria uma promoção já com o tecido escolhido.
      </p>
      <PrecosGrid colunas={colunas} linhas={linhas} chave={r => ({ id: r.id })}
        onSalvar={salvar('precos_tecidos')} onExcluir={excluir!('precos_tecidos')}
        onAdicionar={adicionar!('precos_tecidos')}
        acaoLinha={{ titulo: 'Criar promoção deste tecido', icone: <Percent className="h-3.5 w-3.5" />, onClick: r => onCriarPromocao(r.nome) }}
        conferirMudanca={(row, patch) => {
          const antes = Number(row.preco), depois = Number(patch.preco)
          if (antes > 0 && depois > 0 && (depois > antes * 2 || depois < antes / 2)) {
            return `Preço muito diferente do atual (${fmtBRL(antes)} → ${fmtBRL(depois)}). Confere se não foi erro de digitação.`
          }
          return null
        }} />
      <VinculoModelos tecidos={data ?? []} />
    </div>
  )
}

function VinculoModelos({ tecidos }: { tecidos: { nome: string }[] }) {
  const { data: vinculos, isLoading } = usePrecosTecidoModelos()
  const { insertRow, deleteRow } = usePrecosMutations()
  const [tecido, setTecido] = useState('')
  const [mexendo, setMexendo] = useState<string | null>(null)
  const nomes = useMemo(() => [...new Set(tecidos.map(t => t.nome))], [tecidos])
  const meus = useMemo(() => new Set((vinculos ?? []).filter(v => v.tecido_nome === tecido).map(v => v.modelo)), [vinculos, tecido])

  async function alternar(modelo: string) {
    if (!tecido) return
    setMexendo(modelo)
    try {
      if (meus.has(modelo)) await deleteRow('precos_tecido_modelos', { tecido_nome: tecido, modelo })
      else await insertRow('precos_tecido_modelos', { tecido_nome: tecido, modelo })
    } finally { setMexendo(null) }
  }

  return (
    <div className="rounded-xl border-2 bg-card shadow-sm p-4">
      <p className="font-display text-sm font-semibold tracking-wide">Em quais modelos cada tecido entra</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Um tecido só aparece nos orçamentos dos modelos marcados aqui (é o que gera a aba DADOS_TECIDOS).
      </p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <CustomSelect className="py-2 sm:w-64" value={tecido} onChange={setTecido}
          options={nomes} placeholder="Escolha o tecido…" />
        {tecido && !isLoading && (
          <div className="flex flex-wrap gap-1.5">
            {MODELOS_PERSIANA.map(m => (
              <button key={m} onClick={() => alternar(m)} disabled={mexendo === m}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-semibold transition-colors active:scale-95',
                  meus.has(m) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
                )}>
                {mexendo === m ? '…' : m.replace('_', ' ')}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SecaoPromocoes({ toast, prefill }: { toast: Props['toast']; prefill?: string | null }) {
  const { data: promocoes, isLoading } = usePrecosPromocoes()
  const { data: tecidos } = usePrecosTecidos()
  const { insertRow, deleteRow } = usePrecosMutations()
  const [form, setForm] = useState(() => {
    const hoje = new Date().toISOString().slice(0, 10)
    const semana = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
    return prefill
      ? { alvo_nome: prefill, desconto_pct: '', inicio: hoje, fim: semana }
      : { alvo_nome: '', desconto_pct: '', inicio: '', fim: '' }
  })
  const [salvando, setSalvando] = useState(false)
  const nomes = useMemo(() => [...new Set((tecidos ?? []).map(t => t.nome))], [tecidos])

  async function criar() {
    if (!form.alvo_nome || !form.desconto_pct || !form.inicio || !form.fim) {
      toast('error', 'Preencha tecido, desconto e o período'); return
    }
    if (form.fim < form.inicio) {
      toast('error', 'A data final precisa ser depois da inicial'); return
    }
    setSalvando(true)
    try {
      await insertRow('precos_promocoes', {
        alvo_tipo: 'tecido', alvo_nome: form.alvo_nome,
        desconto_pct: parseFloat(form.desconto_pct.replace(',', '.')),
        inicio: form.inicio, fim: form.fim,
      })
      setForm({ alvo_nome: '', desconto_pct: '', inicio: '', fim: '' })
      toast('success', 'Promoção criada! Entra e sai sozinha nas datas.')
    } catch { toast('error', 'Erro ao criar promoção') }
    finally { setSalvando(false) }
  }

  const inputCls = 'rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary'
  const badge = { ativa: 'bg-emerald-500/15 text-emerald-600', agendada: 'bg-amber-500/15 text-amber-600', expirada: 'bg-muted text-muted-foreground' }
  if (isLoading) return <Carregando />
  return (
    <div className="space-y-4">
      <div className="rounded-xl border-2 bg-card shadow-sm p-4">
        <p className="mb-3 font-display text-sm font-semibold tracking-wide">Nova promoção de tecido</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
          <CustomSelect className="py-2 sm:col-span-2" value={form.alvo_nome}
            onChange={v => setForm(f => ({ ...f, alvo_nome: v }))}
            options={nomes} placeholder="Escolha o tecido…" />
          <input className={inputCls} placeholder="% desconto" inputMode="decimal" value={form.desconto_pct}
            onChange={e => setForm(f => ({ ...f, desconto_pct: e.target.value }))} />
          <DatePicker value={form.inicio} placeholder="Início (dd/mm/aaaa)"
            triggerClassName="py-3"
            onChange={v => setForm(f => ({ ...f, inicio: v }))} />
          <DatePicker value={form.fim} placeholder="Fim (dd/mm/aaaa)"
            min={form.inicio || undefined} triggerClassName="py-3"
            onChange={v => setForm(f => ({ ...f, fim: v }))} />
        </div>
        <button onClick={criar} disabled={salvando}
          className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {salvando ? 'Criando…' : 'Criar promoção'}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full min-w-[600px] text-sm">
          <thead><tr className={tabela.theadRow}>
            <th className={cn(tabela.th, 'text-center')}>Tecido</th>
            <th className={cn(tabela.th, 'text-center')}>Desconto</th>
            <th className={cn(tabela.th, 'text-center')}>Período</th>
            <th className={cn(tabela.th, 'text-center')}>Status</th>
            <th className={cn(tabela.th, 'w-16')} />
          </tr></thead>
          <tbody>
            {(promocoes ?? []).length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Nenhuma promoção cadastrada.</td></tr>
            )}
            {(promocoes ?? []).map(p => {
              const st = statusPromocao(p)
              const diasPraVencer = Math.ceil((new Date(p.fim + 'T23:59:59').getTime() - Date.now()) / 86400000)
              const vencendo = st === 'ativa' && diasPraVencer <= 3
              return (
                <tr key={p.id} className={tabela.tr}>
                  <td className={cn(tabela.td, 'text-center font-semibold')}>{p.alvo_nome}</td>
                  <td className={cn(tabela.td, 'text-center tabular-nums')}>−{fmtNum(p.desconto_pct)}%</td>
                  <td className={cn(tabela.td, 'text-center tabular-nums')}>
                    {new Date(p.inicio + 'T12:00:00').toLocaleDateString('pt-BR')} → {new Date(p.fim + 'T12:00:00').toLocaleDateString('pt-BR')}
                  </td>
                  <td className={cn(tabela.td, 'text-center')}>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', badge[st])}>{st}</span>
                    {vencendo && (
                      <span className="ml-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-600">
                        {diasPraVencer <= 0 ? 'vence hoje' : diasPraVencer === 1 ? 'vence amanhã' : `vence em ${diasPraVencer} dias`}
                      </span>
                    )}
                  </td>
                  <td className={cn(tabela.td, 'text-center')}>
                    <button onClick={async () => {
                      if (!confirm('Remover esta promoção?')) return
                      try { await deleteRow('precos_promocoes', { id: p.id }); toast('success', 'Promoção removida') }
                      catch { toast('error', 'Erro ao remover') }
                    }} className="text-xs font-semibold text-destructive hover:underline">Remover</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SecaoArtigos({ salvar, excluir, adicionar }: SecaoProps) {
  const { data, isLoading } = usePrecosArtigos()
  const colunas: ColunaDef[] = [
    { key: 'categoria', label: 'Linha', tipo: 'select', options: [
      { value: 'PV', label: 'PV (Vertical)' }, { value: 'PH_ALUMINIO', label: 'PH Alumínio 25mm' }] },
    { key: 'nome', label: 'Artigo', tipo: 'texto' },
    { key: 'preco', label: 'Preço/m²', tipo: 'numero', formato: fmtBRL },
  ]
  if (isLoading) return <Carregando />
  return <PrecosGrid colunas={colunas} linhas={data ?? []} chave={r => ({ id: r.id })}
    onSalvar={salvar('precos_artigos')} onExcluir={excluir!('precos_artigos')} onAdicionar={adicionar!('precos_artigos')}
    conferirMudanca={(row, patch) => {
      const antes = Number(row.preco), depois = Number(patch.preco)
      if (antes > 0 && depois > 0 && (depois > antes * 2 || depois < antes / 2)) {
        return `Preço muito diferente do atual (${fmtBRL(antes)} → ${fmtBRL(depois)}). Confere se não foi erro de digitação.`
      }
      return null
    }} />
}

function SecaoPh50({ salvar, excluir, adicionar }: SecaoProps) {
  const { data, isLoading } = usePrecosPh50()
  const colunas: ColunaDef[] = [
    { key: 'modelo', label: 'Modelo', tipo: 'texto' },
    { key: 'cor', label: 'Cor', tipo: 'texto' },
    { key: 'preco_cadarco', label: 'Cadarço/m²', tipo: 'numero', formato: fmtBRL },
    { key: 'preco_fita', label: 'Fita/m²', tipo: 'numero', formato: fmtBRL },
    { key: 'bando_ml', label: 'Bandô/ml', tipo: 'numero', formato: fmtBRL },
    { key: 'aba_pc', label: 'Aba/pç', tipo: 'numero', formato: fmtBRL },
  ]
  if (isLoading) return <Carregando />
  return <PrecosGrid colunas={colunas} linhas={data ?? []} chave={r => ({ id: r.id })}
    onSalvar={salvar('precos_ph50')} onExcluir={excluir!('precos_ph50')} onAdicionar={adicionar!('precos_ph50')} />
}

function SecaoFerragens({ salvar }: SecaoProps) {
  const { data: familias, isLoading: l1 } = usePrecosFerragemFamilias()
  const { data: componentes, isLoading: l2 } = usePrecosFerragemComponentes()
  const { data: escada } = usePrecosFerragemEscada()
  const [fam, setFam] = useState<string>('')
  if (l1 || l2) return <Carregando />

  const chaves = (familias ?? []).map(f => `${f.familia}|${f.cor}|${f.espessura}`)
  const atual = fam || chaves[0] || ''
  const [cFam, cCor, cEsp] = atual.split('|')
  const comps = (componentes ?? []).filter(c => c.familia === cFam && c.cor === cCor && String(c.espessura) === cEsp)
  const escadaFam = (escada ?? []).filter(e => e.familia === cFam && e.cor === cCor && String(e.espessura) === cEsp)
  const somaMl = comps.filter(c => c.tipo_custo === 'por_metro').reduce((s, c) => s + Number(c.valor), 0)
  const somaFixo = comps.filter(c => c.tipo_custo === 'fixo').reduce((s, c) => s + Number(c.valor), 0)

  const colunas: ColunaDef[] = [
    { key: 'item', label: 'Componente', tipo: 'texto' },
    { key: 'tipo_custo', label: 'Cobrança', tipo: 'select', options: [
      { value: 'por_metro', label: 'Por metro' }, { value: 'fixo', label: 'Fixo' },
      { value: 'opcional_ml', label: 'Opcional (por metro)' }, { value: 'opcional_par', label: 'Opcional (por par)' }] },
    { key: 'valor', label: 'Valor', tipo: 'numero', formato: fmtBRL },
  ]
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {[...chaves, 'ROMANA'].map(c => {
          const [f, cor, esp] = c.split('|')
          const label = c === 'ROMANA' ? 'ROMANA (matriz)' : `${f} ${cor}${esp !== '0' ? ` ${esp}mm` : ''}`
          return (
            <button key={c} onClick={() => setFam(c)}
              className={cn('rounded-full px-3 py-1 text-xs font-semibold',
                atual === c ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}>
              {label}
            </button>
          )
        })}
      </div>
      {atual === 'ROMANA' ? (
        <MatrizRomana salvar={salvar} />
      ) : escadaFam.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Esta família usa tabela de valores direta (os componentes da planilha não batiam com a escada).
          </p>
          <PrecosGrid
            colunas={[
              { key: 'largura', label: 'Largura (m)', tipo: 'numero', readonly: true, formato: fmtNum },
              { key: 'custo', label: 'Custo', tipo: 'numero', formato: fmtBRL },
            ]}
            linhas={escadaFam}
            chave={r => ({ familia: r.familia, cor: r.cor, espessura: r.espessura, largura: r.largura })}
            onSalvar={salvar('precos_ferragem_escada')} />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
            Custo calculado: <b className="tabular-nums">{fmtBRL(somaMl)}</b> por metro + <b className="tabular-nums">{fmtBRL(somaFixo)}</b> fixo.
            Ex.: 2,00m → <b className="tabular-nums">{fmtBRL(somaMl * 2 + somaFixo)}</b>.
          </div>
          <EscadaCalculada titulo="Tabela gerada"
            linhas={escadaCalculada(familias?.find(f => `${f.familia}|${f.cor}|${f.espessura}` === atual), somaMl, somaFixo)} />
          <PainelAjustes titulo="Ajustar componentes do custo">
            <p className="text-xs text-muted-foreground">
              Edite um componente e a tabela inteira se recalcula. Itens “Opcional” são cobrados à parte e ficam fora da soma.
            </p>
            <PrecosGrid colunas={colunas} linhas={comps} chave={r => ({ id: r.id })}
              onSalvar={salvar('precos_ferragem_componentes')} />
          </PainelAjustes>
        </div>
      )}
    </div>
  )
}

function escadaCalculada(
  fam: { larg_min: number; larg_max: number; passo: number } | undefined, somaMl: number, somaFixo: number,
): { largura: number; valor: number }[] {
  if (!fam) return []
  const out: { largura: number; valor: number }[] = []
  for (let L = Number(fam.larg_min); L <= Number(fam.larg_max) + 1e-9; L += Number(fam.passo)) {
    const Lr = Math.round(L * 100) / 100
    out.push({ largura: Lr, valor: somaMl * Lr + somaFixo })
  }
  return out
}

/** Painel recolhido por padrão — a edição só aparece pra quem quer mexer */
function PainelAjustes({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  const [aberto, setAberto] = useState(false)
  return (
    <div className="rounded-xl border-2 bg-card shadow-sm overflow-hidden">
      <button onClick={() => setAberto(a => !a)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/30 transition-colors">
        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-semibold">{titulo}</span>
        <span className="text-xs text-muted-foreground">— só mexa aqui se quiser mudar os valores</span>
        <ChevronDown className={cn('ml-auto h-4 w-4 text-muted-foreground transition-transform', aberto && 'rotate-180')} />
      </button>
      {aberto && <div className="border-t p-4 space-y-4">{children}</div>}
    </div>
  )
}

/**
 * Cortinas (Wave, Pregas e Franzida). Os números da tabela JÁ SÃO o preço do
 * orçamento do cliente; o custo fica ao lado só de referência (venda = custo
 * × margem — hoje 2x, decisão da loja de 14/08). Por isso a seção fica
 * separada das persianas: misturar as duas lógicas na mesma tela confunde.
 *
 * A coluna "Custo" aqui era um número derivado: exatamente `venda ÷ 2` nas 12
 * linhas, porque foi assim que ela nasceu. Conferida contra o catálogo de
 * compras, divergia em 9 das 12 — a Gaze cru 2867 dizia 13,90 e a loja paga
 * 14,90; a Flame 3,30 dizia 13,50 e a loja paga 14,50. Quem olhasse a margem
 * por essa coluna veria 50% em tudo, sempre, porque era 50% por construção.
 *
 * Agora ela vem do catálogo, é só leitura e mostra o custo da loja marcada
 * com ✓ "comprei aqui" (regra da Stella, 24/10). Em branco = tecido ainda não
 * ligado a um material, ou sem loja marcada (Orçamentos → Custos → Materiais).
 */
function SecaoCortinas({ salvar, excluir, adicionar }: SecaoProps) {
  const { data: tecidos, isLoading: l1 } = usePrecosCortinaTecidos()
  const { data: valores, isLoading: l2 } = usePrecosCortinaValores()
  const { porNome } = useCustoTecidoCortina()

  // O custo real entra como campo só-leitura da linha. O PrecosGrid pula
  // colunas `readonly` ao montar o patch, então nada disto é enviado ao
  // banco — `precos_cortina_tecidos` continua com as colunas que sempre teve.
  const linhasTecidos = useMemo(
    () =>
      (tecidos ?? []).map(t => {
        const compra = porNome.get(t.nome)
        const m = compra ? margemDoTecido(1, Number(t.preco), compra.custoPorMetro) : null
        return {
          ...t,
          custo_real: compra?.custoPorMetro ?? null,
          custo_loja: compra?.fornecedor ?? (compra ? 'Sem fornecedor' : null),
          margem_real: m ? m.margem : null,
        }
      }),
    [tecidos, porNome]
  )

  const semLigacao = linhasTecidos.filter(t => t.custo_real == null).length

  if (l1 || l2) return <Carregando />

  const pendentes = (valores ?? []).filter(v => v.valor == null)

  return (
    <div className="space-y-5">
      {pendentes.length > 0 && (
        <div className="rounded-xl border-2 border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          <p className="font-semibold text-amber-700 dark:text-amber-400">
            {pendentes.length} valor{pendentes.length > 1 ? 'es' : ''} ainda sem preço
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Enquanto estiver vazio, a calculadora recusa o orçamento em vez de chutar um número:{' '}
            {pendentes.map(p => p.chave.replace(/_/g, ' ')).join(', ')}.
          </p>
        </div>
      )}

      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Tecidos e forros de cortina
        </p>
        <p className="mb-2 text-xs text-muted-foreground">
          Preço por metro de consumo (venda = custo × 2, regra da loja de 14/08). Use{' '}
          <b>tecido</b> para o pano da frente e <b>forro</b> para forro comum e blackouts.
          O <b>fator franzido</b> só vale para forro que vai franzido atrás: BK 100% = 1,5,
          os demais = 1,8 (vazio usa 1,8).
        </p>
        <p className="mb-2 text-xs text-muted-foreground">
          <b>Compra</b> e <b>Margem</b> vêm do catálogo de custos e não se editam aqui — é
          o preço da loja marcada com ✓, e a coluna diz qual. Para corrigir, use{' '}
          <b>Orçamentos → Custos → Materiais</b>.
          {semLigacao > 0 && (
            <>
              {' '}
              {semLigacao} tecido{semLigacao > 1 ? 's' : ''} ainda sem material ligado
              aparece{semLigacao > 1 ? 'm' : ''} com a compra em branco.
            </>
          )}
        </p>
        <PrecosGrid
          colunas={[
            { key: 'nome', label: 'Nome', tipo: 'texto' },
            { key: 'tipo', label: 'Uso', tipo: 'select', options: [
              { value: 'tecido', label: 'Tecido' }, { value: 'forro', label: 'Forro / blackout' }] },
            { key: 'custo_real', label: 'Compra R$/m', tipo: 'numero', readonly: true,
              formato: v => (v == null ? '—' : fmtBRL(v)) },
            { key: 'custo_loja', label: 'Onde compra', tipo: 'texto', readonly: true,
              formato: v => (v == null ? '—' : String(v)) },
            { key: 'preco', label: 'Venda R$/m', tipo: 'numero', formato: fmtBRL },
            { key: 'margem_real', label: 'Margem', tipo: 'numero', readonly: true,
              formato: v => (v == null ? '—' : `${(Number(v) * 100).toFixed(1).replace('.', ',')}%`) },
            { key: 'largura_rolo', label: 'Largura do rolo', tipo: 'numero', formato: fmtNum },
            { key: 'fator_franzido', label: 'Fator franzido', tipo: 'numero', formato: fmtNum },
          ]}
          linhas={linhasTecidos}
          chave={r => ({ id: r.id })}
          onSalvar={salvar('precos_cortina_tecidos')}
          onExcluir={excluir!('precos_cortina_tecidos')}
          onAdicionar={adicionar!('precos_cortina_tecidos')} />
      </div>

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Valores e regras das cortinas
        </p>
        <PrecosGrid
          colunas={[
            { key: 'chave', label: 'Item', tipo: 'texto', readonly: true },
            { key: 'valor', label: 'Valor', tipo: 'numero' },
            { key: 'descricao', label: 'O que é', tipo: 'texto', readonly: true },
          ]}
          linhas={valores ?? []}
          chave={r => ({ chave: r.chave })}
          onSalvar={salvar('precos_cortina_valores')} />
      </div>
    </div>
  )
}

/** Uma linha do menu de download: rótulo + Excel + PDF */
function LinhaBaixar({ rotulo, onBaixar, destaque }: {
  rotulo: string
  onBaixar: (formato: 'xlsx' | 'pdf') => void
  destaque?: boolean
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border/40 px-3 py-1.5 last:border-b-0 hover:bg-muted/40">
      <span className={cn('flex-1 truncate text-xs', destaque ? 'font-semibold' : 'font-medium')}>
        {rotulo}
      </span>
      <button onClick={() => onBaixar('xlsx')} title={`${rotulo} em Excel`}
        className="rounded-md p-1 text-emerald-600 transition-colors hover:bg-emerald-500/10 active:scale-95">
        <FileSpreadsheet className="h-3.5 w-3.5" />
      </button>
      <button onClick={() => onBaixar('pdf')} title={`${rotulo} em PDF`}
        className="rounded-md p-1 text-red-500 transition-colors hover:bg-red-500/10 active:scale-95">
        <FileText className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/**
 * Baixa TODAS as tabelas de preço de uma vez. O Excel sai com uma aba por
 * tabela e os preços como número (dá pra somar); o PDF é a versão de leitura.
 */
function BotaoBaixarTabelas({ toast }: { toast: Props['toast'] }) {
  const [aberto, setAberto] = useState(false)
  const [baixando, setBaixando] = useState<'xlsx' | 'pdf' | null>(null)

  const baixar = async (formato: 'xlsx' | 'pdf', apenas?: string) => {
    setAberto(false)
    setBaixando(formato)
    try {
      const n = formato === 'xlsx' ? await baixarPrecosExcel(apenas) : await baixarPrecosPDF(apenas)
      toast('success', n === 1 ? 'Tabela baixada' : `${n} tabelas baixadas`)
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Não deu para gerar o arquivo')
    } finally {
      setBaixando(null)
    }
  }

  return (
    <div className="relative">
      <button onClick={() => setAberto(a => !a)} disabled={baixando != null}
        className="flex items-center gap-1.5 rounded-lg border-2 px-3 py-2 text-sm font-semibold transition-colors hover:bg-muted disabled:opacity-60">
        {baixando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        Baixar tabelas
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', aberto && 'rotate-180')} />
      </button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAberto(false)} />
          <div className="absolute right-0 z-20 mt-1 w-80 overflow-hidden rounded-xl border-2 bg-card shadow-lg">
            <p className="border-b bg-muted/30 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Tudo junto
            </p>
            <button onClick={() => baixar('xlsx')}
              className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/50">
              <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                <span className="block text-sm font-semibold">Excel (.xlsx)</span>
                <span className="block text-xs text-muted-foreground">Uma aba por tabela, preços como número</span>
              </span>
            </button>
            <button onClick={() => baixar('pdf')}
              className="flex w-full items-start gap-2.5 border-t px-3 py-2.5 text-left transition-colors hover:bg-muted/50">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <span>
                <span className="block text-sm font-semibold">PDF</span>
                <span className="block text-xs text-muted-foreground">Pronto pra imprimir ou mandar por e-mail</span>
              </span>
            </button>

            <p className="border-y bg-muted/30 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Por grupo
            </p>
            {GRUPOS.map(g => (
              <LinhaBaixar key={g} rotulo={g} onBaixar={fmt => baixar(fmt, `grupo:${g}`)} destaque />
            ))}

            <p className="border-y bg-muted/30 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Uma tabela só
            </p>
            <div className="max-h-56 overflow-y-auto">
              {TABELAS_EXPORT.map(tb => (
                <LinhaBaixar key={tb.tabela} rotulo={tb.titulo}
                  onBaixar={fmt => baixar(fmt, tb.tabela)} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function imprimirTabela(
  titulo: string, colunasExtras: string[] | undefined,
  linhas: { largura: number; valor: number; extras?: (string | number)[] }[],
) {
  const w = window.open('', '_blank', 'width=760,height=900')
  if (!w) return
  const head = ['Largura', ...(colunasExtras ?? []), 'Preço']
  const rows = linhas.map(l => [fmtNum(l.largura), ...(l.extras ?? []).map(String), fmtBRL(l.valor)])
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${titulo}</title><style>
    body{font-family:system-ui,sans-serif;padding:28px;color:#1a1a1a}
    h1{font-size:15px;text-transform:uppercase;letter-spacing:.12em;text-align:center;margin:0 0 4px}
    p{font-size:11px;color:#888;text-align:center;margin:0 0 14px}
    table{width:100%;border-collapse:collapse}
    th,td{border:1px solid #bbb;padding:5px 10px;text-align:center;font-size:12.5px}
    th{background:#f3f3f3;font-weight:600}td:first-child{font-weight:600}
  </style></head><body>
    <h1>${titulo} — Sombrear</h1>
    <p>Gerado em ${new Date().toLocaleString('pt-BR')}</p>
    <table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <script>window.print()</script></body></html>`)
  w.document.close()
}

function EscadaCalculada({ titulo, linhas, colunasExtras, altura = 480 }: {
  titulo: string
  linhas: { largura: number; valor: number; extras?: (string | number)[] }[]
  colunasExtras?: string[]
  altura?: number
}) {
  return (
    <div className="rounded-xl border-2 bg-card shadow-sm overflow-hidden self-start">
      <div className="flex items-center border-b bg-muted/40 px-4 py-2">
        <p className="flex-1 text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {titulo}
        </p>
        <button onClick={() => imprimirTabela(titulo, colunasExtras, linhas)}
          title="Imprimir / salvar PDF"
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors active:scale-95">
          <Printer className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="overflow-auto" style={{ maxHeight: altura }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40">
              <th className="border border-border/60 px-3 py-2 text-center font-semibold text-muted-foreground">Largura</th>
              {(colunasExtras ?? []).map(c => (
                <th key={c} className="border border-border/60 px-3 py-2 text-center font-semibold text-muted-foreground">{c}</th>
              ))}
              <th className="border border-border/60 px-3 py-2 text-center font-semibold text-muted-foreground">Preço</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(l => (
              <tr key={l.largura}>
                <td className="border border-border/50 px-3 py-1.5 text-center font-semibold tabular-nums">{fmtNum(l.largura)}</td>
                {(l.extras ?? []).map((e, i) => (
                  <td key={i} className="border border-border/50 px-3 py-1.5 text-center tabular-nums">{e}</td>
                ))}
                <td className="border border-border/50 px-3 py-1.5 text-center tabular-nums">{fmtBRL(l.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MatrizRomana({ salvar }: { salvar: SalvarFn }) {
  const { data, isLoading } = usePrecosRomanaMatriz()
  const [editando, setEditando] = useState<string | null>(null)
  const [valor, setValor] = useState('')
  const [salvandoCel, setSalvandoCel] = useState(false)

  const { largs, alts, porChave } = useMemo(() => {
    const largs = [...new Set((data ?? []).map(r => Number(r.largura)))].sort((a, b) => a - b)
    const alts = [...new Set((data ?? []).map(r => Number(r.altura)))].sort((a, b) => a - b)
    const porChave = new Map((data ?? []).map(r => [`${Number(r.largura)}|${Number(r.altura)}`, Number(r.custo)]))
    return { largs, alts, porChave }
  }, [data])

  if (isLoading) return <Carregando />

  async function salvarCelula(L: number, A: number) {
    const novo = parseFloat(valor.replace(',', '.'))
    const antes = porChave.get(`${L}|${A}`)
    if (!(novo > 0) || novo === antes) { setEditando(null); return }
    setSalvandoCel(true)
    try {
      await salvar('precos_romana_matriz')({ largura: L, altura: A }, { custo: novo }, { custo: antes })
      setEditando(null)
    } finally { setSalvandoCel(false) }
  }

  return (
    <div className="space-y-2">
      <div className="rounded-xl border-2 bg-card shadow-sm overflow-hidden">
        <div className="border-b bg-muted/40 px-4 py-2.5 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Matriz largura × altura — tabela da planilha
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground/80">
            Clique numa célula para editar · a medida usa a célula mais próxima <i>para cima</i>
          </p>
        </div>
        <div className="overflow-x-auto" style={{ maxHeight: 480, overflowY: 'auto' }}>
        <table className="text-xs tabular-nums" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 bg-muted px-2 py-1.5 text-left font-semibold text-muted-foreground">A \ L</th>
              {largs.map(l => (
                <th key={l} className="sticky top-0 z-10 bg-muted px-2 py-1.5 font-semibold text-muted-foreground">{fmtNum(l)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {alts.map(a => (
              <tr key={a}>
                <td className="sticky left-0 z-10 bg-muted px-2 py-1 font-semibold text-muted-foreground">{fmtNum(a)}</td>
                {largs.map(l => {
                  const chave = `${l}|${a}`
                  const em = editando === chave
                  return (
                    <td key={l} className="border-b border-l border-border/40 p-0 text-right">
                      {em ? (
                        <input autoFocus value={valor} disabled={salvandoCel}
                          onChange={e => setValor(e.target.value)}
                          onBlur={() => salvarCelula(l, a)}
                          onKeyDown={e => { if (e.key === 'Enter') salvarCelula(l, a); if (e.key === 'Escape') setEditando(null) }}
                          className="w-16 bg-primary/10 px-1.5 py-1 text-center text-xs outline-none ring-2 ring-primary/40" />
                      ) : (
                        <button
                          onClick={() => { setEditando(chave); setValor(String(porChave.get(chave) ?? '')) }}
                          className="w-full px-1.5 py-1 text-center hover:bg-primary/10">
                          {(porChave.get(chave) ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </button>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}

function SecaoBandos({ salvar, excluir, adicionar }: SecaoProps) {
  const { data, isLoading } = usePrecosBandos()
  const { data: params } = usePrecosBandosParams()
  if (isLoading || !params) return <Carregando />

  const precoDe = (cor: string, largura: number, qtdCd: number) => {
    const p = params.find(x => x.cor === cor)
    if (!p) return 0
    return largura * Number(p.preco_metro) + qtdCd * (Number(p.cd1) + Number(p.cd2)) + Number(p.par)
  }
  const escadaDe = (cor: 'BRANCO' | 'PRETO') => (data ?? [])
    .filter(b => b.cor === cor)
    .sort((a, b) => Number(a.largura) - Number(b.largura))
    .map(b => ({ largura: Number(b.largura), valor: precoDe(cor, Number(b.largura), Number(b.qtd_cd)) }))

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <EscadaCalculada titulo="Bandô branco — tabela gerada" linhas={escadaDe('BRANCO')} />
        <EscadaCalculada titulo="Bandô preto — tabela gerada" linhas={escadaDe('PRETO')} />
      </div>
      <PainelAjustes titulo="Ajustar preços e cadarços">
        <p className="text-xs text-muted-foreground">
          Preço calculado por fórmula: <b>largura × base + cadarços × (cd1 + cd2) + par</b>.
          Mude a base que as tabelas se recalculam.
        </p>
        <PrecosGrid
          colunas={[
            { key: 'cor', label: 'Cor', tipo: 'texto', readonly: true },
            { key: 'preco_metro', label: 'Base (R$/m)', tipo: 'numero', formato: fmtBRL },
            { key: 'par', label: 'Par (fixo)', tipo: 'numero', formato: fmtBRL },
            { key: 'cd1', label: 'Cadarço 1', tipo: 'numero', formato: fmtBRL },
            { key: 'cd2', label: 'Cadarço 2', tipo: 'numero', formato: fmtBRL },
          ]}
          linhas={params} chave={r => ({ cor: r.cor })} onSalvar={salvar('precos_bandos_params')} />
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Escada por largura — edite a quantidade de cadarços; o preço sai da fórmula:
          </p>
          <PrecosGrid
            colunas={[
              { key: 'cor', label: 'Cor', tipo: 'select', options: [
                { value: 'BRANCO', label: 'Branco' }, { value: 'PRETO', label: 'Preto' }] },
              { key: 'largura', label: 'Largura (m)', tipo: 'numero', formato: fmtNum },
              { key: 'qtd_cd', label: 'Cadarços', tipo: 'numero', formato: fmtNum },
              { key: 'qtd_par', label: 'Pares', tipo: 'numero', formato: fmtNum },
            ]}
            linhas={data ?? []} chave={r => ({ id: r.id })}
            onSalvar={salvar('precos_bandos')} onExcluir={excluir!('precos_bandos')}
            onAdicionar={adicionar!('precos_bandos')} />
        </div>
      </PainelAjustes>
    </div>
  )
}

function SecaoBarra({ salvar }: SecaoProps) {
  const { data: params, isLoading } = usePrecosParametros()
  const { data: faixas } = usePrecosBarraFaixas()
  if (isLoading) return <Carregando />
  const barra = (params ?? []).filter(p => p.chave.startsWith('barra_'))
  const metro = Number(barra.find(p => p.chave === 'barra_preco_metro')?.valor ?? 0)
  const presilha = Number(barra.find(p => p.chave === 'barra_preco_presilha')?.valor ?? 0)
  const fxs = [...(faixas ?? [])].sort((a, b) => a.largura_min - b.largura_min)
  const escada: { largura: number; valor: number; extras: (string | number)[] }[] = []
  for (let L = 1.0; L <= 6.0 + 1e-9; L += 0.1) {
    const Lr = Math.round(L * 100) / 100
    let qtd = fxs[0]?.qtd_presilhas ?? 2
    for (const f of fxs) if (Lr >= Number(f.largura_min)) qtd = f.qtd_presilhas
    escada.push({
      largura: Lr, valor: metro * Lr + presilha * qtd,
      extras: [qtd, fmtBRL(presilha * qtd), fmtBRL(metro * Lr)],
    })
  }
  return (
    <div className="space-y-3">
      <EscadaCalculada titulo="Tabela gerada"
        colunasExtras={['Presilhas', 'Valor presilhas', 'Valor barra']} linhas={escada} />
      <PainelAjustes titulo="Ajustar preços e presilhas">
        <PrecosGrid
          colunas={[
            { key: 'descricao', label: 'Parâmetro', tipo: 'texto', readonly: true },
            { key: 'valor', label: 'Valor', tipo: 'numero', formato: fmtBRL },
          ]}
          linhas={barra} chave={r => ({ chave: r.chave })} onSalvar={salvar('precos_parametros')} />
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Quantidade de presilhas por faixa de largura (a partir de):</p>
          <PrecosGrid
            colunas={[
              { key: 'largura_min', label: 'A partir de (m)', tipo: 'numero', readonly: true, formato: fmtNum },
              { key: 'qtd_presilhas', label: 'Presilhas', tipo: 'numero', formato: fmtNum },
            ]}
            linhas={faixas ?? []} chave={r => ({ largura_min: r.largura_min })} onSalvar={salvar('precos_barra_faixas')} />
        </div>
      </PainelAjustes>
    </div>
  )
}

function SecaoColocacao({ salvar, excluir, adicionar }: SecaoProps) {
  const { data, isLoading } = usePrecosColocacao()
  const colunas: ColunaDef[] = [
    { key: 'ml_min', label: 'De (ml)', tipo: 'numero', formato: fmtNum },
    { key: 'ml_max', label: 'Até (ml)', tipo: 'numero', formato: fmtNum },
    { key: 'preco', label: 'Preço', tipo: 'numero', formato: fmtBRL },
  ]
  if (isLoading) return <Carregando />
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Acima da última faixa, a instalação fica “sob consulta”.</p>
      <PrecosGrid colunas={colunas} linhas={data ?? []} chave={r => ({ id: r.id })}
        onSalvar={salvar('precos_colocacao')} onExcluir={excluir!('precos_colocacao')} onAdicionar={adicionar!('precos_colocacao')} />
    </div>
  )
}

function SecaoMotor({ salvar }: SecaoProps) {
  const { data: estrutura, isLoading: l1 } = usePrecosMotorEstrutura()
  const { data: comps, isLoading: l2 } = usePrecosMotorComponentes()
  if (l1 || l2) return <Carregando />
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-semibold text-foreground">Estrutura motorizada (largura × altura)</p>
        <PrecosGrid
          colunas={[
            { key: 'largura', label: 'Largura (m)', tipo: 'numero', readonly: true, formato: fmtNum },
            { key: 'alt_faixa', label: 'Altura', tipo: 'texto', readonly: true },
            { key: 'valor', label: 'Valor', tipo: 'numero', formato: fmtBRL },
            { key: 'obs', label: 'Obs', tipo: 'texto', readonly: true },
          ]}
          linhas={estrutura ?? []} chave={r => ({ id: r.id })} onSalvar={salvar('precos_motor_estrutura')} />
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold text-foreground">Motores e componentes</p>
        <PrecosGrid
          colunas={[
            { key: 'item', label: 'Item', tipo: 'texto', readonly: true },
            { key: 'custo', label: 'Custo', tipo: 'numero', formato: fmtBRL },
            { key: 'quantidade', label: 'Qtd', tipo: 'numero', formato: v => v == null ? '—' : fmtNum(v) },
          ]}
          linhas={comps ?? []} chave={r => ({ id: r.id })} onSalvar={salvar('precos_motor_componentes')} />
      </div>
    </div>
  )
}

// Cada grupo diz EXATAMENTE onde é usado e se está ativo no cálculo dos agentes —
// pra um humano nunca mexer no número errado.
const GRUPOS_PARAMETROS: {
  titulo: string; hint: string; usadoPor: string[]; ativo: boolean
  chaves: string[]; formato: (v: unknown) => string
}[] = [
  {
    titulo: 'Persianas de tecido', hint: 'Venda = custo × markup × parcelamento². Acabamento (bandô/barra) tem markup próprio.',
    usadoPor: ['Rolô', 'Double', 'Romana', 'Motorizado (parte persiana)'], ativo: true,
    chaves: ['markup_venda', 'markup_acabamento'],
    formato: v => `× ${fmtNum(v)}`,
  },
  {
    titulo: 'Custo da empresa parceira',
    hint: 'Quanto a loja paga à parceira por cada item — custo de tabela × este número. NÃO muda o preço do cliente: serve pra margem e pro fechamento com a parceira. Cada item pode ter o seu.',
    usadoPor: ['Rolô', 'Double', 'Romana', 'Motorizado'], ativo: true,
    chaves: [
      'parceiro_tecido', 'parceiro_romana',
      'parceiro_ferragem_rolo_branca_32', 'parceiro_ferragem_rolo_branca_38',
      'parceiro_ferragem_rolo_branca_50', 'parceiro_ferragem_rolo_preta_38',
      'parceiro_ferragem_double_branca', 'parceiro_ferragem_double_preta',
      'parceiro_bando_branco', 'parceiro_bando_preto',
      'parceiro_barra', 'parceiro_kitbox', 'parceiro_motor',
      'custo_parceiro',
    ],
    formato: v => `× ${fmtNum(v)}`,
  },
  {
    titulo: 'PV e PH Alumínio', hint: 'Venda = custo × markup × parcelamento².',
    usadoPor: ['PV', 'PH Alumínio 25mm'], ativo: true,
    chaves: ['markup_venda_pv_ph'],
    formato: v => `× ${fmtNum(v)}`,
  },
  {
    titulo: 'PH 50mm', hint: 'Venda = custo × markup × taxa própria (não usa o parcelamento geral). Bandô tem markup e parcela fixa próprios.',
    usadoPor: ['PH 50mm'], ativo: true,
    chaves: ['markup_venda_ph50', 'taxa_ph50', 'markup_bando_ph50', 'bando_ph50_venda_fixo'],
    formato: v => fmtNum(v),
  },
  {
    titulo: 'Motorização', hint: 'Venda do motor = custo × markup (SEM taxa de parcelamento por cima).',
    usadoPor: ['Rolô Motorizado (parte motor)'], ativo: true,
    chaves: ['markup_motorizacao'],
    formato: v => `× ${fmtNum(v)}`,
  },
  {
    titulo: 'Parcelamento e à vista', hint: 'A taxa entra 2× na venda (4× sem juros); o desconto vale pra pagamento à vista.',
    usadoPor: ['Todos os modelos (exceto a taxa na PH 50mm)'], ativo: true,
    chaves: ['taxa_parcelamento', 'desconto_avista_pct'],
    formato: v => fmtNum(v),
  },
  {
    titulo: 'Kit Box — fórmula atual', hint: 'Fatores da fórmula em uso no orçamento da Rolô.',
    usadoPor: ['Rolô (acabamento Kit Box)'], ativo: true,
    chaves: ['kitbox_ml_largura', 'kitbox_fixo1', 'kitbox_ml_perimetro', 'kitbox_fixo2', 'kitbox_ml_altura'],
    formato: v => fmtBRL(v),
  },
  {
    titulo: 'Kit Box v2 — tabela Julho/26', hint: 'Receita nova da planilha da cliente. Entra em vigor quando o prompt da Rolô for virado.',
    usadoPor: ['Ninguém ainda'], ativo: false,
    chaves: ['kitbox2_bando_ml', 'kitbox2_tampa_bando_par', 'kitbox2_guia60_ml', 'kitbox2_guia55_ml', 'kitbox2_tampa_guia_pc', 'kitbox2_escovinha_ml'],
    formato: v => fmtBRL(v),
  },
  {
    titulo: 'Atacado — tabela Julho/26', hint: 'Multiplicador de atacado da planilha nova. Ainda não entra em nenhum orçamento.',
    usadoPor: ['Ninguém ainda'], ativo: false,
    chaves: ['markup_atacado'],
    formato: v => `× ${fmtNum(v)}`,
  },
]

function SecaoParametros({ salvar }: SecaoProps) {
  const { data, isLoading } = usePrecosParametros()
  if (isLoading) return <Carregando />
  const porChave = new Map((data ?? []).map(p => [p.chave, p]))
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-foreground">
        <CircleDollarSign className="mr-1.5 inline h-4 w-4 text-amber-500" />
        Cuidado: estes números afetam TODOS os orçamentos. Mexa com certeza — dá pra desfazer no histórico do Assistente.
      </div>
      {GRUPOS_PARAMETROS.map(g => {
        const linhas = g.chaves.map(c => porChave.get(c)).filter(Boolean) as NonNullable<ReturnType<typeof porChave.get>>[]
        if (linhas.length === 0) return null
        return (
          <div key={g.titulo}>
            <div className="mb-0.5 flex flex-wrap items-center gap-2">
              <p className="font-display text-sm font-semibold tracking-wide">{g.titulo}</p>
              <span className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                g.ativo ? 'bg-emerald-500/15 text-emerald-600' : 'bg-amber-500/15 text-amber-600',
              )}>
                {g.ativo ? 'usado no cálculo hoje' : 'ainda não usado'}
              </span>
              {g.usadoPor.map(u => (
                <span key={u} className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {u}
                </span>
              ))}
            </div>
            <p className="mb-2 text-xs text-muted-foreground">{g.hint}</p>
            <PrecosGrid
              colunas={[
                { key: 'descricao', label: 'O que é', tipo: 'texto', readonly: true },
                { key: 'valor', label: 'Valor', tipo: 'numero', formato: g.formato },
              ]}
              linhas={linhas} chave={r => ({ chave: r.chave })} onSalvar={salvar('precos_parametros')} />
          </div>
        )
      })}
    </div>
  )
}


// O botão "Sincronizar planilha" foi removido em 26/09. Ele fazia POST em
// /webhook/sincronizar-precos, e esse workflow do n8n está DESATIVADO — a
// chamada vinha retornando 404 e o catch virava "Não consegui falar com o
// sincronizador" toda vez que alguém clicava. A planilha-espelho já não é
// atualizada há tempo e ninguém sentiu falta; esta tela é a fonte da verdade.
// Se a loja voltar a querer o espelho, ele nasce como Edge Function + pg_cron,
// não como webhook.
