import {
  ShoppingBag, Clock, AlertTriangle, ArrowLeftRight, ClipboardCheck, PackageOpen,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/utils'
import { useEstoqueProdutos } from '@/hooks/useEstoqueProdutos'
import { useParetoData } from '@/hooks/useEstoqueAnalytics'
import { useSugestaoCompra } from '@/hooks/useEstoqueSugestao'
import { useEstoquePontoPedido } from '@/hooks/useEstoquePontoPedido'
import { useLeadTimeRows } from '@/hooks/useEstoqueLeadTime'
import { useEstoqueSugestoesMover } from '@/hooks/useEstoqueSugestoesMover'
import { NIVEIS_ACESSO } from '@/lib/constants'
import {
  CartaoPainel, GrupoPainel, VazioCartao, CarregandoBloco, AvisoDados, TudoCerto, BarraProgresso,
} from './shared/PainelEstoque'
import EstoqueTable, { type EstoqueTableColumn } from './shared/EstoqueTable'
import { ClasseABC } from './shared/ClasseABC'
import { InfoTooltip } from '@/components/ui/InfoTooltip'
import type { NivelAlerta } from './theme'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

const fmtNum = (v: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)

function NivelBadge({ nivel }: { nivel: NivelAlerta }) {
  const colorMap: Record<string, string> = {
    ruptura:   'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800/40',
    critico:   'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800/40',
    atencao:   'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800/40',
    ok:        'bg-gray-50 text-gray-500 border border-gray-200 dark:bg-muted/20 dark:text-muted-foreground dark:border-border',
    sem_dados: 'bg-gray-50 text-gray-400 border border-gray-200 dark:bg-muted/20 dark:text-muted-foreground dark:border-border',
  }
  const labels: Record<string, string> = {
    ruptura: 'Ruptura', critico: 'Crítico', atencao: 'Atenção', ok: 'OK', sem_dados: '—',
  }
  return (
    <span className={cn(
      'inline-flex h-6 px-2 items-center rounded-full text-xs font-medium',
      colorMap[nivel] ?? colorMap.sem_dados,
    )}>
      {labels[nivel] ?? nivel}
    </span>
  )
}

const urgencyColor: Record<string, string> = {
  critico:       'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800/40',
  abaixo_minimo: 'bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800/40',
  atencao:       'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800/40',
  ok:            'bg-gray-50 text-gray-500 border border-gray-200 dark:bg-muted/20 dark:text-muted-foreground dark:border-border',
}
const urgencyLabel: Record<string, string> = {
  critico: 'Crítico', abaixo_minimo: 'Ab. mínimo', atencao: 'Atenção', ok: 'OK',
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onDrillDown: (tab: 'lead-time' | 'mover' | 'sugestao' | 'ponto-pedido') => void
}

// ─── Saúde do cadastro ────────────────────────────────────────────────────────
// "Nada a fazer" só é verdade quando os dados que a recomendação usa existem.
// Aqui medimos o que existe, usando só a lista de materiais ativos e a contagem
// de vendas dos últimos 90 dias (as mesmas que as outras telas já carregam).

type SubAba = 'produtos' | 'vendas' | 'analises'

interface Saude {
  carregando: boolean
  total: number
  comMinimo: number
  comCusto: number
  comLocal: number
  comAbc: number
  vendas90: number
}

type Requisito = 'minimo' | 'custo' | 'local' | 'vendas' | 'abc'

interface Pendencia {
  texto: string
  rotulo: string
  destino: SubAba
  /** true = a recomendação não tem como ser calculada; false = sai, mas incompleta */
  bloqueia: boolean
}

interface SecaoProps {
  saude: Saude
  ir: (d: SubAba) => void
  onVerTodos: () => void
}

function pendencias(saude: Saude, reqs: Requisito[]): Pendencia[] {
  if (saude.carregando) return []
  const { total } = saude
  if (total === 0) {
    return [{
      texto: 'Nenhum material ativo cadastrado: sem materiais não há o que analisar.',
      rotulo: 'Cadastrar materiais', destino: 'produtos', bloqueia: true,
    }]
  }
  const out: Pendencia[] = []
  const falta = (com: number) => total - com

  for (const r of reqs) {
    if (r === 'vendas' && saude.vendas90 === 0) {
      out.push({
        texto: 'Nenhuma venda registrada nos últimos 90 dias: sem histórico de saída o sistema não sabe o que gira. Registre em Estoque › Vendas (não nos orçamentos).',
        rotulo: 'Registrar venda', destino: 'vendas', bloqueia: true,
      })
    }
    if (r === 'abc' && saude.comAbc === 0) {
      out.push({
        texto: 'Ainda não dá para dizer — a curva ABC ainda não foi calculada: sem ela o sistema não sabe quais são os materiais classe A. Clique em “Recalcular ABC” em Análises.',
        rotulo: 'Ir para Análises', destino: 'analises', bloqueia: true,
      })
    }
    if (r === 'minimo' && falta(saude.comMinimo) > 0) {
      const todos = saude.comMinimo === 0
      out.push({
        texto: todos
          ? `Nenhum dos ${total} materiais tem estoque mínimo definido: sem isso não dá para dizer o que comprar.`
          : `${falta(saude.comMinimo)} de ${total} materiais estão sem estoque mínimo: esses não entram na conta.`,
        rotulo: 'Definir mínimos em Materiais', destino: 'produtos', bloqueia: todos,
      })
    }
    if (r === 'custo' && falta(saude.comCusto) > 0) {
      const todos = saude.comCusto === 0
      out.push({
        texto: todos
          ? `Nenhum dos ${total} materiais tem custo unitário: os valores em R$ não podem ser calculados.`
          : `${falta(saude.comCusto)} de ${total} materiais estão sem custo: os valores em R$ ficam incompletos.`,
        rotulo: 'Preencher custos em Materiais', destino: 'produtos', bloqueia: false,
      })
    }
    if (r === 'local' && falta(saude.comLocal) > 0) {
      const todos = saude.comLocal === 0
      out.push({
        texto: todos
          ? `Nenhum dos ${total} materiais tem localização: não dá para sugerir onde cada um deve ficar.`
          : `${falta(saude.comLocal)} de ${total} materiais estão sem localização: esses ficam de fora das sugestões.`,
        rotulo: 'Definir locais em Materiais', destino: 'produtos', bloqueia: todos,
      })
    }
  }
  return out
}

/** Avisos parciais (sai resultado, mas incompleto) ou, se bloqueia, o estado "ainda não dá para dizer". */
function avaliar(saude: Saude, reqs: Requisito[], ir: (d: SubAba) => void) {
  const lista = pendencias(saude, reqs)
  const bloqueio = lista.find((p) => p.bloqueia) ?? null
  const parciais = bloqueio ? [] : lista
  const avisos = parciais.map((p) => (
    <AvisoDados key={p.texto} texto={p.texto} acao={{ label: p.rotulo, onClick: () => ir(p.destino) }} />
  ))
  const bloqueioEl = bloqueio ? (
    <VazioCartao
      icon={PackageOpen}
      title="Ainda não dá para dizer"
      description={bloqueio.texto}
      action={{ label: bloqueio.rotulo, onClick: () => ir(bloqueio.destino) }}
    />
  ) : null
  return { bloqueio, avisos, bloqueioEl, completo: !saude.carregando && lista.length === 0 }
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function AcoesView({ onDrillDown }: Props) {
  const navigate = useNavigate()
  const ir = (d: SubAba) => navigate(`/estoque/${d}`)

  const { data: materiais = [], isLoading: lm } = useEstoqueProdutos()
  const { data: pareto, isLoading: lv } = useParetoData()

  const saude: Saude = {
    carregando: lm || lv,
    total: materiais.length,
    comMinimo: materiais.filter((p) => Number(p.quantidade_minima) > 0).length,
    comCusto: materiais.filter((p) => Number(p.custo_unitario) > 0).length,
    comLocal: materiais.filter((p) => !!p.localizacao_id).length,
    comAbc: materiais.filter((p) => p.classificacao_abc === 'A' || p.classificacao_abc === 'B' || p.classificacao_abc === 'C').length,
    vendas90: pareto?.totalVendas ?? 0,
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        O sistema analisa os dados do estoque e diz o que fazer. Quanto mais completo o cadastro, mais confiáveis as sugestões.
      </p>

      <GrupoPainel step="1" titulo="Saúde do cadastro" dica="o que falta preencher para as sugestões fazerem sentido">
        <SaudeCadastro saude={saude} ir={ir} />
      </GrupoPainel>

      <GrupoPainel step="2" titulo="O que fazer" dica="comprar, repor, reorganizar, liberar capital">
        <SecaoSugestaoCompra saude={saude} ir={ir} onVerTodos={() => onDrillDown('sugestao')} />
        <SecaoPontoPedido saude={saude} ir={ir} onVerTodos={() => onDrillDown('ponto-pedido')} />
        <SecaoReorganizar saude={saude} ir={ir} onVerTodos={() => onDrillDown('mover')} />
        <SecaoLeadTime saude={saude} ir={ir} onVerTodos={() => onDrillDown('lead-time')} />
      </GrupoPainel>
    </div>
  )
}

function SaudeCadastro({ saude, ir }: { saude: Saude; ir: (d: SubAba) => void }) {
  const { total, carregando } = saude
  const itens = [
    { chave: 'minimo', rotulo: 'Estoque mínimo', com: saude.comMinimo, dica: 'Base de "o que comprar" e "quando comprar".' },
    { chave: 'custo', rotulo: 'Custo unitário', com: saude.comCusto, dica: 'Necessário para valores em R$ e capital parado.' },
    { chave: 'local', rotulo: 'Localização', com: saude.comLocal, dica: 'Necessário para sugerir reorganização.' },
    { chave: 'abc', rotulo: 'Curva ABC', com: saude.comAbc, dica: 'Base de “o que comprar” e “como reorganizar”.', destino: 'analises' as SubAba, acao: 'Recalcular em Análises →' },
  ]
  const completo = total > 0 && itens.every((i) => i.com === total) && saude.vendas90 > 0 && saude.comAbc > 0

  return (
    <CartaoPainel
      icon={ClipboardCheck}
      title="O que o sistema já sabe"
      subtitle={total > 0 ? `Conta apenas os ${total} materiais ativos.` : 'Conta apenas os materiais ativos.'}
      badge={carregando ? undefined : completo
        ? { label: 'Cadastro completo', tom: 'ok' }
        : { label: 'Falta preencher', tom: 'aviso' }
      }
    >
      {carregando ? (
        <CarregandoBloco altura="h-24" />
      ) : total === 0 ? (
        <VazioCartao
          icon={PackageOpen}
          title="Nenhum material ativo cadastrado"
          description="Cadastre os materiais da loja (tecidos, ferragens, acessórios) para o sistema começar a analisar."
          action={{ label: 'Ir para Materiais', onClick: () => ir('produtos') }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-px bg-border/60 sm:grid-cols-2 lg:grid-cols-4">
          {itens.map((i) => {
            const pct = (i.com / total) * 100
            const falta = total - i.com
            return (
              <div key={i.chave} className="flex flex-col gap-2 bg-card p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{i.rotulo}</p>
                <p className="font-display text-xl font-bold tabular-nums">
                  {i.com}<span className="text-sm font-normal text-muted-foreground"> de {total}</span>
                </p>
                <BarraProgresso pct={pct} />
                <p className="text-xs leading-snug text-muted-foreground">
                  {falta === 0 ? 'Tudo preenchido.' : `${falta} ${falta === 1 ? 'material sem' : 'materiais sem'} esse dado. ${i.dica}`}
                </p>
                {falta > 0 && (
                  <button
                    type="button"
                    onClick={() => ir(i.destino ?? 'produtos')}
                    className="mt-auto self-start text-xs font-semibold text-primary hover:underline"
                  >
                    {i.acao ?? 'Completar em Materiais →'}
                  </button>
                )}
              </div>
            )
          })}
          <div className="flex flex-col gap-2 bg-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Vendas (90 dias)</p>
            <p className="font-display text-xl font-bold tabular-nums">
              {saude.vendas90}<span className="text-sm font-normal text-muted-foreground"> {saude.vendas90 === 1 ? 'venda' : 'vendas'}</span>
            </p>
            <BarraProgresso pct={saude.vendas90 > 0 ? 100 : 0} />
            <p className="text-xs leading-snug text-muted-foreground">
              {saude.vendas90 > 0
                ? 'Histórico de saída disponível.'
                : 'Sem vendas, o sistema não sabe o que gira. Registre em Estoque › Vendas (não nos orçamentos).'}
            </p>
            {saude.vendas90 === 0 && (
              <button
                type="button"
                onClick={() => ir('vendas')}
                className="mt-auto self-start text-xs font-semibold text-primary hover:underline"
              >
                Registrar venda →
              </button>
            )}
          </div>
        </div>
      )}
    </CartaoPainel>
  )
}

// ─── S1: Sugestão de Compra ───────────────────────────────────────────────────

function SecaoSugestaoCompra({ saude, ir, onVerTodos }: SecaoProps) {
  const { data = [], isLoading } = useSugestaoCompra()
  const naoOk = data.filter(r => r.urgencia !== 'ok')
  const totalEstimado = naoOk.reduce((s, r) => s + r.custo_estimado, 0)
  const top10 = naoOk.slice(0, 10)

  type Row = typeof top10[number]
  const columns: EstoqueTableColumn<Row>[] = [
    {
      key: 'urgencia',
      align: 'center',
      header: 'Urgência',
      cell: (r) => (
        <span className={cn(
          'inline-flex h-6 px-2 items-center rounded-full text-xs font-medium',
          urgencyColor[r.urgencia] ?? urgencyColor.ok,
        )}>
          {urgencyLabel[r.urgencia] ?? r.urgencia}
        </span>
      ),
    },
    {
      key: 'sku',
      align: 'center',
      header: 'SKU',
      cell: (r) => <span className="font-mono text-gray-500 dark:text-muted-foreground">{r.codigo ?? '—'}</span>,
    },
    {
      key: 'nome',
      align: 'center',
      header: 'Nome',
      className: 'max-w-[140px]',
      cell: (r) => <span className="block truncate font-medium">{r.nome}</span>,
    },
    {
      key: 'estoque',
      header: 'Estoque',
      align: 'center',
      cell: (r) => <span className="tabular-nums">{fmtNum(r.quantidade_atual)}</span>,
    },
    {
      key: 'lec',
      header: <InfoTooltip label="LEC" tip="Lote Econômico de Compra. Quantidade ideal a comprar de cada vez pra gastar menos com pedidos e armazenagem. Calculado pelo sistema com base nas vendas dos últimos 12 meses." />,
      align: 'center',
      cell: (r) => <span className="tabular-nums font-medium text-primary">{fmtNum(r.lec_sugerido)}</span>,
    },
    {
      key: 'fornecedor',
      align: 'center',
      header: 'Fornecedor',
      className: 'max-w-[120px]',
      cell: (r) => <span className="block truncate text-gray-500 dark:text-muted-foreground">{r.fornecedor_nome ?? '—'}</span>,
    },
  ]

  const av = avaliar(saude, ['abc', 'minimo', 'vendas', 'custo'], ir)
  const pronto = !isLoading && !saude.carregando

  return (
    <CartaoPainel
      icon={ShoppingBag}
      title="O que comprar agora"
      subtitle={
        av.bloqueio || !pronto || naoOk.length === 0
          ? 'Materiais classe A que já passaram do ideal e precisam de reposição.'
          : `${naoOk.length} precisam de reposição · ${fmtBRL(totalEstimado)} estimado`
      }
      badge={!pronto ? undefined
        : av.bloqueio ? { label: 'Dados incompletos', tom: 'aviso' }
        : naoOk.length > 0 ? { label: `${naoOk.length} ${naoOk.length === 1 ? 'material' : 'materiais'}`, tom: 'info' }
        : av.completo ? { label: 'Tudo abastecido', tom: 'ok' }
        : { label: 'Nada a repor (dados parciais)', tom: 'neutro' }
      }
    >
      {saude.carregando ? <CarregandoBloco /> : av.bloqueioEl ?? (
        <>
          {av.avisos}
          {!isLoading && naoOk.length === 0 && av.completo ? (
            <TudoCerto texto="Nenhum material classe A abaixo do ideal." />
          ) : (
            <EstoqueTable
              columns={columns}
              data={top10}
              keyExtractor={(r) => r.id}
              isLoading={isLoading}
              emptyMessage="Nenhum material abaixo do ideal entre os que têm dados completos."
              footerLeft={`${data.length} materiais classe A analisados`}
              footerRight={
                <button onClick={onVerTodos} className="text-xs font-semibold text-primary hover:underline">
                  Ver todos →
                </button>
              }
            />
          )}
        </>
      )}
    </CartaoPainel>
  )
}

// ─── S2: Ponto de Pedido ──────────────────────────────────────────────────────

function SecaoPontoPedido({ saude, ir, onVerTodos }: SecaoProps) {
  const { data = [], isLoading } = useEstoquePontoPedido()
  const alertas = data.filter(r => r.nivel_alerta !== 'ok' && r.nivel_alerta !== 'sem_dados')
  const rupturas = alertas.filter(r => r.nivel_alerta === 'ruptura').length
  const criticos = alertas.filter(r => r.nivel_alerta === 'critico').length
  const top10 = alertas.slice(0, 10)

  const av = avaliar(saude, ['minimo', 'vendas'], ir)
  const pronto = !isLoading && !saude.carregando

  const badge = !pronto ? undefined :
    av.bloqueio ? { label: 'Dados incompletos', tom: 'aviso' as const } :
    rupturas > 0 ? { label: `${rupturas} em ruptura`, tom: 'urgente' as const } :
    criticos > 0 ? { label: `${criticos} crítico${criticos !== 1 ? 's' : ''}`, tom: 'urgente' as const } :
    alertas.length > 0 ? { label: `${alertas.length} em alerta`, tom: 'aviso' as const } :
    av.completo ? { label: 'Tudo ok', tom: 'ok' as const } :
    { label: 'Sem alertas (dados parciais)', tom: 'neutro' as const }

  type Row = typeof top10[number]
  const columns: EstoqueTableColumn<Row>[] = [
    {
      key: 'alerta',
      align: 'center',
      header: 'Alerta',
      cell: (r) => <NivelBadge nivel={r.nivel_alerta} />,
    },
    {
      key: 'sku',
      align: 'center',
      header: 'SKU',
      cell: (r) => <span className="font-mono text-gray-500 dark:text-muted-foreground">{r.sku ?? '—'}</span>,
    },
    {
      key: 'nome',
      align: 'center',
      header: 'Nome',
      className: 'max-w-[140px]',
      cell: (r) => <span className="block truncate font-medium">{r.nome}</span>,
    },
    {
      key: 'classe',
      header: 'Classe',
      align: 'center',
      cell: (r) => <ClasseABC classe={r.classe_abc} />,
    },
    {
      key: 'estoque',
      header: 'Estoque',
      align: 'center',
      cell: (r) => <span className="tabular-nums">{fmtNum(r.estoque_atual)}</span>,
    },
    {
      key: 'ponto_pedido',
      header: <InfoTooltip label="Ponto de Pedido" tip="O nível de estoque em que o sistema avisa: 'compra agora!'. Se esperar mais, o material vai faltar antes do pedido chegar." />,
      align: 'center',
      cell: (r) => <span className="tabular-nums">{fmtNum(r.ponto_pedido)}</span>,
    },
    {
      key: 'cobertura',
      header: 'Cobertura',
      align: 'center',
      cell: (r) =>
        r.cobertura_dias > 0
          ? <span className="tabular-nums text-gray-500 dark:text-muted-foreground">{r.cobertura_dias}d</span>
          : <span className="text-red-700 dark:text-red-400 font-semibold">Ruptura</span>,
    },
  ]

  return (
    <CartaoPainel
      icon={AlertTriangle}
      title="Quando comprar"
      subtitle="Materiais que já passaram do ponto de pedido. Se não comprar agora, vai faltar antes da entrega chegar."
      badge={badge}
    >
      {saude.carregando ? <CarregandoBloco /> : av.bloqueioEl ?? (
        <>
          {av.avisos}
          {!isLoading && alertas.length === 0 && av.completo ? (
            <TudoCerto texto="Todos os materiais estão acima do ponto de pedido." />
          ) : (
            <EstoqueTable
              columns={columns}
              data={top10}
              keyExtractor={(r) => r.produto_id}
              isLoading={isLoading}
              emptyMessage="Nenhum alerta entre os materiais que têm dados completos."
              footerLeft={`${data.length} materiais analisados`}
              footerRight={
                <button onClick={onVerTodos} className="text-xs font-semibold text-primary hover:underline">
                  Ver todos →
                </button>
              }
            />
          )}
        </>
      )}
    </CartaoPainel>
  )
}

// ─── S3: Lead Time ────────────────────────────────────────────────────────────

function SecaoLeadTime({ saude, ir, onVerTodos }: SecaoProps) {
  const { data: rows = [], isLoading } = useLeadTimeRows()
  const comEstoque = rows.filter(r => r.quantidade_atual > 0)
  const top10 = comEstoque.slice(0, 10)
  const valorTotal = rows.reduce((s, r) => s + Number(r.valor_parado_reais ?? 0), 0)

  type Row = typeof top10[number]
  const columns: EstoqueTableColumn<Row>[] = [
    {
      key: 'nome',
      align: 'center',
      header: 'Nome',
      className: 'max-w-[180px]',
      cell: (r) => <span className="block truncate font-medium">{r.nome}</span>,
    },
    {
      key: 'classe',
      header: 'Classe',
      align: 'center',
      cell: (r) => <ClasseABC classe={r.classificacao_abc} />,
    },
    {
      key: 'dias',
      header: 'Dias parado',
      align: 'center',
      cell: (r) => {
        const dias = r.dias_em_estoque ?? 0
        const cls = dias > 180
          ? 'text-red-700 dark:text-red-400 font-semibold'
          : dias > 90
            ? 'text-gray-900 dark:text-foreground font-semibold'
            : 'text-gray-500 dark:text-muted-foreground'
        return (
          <span className={cn('tabular-nums', cls)}>
            {r.dias_em_estoque !== null ? `${r.dias_em_estoque}d` : '—'}
          </span>
        )
      },
    },
    {
      key: 'valor',
      header: 'Valor parado',
      align: 'center',
      cell: (r) =>
        r.valor_parado_reais !== null
          ? <span className="tabular-nums">{formatCurrency(Number(r.valor_parado_reais))}</span>
          : <span className="text-gray-400 dark:text-muted-foreground">—</span>,
    },
  ]

  const av = avaliar(saude, ['custo'], ir)
  const pronto = !isLoading && !saude.carregando

  return (
    <CartaoPainel
      icon={Clock}
      title="O que está parado"
      subtitle="Materiais sentados no estoque há muito tempo. Cada dia parado é dinheiro empatado."
      badge={!pronto ? undefined
        : av.bloqueio ? { label: 'Dados incompletos', tom: 'aviso' }
        : valorTotal > 0 ? { label: `${formatCurrency(valorTotal)} parado`, tom: 'aviso' }
        : av.completo ? { label: 'Nada parado', tom: 'ok' }
        : { label: 'Valor desconhecido', tom: 'neutro' }
      }
    >
      {saude.carregando ? <CarregandoBloco /> : av.bloqueioEl ?? (
        <>
          {av.avisos}
          {!isLoading && comEstoque.length === 0 ? (
            <VazioCartao
              icon={Clock}
              title="Nenhum material com estoque"
              description="Quando houver entradas registradas, aqui aparece há quantos dias cada material está parado."
            />
          ) : (
            <EstoqueTable
              columns={columns}
              data={top10}
              keyExtractor={(r) => r.produto_id}
              isLoading={isLoading}
              footerLeft={`${comEstoque.length} materiais com estoque`}
              footerRight={
                <button onClick={onVerTodos} className="text-xs font-semibold text-primary hover:underline">
                  Ver todos →
                </button>
              }
            />
          )}
        </>
      )}
    </CartaoPainel>
  )
}

// ─── S5: Reorganizar ─────────────────────────────────────────────────────────

function SecaoReorganizar({ saude, ir, onVerTodos }: SecaoProps) {
  const { data: sugestoes = [], isLoading } = useEstoqueSugestoesMover()
  const top10 = sugestoes.slice(0, 10)

  type Row = typeof top10[number]
  const columns: EstoqueTableColumn<Row>[] = [
    {
      key: 'nome',
      align: 'center',
      header: 'Nome',
      className: 'max-w-[140px]',
      cell: (r) => <span className="block truncate font-medium">{r.nome}</span>,
    },
    {
      key: 'classe',
      header: 'Classe',
      align: 'center',
      cell: (r) => <ClasseABC classe={r.classe_abc} />,
    },
    {
      key: 'local_atual',
      align: 'center',
      header: 'Local atual',
      cell: (r) => (
        <span className="text-gray-700 dark:text-foreground/80">
          {NIVEIS_ACESSO[r.nivel_atual] ?? r.nivel_atual}
        </span>
      ),
    },
    {
      key: 'sugestao',
      align: 'center',
      header: 'Sugestão',
      cell: (r) => {
        const translated = r.nivel_sugerido
          .split(' ou ')
          .map((part: string) => NIVEIS_ACESSO[part.trim()] ?? part.trim())
          .join(' ou ')
        return <span className="font-medium text-gray-900 dark:text-foreground">{translated}</span>
      },
    },
  ]

  const av = avaliar(saude, ['abc', 'local', 'vendas'], ir)
  const pronto = !isLoading && !saude.carregando

  return (
    <CartaoPainel
      icon={ArrowLeftRight}
      title="Como reorganizar a loja"
      subtitle="Sugestões para deixar os materiais mais vendidos perto do balcão e os menos vendidos no fundo."
      badge={!pronto ? undefined
        : av.bloqueio ? { label: 'Dados incompletos', tom: 'aviso' }
        : sugestoes.length > 0 ? { label: `${sugestoes.length} ${sugestoes.length === 1 ? 'sugestão' : 'sugestões'}`, tom: 'info' }
        : av.completo ? { label: 'Bem alocado', tom: 'ok' }
        : { label: 'Sem sugestões (dados parciais)', tom: 'neutro' }
      }
    >
      {saude.carregando ? <CarregandoBloco /> : av.bloqueioEl ?? (
        <>
          {av.avisos}
          {!isLoading && sugestoes.length === 0 && av.completo ? (
            <TudoCerto texto="Todos os materiais estão bem alocados." />
          ) : (
            <EstoqueTable
              columns={columns}
              data={top10}
              keyExtractor={(r) => r.produto_id}
              isLoading={isLoading}
              emptyMessage="Nenhuma sugestão entre os materiais que já têm localização."
              footerLeft={`${sugestoes.length} ${sugestoes.length === 1 ? 'sugestão' : 'sugestões'}`}
              footerRight={
                <button onClick={onVerTodos} className="text-xs font-semibold text-primary hover:underline">
                  Ver todos →
                </button>
              }
            />
          )}
        </>
      )}
    </CartaoPainel>
  )
}
