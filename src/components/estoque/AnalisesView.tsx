import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import {
  BarChart2, Activity, Truck, Layers, MapPin, Calendar, TrendingUp,
  Star, RefreshCw, Trophy, ShoppingCart,
} from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useParetoData, useGiroAnual } from '@/hooks/useEstoqueAnalytics'
import { useEstoqueProdutos } from '@/hooks/useEstoqueProdutos'
import { useMargemEstoque } from '@/hooks/useEstoqueMargemEstoque'
import {
  useEstoquePerformanceFornecedor,
  useEstoquePerformanceCategoria,
  useEstoquePerformanceLocalizacao,
  useEstoqueSazonalidade,
} from '@/hooks/useEstoqueAnalyticsDescritivo'
import { NIVEIS_ACESSO } from '@/lib/constants'
import ParetoChart from './dashboard/ParetoChart'
import TopAClassTable from './dashboard/TopAClassTable'
import RecalcularABCButton from './dashboard/RecalcularABCButton'
import GiroMensalChart from './analises/GiroMensalChart'
import EstoqueTable, { type EstoqueTableColumn } from './shared/EstoqueTable'
import { ClasseABC } from './shared/ClasseABC'
import { CartaoPainel, GrupoPainel, KpiResumo, VazioCartao, CarregandoBloco, AvisoDados } from './shared/PainelEstoque'
import type { ToastType } from '@/hooks/useToast'
import type { CoberturaMargemRow } from '@/lib/supabase'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

const fmtNum = (v: number, decimals = 2) =>
  new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(v)

/** Texto que explica de onde vêm os números — repetido nos estados vazios. */
const ORIGEM_VENDAS = 'Estas análises usam as vendas registradas em Estoque › Vendas (não os orçamentos).'

type Ir = (subAba: 'vendas' | 'produtos' | 'fornecedores' | 'entradas' | 'localizacoes') => void

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  toast: (type: ToastType, message: string) => void
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function AnalisesView({ toast }: Props) {
  const navigate = useNavigate()
  const ir: Ir = (subAba) => navigate(`/estoque/${subAba}`)

  return (
    <div className="space-y-6">
      <ResumoTopo />

      <GrupoPainel step="1" titulo="O que mais gira" dica="o que vende, o que rende giro">
        <SecaoCurvaAbc toast={toast} ir={ir} />
        <SecaoGiroMensal ir={ir} />
      </GrupoPainel>

      <GrupoPainel step="2" titulo="Dinheiro e margem" dica="quanto entra, de onde e com que lucro">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SecaoPerformanceCategoria ir={ir} />
          <SecaoSazonalidade ir={ir} />
        </div>
        <SecaoMaisRentaveis ir={ir} />
      </GrupoPainel>

      <GrupoPainel step="3" titulo="Fornecedores e espaço" dica="quem entrega e onde fica cada material">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SecaoPerformanceFornecedor ir={ir} />
          <SecaoPerformanceLocalizacao ir={ir} />
        </div>
      </GrupoPainel>
    </div>
  )
}

// ─── Resumo no topo ───────────────────────────────────────────────────────────

