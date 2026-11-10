import { useState, useEffect, useRef } from 'react'
import { X, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFecharNoFundo } from '@/hooks/useFecharNoFundo'
import { useEstoqueCategorias } from '@/hooks/useEstoqueCategorias'
import { useEstoqueLocalizacoes } from '@/hooks/useEstoqueLocalizacoes'
import { useCreateEstoqueProduto, useUpdateEstoqueProduto } from '@/hooks/useEstoqueProdutos'
import { useRegistrarMovimentacao } from '@/hooks/useEstoqueMovimentacoes'
import type { EstoqueProduto } from '@/lib/supabase'
import type { ToastType } from '@/hooks/useToast'
import { CustomSelect } from '@/components/ui/CustomSelect'

const inputClass = 'w-full rounded-lg border bg-background px-3.5 py-3 text-sm outline-none ring-ring focus:ring-2 focus:border-primary transition-all duration-150'
const labelClass = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground'

const STEPS = [
  { number: 1, label: 'Identificação' },
  { number: 2, label: 'Detalhes' },
  { number: 3, label: 'Estoque' },
]

interface Props {
  open: boolean
  onClose: () => void
  toast: (type: ToastType, message: string) => void
  editando?: EstoqueProduto | null
  responsavel: string
}

const EMPTY_FORM = {
  nome: '',
  codigo: '',
  categoria_id: '',
  unidade: 'm' as 'm' | 'm2' | 'un' | 'kg',
  largura_padrao_cm: '',
  quantidade_minima: '0',
  custo_unitario: '',
  fornecedor: '',
  localizacao_id: '',
  observacoes: '',
  quantidade_inicial: '0',
}

