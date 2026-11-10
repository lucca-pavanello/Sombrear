import { useState, useEffect, useRef } from 'react'
import { X, Plus, Trash2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFecharNoFundo } from '@/hooks/useFecharNoFundo'
import { useAddFornecedor, useUpdateFornecedor } from '@/hooks/useEstoqueFornecedores'
import { useFornecedorCategorias } from '@/hooks/useFornecedorCategorias'
import { useFornecedorDescontos } from '@/hooks/useFornecedorDescontos'
import { supabase } from '@/lib/supabase'
import { useQueryClient } from '@tanstack/react-query'
import type { EstoqueFornecedor } from '@/lib/supabase'
import type { ToastType } from '@/hooks/useToast'

const inputClass = 'w-full rounded-lg border bg-background px-3.5 py-3 text-sm outline-none ring-ring focus:ring-2 focus:border-primary transition-all duration-150'
const labelClass = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground'

function SecaoTitulo({ id, n, titulo, dica }: { id: string; n: number; titulo: string; dica: string }) {
  return (
    <div className="border-b border-border/60 pb-2">
      <h3 id={id} className="flex items-center gap-2 text-sm font-semibold">
        <span className="flex h-5 w-5 items-center justify-center rounded-full border border-primary text-[11px] font-bold text-primary">{n}</span>
        {titulo}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">{dica}</p>
    </div>
  )
}

const TIPOS = ['Tecido', 'Ferragem', 'Acessorio'] as const
type TipoProduto = typeof TIPOS[number]

interface CatLocal {
  ativo: boolean
  lead_time_dias: string
  prazo_pagamento_dias: string
}

interface DescontoLocal {
  id?: string
  categorias_combo: string[]
  percentual_desconto: string
  valor_minimo_pedido: string
  observacao: string
}

const EMPTY_CATS: Record<TipoProduto, CatLocal> = {
  Tecido:    { ativo: false, lead_time_dias: '', prazo_pagamento_dias: '' },
  Ferragem:  { ativo: false, lead_time_dias: '', prazo_pagamento_dias: '' },
  Acessorio: { ativo: false, lead_time_dias: '', prazo_pagamento_dias: '' },
}

const EMPTY_FORM = {
  nome: '',
  cnpj: '',
  telefone: '',
  email: '',
  contato: '',
  prazo_entrega_dias: '',
  observacoes: '',
}

interface Props {
  open: boolean
  onClose: () => void
  toast: (type: ToastType, message: string) => void
  editando?: EstoqueFornecedor | null
}