function ResumoTopo() {
  const { data: produtos = [], isLoading: lp } = useEstoqueProdutos()
  const { data: giro, isLoading: lg } = useGiroAnual()
  const { data: categorias = [], isLoading: lc } = useEstoquePerformanceCategoria()
  const { data: fornecedores = [], isLoading: lf } = useEstoquePerformanceFornecedor()

  const classeA = produtos.filter((p) => p.classificacao_abc === 'A').length
  const classificados = produtos.filter(
    (p) => p.classificacao_abc === 'A' || p.classificacao_abc === 'B' || p.classificacao_abc === 'C',
  ).length

  const totalVendido = categorias.reduce((s, r) => s + r.valor_vendido_90d, 0)
  const topCategoria = categorias.reduce<(typeof categorias)[number] | null>(
    (best, r) => (r.valor_vendido_90d > (best?.valor_vendido_90d ?? 0) ? r : best), null,
  )

  const topFornecedor = fornecedores.reduce<(typeof fornecedores)[number] | null>(
    (best, r) => (r.total_entradas > (best?.total_entradas ?? 0) ? r : best), null,
  )

  const temGiro = !!giro && giro.vendas_reais > 0

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiResumo
        icon={Star}
        rotulo="Materiais classe A"
        carregando={lp}
        valor={classificados > 0 ? String(classeA) : '—'}
        sub={classificados > 0 ? `de ${classificados} materiais classificados` : 'Registre vendas e clique em Recalcular ABC'}
        acento="primario"
      />
      <KpiResumo
        icon={RefreshCw}
        rotulo="Giro anual"
        carregando={lg}
        valor={temGiro ? `${fmtNum(giro.giro_reais)}×` : '—'}
        sub={temGiro ? 'estoque vendido e reposto em 12 meses' : 'Sem vendas nos últimos 12 meses'}
        acento="emerald"
      />
      <KpiResumo
        icon={Trophy}
        rotulo="Categoria que mais vende"
        carregando={lc}
        valor={topCategoria && totalVendido > 0 ? (topCategoria.categoria ?? 'Sem tipo') : '—'}
        sub={
          topCategoria && totalVendido > 0
            ? `${Math.round((topCategoria.valor_vendido_90d / totalVendido) * 100)}% do vendido em 90 dias`
            : 'Sem vendas nos últimos 90 dias'
        }
      />
      <KpiResumo
        icon={Truck}
        rotulo="Fornecedor mais usado"
        carregando={lf}
        valor={topFornecedor ? topFornecedor.nome : '—'}
        sub={
          topFornecedor
            ? `${topFornecedor.total_entradas} ${topFornecedor.total_entradas === 1 ? 'entrada' : 'entradas'} em 90 dias`
            : 'Sem entradas em 90 dias. Registre em Entradas'
        }
      />
    </div>
  )
}

// ─── Curva ABC / O que mais vende ────────────────────────────────────────────

function SecaoCurvaAbc({ toast, ir }: { toast: Props['toast']; ir: Ir }) {
  const { data: paretoData, isLoading } = useParetoData()
  const total = paretoData?.totalVendas ?? 0
  const hasData = total >= 5

  return (
    <CartaoPainel
      icon={BarChart2}
      title="O que mais vende"
      subtitle="Curva ABC: poucos materiais geram a maior parte do faturamento. Top 20, últimos 90 dias."
      badge={isLoading ? undefined : { label: `${total} ${total === 1 ? 'venda' : 'vendas'} em 90 dias`, tom: hasData ? 'neutro' : 'aviso' }}
      acao={<RecalcularABCButton toast={toast} />}
    >
      {isLoading ? (
        <CarregandoBloco altura="h-64" />
      ) : !hasData ? (
        <VazioCartao
          icon={BarChart2}
          title={total === 0 ? 'Nenhuma venda registrada nos últimos 90 dias' : `Só ${total} de 5 vendas necessárias`}
          description={`A Curva ABC precisa de pelo menos 5 vendas para fazer sentido. ${ORIGEM_VENDAS}`}
          action={{ label: 'Registrar venda', onClick: () => ir('vendas') }}
        />
      ) : (
        <div className="space-y-4 p-4">
          <ParetoChart items={paretoData?.items ?? []} isLoading={false} />
          <TopAClassTable items={paretoData?.items ?? []} isLoading={false} />
        </div>
      )}
    </CartaoPainel>
  )
}

// ─── Evolução do giro ─────────────────────────────────────────────────────────

function Stat({ rotulo, valor, sub }: { rotulo: string; valor: ReactNode; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{rotulo}</p>
      <p className="font-display mt-1 text-2xl font-bold tabular-nums text-foreground">{valor}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
    </div>
  )
}

function SecaoGiroMensal({ ir }: { ir: Ir }) {
  const { data: giro, isLoading } = useGiroAnual()
  const temDados = !!giro && giro.vendas_reais > 0

  return (
    <CartaoPainel
      icon={Activity}
      title="Evolução do giro"
      subtitle="Quantas vezes o estoque inteiro foi vendido e reposto em cada mês do último ano."
    >
      {isLoading ? (
        <CarregandoBloco altura="h-72" />
      ) : !temDados ? (
        <VazioCartao
          icon={Activity}
          title="Sem vendas para calcular o giro"
          description={`O giro compara o que foi vendido com o valor parado em estoque. ${ORIGEM_VENDAS} Os custos dos materiais vêm de Materiais.`}
          action={{ label: 'Ir para Vendas', onClick: () => ir('vendas') }}
        />
      ) : (
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Stat
              rotulo="Giro anual"
              valor={<>{fmtNum(giro.giro_reais)}<span className="text-base font-normal text-muted-foreground"> × ao ano</span></>}
              sub="Quantas vezes o estoque foi vendido e reposto nos últimos 12 meses"
            />
            <Stat
              rotulo="Estoque médio"
              valor={fmtBRL(giro.estoque_atual_reais)}
              sub="Valor médio mantido em estoque ao longo do ano"
            />
          </div>
          <GiroMensalChart />
        </div>
      )}
    </CartaoPainel>
  )
}