export default function NovoProdutoForm({ open, onClose, toast, editando, responsavel }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const fundoProps = useFecharNoFundo(onClose)
  const [step, setStep] = useState(1)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const { data: categorias = [] } = useEstoqueCategorias()
  const { data: localizacoes = [] } = useEstoqueLocalizacoes()
  const createMutation = useCreateEstoqueProduto()
  const updateMutation = useUpdateEstoqueProduto()
  const registrarMov = useRegistrarMovimentacao()

  const isEditing = !!editando
  const isPending = createMutation.isPending || updateMutation.isPending || registrarMov.isPending

  const categoriaSelecionada = categorias.find((c) => c.id === form.categoria_id)
  const isTecido = categoriaSelecionada?.tipo === 'tecido'

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
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
    if (editando) {
      setForm({
        nome: editando.nome,
        codigo: editando.codigo ?? '',
        categoria_id: editando.categoria_id,
        unidade: editando.unidade,
        largura_padrao_cm: editando.largura_padrao_cm != null ? String(editando.largura_padrao_cm) : '',
        quantidade_minima: String(editando.quantidade_minima),
        custo_unitario: editando.custo_unitario != null ? String(editando.custo_unitario) : '',
        fornecedor: editando.fornecedor ?? '',
        localizacao_id: editando.localizacao_id ?? '',
        observacoes: editando.observacoes ?? '',
        quantidade_inicial: '0',
      })
    } else {
      setForm({ ...EMPTY_FORM, categoria_id: categorias[0]?.id ?? '' })
    }
  }, [open, editando, categorias])

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => { const n = { ...e }; delete n[key]; return n })
  }

  function validate(s: number): boolean {
    const e: Record<string, string> = {}
    if (s === 1) {
      if (!form.nome.trim()) e.nome = 'Informe o nome do material'
      if (!form.categoria_id) e.categoria_id = 'Selecione uma categoria'
      if (!form.unidade) e.unidade = 'Selecione a unidade'
    }
    if (s === 2) {
      const min = parseFloat(form.quantidade_minima)
      if (isNaN(min) || min < 0) e.quantidade_minima = 'Valor inválido'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleNext() {
    if (validate(step)) setStep((s) => Math.min(s + 1, STEPS.length))
  }

  async function handleSubmit() {
    if (!validate(step)) return
    try {
      const payload = {
        nome: form.nome.trim(),
        codigo: form.codigo.trim() || null,
        categoria_id: form.categoria_id,
        unidade: form.unidade,
        largura_padrao_cm: isTecido && form.largura_padrao_cm ? parseFloat(form.largura_padrao_cm) : null,
        quantidade_minima: parseFloat(form.quantidade_minima) || 0,
        custo_unitario: form.custo_unitario ? parseFloat(form.custo_unitario) : null,
        fornecedor: form.fornecedor.trim() || null,
        localizacao_id: form.localizacao_id || null,
        observacoes: form.observacoes.trim() || null,
        ativo: true,
        quantidade_atual: 0,
      }

      if (isEditing) {
        await updateMutation.mutateAsync({ id: editando!.id, ...payload })
        toast('success', `Material "${payload.nome}" atualizado.`)
      } else {
        const criado = await createMutation.mutateAsync(payload)
        const qtdInicial = parseFloat(form.quantidade_inicial)
        if (qtdInicial > 0) {
          await registrarMov.mutateAsync({
            produto_id: criado.id,
            tipo: 'entrada',
            quantidade: qtdInicial,
            quantidade_anterior: 0,
            motivo: 'Estoque inicial',
            responsavel,
          })
        }
        toast('success', `Material "${payload.nome}" cadastrado.`)
      }
      onClose()
    } catch (err) {
      console.error('[NovoProdutoForm]', err)
      toast('error', 'Erro ao salvar material.')
    }
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title-produto"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-[2px] px-4"
      {...fundoProps}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-full sm:max-w-lg bg-card rounded-2xl shadow-elevated max-h-[92dvh] flex flex-col outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4 shrink-0">
          <h2 id="modal-title-produto" className="font-display text-base font-semibold">
            {isEditing ? 'Editar material' : 'Novo material'}
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
                <label className={labelClass}>Nome *</label>
                <input
                  autoFocus
                  value={form.nome}
                  onChange={(e) => set('nome', e.target.value)}
                  placeholder="Ex: Tecido Screen 5% Branco"
                  className={cn(inputClass, errors.nome && 'border-destructive')}
                />
                {errors.nome && <p className="mt-1 text-xs text-destructive">{errors.nome}</p>}
              </div>
              <div>
                <label className={labelClass}>Código Interno</label>
                <input
                  value={form.codigo}
                  onChange={(e) => set('codigo', e.target.value)}
                  placeholder="Ex: TEC-SCREEN-5-BR"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Categoria *</label>
                <CustomSelect
                  value={form.categoria_id}
                  onChange={(v) => set('categoria_id', v)}
                  options={categorias.map((c) => ({ value: c.id, label: c.nome }))}
                  placeholder="Selecione…"
                  className={cn(errors.categoria_id && 'border-destructive')}
                />
                {errors.categoria_id && <p className="mt-1 text-xs text-destructive">{errors.categoria_id}</p>}
              </div>
              <div>
                <label className={labelClass}>Unidade de Medida *</label>
                <CustomSelect
                  value={form.unidade}
                  onChange={(v) => set('unidade', v as typeof form.unidade)}
                  options={[
                    { value: 'm', label: 'Metro linear (m)' },
                    { value: 'm2', label: 'Metro quadrado (m²)' },
                    { value: 'un', label: 'Unidade (un)' },
                    { value: 'kg', label: 'Quilograma (kg)' },
                  ]}
                  className={cn(errors.unidade && 'border-destructive')}
                />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              {isTecido && (
                <div>
                  <label className={labelClass}>Largura Padrão (cm)</label>
                  <input
                    type="number"
                    min="0"
                    value={form.largura_padrao_cm}
                    onChange={(e) => set('largura_padrao_cm', e.target.value)}
                    placeholder="Ex: 250"
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">Largura do rolo de tecido em centímetros</p>
                </div>
              )}
              <div>
                <label className={labelClass}>Quantidade Mínima *</label>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={form.quantidade_minima}
                  onChange={(e) => set('quantidade_minima', e.target.value)}
                  placeholder="0"
                  className={cn(inputClass, errors.quantidade_minima && 'border-destructive')}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Alerta será ativado quando o estoque ficar abaixo desse valor ({form.unidade})
                </p>
                {errors.quantidade_minima && <p className="mt-1 text-xs text-destructive">{errors.quantidade_minima}</p>}
              </div>
              <div>
                <label className={labelClass}>Custo Unitário (R$/{form.unidade})</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.custo_unitario}
                  onChange={(e) => set('custo_unitario', e.target.value)}
                  placeholder="0,00"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Fornecedor</label>
                <input
                  value={form.fornecedor}
                  onChange={(e) => set('fornecedor', e.target.value)}
                  placeholder="Nome do fornecedor"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Localização</label>
                <CustomSelect
                  value={form.localizacao_id}
                  onChange={(v) => set('localizacao_id', v)}
                  options={[
                    { value: '', label: 'Sem localização' },
                    ...localizacoes.map((l) => ({ value: l.id, label: `${l.codigo} – ${l.setor}` })),
                  ]}
                  placeholder="Sem localização"
                />
              </div>
            </>
          )}

          {step === 3 && (
            <>
              {!isEditing && (
                <div>
                  <label className={labelClass}>Quantidade Inicial ({form.unidade})</label>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={form.quantidade_inicial}
                    onChange={(e) => set('quantidade_inicial', e.target.value)}
                    placeholder="0"
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Se informado, registra uma movimentação de entrada inicial automaticamente.
                  </p>
                </div>
              )}
              <div>
                <label className={labelClass}>Observações</label>
                <textarea
                  value={form.observacoes}
                  onChange={(e) => set('observacoes', e.target.value)}
                  rows={3}
                  placeholder="Informações adicionais sobre o material…"
                  className={cn(inputClass, 'resize-none')}
                />
              </div>
            </>
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
              {isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando…</> : isEditing ? 'Salvar Alterações' : 'Cadastrar material'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
