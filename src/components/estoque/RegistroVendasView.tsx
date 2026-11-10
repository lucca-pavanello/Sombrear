import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ShoppingCart, Plus, Trash2, Loader2, Eye, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/utils'
import { useEstoqueProdutos } from '@/hooks/useEstoqueProdutos'
import { useVendas, useRegistrarVenda, useVendedores } from '@/hooks/useEstoqueVendas'
import type { VendaComContagem } from '@/hooks/useEstoqueVendas'
import DatePicker from '@/components/ui/DatePicker'
import SeletorMaterial, { unidadeLabel, formatSaldo } from './SeletorMaterial'
import { tbl } from './shared/tableStyles'
import EstoqueTable, { type EstoqueTableColumn } from './shared/EstoqueTable'
import { INPUT_CLASSES, LABEL_CLASS } from './shared/inputStyles'
import type { ToastType } from '@/hooks/useToast'

// ─── Schema ───────────────────────────────────────────────────────────────────

const itemSchema = z.object({
  produto_id:     z.string().min(1, 'Escolha o material'),
  quantidade:     z.number({ error: 'Valor inválido' }).min(0.001, 'Deve ser > 0'),
  preco_unitario: z.number({ error: 'Valor inválido' }).min(0, 'Deve ser ≥ 0'),
  desconto:       z.number({ error: 'Valor inválido' }).min(0, 'Deve ser ≥ 0').default(0),
})

const schema = z.object({
  cliente:    z.string().optional(),
  data:       z.string().min(1, 'Informe a data'),
  vendedor:   z.string().optional(),
  observacao: z.string().optional(),
  itens:      z.array(itemSchema).min(1, 'Adicione pelo menos 1 item'),
})

type FormData = z.infer<typeof schema>

function hoje() {
  return new Date().toISOString().split('T')[0]
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  toast:        (type: ToastType, message: string) => void
  responsavel:  string
  userId:       string | undefined
  onVerDetalhe: (id: string) => void
}

// ─── Linha de item ────────────────────────────────────────────────────────────
// Separada do formulário para permitir, no futuro, um modo "baixa simples" (sem preço).

