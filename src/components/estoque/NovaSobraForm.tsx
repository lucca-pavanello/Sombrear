import { useState, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { CustomSelect } from '@/components/ui/CustomSelect'
import { cn } from '@/lib/utils'
import {
  useAddSobra, useUpdateSobra, useEstoqueSobras, FAMILIAS_SOBRA, ABERTURAS_SOBRA, CORES_SOBRA,
  nomeSobra, type EstoqueSobra,
} from '@/hooks/useEstoqueSobras'

const inputClass = 'w-full rounded-lg border bg-background px-3.5 py-3 text-sm outline-none ring-ring transition-all duration-150 focus:border-primary focus:ring-2'
const labelClass = 'mb-1.5 block text-xs font-medium text-muted-foreground'

interface Props {
  open: boolean
  onClose: () => void
  toast: (type: 'success' | 'error' | 'info', message: string) => void
  editando?: EstoqueSobra | null
}

const OUTRO = '__outro__'

/** Lista fechada + "Outro…" que vira campo de texto livre. Valores fora da lista (ex.: ao editar) caem direto no texto. */
function SelectOuOutro({ valor, onChange, sugestoes, placeholder, textoOutro, erro }: {
  valor: string
  onChange: (v: string) => void
  sugestoes: string[]
  placeholder: string
  textoOutro: string
  erro?: string
}) {
  const [livre, setLivre] = useState(false)
  const modoTexto = livre || (valor !== '' && !sugestoes.includes(valor))
  return (
    <>
      {modoTexto ? (
        <div className="flex gap-2">
          <input
            autoFocus={livre}
            value={valor}
            onChange={e => onChange(e.target.value)}
            placeholder={textoOutro}
            className={cn(inputClass, erro && 'border-destructive')}
          />
          <button
            type="button"
            onClick={() => { setLivre(false); onChange('') }}
            className="shrink-0 rounded-lg border px-3 text-xs font-medium text-muted-foreground hover:bg-muted"
            title="Voltar para a lista"
          >
            Lista
          </button>
        </div>
      ) : (
        <CustomSelect
          value={valor}
          onChange={v => { if (v === OUTRO) { setLivre(true); onChange('') } else onChange(v) }}
          options={[...sugestoes.map(x => ({ value: x, label: x })), { value: OUTRO, label: 'Outro… (digitar)' }]}
          placeholder={placeholder}
        />
      )}
      {erro && <p className="mt-1 text-xs text-destructive">{erro}</p>}
    </>
  )
}

const EMPTY = { familia: '', abertura: '', cor: '', largura: '', altura: '', observacao: '' }

/** Aceita "1,20" e "1.20" — a loja digita com vírgula. */
function paraNumero(v: string): number {
  return parseFloat(v.replace(',', '.'))
}

export default function NovaSobraForm({ open, onClose, toast, editando }: Props) {
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState(false)
  const painelRef = useRef<HTMLDivElement>(null)

  const { data: todasSobras = [] } = useEstoqueSobras({ incluirVendidas: true })
  const addMutation = useAddSobra()
  const updateMutation = useUpdateSobra()
  const editing = !!editando

  useEffect(() => {
    if (!open) return
    setErrors({})
    setForm(editando ? {
      familia: editando.familia,
      abertura: editando.abertura ?? '',
      cor: editando.cor,
      largura: String(editando.largura_m).replace('.', ','),
      altura: String(editando.altura_m).replace('.', ','),
      observacao: editando.observacao ?? '',
    } : EMPTY)
  }, [open, editando])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    painelRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  // Sugestões = lista padrão + o que já foi cadastrado antes (tecido/cor novos entram sozinhos)
  const uniq = (base: readonly string[], extra: (string | null)[]) =>
    [...base, ...[...new Set(extra.filter(Boolean) as string[])].filter(x => !base.includes(x)).sort((a, b) => a.localeCompare(b, 'pt-BR'))]
  const familias = uniq(FAMILIAS_SOBRA, todasSobras.map(x => x.familia))
  const cores = uniq(CORES_SOBRA, todasSobras.map(x => x.cor))
  const ehTelaSolar = form.familia.trim().toLowerCase() === 'tela solar'

  function validar(): boolean {
    const e: Record<string, string> = {}
    if (!form.familia.trim()) e.familia = 'Escolha o tecido'
    if (!form.cor.trim()) e.cor = 'Escolha a cor'
    const L = paraNumero(form.largura)
    const A = paraNumero(form.altura)
    if (!Number.isFinite(L) || L <= 0) e.largura = 'Largura precisa ser maior que zero'
    if (!Number.isFinite(A) || A <= 0) e.altura = 'Altura precisa ser maior que zero'
    // não é validação de banco, é de digitação: peça de 30 m é quase certamente vírgula
    // esquecida, e uma medida errada aqui manda o vendedor prometer o que não existe
    if (Number.isFinite(L) && L > 5) e.largura = 'Confere: mais de 5 m de largura?'
    if (Number.isFinite(A) && A > 10) e.altura = 'Confere: mais de 10 m de altura?'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!validar() || salvando) return
    setSalvando(true)
    const payload = {
      familia: form.familia.trim(),
      abertura: ehTelaSolar ? (form.abertura || null) : null,
      cor: form.cor.trim(),
      largura_m: paraNumero(form.largura),
      altura_m: paraNumero(form.altura),
      observacao: form.observacao.trim() || null,
    }
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editando!.id, ...payload })
        toast('success', `${nomeSobra(payload)} atualizada.`)
      } else {
        await addMutation.mutateAsync({ ...payload, status: 'disponivel', origem: 'cadastro manual' })
        toast('success', `${nomeSobra(payload)} cadastrada.`)
      }
      onClose()
    } catch (err) {
      console.error('[NovaSobraForm]', err)
      toast('error', 'Erro ao salvar a sobra.')
    } finally {
      setSalvando(false)
    }
  }

  const area = (() => {
    const L = paraNumero(form.largura), A = paraNumero(form.altura)
    return Number.isFinite(L) && Number.isFinite(A) && L > 0 && A > 0 ? (L * A).toFixed(2).replace('.', ',') : null
  })()

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/70 backdrop-blur-[2px] sm:items-center" role="dialog" aria-modal="true" aria-label={editing ? 'Editar sobra' : 'Nova sobra'}>
      <div ref={painelRef} tabIndex={-1} className="flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-card shadow-elevated outline-none sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="font-display text-sm font-semibold tracking-wide">
              {editing ? 'Editar sobra' : 'Nova sobra'}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Peça pronta que sobrou e não vai ser refeita.
            </p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form id="form-nova-sobra" onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label className={labelClass}>Tecido</label>
            <SelectOuOutro
              valor={form.familia}
              onChange={v => setForm(f => ({ ...f, familia: v }))}
              sugestoes={familias}
              placeholder="Escolha o tecido"
              textoOutro="Nome do tecido"
              erro={errors.familia}
            />
          </div>

          <div className={cn('grid gap-3', ehTelaSolar ? 'grid-cols-2' : 'grid-cols-1')}>
            {ehTelaSolar && (
              <div>
                <label className={labelClass}>Abertura</label>
                <CustomSelect
                  value={form.abertura}
                  onChange={v => setForm(f => ({ ...f, abertura: v }))}
                  options={[{ value: '', label: 'Não informada' }, ...ABERTURAS_SOBRA.map(a => ({ value: a, label: a }))]}
                  placeholder="Escolha a abertura"
                />
              </div>
            )}
            <div>
              <label className={labelClass}>Cor</label>
              <SelectOuOutro
                valor={form.cor}
                onChange={v => setForm(f => ({ ...f, cor: v }))}
                sugestoes={cores}
                placeholder="Escolha a cor"
                textoOutro="Nome da cor"
                erro={errors.cor}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Largura (m)</label>
              <input
                value={form.largura}
                onChange={e => setForm(f => ({ ...f, largura: e.target.value }))}
                inputMode="decimal"
                placeholder="1,20"
                className={cn(inputClass, errors.largura && 'border-destructive')}
              />
              {errors.largura && <p className="mt-1 text-xs text-destructive">{errors.largura}</p>}
            </div>
            <div>
              <label className={labelClass}>Altura (m)</label>
              <input
                value={form.altura}
                onChange={e => setForm(f => ({ ...f, altura: e.target.value }))}
                inputMode="decimal"
                placeholder="2,30"
                className={cn(inputClass, errors.altura && 'border-destructive')}
              />
              {errors.altura && <p className="mt-1 text-xs text-destructive">{errors.altura}</p>}
            </div>
          </div>

          {area && (
            <p className="text-xs text-muted-foreground">
              Área: <span className="font-semibold text-foreground tabular-nums">{area} m²</span>
            </p>
          )}

          <div>
            <label className={labelClass}>Observação</label>
            <input
              value={form.observacao}
              onChange={e => setForm(f => ({ ...f, observacao: e.target.value }))}
              placeholder="fundo branco, tem 5 partes iguais…"
              className={inputClass}
            />
          </div>
        </form>

        <div className="flex gap-2 border-t px-5 py-4">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted">
            Cancelar
          </button>
          <button type="submit" form="form-nova-sobra" disabled={salvando} className="flex-1 rounded-xl bg-brand-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-brand transition-all hover:opacity-90 active:scale-95 disabled:opacity-60">
            {salvando ? 'Salvando…' : editing ? 'Salvar' : 'Cadastrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
