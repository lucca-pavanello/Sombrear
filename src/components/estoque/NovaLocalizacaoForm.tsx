import { useState, useEffect, useRef } from 'react'
import { X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFecharNoFundo } from '@/hooks/useFecharNoFundo'
import { useAddLocalizacao, useUpdateLocalizacao } from '@/hooks/useEstoqueLocalizacoes'
import { NIVEIS_ACESSO } from '@/lib/constants'
import type { EstoqueLocalizacao } from '@/lib/supabase'
import type { ToastType } from '@/hooks/useToast'
import { CustomSelect } from '@/components/ui/CustomSelect'

const inputClass = 'w-full rounded-lg border bg-background px-3.5 py-3 text-sm outline-none ring-ring focus:ring-2 focus:border-primary transition-all duration-150'
const labelClass = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground'

interface Props {
  open: boolean
  onClose: () => void
  toast: (type: ToastType, message: string) => void
  editando?: EstoqueLocalizacao | null
}

const EMPTY_FORM = {
  codigo: '',
  setor: '',
  prateleira: '',
  posicao: '',
  nivel_acesso: '' as EstoqueLocalizacao['nivel_acesso'] | '',
  descricao: '',
}

export default function NovaLocalizacaoForm({ open, onClose, toast, editando }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const fundoProps = useFecharNoFundo(onClose)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [ativo, setAtivo] = useState(true)

  const addMutation = useAddLocalizacao()
  const updateMutation = useUpdateLocalizacao()
  const isPending = addMutation.isPending || updateMutation.isPending
  const isEditing = !!editando

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
    setErrors({})
    if (editando) {
      setForm({
        codigo:       editando.codigo,
        setor:        editando.setor,
        prateleira:   editando.prateleira ?? '',
        posicao:      editando.posicao ?? '',
        nivel_acesso: editando.nivel_acesso,
        descricao:    editando.descricao ?? '',
      })
      setAtivo(editando.ativo)
    } else {
      setForm(EMPTY_FORM)
      setAtivo(true)
    }
  }, [open, editando])

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => { const n = { ...e }; delete n[key]; return n })
  }

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!form.codigo.trim()) e.codigo = 'Informe o código'
    if (!form.setor.trim()) e.setor = 'Informe o setor'
    if (!form.nivel_acesso) e.nivel_acesso = 'Selecione o nível de acesso'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return
    try {
      const payload = {
        codigo:       form.codigo.trim(),
        setor:        form.setor.trim(),
        prateleira:   form.prateleira.trim() || null,
        posicao:      form.posicao.trim() || null,
        nivel_acesso: form.nivel_acesso as EstoqueLocalizacao['nivel_acesso'],
        descricao:    form.descricao.trim() || null,
        ativo,
      }
      if (isEditing) {
        await updateMutation.mutateAsync({ id: editando!.id, ...payload })
        toast('success', `Localização "${payload.codigo}" atualizada.`)
      } else {
        await addMutation.mutateAsync(payload)
        toast('success', `Localização "${payload.codigo}" cadastrada.`)
      }
      onClose()
    } catch (err) {
      console.error('[NovaLocalizacaoForm]', err)
      toast('error', 'Erro ao salvar localização.')
    }
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title-localizacao"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-[2px] px-4"
      {...fundoProps}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-full sm:max-w-lg bg-card rounded-t-2xl sm:rounded-2xl shadow-elevated max-h-[92dvh] flex flex-col outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4 shrink-0">
          <h2 id="modal-title-localizacao" className="font-display text-base font-semibold">
            {isEditing ? 'Editar Localização' : 'Nova Localização'}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Código *</label>
              <input
                autoFocus
                value={form.codigo}
                onChange={(e) => set('codigo', e.target.value)}
                placeholder="Ex: A-01-P3"
                className={cn(inputClass, errors.codigo && 'border-destructive')}
              />
              {errors.codigo && <p className="mt-1 text-xs text-destructive">{errors.codigo}</p>}
            </div>
            <div>
              <label className={labelClass}>Setor *</label>
              <input
                value={form.setor}
                onChange={(e) => set('setor', e.target.value)}
                placeholder="Ex: Tecidos"
                className={cn(inputClass, errors.setor && 'border-destructive')}
              />
              {errors.setor && <p className="mt-1 text-xs text-destructive">{errors.setor}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Prateleira</label>
              <input
                value={form.prateleira}
                onChange={(e) => set('prateleira', e.target.value)}
                placeholder="Ex: P3"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Posição</label>
              <input
                value={form.posicao}
                onChange={(e) => set('posicao', e.target.value)}
                placeholder="Ex: 01"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Nível de acesso *</label>
            <CustomSelect
              value={form.nivel_acesso}
              onChange={(v) => set('nivel_acesso', v)}
              options={Object.entries(NIVEIS_ACESSO).map(([value, label]) => ({ value, label }))}
              placeholder="Selecione…"
              className={cn(errors.nivel_acesso && 'border-destructive')}
            />
            {errors.nivel_acesso && <p className="mt-1 text-xs text-destructive">{errors.nivel_acesso}</p>}
          </div>

          <div>
            <label className={labelClass}>Descrição</label>
            <textarea
              value={form.descricao}
              onChange={(e) => set('descricao', e.target.value)}
              rows={3}
              placeholder="Informações adicionais sobre esta localização…"
              className={cn(inputClass, 'resize-none')}
            />
          </div>

          {isEditing && (
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
              <div>
                <p className="text-sm font-semibold">Localização ativa</p>
                <p className="text-xs text-muted-foreground">Desativar remove da listagem principal</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={ativo}
                onClick={() => setAtivo((v) => !v)}
                className={cn(
                  'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
                  ativo ? 'bg-primary' : 'bg-muted-foreground/30',
                )}
              >
                <span
                  className={cn(
                    'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                    ativo ? 'translate-x-6' : 'translate-x-1',
                  )}
                />
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t px-5 py-4 shrink-0 gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-4 py-2.5 text-sm font-semibold hover:bg-muted active:scale-95 transition-all"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="flex items-center gap-2 rounded-lg bg-brand-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-brand hover:opacity-90 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
          >
            {isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando…</> : isEditing ? 'Salvar Alterações' : 'Cadastrar Localização'}
          </button>
        </div>
      </div>
    </div>
  )
}
