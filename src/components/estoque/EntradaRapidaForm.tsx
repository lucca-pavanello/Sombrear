import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { PackagePlus, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CustomSelect } from '@/components/ui/CustomSelect'
import SeletorMaterial, { unidadeLabel, formatSaldo } from './SeletorMaterial'
import DatePicker from '@/components/ui/DatePicker'
import { INPUT_CLASSES, LABEL_CLASS } from './shared/inputStyles'
import { useEstoqueProdutos } from '@/hooks/useEstoqueProdutos'
import { useEstoqueFornecedores } from '@/hooks/useEstoqueFornecedores'
import { useAddLote } from '@/hooks/useEstoqueLotes'
import type { ToastType } from '@/hooks/useToast'

const labelClass = LABEL_CLASS

const schema = z.object({
  produto_id:     z.string().min(1, 'Escolha o material'),
  data_entrada:   z.string().min(1, 'Informe a data'),
  quantidade:     z.number({ error: 'Valor inválido' }).min(0.001, 'Deve ser > 0'),
  custo_unitario: z.number({ error: 'Valor inválido' }).min(0, 'Deve ser ≥ 0'),
  nota_fiscal:    z.string().optional(),
  fornecedor_id:  z.string().optional(),
})

type FormData = z.infer<typeof schema>

function PassoTitulo({ n, titulo, dica, opcional }: { n: number; titulo: string; dica?: string; opcional?: boolean }) {
  return (
    <div className="pt-1">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <span className="flex h-5 w-5 items-center justify-center rounded-full border border-primary text-[11px] font-bold text-primary">{n}</span>
        {titulo}
        {opcional && <span className="text-[11px] font-normal text-muted-foreground">(opcional)</span>}
      </p>
      {dica && <p className="mt-0.5 ml-7 text-xs text-muted-foreground">{dica}</p>}
    </div>
  )
}

function hoje() {
  return new Date().toISOString().split('T')[0]
}

interface Props {
  toast: (type: ToastType, message: string) => void
}

