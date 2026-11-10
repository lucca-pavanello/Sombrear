import { useState, useEffect, useRef } from 'react'
import { X, Plus, Trash2, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFecharNoFundo } from '@/hooks/useFecharNoFundo'
import { useEstoqueFornecedores } from '@/hooks/useEstoqueFornecedores'
import { useAddLote } from '@/hooks/useEstoqueLotes'
import { useEstoqueProdutos } from '@/hooks/useEstoqueProdutos'
import { formatCurrency } from '@/lib/utils'
import DatePicker from '@/components/ui/DatePicker'
import type { ToastType } from '@/hooks/useToast'
import { CustomSelect } from '@/components/ui/CustomSelect'

const inputClass = 'w-full rounded-lg border bg-background px-3.5 py-3 text-sm outline-none ring-ring focus:ring-2 focus:border-primary transition-all duration-150'
const labelClass = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground'

const STEPS = [
  { number: 1, label: 'Nota Fiscal' },
  { number: 2, label: 'Itens' },
]

interface LoteItemRascunho {
  produto_id: string
  quantidade: string
  custo_unitario: string
}

interface Props {
  open: boolean
  onClose: () => void
  toast: (type: ToastType, message: string) => void
}

function today() {
  return new Date().toISOString().split('T')[0]
}

const EMPTY_ITEM: LoteItemRascunho = { produto_id: '', quantidade: '', custo_unitario: '' }