// ─── Performance por fornecedor ──────────────────────────────────────────────

function SecaoPerformanceFornecedor({ ir }: { ir: Ir }) {
  const { data = [], isLoading } = useEstoquePerformanceFornecedor()
  const semEntradas = data.length > 0 && data.every((r) => r.total_entradas === 0)

  type Row = typeof data[number]
  const columns: EstoqueTableColumn<Row>[] = [
    {
      key: 'nome',
      header: 'Fornecedor',
      cell: (r) => <span className="text-sm font-medium">{r.nome}</span>,
    },
    {
      key: 'lead_time',
      header: 'Lead time',
      align: 'right',
      cell: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {r.lead_time_medio_dias !== null ? r.lead_time_medio_dias + 'd' : '—'}
        </span>
      ),
    },
    {
      key: 'entradas',
      header: 'Entradas 90d',
      align: 'right',
      cell: (r) => <span className="tabular-nums">{r.total_entradas}</span>,
    },
    {
      key: 'valor_comprado',
      header: 'Comprado 90d',
      align: 'right',
      cell: (r) => <span className="tabular-nums">{fmtBRL(r.valor_total_comprado)}</span>,
    },
  ]

  return (
    <CartaoPainel
      icon={Truck}
      title="Performance por fornecedor"
      subtitle="Quem entrega mais e mais rápido. Use para negociar e priorizar."
      badge={isLoading || data.length === 0 ? undefined : { label: data.length + (data.length !== 1 ? ' fornecedores' : ' fornecedor'), tom: 'neutro' }}
    >
      {isLoading ? (
        <CarregandoBloco />
      ) : data.length === 0 ? (
        <VazioCartao
          icon={Truck}
          title="Nenhum fornecedor ativo"
          description="Cadastre seus fornecedores e registre as compras em Entradas; o lead time sai das datas de pedido e chegada."
          action={{ label: 'Ir para Fornecedores', onClick: () => ir('fornecedores') }}
        />
      ) : (
        <>
          {semEntradas && (
            <AvisoDados
              texto="Nenhuma compra registrada nos últimos 90 dias, então valores e lead time ainda estão zerados."
              acao={{ label: 'Registrar entrada', onClick: () => ir('entradas') }}
            />
          )}
          <EstoqueTable columns={columns} data={data} keyExtractor={(r) => r.id} />
        </>
      )}
    </CartaoPainel>
  )
}

// ─── Os mais rentáveis ────────────────────────────────────────────────────────

type RentavelRow = CoberturaMargemRow & { lucro_unitario: number | null }