function LinhaItem({
  numero, podeRemover, onRemover, subtotal, unidade, saldoTexto, acimaDoSaldo,
  material, quantidade, preco, desconto,
}: {
  numero: number
  podeRemover: boolean
  onRemover: () => void
  subtotal: number
  unidade: string
  saldoTexto: string | null
  acimaDoSaldo: boolean
  material: React.ReactNode
  quantidade: React.ReactNode
  preco: React.ReactNode
  desconto: React.ReactNode
}) {
  const rot = 'block mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground'
  return (
    <div className="rounded-lg border border-gray-200 dark:border-border p-3 space-y-3">
      <div className="flex items-start gap-2">
        <span className="mt-6 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-primary text-[11px] font-bold text-primary">{numero}</span>
        <div className="flex-1 min-w-0">
          <label className={rot}>Material</label>
          {material}
        </div>
        <button
          type="button"
          onClick={onRemover}
          disabled={!podeRemover}
          className="mt-5 flex items-center gap-1 rounded-lg px-2 py-2 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Remover este item"
        >
          <Trash2 className="h-4 w-4" />
          <span className="hidden md:inline">Remover</span>
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:pl-7">
        <div>
          <label className={rot}>Quantidade{unidade ? ` (${unidade})` : ''}</label>
          {quantidade}
        </div>
        <div>
          <label className={rot}>Preço por {unidade || 'unid.'} (R$)</label>
          {preco}
        </div>
        <div>
          <label className={rot}>Desconto (R$)</label>
          {desconto}
        </div>
        <div>
          <label className={rot}>Subtotal</label>
          <div className={cn(INPUT_CLASSES, '!flex !items-center !justify-center !text-orange-700 !font-semibold !cursor-default')}>
            {formatCurrency(subtotal)}
          </div>
        </div>
      </div>

      {saldoTexto && (
        <p className={cn('sm:pl-7 flex items-center gap-1.5 text-xs', acimaDoSaldo ? 'font-semibold text-red-600' : 'text-muted-foreground')}>
          {acimaDoSaldo && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
          {acimaDoSaldo
            ? `Só há ${saldoTexto} em estoque — o sistema não deixa vender mais do que isso. Registre a entrada antes.`
            : `Disponível em estoque: ${saldoTexto}`}
        </p>
      )}
    </div>
  )
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function RegistroVendasView({ toast, responsavel, userId, onVerDetalhe }: Props) {
  const { data: produtos = [] } = useEstoqueProdutos()
  const { data: vendas = [], isLoading: loadingVendas } = useVendas()
  const { data: vendedores = [] } = useVendedores()
  const registrar = useRegistrarVenda()

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema) as never,
    defaultValues: {
      cliente:    '',
      data:       hoje(),
      vendedor:   responsavel,
      observacao: '',
      itens:      [{ produto_id: '', quantidade: undefined as unknown as number, preco_unitario: undefined as unknown as number, desconto: 0 }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'itens' })
  const watchedItens = watch('itens')
  const dataValue = watch('data')

  // Autopreenchimento de preco_unitario ao selecionar produto
  function handleProdutoChange(index: number, produtoId: string) {
    const produto = produtos.find((p) => p.id === produtoId)
    if (produto?.preco_venda != null) {
      setValue(`itens.${index}.preco_unitario`, produto.preco_venda)
    }
  }

  function calcSubtotal(index: number): number {
    const item = watchedItens?.[index]
    if (!item) return 0
    const q = Number(item.quantidade) || 0
    const p = Number(item.preco_unitario) || 0
    const d = Number(item.desconto) || 0
    return Math.max(0, q * p - d)
  }

  const totalVenda = fields.reduce((acc, _, i) => acc + calcSubtotal(i), 0)

  const hasValidItem = watchedItens?.some(
    (item) =>
      item.produto_id &&
      Number(item.quantidade) > 0 &&
      Number(item.preco_unitario) >= 0
  )

  async function onSubmit(data: FormData) {
    // O banco recusa venda acima do saldo (estoque_consumir_peps) — avisa antes de tentar.
    const acima = data.itens.filter((it) => {
      const prod = produtos.find((p) => p.id === it.produto_id)
      return prod != null && Number(it.quantidade) > (Number(prod.quantidade_atual) || 0)
    })
    if (acima.length > 0) {
      const nomes = acima.map((it) => produtos.find((p) => p.id === it.produto_id)?.nome ?? 'material').join(', ')
      toast('error', `Quantidade acima do estoque em: ${nomes}. Ajuste a quantidade ou registre a entrada antes.`)
      return
    }
    try {
      const vendedorFinal = data.vendedor?.trim() || responsavel
      const vendaId = await registrar.mutateAsync({
        data:        data.data,
        cliente:     data.cliente,
        observacao:  data.observacao,
        vendedor:    vendedorFinal,
        vendedor_id: userId,
        itens:       data.itens,
      })

      const total = data.itens.reduce((acc, item) => {
        const sub = Math.max(0, item.quantidade * item.preco_unitario - (item.desconto ?? 0))
        return acc + sub
      }, 0)
      const totalFmt = formatCurrency(total)
      const nItens = data.itens.length

      toast('success', `Venda registrada: ${totalFmt} em ${nItens} item(s)`)
      reset({
        cliente:    '',
        data:       hoje(),
        vendedor:   responsavel,
        observacao: '',
        itens:      [{ produto_id: '', quantidade: undefined as unknown as number, preco_unitario: undefined as unknown as number, desconto: 0 }],
      })
      void vendaId
    } catch (err: any) {
      console.error('[RegistroVendasView]', err)
      const msg: string = err?.message ?? ''
      if (msg.includes('Estoque insuficiente')) {
        const nomes = data.itens
          .map((it) => produtos.find((p) => p.id === it.produto_id)?.nome)
          .filter(Boolean)
          .join(', ')
        toast('error', `Estoque insuficiente para ${nomes || 'um dos materiais'}`)
      } else {
        toast('error', `Erro ao registrar venda: ${msg || 'erro desconhecido'}`)
      }
    }
  }

  // ─── Colunas do histórico ───────────────────────────────────────────────────

  const colunas: EstoqueTableColumn<VendaComContagem>[] = [
    {
      key: 'data',
      header: 'Data',
      align: 'center',
      cell: (v) => new Date(v.data + 'T12:00:00').toLocaleDateString('pt-BR'),
    },
    {
      key: 'cliente',
      header: 'Cliente',
      align: 'center',
      cell: (v) => v.cliente || <span className="italic text-muted-foreground/60">—</span>,
    },
    {
      key: 'vendedor',
      header: 'Vendedor',
      align: 'center',
      cell: (v) => (v.vendedor || v.vendedor_nome) || <span className="italic text-muted-foreground/60">—</span>,
    },
    {
      key: 'num_itens',
      header: 'Nº itens',
      align: 'right',
      cell: (v) => v.num_itens,
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      cell: (v) => <span className="font-semibold text-orange-700 whitespace-nowrap">{formatCurrency(v.total)}</span>,
    },
    {
      key: 'acoes',
      header: '',
      align: 'center',
      cell: (v) => (
        <button
          type="button"
          onClick={() => onVerDetalhe(v.id)}
          className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          title="Ver detalhes"
        >
          <Eye className="h-4 w-4" />
        </button>
      ),
    },
  ]

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Card do formulário ── */}
      <div className="rounded-xl border border-gray-200 dark:border-border bg-card shadow-sm p-6">

        {/* Header interno */}
        <div className="flex items-center justify-center gap-2 mb-5">
          <div className="h-8 w-8 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
            <ShoppingCart className="h-4 w-4 text-orange-600" />
          </div>
          <h3 className="text-base font-semibold">Registrar Venda</h3>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

          {/* Dados da venda */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL_CLASS}>Cliente</label>
              <input
                type="text"
                {...register('cliente')}
                placeholder="Nome do cliente (opcional)"
                className={INPUT_CLASSES}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Data <span className="text-orange-500 ml-0.5">*</span></label>
              <DatePicker
                value={dataValue}
                onChange={(v) => setValue('data', v, { shouldValidate: true })}
                triggerClassName={INPUT_CLASSES}
              />
              {errors.data && <p className="mt-1 text-xs text-destructive">{errors.data.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL_CLASS}>Vendedor</label>
              <input
                type="text"
                list="vendedores-list"
                {...register('vendedor')}
                placeholder={responsavel || 'Nome do vendedor'}
                className={INPUT_CLASSES}
              />
              <datalist id="vendedores-list">
                {vendedores.map((v) => <option key={v} value={v} />)}
              </datalist>
            </div>
            <div>
              <label className={LABEL_CLASS}>Observação</label>
              <input
                type="text"
                {...register('observacao')}
                placeholder="Opcional"
                className={INPUT_CLASSES}
              />
            </div>
          </div>

          {/* Separador + Itens */}
          <div className="border-t border-gray-200 pt-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="text-sm font-semibold">Itens da venda</p>
                <p className="text-xs text-muted-foreground">Escolha o material, informe a quantidade e confira o valor. O preço sugerido vem do cadastro e pode ser alterado.</p>
              </div>
              <button
                type="button"
                onClick={() => append({ produto_id: '', quantidade: undefined as unknown as number, preco_unitario: undefined as unknown as number, desconto: 0 })}
                className="flex items-center gap-1 rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Adicionar item
              </button>
            </div>

            {/* Cada item é um bloco: 1ª linha o material, 2ª linha quantidade e valores */}
            <div className="space-y-3">
              {fields.map((field, index) => {
                const item = watchedItens?.[index]
                const prod = produtos.find((p) => p.id === item?.produto_id)
                const qtd = Number(item?.quantidade) || 0
                const acimaDoSaldo = prod != null && qtd > (Number(prod.quantidade_atual) || 0)
                const e = errors.itens?.[index]
                return (
                  <LinhaItem
                    key={field.id}
                    numero={index + 1}
                    podeRemover={fields.length > 1}
                    onRemover={() => remove(index)}
                    subtotal={calcSubtotal(index)}
                    unidade={unidadeLabel(prod?.unidade)}
                    saldoTexto={prod ? formatSaldo(prod) : null}
                    acimaDoSaldo={acimaDoSaldo}
                    material={
                      <>
                        <SeletorMaterial
                          produtos={produtos}
                          value={item?.produto_id ?? ''}
                          onChange={(id) => {
                            setValue(`itens.${index}.produto_id`, id, { shouldValidate: true })
                            handleProdutoChange(index, id)
                          }}
                          invalido={!!e?.produto_id}
                        />
                        {e?.produto_id && <p className="mt-0.5 text-xs text-destructive">{e.produto_id.message}</p>}
                      </>
                    }
                    quantidade={
                      <>
                        <input
                          type="number"
                          min="0.001"
                          step="0.001"
                          placeholder="0"
                          {...register(`itens.${index}.quantidade`, { valueAsNumber: true })}
                          className={cn(INPUT_CLASSES, (e?.quantidade || acimaDoSaldo) && '!border-red-400')}
                        />
                        {e?.quantidade && <p className="mt-0.5 text-xs text-destructive">{e.quantidade.message}</p>}
                      </>
                    }
                    preco={
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0,00"
                        {...register(`itens.${index}.preco_unitario`, { valueAsNumber: true })}
                        className={cn(INPUT_CLASSES, e?.preco_unitario && '!border-red-400')}
                      />
                    }
                    desconto={
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0,00"
                        {...register(`itens.${index}.desconto`, { valueAsNumber: true })}
                        className={INPUT_CLASSES}
                      />
                    }
                  />
                )
              })}
            </div>

            {errors.itens?.root && (
              <p className="mt-1 text-xs text-destructive">{errors.itens.root.message}</p>
            )}
          </div>

          {/* Total */}
          <div className="flex items-center justify-between bg-orange-50 border border-orange-100 rounded-lg px-4 py-3 md:px-6 md:py-4 mt-4">
            <span className="text-sm font-medium text-gray-700">Total da venda</span>
            <span className="text-xl md:text-2xl font-bold text-orange-700">{formatCurrency(totalVenda)}</span>
          </div>

          {/* Submit */}
          <div className="flex justify-center mt-6">
            <button
              type="submit"
              disabled={!hasValidItem || registrar.isPending}
              className="flex items-center justify-center gap-2 rounded-lg bg-brand-gradient h-11 px-8 text-sm font-semibold text-white shadow-brand hover:opacity-90 hover:scale-105 active:scale-95 transition-all disabled:!bg-gray-300 disabled:!text-gray-500 disabled:!opacity-100 disabled:!cursor-not-allowed disabled:!scale-100"
            >
              {registrar.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Registrando…</>
                : <><ShoppingCart className="h-4 w-4" /> Registrar venda</>
              }
            </button>
          </div>
        </form>
      </div>

      {/* ── Histórico ── */}
      <div className={tbl.container}>
        <div className="px-5 py-3 border-b text-center">
          <p className="text-sm font-semibold">Histórico de vendas</p>
          <p className="text-xs text-muted-foreground">Últimas 50 vendas registradas</p>
        </div>
        <EstoqueTable
          columns={colunas}
          data={vendas}
          keyExtractor={(v) => v.id}
          isLoading={loadingVendas}
          emptyMessage="Nenhuma venda registrada ainda."
          footerLeft={vendas.length > 0
            ? `Total — ${vendas.length} ${vendas.length === 1 ? 'venda' : 'vendas'}`
            : undefined}
        />
      </div>
    </div>
  )
}
