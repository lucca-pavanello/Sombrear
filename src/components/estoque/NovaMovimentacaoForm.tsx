import { useState, useEffect, useRef } from 'react'
import { X, TrendingUp, TrendingDown, RefreshCw, AlertOctagon, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFecharNoFundo } from '@/hooks/useFecharNoFundo'
import { useEstoqueProdutos } from '@/hooks/useEstoqueProdutos'
import { useRegistrarMovimentacao } from '@/hooks/useEstoqueMovimentacoes'
import type { EstoqueProduto } from '@/lib/supabase'
import type { ToastType } from '@/hooks/useToast'
import { CustomSelect } from '@/components/ui/CustomSelect'

const inputClass = 'w-full rounded-lg border bg-background px-3.5 py-3 text-sm outline-none ring-ring focus:ring-2 focus:border-primary transition-all duration-150'
const labelClass = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-muted-foreground'

type TipoMov = 'entrada' | 'saida' | 'ajuste' | 'perda'

const TIPO_CONFIG: Record<TipoMov, { label: string; icon: React.ReactNode; cor: string; descricao: string }> = {
  entrada:  { label: 'Entrada',  icon: <TrendingUp className="h-4 w-4" />,      cor: 'text-primary',     descricao: 'Recebimento ou compra de material' },
  saida:    { label: 'Saída',    icon: <TrendingDown className="h-4 w-4" />,     cor: 'text-destructive', descricao: 'Uso em produção ou instalação' },
  ajuste:   { label: 'Ajuste',   icon: <RefreshCw className="h-4 w-4" />,        cor: 'text-muted-foreground', descricao: 'Correção de inventário (define novo total)' },
  perda:    { label: 'Perda',    icon: <AlertOctagon className="h-4 w-4" />,     cor: 'text-amber-600',   descricao: 'Material inutilizado ou extraviado' },
}

interface Props {
  open: boolean
  onClose: () => void
  toast: (type: ToastType, message: string) => void
  tipoInicial?: TipoMov
  produtoInicial?: EstoqueProduto | null
  responsavel: string
  userId?: string
}

