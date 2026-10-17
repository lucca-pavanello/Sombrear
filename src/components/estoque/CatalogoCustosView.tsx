import { useMemo, useState } from 'react'
import {
  Search, Scissors, Wrench, ChevronRight, FileText, Package,
  Truck, CircleHelp, Receipt, Plus,
} from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import { CustomSelect } from '@/components/ui/CustomSelect'
import KpiCard from '@/components/shared/KpiCard'
import EstoqueTable, { type EstoqueTableColumn } from './shared/EstoqueTable'
import SectionCard from './shared/SectionCard'
import CorrigirCustoModal from './CorrigirCustoModal'
import LigarTecidosVenda from './LigarTecidosVenda'
import { tbl } from './shared/tableStyles'
import {
  useCustosVigentes, useHistoricoCusto, useApenasCotados,
  ROTULO_CATEGORIA, grupoDa, rotuloUnidade,
  type CustoVigente, type CategoriaCatalogo, type GrupoCatalogo,
} from '@/hooks/useCatalogoCustos'
import type { ToastType } from '@/hooks/useToast'

/**
 * Catálogo de custos — o que a loja paga pelos materiais de cortina.
 *
 * A decisão de layout principal é a separação exigida pelo pedido: tecido de
 * um lado, acessório do outro, em dois botões grandes. Quem procura um tecido
 * não passa por ponteira nem deslizante no caminho.
 *
 * O custo mostrado é o mais recente DE CADA FORNECEDOR. Por isso o mesmo
 * produto pode aparecer duas vezes, uma por fornecedor — e deve mesmo: o
 * trilho duplo sai a R$ 8,74/m na Alumitec e a R$ 15,49/m na TA Decor, e
 * esconder um dos dois seria esconder a decisão de compra.
 *
 * Esta tela NÃO altera o que a loja cobra. Custo e preço de venda vivem em
 * tabelas separadas que não se tocam.
 */

const GRUPO_INFO: Record<GrupoCatalogo, { rotulo: string; icone: typeof Scissors }> = {
  tecido:    { rotulo: 'Tecidos',    icone: Scissors },
  acessorio: { rotulo: 'Acessórios', icone: Wrench },
}

/** Data do documento como a loja lê. */
function dataBr(iso: string | null): string {
  if (!iso) return '—'
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

function precoPor(custo: number, unidade: string) {
  return `${formatCurrency(custo)} / ${rotuloUnidade(unidade)}`
}

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  toast: (type: ToastType, message: string) => void
}

type Edicao = { modo: 'editar'; item: CustoVigente } | { modo: 'novo' }