function SecaoMaisRentaveis({ ir }: { ir: Ir }) {
  const { data: rawRows = [], isLoading } = useMargemEstoque()

  const rows: RentavelRow[] = useMemo(() => {
    return rawRows
      .filter(r => r.margem_percentual !== null)
      .map(r => ({
        ...r,
        lucro_unitario:
          r.preco_venda != null && r.custo_medio != null
            ? r.preco_venda - r.custo_medio
            : null,
      }))
      .slice(0, 20)
  }, [rawRows])

  const columns: EstoqueTableColumn<RentavelRow>[] = [
    {
      key: 'produto',
      header: 'Material',
      cell: (r) => (
        <div className="flex flex-col">
          <span className="text-sm font-medium">{r.nome}</span>
          {r.sku && <span className="text-xs font-mono text-muted-foreground/60">{r.sku}</span>}
        </div>
      ),
    },
    {
      key: 'classe',
      header: 'ABC',
      align: 'center',
      cell: (r) => <ClasseABC classe={r.classe_abc} />,
    },
    {
      key: 'custo',
      header: 'Custo',
      align: 'right',
      cell: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {r.custo_medio != null ? fmtBRL(r.custo_medio) : '—'}
        </span>
      ),
    },
    {
      key: 'preco',
      header: 'Preço venda',
      align: 'right',
      cell: (r) => (
        <span className="tabular-nums">
          {r.preco_venda != null ? fmtBRL(r.preco_venda) : '—'}
        </span>
      ),
    },
    {
      key: 'lucro',
      header: 'Lucro unit.',
      align: 'right',
      cell: (r) => {
        const l = r.lucro_unitario
        return (
          <span className={cn('tabular-nums font-medium', l != null && l < 0 ? 'text-red-600' : 'text-green-700 dark:text-green-400')}>
            {l != null ? fmtBRL(l) : '—'}
          </span>
        )
      },
    },
    {
      key: 'margem',
      header: 'Margem',
      align: 'right',
      cell: (r) => {
        const m = r.margem_percentual
        const cor = m == null ? '' : m < 0 ? 'text-red-600' : m < 20 ? 'text-amber-600' : 'text-green-700 dark:text-green-400'
        return (
          <span className={cn('tabular-nums font-semibold', cor)}>
            {m != null ? fmtNum(m, 1) + '%' : '—'}
          </span>
        )
      },
    },
  ]

  return (
    <CartaoPainel
      icon={TrendingUp}
      title="Os mais rentáveis"
      subtitle="Materiais com maior margem de contribuição: (preço de venda − custo) ÷ preço. Top 20."
      badge={isLoading || rows.length === 0 ? undefined : { label: `${rows.length} ${rows.length === 1 ? 'material' : 'materiais'}`, tom: 'neutro' }}
    >
      {isLoading ? (
        <CarregandoBloco />
      ) : rows.length === 0 ? (
        <VazioCartao
          icon={TrendingUp}
          title="Nenhum material com preço de venda e custo"
          description="A margem só aparece quando o material tem custo unitário e preço de venda preenchidos na ficha dele."
          action={{ label: 'Ir para Materiais', onClick: () => ir('produtos') }}
        />
      ) : (
        <EstoqueTable columns={columns} data={rows} keyExtractor={(r) => r.produto_id} />
      )}
    </CartaoPainel>
  )
}

// ─── Performance por categoria ───────────────────────────────────────────────

const PIE_COLORS = ['#E8701A', '#FB923C', '#FDBA74', '#FED7AA', '#FFF7ED']