export default function NovoFornecedorForm({ open, onClose, toast, editando }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const fundoProps = useFecharNoFundo(onClose)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [ativo, setAtivo] = useState(true)
  const [cats, setCats] = useState<Record<TipoProduto, CatLocal>>(EMPTY_CATS)
  const [descontos, setDescontos] = useState<DescontoLocal[]>([])
  const [saving, setSaving] = useState(false)

  const addMutation = useAddFornecedor()
  const updateMutation = useUpdateFornecedor()
  const qc = useQueryClient()
  const isEditing = !!editando

  const { data: categoriasDB } = useFornecedorCategorias(editando?.id)
  const { data: descontosDB } = useFornecedorDescontos(editando?.id)

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
        nome:               editando.nome,
        cnpj:               editando.cnpj ?? '',
        telefone:           editando.telefone ?? '',
        email:              editando.email ?? '',
        contato:            editando.contato ?? '',
        prazo_entrega_dias: editando.prazo_entrega_dias != null ? String(editando.prazo_entrega_dias) : '',
        observacoes:        editando.observacoes ?? '',
      })
      setAtivo(editando.ativo)
    } else {
      setForm(EMPTY_FORM)
      setAtivo(true)
      setCats(EMPTY_CATS)
      setDescontos([])
    }
  }, [open, editando])

  // Preencher categorias quando dados chegam do banco (edição)
  useEffect(() => {
    if (!open || !editando || !categoriasDB) return
    const next = { ...EMPTY_CATS }
    for (const c of categoriasDB) {
      const tipo = c.tipo_produto as TipoProduto
      next[tipo] = {
        ativo: true,
        lead_time_dias: String(c.lead_time_dias),
        prazo_pagamento_dias: c.prazo_pagamento_dias != null ? String(c.prazo_pagamento_dias) : '',
      }
    }
    setCats(next)
  }, [open, editando, categoriasDB])

  // Preencher descontos quando dados chegam do banco (edição)
  useEffect(() => {
    if (!open || !editando || !descontosDB) return
    setDescontos(descontosDB.map(d => ({
      id: d.id,
      categorias_combo: d.categorias_combo,
      percentual_desconto: String(d.percentual_desconto),
      valor_minimo_pedido: d.valor_minimo_pedido != null ? String(d.valor_minimo_pedido) : '',
      observacao: d.observacao ?? '',
    })))
  }, [open, editando, descontosDB])

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => { const n = { ...e }; delete n[key]; return n })
  }

  function setCat(tipo: TipoProduto, field: keyof CatLocal, value: boolean | string) {
    setCats(prev => ({ ...prev, [tipo]: { ...prev[tipo], [field]: value } }))
  }

  function addDesconto() {
    setDescontos(prev => [...prev, {
      categorias_combo: [],
      percentual_desconto: '',
      valor_minimo_pedido: '',
      observacao: '',
    }])
  }

  function removeDesconto(i: number) {
    setDescontos(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateDesconto(i: number, patch: Partial<DescontoLocal>) {
    setDescontos(prev => prev.map((d, idx) => idx === i ? { ...d, ...patch } : d))
  }

  function toggleCategoriaCombo(i: number, tipo: string) {
    setDescontos(prev => prev.map((d, idx) => {
      if (idx !== i) return d
      const has = d.categorias_combo.includes(tipo)
      return {
        ...d,
        categorias_combo: has
          ? d.categorias_combo.filter(c => c !== tipo)
          : [...d.categorias_combo, tipo],
      }
    }))
  }

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!form.nome.trim()) e.nome = 'Informe o nome do fornecedor'
    const prazo = form.prazo_entrega_dias ? parseInt(form.prazo_entrega_dias) : null
    if (form.prazo_entrega_dias && (isNaN(prazo!) || prazo! < 0)) {
      e.prazo_entrega_dias = 'Prazo inválido'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return
    setSaving(true)
    try {
      const payload = {
        nome:               form.nome.trim(),
        cnpj:               form.cnpj.trim() || null,
        telefone:           form.telefone.trim() || null,
        email:              form.email.trim() || null,
        contato:            form.contato.trim() || null,
        prazo_entrega_dias: form.prazo_entrega_dias ? parseInt(form.prazo_entrega_dias) : null,
        observacoes:        form.observacoes.trim() || null,
        ativo,
      }

      let fornecedorId: string
      if (isEditing) {
        await updateMutation.mutateAsync({ id: editando!.id, ...payload })
        fornecedorId = editando!.id
        toast('success', `Fornecedor "${payload.nome}" atualizado.`)
      } else {
        const novo = await addMutation.mutateAsync(payload)
        fornecedorId = novo.id
        toast('success', `Fornecedor "${payload.nome}" cadastrado.`)
      }

      // Upsert/inativar categorias
      for (const tipo of TIPOS) {
        const cat = cats[tipo]
        if (cat.ativo) {
          const lt = parseInt(cat.lead_time_dias) || 7
          const pp = cat.prazo_pagamento_dias ? parseInt(cat.prazo_pagamento_dias) : null
          await supabase
            .from('estoque_fornecedor_categorias')
            .upsert(
              { fornecedor_id: fornecedorId, tipo_produto: tipo, lead_time_dias: lt, prazo_pagamento_dias: pp, ativo: true },
              { onConflict: 'fornecedor_id,tipo_produto' }
            )
        } else {
          // Inativar se existia
          await supabase
            .from('estoque_fornecedor_categorias')
            .update({ ativo: false })
            .eq('fornecedor_id', fornecedorId)
            .eq('tipo_produto', tipo)
        }
      }

      // Deletar descontos existentes e reinserir
      await supabase
        .from('estoque_fornecedor_descontos_combo')
        .delete()
        .eq('fornecedor_id', fornecedorId)

      const descontosValidos = descontos.filter(
        d => d.categorias_combo.length >= 2 && parseFloat(d.percentual_desconto) > 0
      )
      if (descontosValidos.length > 0) {
        await supabase
          .from('estoque_fornecedor_descontos_combo')
          .insert(descontosValidos.map(d => ({
            fornecedor_id: fornecedorId,
            categorias_combo: d.categorias_combo,
            percentual_desconto: parseFloat(d.percentual_desconto),
            valor_minimo_pedido: d.valor_minimo_pedido ? parseFloat(d.valor_minimo_pedido) : null,
            observacao: d.observacao.trim() || null,
          })))
      }

      // Invalida caches relacionados
      qc.invalidateQueries({ queryKey: ['fornecedor-categorias'] })
      qc.invalidateQueries({ queryKey: ['fornecedor-categorias-all'] })
      qc.invalidateQueries({ queryKey: ['fornecedor-descontos'] })
      qc.invalidateQueries({ queryKey: ['fornecedor-descontos-all'] })

      onClose()
    } catch (err) {
      console.error('[NovoFornecedorForm]', err)
      toast('error', 'Erro ao salvar fornecedor.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title-fornecedor"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-[2px] px-4"
      {...fundoProps}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-full sm:max-w-xl bg-card rounded-t-2xl sm:rounded-2xl shadow-elevated h-[min(92dvh,760px)] flex flex-col outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4 shrink-0">
          <h2 id="modal-title-fornecedor" className="font-display text-base font-semibold">
            {isEditing ? 'Editar Fornecedor' : 'Novo Fornecedor'}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Uma página só, rolável, com 3 seções */}
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 space-y-8">

          {/* ── 1. Dados Gerais ── */}
          <section className="space-y-4" aria-labelledby="sec-dados">
            <SecaoTitulo
              id="sec-dados" n={1} titulo="Dados gerais"
              dica="Quem é o fornecedor e como falar com ele. Só o nome é obrigatório."
            />
            <div>
              <label className={labelClass}>Nome *</label>
              <input
                autoFocus
                value={form.nome}
                onChange={(e) => set('nome', e.target.value)}
                placeholder="Ex: Tecidos Sombrear Ltda"
                className={cn(inputClass, errors.nome && 'border-destructive')}
              />
              {errors.nome && <p className="mt-1 text-xs text-destructive">{errors.nome}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>CNPJ</label>
                <input
                  value={form.cnpj}
                  onChange={(e) => set('cnpj', e.target.value)}
                  placeholder="00.000.000/0001-00"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Prazo geral (dias)</label>
                <input
                  type="number"
                  min="0"
                  value={form.prazo_entrega_dias}
                  onChange={(e) => set('prazo_entrega_dias', e.target.value)}
                  placeholder="7 (fallback)"
                  className={cn(inputClass, errors.prazo_entrega_dias && 'border-destructive')}
                />
                {errors.prazo_entrega_dias && (
                  <p className="mt-1 text-xs text-destructive">{errors.prazo_entrega_dias}</p>
                )}
                <p className="mt-1 text-[11px] text-muted-foreground">Usado quando não há prazo específico por categoria</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Telefone</label>
                <input
                  value={form.telefone}
                  onChange={(e) => set('telefone', e.target.value)}
                  placeholder="(11) 99999-0000"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>E-mail</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                  placeholder="contato@fornecedor.com"
                  className={inputClass}
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>Nome do Contato</label>
              <input
                value={form.contato}
                onChange={(e) => set('contato', e.target.value)}
                placeholder="Ex: João Silva"
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Observações</label>
              <textarea
                value={form.observacoes}
                onChange={(e) => set('observacoes', e.target.value)}
                rows={3}
                placeholder="Informações adicionais…"
                className={cn(inputClass, 'resize-none')}
              />
            </div>

            {isEditing && (
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">Fornecedor ativo</p>
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
          </section>

          {/* ── 2. Categorias e Prazos ── */}
          <section className="space-y-3" aria-labelledby="sec-prazos">
            <SecaoTitulo
              id="sec-prazos" n={2} titulo="Prazos por categoria"
              dica="Marque o que este fornecedor vende e em quantos dias entrega. O prazo de entrega alimenta o cálculo de “quando comprar”; se não marcar nada, vale o prazo geral."
            />
            {TIPOS.map(tipo => {
              const cat = cats[tipo]
              return (
                <div key={tipo} className="rounded-lg border bg-muted/20 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{tipo}</span>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <span className="text-xs text-muted-foreground">{cat.ativo ? 'Ativo' : 'Inativo'}</span>
                      <input
                        type="checkbox"
                        checked={cat.ativo}
                        onChange={e => setCat(tipo, 'ativo', e.target.checked)}
                        className="h-4 w-4 rounded accent-primary cursor-pointer"
                      />
                    </label>
                  </div>

                  {cat.ativo && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelClass}>Lead time (dias)</label>
                        <input
                          type="number"
                          min="1"
                          value={cat.lead_time_dias}
                          onChange={e => setCat(tipo, 'lead_time_dias', e.target.value)}
                          placeholder="7"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Prazo pagamento (dias)</label>
                        <input
                          type="number"
                          min="0"
                          value={cat.prazo_pagamento_dias}
                          onChange={e => setCat(tipo, 'prazo_pagamento_dias', e.target.value)}
                          placeholder="Opcional"
                          className={inputClass}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </section>

          {/* ── 3. Descontos por Combo ── */}
          <section className="space-y-3" aria-labelledby="sec-descontos">
            <SecaoTitulo
              id="sec-descontos" n={3} titulo="Descontos"
              dica="Opcional. Use quando o fornecedor dá desconto por comprar categorias juntas no mesmo pedido (mínimo 2). Ajuda a decidir se vale juntar compras."
            />
            {descontos.map((d, i) => (
              <div key={i} className="rounded-lg border bg-muted/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Desconto #{i + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeDesconto(i)}
                    className="rounded-lg p-1.5 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div>
                  <label className={labelClass}>Categorias que ativam o desconto</label>
                  <div className="flex gap-4 mt-1">
                    {TIPOS.map(tipo => (
                      <label key={tipo} className="flex items-center gap-1.5 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={d.categorias_combo.includes(tipo)}
                          onChange={() => toggleCategoriaCombo(i, tipo)}
                          className="h-4 w-4 rounded accent-primary cursor-pointer"
                        />
                        {tipo}
                      </label>
                    ))}
                  </div>
                  {d.categorias_combo.length === 1 && (
                    <p className="mt-1 text-xs text-amber-600">Selecione ao menos 2 categorias</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Desconto (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      max="100"
                      value={d.percentual_desconto}
                      onChange={e => updateDesconto(i, { percentual_desconto: e.target.value })}
                      placeholder="5"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Valor mínimo (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={d.valor_minimo_pedido}
                      onChange={e => updateDesconto(i, { valor_minimo_pedido: e.target.value })}
                      placeholder="Opcional"
                      className={inputClass}
                    />
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Observação</label>
                  <input
                    value={d.observacao}
                    onChange={e => updateDesconto(i, { observacao: e.target.value })}
                    placeholder="Ex: Compra combinada Tecido + Ferragem"
                    className={inputClass}
                  />
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={addDesconto}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Adicionar desconto por combo
            </button>
          </section>
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
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-brand-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-brand hover:opacity-90 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
          >
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando…</> : isEditing ? 'Salvar Alterações' : 'Cadastrar Fornecedor'}
          </button>
        </div>
      </div>
    </div>
  )
}
