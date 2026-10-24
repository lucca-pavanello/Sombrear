import { useMemo, useState } from 'react'
import { Loader2, Palette } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import { useDuplicarMaterial } from '@/hooks/useCatalogoManual'
import { rotuloUnidade } from '@/hooks/useCatalogoCustos'
import type { MaterialPivotado } from '@/lib/catalogo/pivo'
import { alvosDoMaterial } from '@/lib/catalogo/editarMaterial'
import { separarCores, variacoesSugeridas } from '@/lib/catalogo/duplicarCores'
import type { ToastType } from '@/hooks/useToast'

/**
 * "Acrescentar tudo igual, também nas cores branco, cinza e marfim."
 *
 * A loja digita as cores; a tela mostra o nome que cada uma vai ganhar (e
 * deixa corrigir) e o preço que vai junto em cada loja — o mesmo do material
 * de origem. Cada cópia entra como registro da loja de hoje, sem código: o
 * código é de cada cor no fornecedor (migration 0035).
 */

const campo =
  'w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground ' +
  'placeholder:text-muted-foreground/60 focus:border-brand focus:outline-none transition-colors'
const rotulo = 'mb-1.5 block text-xs font-medium text-muted-foreground'

interface Props {
  material: MaterialPivotado
  onFechar: () => void
  toast: (type: ToastType, message: string) => void
}

export default function DuplicarCoresModal({ material, onFechar, toast }: Props) {
  const duplicar = useDuplicarMaterial()
  const celulas = [...material.porFornecedor.values()]

  const [texto, setTexto] = useState('')
  // Nome corrigido à mão, por cor digitada (chave = a cor como foi digitada).
  const [nomesEditados, setNomesEditados] = useState<Map<string, string>>(new Map())
  const [erro, setErro] = useState<string | null>(null)

  const cores = useMemo(() => separarCores(texto), [texto])
  const variacoes = useMemo(
    () =>
      variacoesSugeridas(material.descricao, material.cor, cores).map((v, i) => ({
        ...v,
        descricao: nomesEditados.get(cores[i]) ?? v.descricao,
      })),
    [material.descricao, material.cor, cores, nomesEditados]
  )

  async function salvar() {
    setErro(null)
    if (variacoes.length === 0) {
      setErro('Digite ao menos uma cor.')
      return
    }
    if (variacoes.some(v => !v.descricao.trim())) {
      setErro('Uma das cores ficou sem nome.')
      return
    }
    try {
      const criados = await duplicar.mutateAsync({
        alvos: alvosDoMaterial(celulas),
        variacoes: variacoes.map(v => ({ descricao: v.descricao.trim(), cor: v.cor })),
      })
      toast(
        'success',
        criados > 0
          ? `${variacoes.length === 1 ? '1 cor nova entrou' : `${variacoes.length} cores novas entraram`} no catálogo.`
          : 'Essas cores já existiam no catálogo — nada mudou.'
      )
      onFechar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu para salvar.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={onFechar}
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-xl dark:bg-card sm:rounded-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-border px-5 py-4">
          <h3 className="font-semibold text-foreground">Duplicar em outras cores</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {material.descricao}: o mesmo tecido, com o mesmo preço em cada loja, em outras cores.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label className={rotulo}>Cores novas</label>
            <input
              value={texto}
              onChange={e => setTexto(e.target.value)}
              placeholder="ex.: branco, cinza, marfim"
              className={campo}
              autoFocus
            />
            <p className="mt-1 text-xs text-muted-foreground">Separe por vírgula.</p>
          </div>

          <div className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">Vai junto em cada cor</p>
            {celulas.map(c => (
              <div key={c.fornecedor_id ?? ''} className="flex justify-between gap-3">
                <span className="truncate">{c.fornecedor ?? 'Sem fornecedor'}</span>
                <span className="shrink-0 tabular-nums">
                  {formatCurrency(c.custo_unitario)} / {rotuloUnidade(c.unidade_canonica)}
                </span>
              </div>
            ))}
            <p className="mt-2">Sem código de fornecedor: o código muda de cor para cor.</p>
          </div>

          {variacoes.length > 0 && (
            <div>
              <label className={rotulo}>Nome de cada uma (pode corrigir)</label>
              <div className="space-y-2">
                {variacoes.map((v, i) => (
                  <input
                    key={cores[i]}
                    value={v.descricao}
                    onChange={e =>
                      setNomesEditados(prev => new Map(prev).set(cores[i], e.target.value))
                    }
                    className={campo}
                  />
                ))}
              </div>
            </div>
          )}

          {erro && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {erro}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onFechar}
            className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={duplicar.isPending || variacoes.length === 0}
            className={cn(
              'inline-flex items-center gap-2 rounded-xl bg-brand-gradient px-4 py-2 text-sm font-semibold text-white shadow-brand',
              'transition-all hover:opacity-90 active:scale-95 disabled:opacity-60'
            )}
          >
            {duplicar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Palette className="h-4 w-4" />}
            {variacoes.length > 1 ? `Criar ${variacoes.length} cores` : 'Criar cor'}
          </button>
        </div>
      </div>
    </div>
  )
}