export default function NovoLoteForm({ open, onClose, toast }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const fundoProps = useFecharNoFundo(onClose)
  const [step, setStep] = useState(1)
  const [fornecedor_id, setFornecedorId] = useState('')
  const [nf_numero, setNfNumero] = useState('')
  const [data_entrada, setDataEntrada] = useState(today())
  const [observacoes, setObservacoes] = useState('')
  const [itens, setItens] = useState<LoteItemRascunho[]>([{ ...EMPTY_ITEM }])
  const [errors, setErrors] = useState<Record<string, string>>({})

  const { data: fornecedores = [] } = useEstoqueFornecedores()
  const { data: produtos = [] } = useEstoqueProdutos()
  const addLote = useAddLote()
  const isPending = addLote.isPending

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    return () => { prev?.focus() }
  }, [open])

  useEffect(() => {
    if (!open) return
    setStep(1)
    setErrors({})
    setFornecedorId('')
    setNfNumero('')
    setDataEntrada(today())
    setObservacoes('')
    setItens([{ ...EMPTY_ITEM }])
  }, [open])

  function validate(s: number): boolean {
    const e: Record<string, string> = {}
    if (s === 1) {
      if (!data_entrada) e.data_entrada = 'Informe a data de entrada'
    }
    if (s === 2) {
      if (itens.length === 0) {
        e._itens = 'Adicione pelo menos um item'
      } else {
        itens.forEach((item, idx) => {
          if (!item.produto_id)    e[`produto_${idx}`]   = 'Selecione o produto'
          const qtd = parseFloat(item.quantidade)
          if (!item.quantidade || isNaN(qtd) || qtd <= 0)
            e[`quantidade_${idx}`] = 'Quantidade inválida'
          const custo = parseFloat(item.custo_unitario)
          if (!item.custo_unitario || isNaN(custo) || custo < 0)
            e[`custo_${idx}`] = 'Custo inválido'
        })
      }
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleNext() {
    if (validate(step)) setStep((s) => Math.min(s + 1, STEPS.length))
  }

  function addItem() {
    setItens((prev) => [...prev, { ...EMPTY_ITEM }])
  }

  function removeItem(idx: number) {
    setItens((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateItem(idx: number, field: keyof LoteItemRascunho, value: string) {
    setItens((prev) => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it))
    setErrors((e) => {
      const n = { ...e }
      delete n[`produto_${idx}`]
      delete n[`quantidade_${idx}`]
      delete n[`custo_${idx}`]
      delete n._itens
      return n
    })
  }

  const totalLote = itens.reduce((acc, it) => {
    const qtd = parseFloat(it.quantidade) || 0
    const custo = parseFloat(it.custo_unitario) || 0
    return acc + qtd * custo
  }, 0)

  async function handleSubmit() {
    if (!validate(step)) return
    try {
      await addLote.mutateAsync({
        fornecedor_id: fornecedor_id || null,
        nf_numero:     nf_numero.trim() || null,
        data_entrada,
        observacoes:   observacoes.trim() || null,
        itens: itens.map((it) => ({
          produto_id:     it.produto_id,
          quantidade:     parseFloat(it.quantidade),
          custo_unitario: parseFloat(it.custo_unitario),
        })),
      })
      toast('success', `Entrada registrada — ${itens.length} item${itens.length !== 1 ? 'ns' : ''}, total ${formatCurrency(totalLote)}.`)
      onClose()
    } catch (err) {
      console.error('[NovoLoteForm]', err)
      toast('error', 'Erro ao registrar entrada.')
    }
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title-lote"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-[2px] px-4"
      {...fundoProps}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-full sm:max-w-xl bg-card rounded-t-2xl sm:rounded-2xl shadow-elevated max-h-[92dvh] flex flex-col outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4 shrink-0">
          <h2 id="modal-title-lote" className="font-display text-base font-semibold">
            Registrar Entrada de Estoque
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-0 px-5 pt-4 pb-2 shrink-0">
          {STEPS.map((s, idx) => (
            <div key={s.number} className="flex items-center">
              <button
                type="button"
                onClick={() => { if (s.number < step) setStep(s.number) }}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold border-2 transition-all duration-200',
                  step === s.number ? 'border-primary bg-primary text-white'
                    : step > s.number ? 'border-primary bg-primary/10 text-primary'
                    : 'border-muted-foreground/30 bg-muted text-muted-foreground'
                )}
              >
                {step > s.number ? <Check className="h-3.5 w-3.5" /> : s.number}
              </button>
              <span className={cn(
                'ml-1.5 text-[11px] font-semibold transition-colors',
                step === s.number ? 'text-primary' : step > s.number ? 'text-primary/60' : 'text-muted-foreground/50'
              )}>
                {s.label}
              </span>
              {idx < STEPS.length - 1 && (
                <div className={cn('mx-2 h-px w-8 transition-colors duration-200', step > s.number ? 'bg-primary/40' : 'bg-muted-foreground/20')} />
              )}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {step === 1 && (
            <>
              <div>
                <label className={labelClass}>Data de Entrada *</label>
                <DatePicker
                  value={data_entrada}
                  onChange={(v) => { setDataEntrada(v); setErrors((er) => { const n = {...er}; delete n.data_entrada; return n }) }}
                  triggerClassName={cn('py-3', errors.data_entrada && 'border-destructive')}
                />
                {errors.data_entrada && <p className="mt-1 text-xs text-destructive">{errors.data_entrada}</p>}
              </div>
              <div>
                <label className={labelClass}>Fornecedor</label>
                <CustomSelect
                  value={fornecedor_id}
                  onChange={setFornecedorId}
                  options={[
                    { value: '', label: 'Selecione (opcional)...' },
                    ...fornecedores.map((f) => ({ value: f.id, label: f.nome })),
                  ]}
                  placeholder="Selecione (opcional)..."
                />
              </div>
              <div>
                <label className={labelClass}>Número da NF</label>
                <input
                  value={nf_numero}
                  onChange={(e) => setNfNumero(e.target.value)}
                  placeholder="Ex: 000123"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Observações</label>
                <textarea
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                  rows={2}
                  placeholder="Informações adicionais…"
                  className={cn(inputClass, 'resize-none')}
                />
              </div>
            </>
          )}

          {step === 2 && (
            <div className="space-y-3">
              {errors._itens && (
                <p className="text-xs text-destructive">{errors._itens}</p>
              )}

              {itens.map((item, idx) => (
                <div key={idx} className="rounded-xl border bg-muted/20 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                      Item {idx + 1}
                    </span>
                    {itens.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(idx)}
                        className="rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <div>
                    <label className={labelClass}>Material *</label>
                    <CustomSelect
                      value={item.produto_id}
                      onChange={(v) => updateItem(idx, 'produto_id', v)}
                      options={produtos.map((p) => ({
                        value: p.id,
                        label: `${p.nome}${p.codigo ? ` (${p.codigo})` : ''}`,
                      }))}
                      placeholder="Selecione o produto…"
                      className={cn(errors[`produto_${idx}`] && 'border-destructive')}
                    />
                    {errors[`produto_${idx}`] && (
                      <p className="mt-1 text-xs text-destructive">{errors[`produto_${idx}`]}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>
                        Quantidade *
                        {item.produto_id && (() => {
                          const p = produtos.find((pr) => pr.id === item.produto_id)
                          return p ? ` (${p.unidade})` : ''
                        })()}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={item.quantidade}
                        onChange={(e) => updateItem(idx, 'quantidade', e.target.value)}
                        placeholder="0,000"
                        className={cn(inputClass, errors[`quantidade_${idx}`] && 'border-destructive')}
                      />
                      {errors[`quantidade_${idx}`] && (
                        <p className="mt-1 text-xs text-destructive">{errors[`quantidade_${idx}`]}</p>
                      )}
                    </div>
                    <div>
                      <label className={labelClass}>Custo Unitário (R$) *</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.custo_unitario}
                        onChange={(e) => updateItem(idx, 'custo_unitario', e.target.value)}
                        placeholder="0,00"
                        className={cn(inputClass, errors[`custo_${idx}`] && 'border-destructive')}
                      />
                      {errors[`custo_${idx}`] && (
                        <p className="mt-1 text-xs text-destructive">{errors[`custo_${idx}`]}</p>
                      )}
                    </div>
                  </div>

                  {item.quantidade && item.custo_unitario && (
                    <p className="text-xs text-muted-foreground text-right">
                      Subtotal: <strong>{formatCurrency((parseFloat(item.quantidade) || 0) * (parseFloat(item.custo_unitario) || 0))}</strong>
                    </p>
                  )}
                </div>
              ))}

              <button
                type="button"
                onClick={addItem}
                className="flex items-center gap-1.5 w-full rounded-xl border-2 border-dashed border-muted-foreground/30 py-3 text-sm font-semibold text-muted-foreground hover:border-primary hover:text-primary transition-colors justify-center"
              >
                <Plus className="h-4 w-4" />
                Adicionar item
              </button>

              {totalLote > 0 && (
                <div className="rounded-xl bg-primary/5 border border-primary/20 px-4 py-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-muted-foreground">Total da entrada</span>
                  <span className="text-base font-bold text-primary">{formatCurrency(totalLote)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t px-5 py-4 shrink-0 gap-3">
          <button
            type="button"
            onClick={step === 1 ? onClose : () => setStep((s) => s - 1)}
            className="rounded-lg border px-4 py-2.5 text-sm font-semibold hover:bg-muted active:scale-95 transition-all"
          >
            {step === 1 ? 'Cancelar' : 'Anterior'}
          </button>
          {step < STEPS.length ? (
            <button
              type="button"
              onClick={handleNext}
              className="rounded-lg bg-brand-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-brand hover:opacity-90 hover:scale-105 active:scale-95 transition-all"
            >
              Próximo
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending}
              className="flex items-center gap-2 rounded-lg bg-brand-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-brand hover:opacity-90 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
            >
              {isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Registrando…</> : 'Confirmar Entrada'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