export default function NovaMovimentacaoForm({
  open, onClose, toast,
  tipoInicial = 'entrada',
  produtoInicial,
  responsavel,
  userId,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const fundoProps = useFecharNoFundo(onClose)
  const [tipo, setTipo] = useState<TipoMov>(tipoInicial)
  const [produtoId, setProdutoId] = useState(produtoInicial?.id ?? '')
  const [quantidade, setQuantidade] = useState('')
  const [motivo, setMotivo] = useState('')
  const [notaFiscal, setNotaFiscal] = useState('')
  const [custoUnitario, setCustoUnitario] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const { data: produtos = [] } = useEstoqueProdutos()
  const registrar = useRegistrarMovimentacao()

  const produtoSelecionado = produtos.find((p) => p.id === produtoId) ?? null
  const disponivelAtual = produtoSelecionado?.quantidade_atual ?? 0
  const unidade = produtoSelecionado?.unidade ?? 'un'

  const tipoConfig = TIPO_CONFIG[tipo]

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
    setTipo(tipoInicial)
    setProdutoId(produtoInicial?.id ?? '')
    setQuantidade('')
    setMotivo('')
    setNotaFiscal('')
    setCustoUnitario('')
    setErrors({})
  }, [open, tipoInicial, produtoInicial])

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!produtoId) e.produto = 'Selecione um produto'
    const qtd = parseFloat(quantidade)
    if (!quantidade || isNaN(qtd) || qtd <= 0) e.quantidade = 'Informe uma quantidade válida'
    if ((tipo === 'ajuste' || tipo === 'perda') && !motivo.trim()) e.motivo = 'Informe o motivo'
    if (tipo === 'saida' && qtd > disponivelAtual) {
      e.quantidade = `Estoque insuficiente — disponível: ${disponivelAtual.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${unidade}`
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return
    try {
      const qtd = parseFloat(quantidade)
      await registrar.mutateAsync({
        produto_id: produtoId,
        tipo,
        quantidade: qtd,
        quantidade_anterior: disponivelAtual,
        motivo: motivo.trim() || undefined,
        nota_fiscal: notaFiscal.trim() || undefined,
        custo_unitario: custoUnitario ? parseFloat(custoUnitario) : undefined,
        responsavel,
        user_id: userId,
      })

      const labelTipo = tipoConfig.label.toLowerCase()
      const qtdStr = `${qtd.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${unidade}`
      toast('success', `${tipoConfig.label} registrada: ${labelTipo === 'ajuste' ? `estoque ajustado para ${qtdStr}` : `${qtdStr} de ${produtoSelecionado?.nome}`}`)
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao registrar movimentação.'
      toast('error', msg)
    }
  }

  // Label de quantidade muda por tipo
  const quantidadeLabel =
    tipo === 'ajuste'
      ? `Nova Quantidade Total (${unidade})`
      : `Quantidade (${unidade})`

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title-mov"
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
          <div className="flex items-center gap-2">
            <span className={tipoConfig.cor}>{tipoConfig.icon}</span>
            <h2 id="modal-title-mov" className="font-display text-base font-semibold">
              Registrar {tipoConfig.label}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Seletor de tipo */}
          <div>
            <label className={labelClass}>Tipo de Movimentação</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {(Object.keys(TIPO_CONFIG) as TipoMov[]).map((t) => {
                const cfg = TIPO_CONFIG[t]
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => { setTipo(t); setErrors({}) }}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-xs font-semibold transition-all active:scale-95',
                      tipo === t
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:bg-muted'
                    )}
                  >
                    <span className={tipo === t ? 'text-primary' : cfg.cor}>{cfg.icon}</span>
                    {cfg.label}
                  </button>
                )
              })}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">{tipoConfig.descricao}</p>
          </div>

          {/* Produto */}
          <div>
            <label className={labelClass}>Material *</label>
            <CustomSelect
              value={produtoId}
              onChange={(v) => { setProdutoId(v); setErrors((er) => { const n = {...er}; delete n.produto; return n }) }}
              options={produtos.map((p) => ({
                value: p.id,
                label: `${p.nome} (${p.quantidade_atual.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${p.unidade} em estoque)`,
              }))}
              placeholder="Selecione o produto…"
              className={cn(errors.produto && 'border-destructive')}
            />
            {errors.produto && <p className="mt-1 text-xs text-destructive">{errors.produto}</p>}
          </div>

          {/* Quantidade */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={cn(labelClass, 'mb-0')}>{quantidadeLabel} *</label>
              {tipo === 'saida' && produtoSelecionado && (
                <span className="text-xs text-muted-foreground">
                  Disponível: <strong>{disponivelAtual.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {unidade}</strong>
                </span>
              )}
            </div>
            <input
              type="number"
              min="0"
              step="0.001"
              value={quantidade}
              onChange={(e) => { setQuantidade(e.target.value); setErrors((er) => { const n = {...er}; delete n.quantidade; return n }) }}
              placeholder={tipo === 'ajuste' ? `Novo total em ${unidade}` : `Quantidade em ${unidade}`}
              className={cn(inputClass, errors.quantidade && 'border-destructive')}
            />
            {errors.quantidade && <p className="mt-1 text-xs text-destructive">{errors.quantidade}</p>}
          </div>

          {/* Campos específicos por tipo */}
          {tipo === 'entrada' && (
            <>
              <div>
                <label className={labelClass}>Nota Fiscal</label>
                <input
                  value={notaFiscal}
                  onChange={(e) => setNotaFiscal(e.target.value)}
                  placeholder="Número ou referência da NF"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Custo Unitário (R$/{unidade})</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={custoUnitario}
                  onChange={(e) => setCustoUnitario(e.target.value)}
                  placeholder="0,00"
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-muted-foreground">Se informado, atualiza o custo cadastrado do produto.</p>
              </div>
            </>
          )}

          <div>
            <label className={labelClass}>
              Motivo{(tipo === 'ajuste' || tipo === 'perda') ? ' *' : ''}
            </label>
            <input
              value={motivo}
              onChange={(e) => { setMotivo(e.target.value); setErrors((er) => { const n = {...er}; delete n.motivo; return n }) }}
              placeholder={
                tipo === 'ajuste' ? 'Ex: Contagem física — diferença encontrada'
                : tipo === 'perda' ? 'Ex: Rasgo durante corte'
                : tipo === 'saida' ? 'Ex: Orçamento #123 — cliente João'
                : 'Opcional'
              }
              className={cn(inputClass, errors.motivo && 'border-destructive')}
            />
            {errors.motivo && <p className="mt-1 text-xs text-destructive">{errors.motivo}</p>}
          </div>
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
            disabled={registrar.isPending}
            className="flex items-center gap-2 rounded-lg bg-brand-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-brand hover:opacity-90 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
          >
            {registrar.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Registrando…</> : `Registrar ${tipoConfig.label}`}
          </button>
        </div>
      </div>
    </div>
  )
}
