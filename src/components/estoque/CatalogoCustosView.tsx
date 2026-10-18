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
import { useFornecedoresCatalogo } from '@/hooks/useCatalogoManual'
import {
  pivotarPorFornecedor, ordenar, lojasDe, ROTULO_ORDEM, SEM_FORNECEDOR,
  type MaterialPivotado, type Ordem,
} from '@/lib/catalogo/pivo'
import type { ToastType } from '@/hooks/useToast'

/**
 * Catálogo de custos — o que a loja paga pelos materiais de cortina.
 *
 * A decisão de layout principal é a separação exigida pelo pedido: tecido de
 * um lado, acessório do outro, em dois botões grandes. Quem procura um tecido
 * não passa por ponteira nem deslizante no caminho.
 *
 * O custo mostrado é o mais recente DE CADA LOJA, e as lojas ficam lado a
 * lado: uma linha por material, uma coluna por fornecedor. O que vale no
 * cálculo é o MENOR, porque é dele que a loja compra — e a comparação só é
 * possível vendo os dois juntos. Célula vazia não é erro: é a loja que ainda
 * não tem preço daquele material, e a dona preenche clicando nela.
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

type Edicao =
  | { modo: 'editar'; item: CustoVigente }
  | { modo: 'novo' }
  /** Preencher a célula vazia: este material, nesta loja, custo em branco. */
  | { modo: 'preencher'; item: CustoVigente; fornecedorId: string }

