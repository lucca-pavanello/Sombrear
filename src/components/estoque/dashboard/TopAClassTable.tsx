import EstoqueTable, { type EstoqueTableColumn } from '../shared/EstoqueTable'
import type { ParetoItem } from '@/hooks/useEstoqueAnalytics'

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

interface Props {
  items: ParetoItem[]
  isLoading: boolean
}

export default function TopAClassTable({ items, isLoading }: Props) {
  const classAItems = items.filter((p) => p.classificacao_abc === 'A').slice(0, 20)

  const columns: EstoqueTableColumn<ParetoItem>[] = [
    {
      key: 'rank',
      header: '#',
      cell: (_row, i) => <span className="text-gray-500 dark:text-muted-foreground">{i + 1}</span>,
    },
    {
      key: 'sku',
      header: 'SKU',
      cell: (item) => <span className="font-mono text-xs">{item.codigo}</span>,
    },
    {
      key: 'nome',
      header: 'Nome',
      className: 'max-w-[160px]',
      cell: (item) => (
        <span className="block truncate font-medium" title={item.nome}>
          {item.nome}
        </span>
      ),
    },
    {
      key: 'valor',
      header: 'Valor vendido 90d',
      align: 'right',
      cell: (item) => (
        <span className="tabular-nums font-medium text-orange-700 dark:text-orange-400">
          {fmtBRL(item.valor_total)}
        </span>
      ),
    },
    {
      key: 'pct',
      header: '% do total',
      align: 'right',
      cell: (item) => (
        <span className="tabular-nums text-gray-500 dark:text-muted-foreground">
          {item.percentual_individual.toFixed(1)}%
        </span>
      ),
    },
  ]

  return (
    <div className="rounded-xl border-2 bg-card shadow-sm overflow-hidden">
      <div className="border-b px-4 py-3 text-center">
        <p className="text-sm font-semibold">Top Materiais — Classe A</p>
        <p className="text-xs text-muted-foreground">
          Materiais que concentram ~80% do valor vendido nos últimos 90 dias
        </p>
      </div>

      {!isLoading && classAItems.length === 0 ? (
        <div className="flex items-center justify-center h-28 text-center px-4">
          <p className="text-sm text-muted-foreground">
            Nenhum material classificado como Classe A ainda.
          </p>
        </div>
      ) : (
        <EstoqueTable
          columns={columns}
          data={classAItems}
          keyExtractor={(item) => item.produto_id}
          isLoading={isLoading}
        />
      )}
    </div>
  )
}