export default function CatalogoCustosView({ toast }: Props) {
  const { data: custos = [], isLoading, error } = useCustosVigentes()
  const { data: cotados = [] } = useApenasCotados()

  const [grupo, setGrupo] = useState<GrupoCatalogo>('tecido')
  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState('all')
  const [fornecedor, setFornecedor] = useState('all')
  const [aberto, setAberto] = useState<CustoVigente | null>(null)
  const [edicao, setEdicao] = useState<Edicao | null>(null)

  const porGrupo = useMemo(
    () => ({
      tecido: custos.filter(c => grupoDa(c.categoria) === 'tecido'),
      acessorio: custos.filter(c => grupoDa(c.categoria) === 'acessorio'),
    }),
    [custos]
  )

  const doGrupo = porGrupo[grupo]

  const categorias = useMemo(() => {
    const vistas = new Map<string, number>()
    for (const c of doGrupo) vistas.set(c.categoria, (vistas.get(c.categoria) ?? 0) + 1)
    return [...vistas.entries()].sort((a, b) => b[1] - a[1])
  }, [doGrupo])

  const fornecedores = useMemo(
    () => [...new Set(custos.map(c => c.fornecedor).filter(Boolean))].sort() as string[],
    [custos]
  )

  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return doGrupo.filter(c => {
      if (categoria !== 'all' && c.categoria !== categoria) return false
      if (fornecedor !== 'all' && c.fornecedor !== fornecedor) return false
      if (!q) return true
      return (
        c.descricao.toLowerCase().includes(q) ||
        (c.codigo_fornecedor ?? '').toLowerCase().includes(q) ||
        (c.cor ?? '').toLowerCase().includes(q)
      )
    })
  }, [doGrupo, busca, categoria, fornecedor])

  const aClassificar = custos.filter(c => c.categoria === 'outro').length

  const colunas: EstoqueTableColumn<CustoVigente>[] = [
    {
      key: 'produto',
      header: 'Produto',
      align: 'left',
      cell: c => (
        <div className="text-left">
          <div className="font-medium text-foreground">{c.descricao}</div>
          <div className="text-xs text-muted-foreground">
            {c.codigo_fornecedor && <span className="font-mono">{c.codigo_fornecedor}</span>}
            {c.codigo_fornecedor && ' · '}
            {ROTULO_CATEGORIA[c.categoria]}
            {c.cor && ` · ${c.cor}`}
            {c.largura_m && ` · ${c.largura_m.toFixed(2).replace('.', ',')} m`}
          </div>
        </div>
      ),
    },
    {
      key: 'fornecedor',
      header: 'Fornecedor',
      align: 'left',
      cell: c => <span className="text-left text-muted-foreground">{c.fornecedor ?? '—'}</span>,
    },
    {
      key: 'custo',
      header: 'Custo',
      align: 'right',
      cell: c => {
        // O fornecedor pode cobrar numa unidade e a loja consumir noutra: o
        // deslizante vem por MILHEIRO. Empilhar "R$ 0,18 / un" embaixo de
        // "R$ 259,44 − 30%" sem dizer a unidade do bruto faz o preço parecer
        // conta errada. Quando converte, a linha de baixo carrega a unidade.
        const converteu = c.unidade_documento !== rotuloUnidade(c.unidade_canonica).toUpperCase()
          && Math.abs(c.preco_liquido - c.custo_unitario) > 0.0001
        return (
          <div className="text-right">
            <div className="font-semibold tabular-nums text-foreground">
              {precoPor(c.custo_unitario, c.unidade_canonica)}
            </div>
            {converteu ? (
              <div className="text-xs text-muted-foreground tabular-nums">
                {formatCurrency(c.preco_liquido)} por {c.unidade_documento}
              </div>
            ) : c.desconto_pct > 0 ? (
              <div className="text-xs text-muted-foreground tabular-nums">
                tabela {formatCurrency(c.preco_bruto)} − {c.desconto_pct}%
              </div>
            ) : null}
          </div>
        )
      },
    },
    {
      key: 'origem',
      header: 'De onde veio',
      align: 'left',
      cell: c => (
        <div className="text-left text-xs">
          <div className="text-foreground">{c.referencia}</div>
          <div className="text-muted-foreground">
            {dataBr(c.data_documento)}
            {c.tipo === 'lista_manual' && ' · informado pela loja'}
          </div>
        </div>
      ),
    },
    {
      key: 'historico',
      header: '',
      align: 'center',
      cell: c => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => setEdicao({ modo: 'editar', item: c })}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-brand"
          >
            Corrigir
          </button>
          <button
            type="button"
            onClick={() => setAberto(c)}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-brand"
          >
            Histórico <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ]

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm">
        <p className="font-semibold text-destructive">Não deu para carregar o catálogo.</p>
        <p className="mt-1 text-muted-foreground">
          {error instanceof Error ? error.message : 'Erro desconhecido.'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          title="Materiais com custo"
          value={custos.length}
          icon={<Package className="h-5 w-5" />}
          subtitle="o mais recente de cada fornecedor"
        />
        <KpiCard
          title="Tecidos"
          value={porGrupo.tecido.length}
          icon={<Scissors className="h-5 w-5" />}
        />
        <KpiCard
          title="Acessórios"
          value={porGrupo.acessorio.length}
          icon={<Wrench className="h-5 w-5" />}
        />
        <KpiCard
          title="Fornecedores"
          value={fornecedores.length}
          icon={<Truck className="h-5 w-5" />}
        />
      </div>

      {aClassificar > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50/60 p-4 text-sm dark:border-amber-800/40 dark:bg-amber-950/20">
          <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-amber-900 dark:text-amber-200">
            <b>{aClassificar}</b>{' '}
            {aClassificar === 1 ? 'material espera' : 'materiais esperam'} a loja dizer em que
            categoria entra{aClassificar === 1 ? '' : 'm'}. Até lá{' '}
            {aClassificar === 1 ? 'aparece' : 'aparecem'} em “A classificar”, com o custo
            correto — a dúvida é só onde arquivar.
          </p>
        </div>
      )}

      {/* A separação obrigatória: tecido de um lado, acessório do outro */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(GRUPO_INFO) as GrupoCatalogo[]).map(g => {
          const { rotulo, icone: Icone } = GRUPO_INFO[g]
          const ativo = grupo === g
          return (
            <button
              key={g}
              type="button"
              onClick={() => {
                setGrupo(g)
                setCategoria('all')
              }}
              className={cn(
                'flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all',
                ativo
                  ? 'border-brand text-brand shadow-sm'
                  : 'border-border text-muted-foreground hover:border-border/80 hover:text-foreground'
              )}
            >
              <Icone className="h-4 w-4" />
              {rotulo}
              <span
                className={cn(
                  'rounded-md px-1.5 py-0.5 text-xs tabular-nums',
                  ativo ? 'bg-brand/10 text-brand' : 'bg-muted text-muted-foreground'
                )}
              >
                {porGrupo[g].length}
              </span>
            </button>
          )
        })}
      </div>

      <div className={tbl.container}>
        <div className={tbl.filterRow}>
          <div className={tbl.searchWrap}>
            <Search className={tbl.searchIcon} />
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por nome, código do fornecedor ou cor…"
              className={tbl.searchInput}
            />
          </div>
          {grupo === 'acessorio' && (
            <CustomSelect
              value={categoria}
              onChange={setCategoria}
              options={[
                { value: 'all', label: `Todas as categorias (${doGrupo.length})` },
                ...categorias.map(([c, n]) => ({
                  value: c,
                  label: `${ROTULO_CATEGORIA[c as CategoriaCatalogo]} (${n})`,
                })),
              ]}
            />
          )}
          <CustomSelect
            value={fornecedor}
            onChange={setFornecedor}
            options={[
              { value: 'all', label: 'Todos os fornecedores' },
              ...fornecedores.map(f => ({ value: f, label: f })),
            ]}
          />
          <button type="button" onClick={() => setEdicao({ modo: 'novo' })} className={tbl.addBtn}>
            <Plus className="h-4 w-4" /> Novo material
          </button>
        </div>

        <EstoqueTable
          columns={colunas}
          data={linhas}
          keyExtractor={c => c.item_id}
          isLoading={isLoading}
          emptyMessage={
            busca || categoria !== 'all' || fornecedor !== 'all'
              ? 'Nenhum material com esses filtros.'
              : 'Nenhum custo cadastrado ainda neste grupo.'
          }
          footerLeft={`${linhas.length} de ${doGrupo.length} ${
            GRUPO_INFO[grupo].rotulo.toLowerCase()
          }`}
        />
      </div>

      {/* Cotado e nunca comprado: fora do custo, mas não escondido */}
      {cotados.length > 0 && (
        <SectionCard
          icon={Receipt}
          title="Cotado, nunca comprado"
          subtitle="Preço que o fornecedor ofereceu e a loja não fechou — não entra no custo"
          badge={{ label: `${cotados.length} itens`, variant: 'neutral' }}
        >
          <div className="px-4 pb-4 pt-1">
            <p className="mb-3 text-xs text-muted-foreground">
              Orçamento não é compra: estes valores ficam de fora do custo de propósito. Hoje
              são a única notícia que a loja tem do preço de entretela e varão.
            </p>
            <div className="divide-y divide-border/60">
              {cotados.map(c => (
                <div key={c.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate text-foreground">{c.descricao}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.catalogo_documentos?.estoque_fornecedores?.nome} ·{' '}
                      {c.catalogo_documentos?.referencia} ·{' '}
                      {dataBr(c.catalogo_documentos?.data_documento ?? null)}
                    </div>
                  </div>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {precoPor(c.custo_unitario, c.unidade_canonica)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
      )}

      <LigarTecidosVenda toast={toast} />

      {aberto && <PainelHistorico item={aberto} onFechar={() => setAberto(null)} />}

      {edicao && (
        <CorrigirCustoModal
          item={edicao.modo === 'editar' ? edicao.item : null}
          onFechar={() => setEdicao(null)}
          toast={toast}
        />
      )}
    </div>
  )
}

// ─── Histórico de um produto ──────────────────────────────────────────────────

function PainelHistorico({ item, onFechar }: { item: CustoVigente; onFechar: () => void }) {
  const { data: ocorrencias = [], isLoading, error } = useHistoricoCusto(item)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onFechar}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white shadow-xl dark:bg-card sm:rounded-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 border-b border-border bg-white px-5 py-4 dark:bg-card">
          <h3 className="font-semibold text-foreground">{item.descricao}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {item.fornecedor}
            {item.codigo_fornecedor && ` · código ${item.codigo_fornecedor}`} ·{' '}
            {ROTULO_CATEGORIA[item.categoria]}
          </p>
        </div>

        <div className="px-5 py-4">
          <p className="mb-3 text-xs text-muted-foreground">
            Toda vez que este produto apareceu num documento deste fornecedor, do mais novo
            para o mais antigo. O custo que vale é o de cima.
          </p>

          {isLoading ? (
            <div className="space-y-2">
              {[0, 1].map(i => (
                <div key={i} className="h-14 rounded-lg skeleton-shimmer" />
              ))}
            </div>
          ) : error ? (
            /* Lista vazia e consulta quebrada são coisas MUITO diferentes, e
               sem isto as duas apareciam igual: um painel em branco. */
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <p className="font-medium text-destructive">Não deu para carregar o histórico.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {error instanceof Error ? error.message : 'Erro desconhecido.'}
              </p>
            </div>
          ) : ocorrencias.length === 0 ? (
            <p className="rounded-lg border border-border/60 p-4 text-sm text-muted-foreground">
              Nenhum documento deste fornecedor registra este produto. Se ele aparece na
              lista, o custo veio de outro lugar — vale conferir.
            </p>
          ) : (
            <ol className="space-y-2">
              {ocorrencias.map((o, i) => {
                const doc = o.catalogo_documentos
                const cotacao = doc?.tipo === 'orcamento' || doc?.tipo === 'cotacao'
                return (
                  <li
                    key={o.id}
                    className={cn(
                      'rounded-lg border p-3',
                      i === 0 && !cotacao
                        ? 'border-brand/40'
                        : 'border-border/60'
                    )}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-sm text-foreground">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                        {doc?.referencia}
                        {cotacao && (
                          <span className="rounded px-1.5 py-0.5 text-[11px] font-medium bg-muted text-muted-foreground">
                            cotação — não vale como custo
                          </span>
                        )}
                        {i === 0 && !cotacao && (
                          <span className="rounded px-1.5 py-0.5 text-[11px] font-medium bg-brand/10 text-brand">
                            custo atual
                          </span>
                        )}
                      </span>
                      <span className="font-semibold tabular-nums text-foreground">
                        {precoPor(o.custo_unitario, o.unidade_canonica)}
                      </span>
                    </div>

                    <div className="mt-1.5 text-xs text-muted-foreground">
                      {dataBr(doc?.data_documento ?? null)} · comprou{' '}
                      {o.quantidade_documento.toLocaleString('pt-BR')} {o.unidade_documento}
                      {o.desconto_pct > 0 &&
                        ` · tabela ${formatCurrency(o.preco_bruto)} com ${o.desconto_pct}% de desconto`}
                      {doc?.tabela_preco && ` · tabela ${doc.tabela_preco}`}
                      {doc?.categoria_cliente && ` · categoria ${doc.categoria_cliente}`}
                    </div>

                    {o.unidade_documento !== o.unidade_canonica && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Cobrado por {o.unidade_documento} a{' '}
                        {formatCurrency(o.preco_liquido)}; convertido para{' '}
                        {rotuloUnidade(o.unidade_canonica)} para dar para comparar.
                      </div>
                    )}

                    {o.observacao && (
                      <div className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
                        {o.observacao}
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </div>

        <div className="sticky bottom-0 border-t border-border bg-white px-5 py-3 text-right dark:bg-card">
          <button
            type="button"
            onClick={onFechar}
            className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