export default function CatalogoCustosView({ toast }: Props) {
  const { data: custos = [], isLoading, error } = useCustosVigentes()
  const { data: cotados = [] } = useApenasCotados()
  const { data: fornecedoresCadastrados = [] } = useFornecedoresCatalogo()

  const [grupo, setGrupo] = useState<GrupoCatalogo>('tecido')
  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState('all')
  const [fornecedor, setFornecedor] = useState('all')
  const [ordem, setOrdem] = useState<Ordem>('menor_custo')
  const [aberto, setAberto] = useState<CustoVigente | null>(null)
  const [edicao, setEdicao] = useState<Edicao | null>(null)

  // O pivô vem ANTES de tudo para que as contagens da tela sejam de
  // materiais, não de linhas por fornecedor: a loja compra 20 tecidos, não
  // "20 ocorrências".
  const porGrupo = useMemo(
    () => ({
      tecido: pivotarPorFornecedor(custos.filter(c => grupoDa(c.categoria) === 'tecido')),
      acessorio: pivotarPorFornecedor(custos.filter(c => grupoDa(c.categoria) === 'acessorio')),
    }),
    [custos]
  )

  const doGrupo = porGrupo[grupo]

  const nomePorId = useMemo(
    () => new Map(fornecedoresCadastrados.map(f => [f.id, f.nome as string | null])),
    [fornecedoresCadastrados]
  )

  /** As colunas: uma por loja que aparece neste grupo. */
  const lojas = useMemo(() => lojasDe(doGrupo, nomePorId), [doGrupo, nomePorId])

  const categorias = useMemo(() => {
    const vistas = new Map<string, number>()
    for (const m of doGrupo) vistas.set(m.categoria, (vistas.get(m.categoria) ?? 0) + 1)
    return [...vistas.entries()].sort((a, b) => b[1] - a[1])
  }, [doGrupo])

  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const filtradas = doGrupo.filter(m => {
      if (categoria !== 'all' && m.categoria !== categoria) return false
      if (fornecedor !== 'all' && !m.porFornecedor.has(fornecedor)) return false
      if (!q) return true
      if (m.descricao.toLowerCase().includes(q)) return true
      if ((m.cor ?? '').toLowerCase().includes(q)) return true
      // O código é de cada loja, então busca-se em todos: digitar "2849090"
      // tem que achar o material mesmo que a Corttex não seja a mais barata.
      return [...m.porFornecedor.values()].some(c =>
        (c.codigo_fornecedor ?? '').toLowerCase().includes(q)
      )
    })
    return ordenar(filtradas, ordem)
  }, [doGrupo, busca, categoria, fornecedor, ordem])

  const aClassificar = [...porGrupo.tecido, ...porGrupo.acessorio]
    .filter(m => m.categoria === 'outro').length
  const totalMateriais = porGrupo.tecido.length + porGrupo.acessorio.length

  const colunas: EstoqueTableColumn<MaterialPivotado>[] = [
    {
      key: 'produto',
      header: 'Produto',
      align: 'left',
      cell: m => (
        <div className="text-left">
          <div className="font-medium text-foreground">{m.descricao}</div>
          <div className="text-xs text-muted-foreground">
            {ROTULO_CATEGORIA[m.categoria]}
            {m.cor && ` · ${m.cor}`}
            {m.largura_m && ` · ${m.largura_m.toFixed(2).replace('.', ',')} m`}
            {` · por ${rotuloUnidade(m.unidade_canonica)}`}
          </div>
        </div>
      ),
    },

    // Uma coluna por loja. A mais barata fica marcada, porque é a que o
    // cálculo usa — e a comparação é o motivo de a tela existir.
    ...lojas.map<EstoqueTableColumn<MaterialPivotado>>(loja => ({
      key: `loja:${loja.id}`,
      header: loja.nome,
      align: 'right',
      cell: m => {
        const c = m.porFornecedor.get(loja.id)
        if (!c) {
          return (
            <button
              type="button"
              onClick={() =>
                setEdicao({
                  modo: 'preencher',
                  // O material é o mesmo; só o fornecedor e o custo mudam.
                  item: m.menor ?? [...m.porFornecedor.values()][0],
                  fornecedorId: loja.id,
                })
              }
              className="w-full rounded-lg border border-dashed border-border/70 px-2 py-1.5 text-xs text-muted-foreground/70 transition-colors hover:border-brand/50 hover:text-brand"
              title={`Informar quanto este material custa em ${loja.nome}`}
            >
              informar
            </button>
          )
        }
        const maisBarato = m.menor?.item_id === c.item_id && m.porFornecedor.size > 1
        return (
          <button
            type="button"
            onClick={() => setEdicao({ modo: 'editar', item: c })}
            className="w-full rounded-lg px-2 py-1 text-right transition-colors hover:bg-muted/60"
            title={`Corrigir o custo em ${loja.nome}`}
          >
            <span
              className={cn(
                'block font-semibold tabular-nums',
                maisBarato ? 'text-brand' : 'text-foreground'
              )}
            >
              {formatCurrency(c.custo_unitario)}
            </span>
            {/* Só cabe uma linha de contexto por célula agora que são várias
                lojas. A ordem é a da utilidade: qual vale, depois o desconto
                que explica o número (todo item da Alumitec tem 30%), depois
                a data. O detalhe completo continua no Histórico. */}
            <span className="block text-xs text-muted-foreground tabular-nums">
              {maisBarato
                ? 'mais barato'
                : c.desconto_pct > 0
                  ? `tabela ${formatCurrency(c.preco_bruto)} − ${c.desconto_pct}%`
                  : dataBr(c.data_documento)}
            </span>
          </button>
        )
      },
    })),

    {
      key: 'origem',
      header: 'De onde veio',
      align: 'left',
      cell: m =>
        m.menor ? (
          <div className="text-left text-xs">
            <div className="text-foreground">{m.menor.referencia}</div>
            <div className="text-muted-foreground">
              {dataBr(m.menor.data_documento)}
              {m.menor.tipo === 'lista_manual' && ' · informado pela loja'}
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: 'historico',
      header: '',
      align: 'center',
      cell: m => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => m.menor && setAberto(m.menor)}
            disabled={!m.menor}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-brand disabled:opacity-40"
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
          value={totalMateriais}
          icon={<Package className="h-5 w-5" />}
          subtitle="vale o mais barato entre as lojas"
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
          title="Lojas"
          value={lojas.filter(l => l.id !== SEM_FORNECEDOR).length}
          icon={<Truck className="h-5 w-5" />}
          subtitle={`com preço de ${GRUPO_INFO[grupo].rotulo.toLowerCase()}`}
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
              { value: 'all', label: 'Todas as lojas' },
              ...lojas.map(l => ({ value: l.id, label: `Tem preço em ${l.nome}` })),
            ]}
          />
          <CustomSelect
            value={ordem}
            onChange={v => setOrdem(v as Ordem)}
            options={(Object.keys(ROTULO_ORDEM) as Ordem[]).map(o => ({
              value: o,
              label: ROTULO_ORDEM[o],
            }))}
          />
          <button type="button" onClick={() => setEdicao({ modo: 'novo' })} className={tbl.addBtn}>
            <Plus className="h-4 w-4" /> Novo material
          </button>
        </div>

        <EstoqueTable
          columns={colunas}
          data={linhas}
          keyExtractor={m => m.chave}
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
          item={edicao.modo === 'novo' ? null : edicao.item}
          /* Preencher a célula vazia é o mesmo material em outra loja: os
             dados do produto vêm prontos, o fornecedor já vem escolhido e só
             o custo fica em branco, que é o que a dona tem para digitar. */
          trocarPara={edicao.modo === 'preencher' ? edicao.fornecedorId : undefined}
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