export default function EntradaRapidaForm({ toast }: Props) {
  const { data: produtos = [] } = useEstoqueProdutos()
  const { data: fornecedores = [] } = useEstoqueFornecedores()
  const addLote = useAddLote()

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData, unknown, FormData>({
    resolver: zodResolver(schema) as never,
    defaultValues: {
      produto_id:     '',
      data_entrada:   hoje(),
      quantidade:     undefined,
      custo_unitario: undefined,
      nota_fiscal:    '',
      fornecedor_id:  '',
    },
  })

  const produtoId = watch('produto_id')
  const fornecedorId = watch('fornecedor_id')
  const dataEntrada = watch('data_entrada')

  const produtoSel = produtos.find((p) => p.id === produtoId)
  const unidade = unidadeLabel(produtoSel?.unidade)

  const fornecedorOptions = [
    { value: '', label: '— Nenhum —' },
    ...fornecedores.map((f) => ({ value: f.id, label: f.nome })),
  ]

  // Auto-preenche fornecedor ao selecionar produto
  useEffect(() => {
    if (!produtoId) return
    const produto = produtos.find((p) => p.id === produtoId)
    if (!produto?.fornecedor) return
    const match = fornecedores.find((f) => f.nome === produto.fornecedor)
    if (match) setValue('fornecedor_id', match.id)
  }, [produtoId, produtos, fornecedores, setValue])

  async function onSubmit(data: FormData) {
    const produto = produtos.find((p) => p.id === data.produto_id)
    try {
      await addLote.mutateAsync({
        fornecedor_id: data.fornecedor_id || null,
        nf_numero:     data.nota_fiscal?.trim() || null,
        data_entrada:  data.data_entrada,
        itens: [{
          produto_id:     data.produto_id,
          quantidade:     data.quantidade,
          custo_unitario: data.custo_unitario,
        }],
      })
      const qtdFmt = data.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
      toast('success', `Entrada registrada: ${qtdFmt} ${unidadeLabel(produto?.unidade)} de ${produto?.nome ?? 'material'}`)
      reset({ produto_id: '', data_entrada: hoje(), quantidade: undefined, custo_unitario: undefined, nota_fiscal: '', fornecedor_id: '' })
    } catch (err) {
      console.error('[EntradaRapidaForm]', err)
      toast('error', 'Erro ao registrar entrada.')
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-border bg-card shadow-sm p-4 md:p-6">
      <div className="flex items-center justify-center gap-2 mb-5">
        <PackagePlus className="h-5 w-5 text-primary" />
        <h3 className="text-base font-semibold">Registrar entrada de material</h3>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Passo 1 — material + data */}
        <PassoTitulo n={1} titulo="Qual material chegou?" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>
              Material <span className="text-orange-500 ml-0.5">*</span>
            </label>
            <SeletorMaterial
              produtos={produtos}
              value={produtoId ?? ''}
              onChange={(id) => setValue('produto_id', id, { shouldValidate: true })}
              invalido={!!errors.produto_id}
            />
            {errors.produto_id && <p className="mt-1 text-xs text-red-600">{errors.produto_id.message}</p>}
          </div>
          <div>
            <label className={labelClass}>
              Data de entrada <span className="text-orange-500 ml-0.5">*</span>
            </label>
            <DatePicker
              value={dataEntrada ?? ''}
              onChange={(v) => setValue('data_entrada', v, { shouldValidate: true })}
              triggerClassName={cn(INPUT_CLASSES, errors.data_entrada && '!border-red-400')}
            />
            {errors.data_entrada && <p className="mt-1 text-xs text-red-600">{errors.data_entrada.message}</p>}
          </div>
        </div>

        {/* Passo 2 — quantidade e custo */}
        <PassoTitulo
          n={2}
          titulo="Quanto chegou e quanto custou?"
          dica={produtoSel ? `Este material é controlado em ${unidade}. Saldo atual: ${formatSaldo(produtoSel)}.` : 'A unidade (m, un, kg…) vem do material escolhido.'}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>
              Quantidade{unidade ? ` (${unidade})` : ''} <span className="text-orange-500 ml-0.5">*</span>
            </label>
            <div className="relative">
              <input
                type="number"
                min="0.001"
                step="0.001"
                {...register('quantidade', { valueAsNumber: true })}
                placeholder="Ex: 50"
                className={cn(INPUT_CLASSES, unidade && '!pr-12', errors.quantidade && '!border-red-400 focus:!border-red-500 focus:!ring-red-200')}
              />
              {unidade && (
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">{unidade}</span>
              )}
            </div>
            {errors.quantidade && <p className="mt-1 text-xs text-red-600">{errors.quantidade.message}</p>}
          </div>
          <div>
            <label className={labelClass}>
              {unidade ? `Custo por ${unidade} (R$)` : 'Custo unitário (R$)'} <span className="text-orange-500 ml-0.5">*</span>
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              {...register('custo_unitario', { valueAsNumber: true })}
              placeholder="Ex: 40,00"
              className={cn(INPUT_CLASSES, errors.custo_unitario && '!border-red-400 focus:!border-red-500 focus:!ring-red-200')}
            />
            {errors.custo_unitario && <p className="mt-1 text-xs text-red-600">{errors.custo_unitario.message}</p>}
          </div>
        </div>

        {/* Passo 3 — opcionais */}
        <PassoTitulo n={3} titulo="Nota e fornecedor" opcional dica="Pode deixar em branco. Se o material já tem fornecedor cadastrado, ele é preenchido sozinho." />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Nota fiscal</label>
            <input
              type="text"
              {...register('nota_fiscal')}
              placeholder="Ex: NF-123456"
              className={INPUT_CLASSES}
            />
          </div>
          <div>
            <label className={labelClass}>Fornecedor</label>
            <CustomSelect
              value={fornecedorId ?? ''}
              onChange={(v) => setValue('fornecedor_id', v, { shouldValidate: true })}
              options={fornecedorOptions}
              placeholder="— Nenhum —"
              className={cn(INPUT_CLASSES, "!font-normal")}
            />
          </div>
        </div>

        <div className="flex justify-center mt-6">
          <button
            type="submit"
            disabled={addLote.isPending}
            className="flex items-center justify-center gap-2 rounded-lg bg-brand-gradient h-11 px-8 text-sm font-semibold text-white shadow-brand hover:opacity-90 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
          >
            {addLote.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Registrando…</>
              : <><PackagePlus className="h-4 w-4" /> Registrar entrada</>
            }
          </button>
        </div>
      </form>
    </div>
  )
}