function SecaoPerformanceCategoria({ ir }: { ir: Ir }) {
  const { data = [], isLoading } = useEstoquePerformanceCategoria()

  const totalVendido = data.reduce((s, r) => s + r.valor_vendido_90d, 0)
  const maxVendido = data.length > 0 ? Math.max(...data.map(r => r.valor_vendido_90d)) : 0

  const pieData = data.map((r) => ({
    name: r.categoria ?? 'Sem tipo',
    value: r.valor_vendido_90d,
  }))

  return (
    <CartaoPainel
      icon={Layers}
      title="Performance por categoria"
      subtitle="Quanto cada tipo de material contribui no faturamento dos últimos 90 dias."
    >
      {isLoading ? (
        <CarregandoBloco altura="h-64" />
      ) : data.length === 0 ? (
        <VazioCartao
          icon={Layers}
          title="Nenhum material com categoria"
          description="Cadastre os materiais e escolha a categoria de cada um (tecido, ferragem, acessório…) para comparar o desempenho."
          action={{ label: 'Ir para Materiais', onClick: () => ir('produtos') }}
        />
      ) : totalVendido === 0 ? (
        <VazioCartao
          icon={ShoppingCart}
          title="Sem vendas nos últimos 90 dias"
          description={`Há ${data.length} ${data.length === 1 ? 'categoria' : 'categorias'}, mas nenhuma venda para dividir entre elas. ${ORIGEM_VENDAS}`}
          action={{ label: 'Registrar venda', onClick: () => ir('vendas') }}
        />
      ) : (
        <div className="space-y-3 p-4">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {pieData.map((_, index) => (
                    <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => [fmtBRL(value), 'Vendido 90d']}
                  contentStyle={{
                    backgroundColor: 'var(--background)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="divide-y divide-border/60">
            {data.map((r, i) => {
              const pct = Math.round((r.valor_vendido_90d / totalVendido) * 100)
              const isMax = r.valor_vendido_90d === maxVendido
              return (
                <li key={r.categoria ?? i} className="flex items-center gap-3 py-2 text-sm">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium capitalize">{r.categoria ?? 'Sem tipo'}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.total_produtos} {r.total_produtos === 1 ? 'material' : 'materiais'}
                      {r.valor_em_estoque !== null && ` · ${fmtBRL(r.valor_em_estoque)} em estoque`}
                    </p>
                  </div>
                  <span className="tabular-nums">{fmtBRL(r.valor_vendido_90d)}</span>
                  <span className={cn(
                    'w-10 text-right tabular-nums font-semibold',
                    isMax ? 'text-primary' : 'text-muted-foreground',
                  )}>
                    {pct}%
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </CartaoPainel>
  )
}

// ─── Performance por localização ─────────────────────────────────────────────

function SecaoPerformanceLocalizacao({ ir }: { ir: Ir }) {
  const { data = [], isLoading } = useEstoquePerformanceLocalizacao()

  const avgVendido = data.length > 0
    ? data.reduce((s, r) => s + r.valor_vendido_90d, 0) / data.length
    : 0
  const semVendas = data.length > 0 && avgVendido === 0

  const isOportunidade = (r: { nivel_acesso: string | null; valor_vendido_90d: number }) =>
    (r.nivel_acesso === 'balcao' || r.nivel_acesso === 'acessivel') &&
    r.valor_vendido_90d < avgVendido &&
    avgVendido > 0

  type Row = typeof data[number]
  const columns: EstoqueTableColumn<Row>[] = [
    {
      key: 'codigo',
      header: 'Local',
      cell: (r) => (
        <div className="flex flex-col">
          <span className="font-mono font-medium">{r.codigo}</span>
          {r.setor && <span className="text-xs capitalize text-muted-foreground">{r.setor}</span>}
        </div>
      ),
    },
    {
      key: 'nivel',
      header: 'Nível',
      cell: (r) => (
        <span className="inline-flex h-6 items-center rounded-full border border-border bg-muted/40 px-2 text-xs font-medium text-muted-foreground">
          {NIVEIS_ACESSO[r.nivel_acesso ?? ''] ?? r.nivel_acesso ?? '—'}
        </span>
      ),
    },
    {
      key: 'estoque',
      header: 'Estoque',
      align: 'right',
      cell: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {r.valor_em_estoque !== null ? fmtBRL(r.valor_em_estoque) : '—'}
        </span>
      ),
    },
    {
      key: 'vendido',
      header: 'Vendido 90d',
      align: 'right',
      cell: (r) => <span className="tabular-nums">{fmtBRL(r.valor_vendido_90d)}</span>,
    },
  ]

  const temOportunidade = data.some(isOportunidade)

  return (
    <CartaoPainel
      icon={MapPin}
      title="Performance por localização"
      subtitle="Quais lugares da loja geram mais vendas. Ajuda a reorganizar e aproveitar pontos quentes."
      badge={isLoading || data.length === 0 ? undefined : { label: `${data.length} ${data.length === 1 ? 'local' : 'locais'}`, tom: 'neutro' }}
    >
      {isLoading ? (
        <CarregandoBloco />
      ) : data.length === 0 ? (
        <VazioCartao
          icon={MapPin}
          title="Nenhuma localização cadastrada"
          description="Cadastre as prateleiras e gavetas e diga onde cada material fica; só assim dá para ver quais locais vendem mais."
          action={{ label: 'Ir para Localizações', onClick: () => ir('localizacoes') }}
        />
      ) : (
        <>
          {semVendas && (
            <AvisoDados
              texto="Ainda não há vendas ligadas a estes locais nos últimos 90 dias, por isso a coluna de vendas está zerada."
              acao={{ label: 'Ir para Vendas', onClick: () => ir('vendas') }}
            />
          )}
          <EstoqueTable
            columns={columns}
            data={data}
            keyExtractor={(r) => r.id}
            rowClassName={(r) => isOportunidade(r) ? 'bg-amber-50/30 dark:bg-amber-950/10' : undefined}
            footerLeft={
              temOportunidade ? (
                <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                  <span className="h-2.5 w-2.5 rounded-sm bg-amber-100 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700" />
                  Locais visíveis com vendas abaixo da média: considere reorganizar
                </span>
              ) : undefined
            }
          />
        </>
      )}
    </CartaoPainel>
  )
}

// ─── Sazonalidade ─────────────────────────────────────────────────────────────

const MES_ABREV: Record<number, string> = {
  1: 'Jan', 2: 'Fev', 3: 'Mar', 4: 'Abr', 5: 'Mai', 6: 'Jun',
  7: 'Jul', 8: 'Ago', 9: 'Set', 10: 'Out', 11: 'Nov', 12: 'Dez',
}

function SecaoSazonalidade({ ir }: { ir: Ir }) {
  const { data = [], isLoading } = useEstoqueSazonalidade()

  const maxFaturamento = data.length > 0 ? Math.max(...data.map(r => r.faturamento)) : 0
  const minFaturamento = data.length > 0 ? Math.min(...data.map(r => r.faturamento)) : 0

  const mesPico = data.find(r => r.faturamento === maxFaturamento && maxFaturamento > 0)
  const mesFraco = data.length > 1 ? data.find(r => r.faturamento === minFaturamento) : undefined
  const variacao = minFaturamento > 0 ? maxFaturamento / minFaturamento : null

  const barColor = (fat: number) => {
    if (fat === maxFaturamento && maxFaturamento > 0) return '#C2570F'
    if (data.length > 1 && fat === minFaturamento) return '#FDBA74'
    return 'hsl(var(--primary))'
  }

  const chartData = data.map(r => ({
    mes: MES_ABREV[r.mes_numero] ?? String(r.mes_numero),
    faturamento: r.faturamento,
    fill: barColor(r.faturamento),
  }))

  type Row = typeof data[number]
  const columns: EstoqueTableColumn<Row>[] = [
    {
      key: 'mes',
      header: 'Mês',
      cell: (r) => (
        <span className="font-medium">
          {MES_ABREV[r.mes_numero] ?? String(r.mes_numero)}/{r.ano}
        </span>
      ),
    },
    {
      key: 'vendas',
      header: 'Vendas',
      align: 'right',
      cell: (r) => <span className="tabular-nums">{r.total_vendas}</span>,
    },
    {
      key: 'faturamento',
      header: 'Faturamento',
      align: 'right',
      cell: (r) => <span className="tabular-nums">{fmtBRL(r.faturamento)}</span>,
    },
    {
      key: 'ticket',
      header: 'Ticket médio',
      align: 'right',
      cell: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {r.ticket_medio > 0 ? fmtBRL(r.ticket_medio) : '—'}
        </span>
      ),
    },
  ]

  return (
    <CartaoPainel
      icon={Calendar}
      title="Sazonalidade"
      subtitle="Como as vendas variam mês a mês. Meses fortes e fracos para planejar compras e promoções."
    >
      {isLoading ? (
        <CarregandoBloco altura="h-64" />
      ) : data.length === 0 ? (
        <VazioCartao
          icon={Calendar}
          title="Nenhuma venda nos últimos 12 meses"
          description={`Com algumas semanas de vendas registradas já dá para ver o ritmo de cada mês. ${ORIGEM_VENDAS}`}
          action={{ label: 'Registrar venda', onClick: () => ir('vendas') }}
        />
      ) : (
        <div className="space-y-4 p-4">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="mes"
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) =>
                    new Intl.NumberFormat('pt-BR', {
                      notation: 'compact',
                      style: 'currency',
                      currency: 'BRL',
                      maximumFractionDigits: 0,
                    }).format(v)
                  }
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                />
                <Tooltip
                  formatter={(value: number) => [fmtBRL(value), 'Faturamento']}
                  contentStyle={{
                    backgroundColor: 'var(--background)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="faturamento" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={700} animationEasing="ease-out">
                  {chartData.map((entry, index) => (
                    <Cell key={index} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {(mesPico || mesFraco) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {mesPico && (
                <Stat rotulo="Mês de pico" valor={<span className="text-base">{mesPico.mes_nome} {mesPico.ano}</span>} sub={fmtBRL(mesPico.faturamento)} />
              )}
              {mesFraco && mesFraco !== mesPico && (
                <Stat rotulo="Mês mais fraco" valor={<span className="text-base">{mesFraco.mes_nome} {mesFraco.ano}</span>} sub={fmtBRL(mesFraco.faturamento)} />
              )}
              {variacao !== null && variacao > 1 && (
                <Stat rotulo="Variação" valor={<span className="text-base">{fmtNum(variacao, 1)}×</span>} sub="entre pico e vale" />
              )}
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-border">
            <EstoqueTable
              columns={columns}
              data={data}
              keyExtractor={(r) => r.ano + '-' + r.mes_numero}
            />
          </div>
        </div>
      )}
    </CartaoPainel>
  )
}
