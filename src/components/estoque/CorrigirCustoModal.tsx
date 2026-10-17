import { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import { CustomSelect } from '@/components/ui/CustomSelect'
import { useSalvarCustoManual, useFornecedoresCatalogo } from '@/hooks/useCatalogoManual'
import { validarCorrecao, mudancaSuspeita } from '@/lib/catalogo/manual'
import { ROTULO_CATEGORIA, rotuloUnidade, type CustoVigente, type CategoriaCatalogo } from '@/hooks/useCatalogoCustos'
import type { ToastType } from '@/hooks/useToast'

/**
 * Corrigir o custo de um material, ou cadastrar um que ainda não existe.
 *
 * A correção NÃO reescreve o item do documento. O pedido 115104 diz que o
 * trilho saiu a R$ 8,736/m, e isso é um fato do papel. O que a loja informa
 * aqui entra como um registro novo, datado de hoje — e, como o catálogo
 * sempre mostra o mais recente, passa a valer sem apagar de onde veio o
 * valor anterior. É por isso que reimportar um pedido antigo não desfaz
 * nada do que foi corrigido.
 */

const UNIDADES = [
  { value: 'm', label: 'metro (m)' },
  { value: 'm2', label: 'metro quadrado (m²)' },
  { value: 'un', label: 'unidade (un)' },
  { value: 'kg', label: 'quilo (kg)' },
]

const campo =
  'w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground ' +
  'placeholder:text-muted-foreground/60 focus:border-brand focus:outline-none transition-colors'
const rotulo = 'mb-1.5 block text-xs font-medium text-muted-foreground'

interface Props {
  /** Null = cadastrar material novo; preenchido = corrigir o custo deste. */
  item: CustoVigente | null
  onFechar: () => void
  toast: (type: ToastType, message: string) => void
}

export default function CorrigirCustoModal({ item, onFechar, toast }: Props) {
  const { data: fornecedores = [] } = useFornecedoresCatalogo()
  const salvar = useSalvarCustoManual()

  const editando = !!item
  const [fornecedorId, setFornecedorId] = useState(item?.fornecedor_id ?? '')
  const [descricao, setDescricao] = useState(item?.descricao ?? '')
  const [codigo, setCodigo] = useState(item?.codigo_fornecedor ?? '')
  const [categoria, setCategoria] = useState<string>(item?.categoria ?? 'tecido')
  const [cor, setCor] = useState(item?.cor ?? '')
  const [largura, setLargura] = useState(item?.largura_m?.toString() ?? '')
  const [unidade, setUnidade] = useState<string>(item?.unidade_canonica ?? 'm')
  const [custo, setCusto] = useState(item?.custo_unitario?.toString() ?? '')
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState<string | null>(null)

  const custoNum = Number(custo.replace(',', '.'))
  const fornecedorNome = fornecedores.find(f => f.id === fornecedorId)?.nome ?? ''

  async function enviar(ignorarAviso = false) {
    setErro(null)
    const correcao = {
      fornecedorId,
      fornecedorNome,
      codigoFornecedor: codigo.trim() || null,
      descricao,
      categoria,
      cor: cor.trim() || null,
      larguraM: largura.trim() ? Number(largura.replace(',', '.')) : null,
      custoUnitario: custoNum,
      unidadeCanonica: unidade as 'm' | 'm2' | 'un' | 'kg',
      motivo: motivo.trim() || null,
    }

    const problema = validarCorrecao(correcao)
    if (problema) {
      setErro(problema)
      return
    }

    // Avisa, mas não impede: a maioria dos erros de digitação de preço é
    // casa decimal, e quem corrige sabe quando o reajuste foi grande mesmo.
    if (!ignorarAviso) {
      const suspeita = mudancaSuspeita(item?.custo_unitario ?? null, custoNum)
      if (suspeita) {
        setConfirmando(suspeita)
        return
      }
    }
    setConfirmando(null)

    try {
      await salvar.mutateAsync(correcao)
      toast(
        'success',
        editando
          ? `Custo de ${descricao} agora é ${formatCurrency(custoNum)} / ${rotuloUnidade(unidade)}.`
          : `${descricao} entrou no catálogo.`
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
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white shadow-xl dark:bg-card sm:rounded-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="border-b border-border px-5 py-4">
          <h3 className="font-semibold text-foreground">
            {editando ? 'Corrigir custo' : 'Novo material'}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {editando
              ? 'O documento do fornecedor fica como está. Sua correção entra como um registro de hoje e passa a valer.'
              : 'Material que a loja compra e ainda não aparece em nenhum documento.'}
          </p>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className={rotulo}>Fornecedor</label>
            <CustomSelect
              value={fornecedorId}
              onChange={setFornecedorId}
              options={[
                { value: '', label: 'Escolha o fornecedor…' },
                ...fornecedores.map(f => ({ value: f.id, label: f.nome })),
              ]}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              O custo é por fornecedor: o mesmo trilho tem preço diferente em cada um.
            </p>
          </div>

          <div>
            <label className={rotulo}>Material</label>
            <input
              value={descricao}
              onChange={e => setDescricao(e.target.value)}
              placeholder="Como o fornecedor chama"
              className={campo}
              readOnly={editando}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={rotulo}>Código do fornecedor</label>
              <input
                value={codigo}
                onChange={e => setCodigo(e.target.value)}
                placeholder="opcional"
                className={campo}
                readOnly={editando}
              />
            </div>
            <div>
              <label className={rotulo}>Categoria</label>
              <CustomSelect
                value={categoria}
                onChange={setCategoria}
                options={(Object.keys(ROTULO_CATEGORIA) as CategoriaCatalogo[]).map(c => ({
                  value: c,
                  label: ROTULO_CATEGORIA[c],
                }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={rotulo}>Cor</label>
              <input
                value={cor}
                onChange={e => setCor(e.target.value)}
                placeholder="opcional"
                className={campo}
              />
            </div>
            <div>
              <label className={rotulo}>Largura em metros</label>
              <input
                value={largura}
                onChange={e => setLargura(e.target.value)}
                placeholder="ex.: 3,00"
                className={campo}
                inputMode="decimal"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={rotulo}>Custo</label>
              <input
                value={custo}
                onChange={e => setCusto(e.target.value)}
                placeholder="0,00"
                className={cn(campo, 'tabular-nums')}
                inputMode="decimal"
                autoFocus
              />
            </div>
            <div>
              <label className={rotulo}>Por</label>
              <CustomSelect
                value={unidade}
                onChange={setUnidade}
                options={UNIDADES}
              />
            </div>
          </div>

          {editando && item && (
            <p className="text-xs text-muted-foreground">
              Hoje está {formatCurrency(item.custo_unitario)} /{' '}
              {rotuloUnidade(item.unidade_canonica)}, de {item.referencia}.
            </p>
          )}

          <div>
            <label className={rotulo}>Por quê (opcional)</label>
            <input
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              placeholder="ex.: fornecedor avisou o reajuste por telefone"
              className={campo}
            />
          </div>

          {confirmando && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50/60 p-3 text-sm dark:border-amber-800/40 dark:bg-amber-950/20">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-amber-900 dark:text-amber-200">{confirmando}</p>
                <button
                  type="button"
                  onClick={() => void enviar(true)}
                  className="mt-2 text-xs font-semibold text-amber-900 underline dark:text-amber-200"
                >
                  É isso mesmo, salvar assim
                </button>
              </div>
            </div>
          )}

          {erro && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {erro}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onFechar}
            className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void enviar()}
            disabled={salvar.isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-gradient px-4 py-2 text-sm font-semibold text-white shadow-brand transition-all hover:opacity-90 active:scale-95 disabled:opacity-60"
          >
            {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {editando ? 'Salvar correção' : 'Cadastrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
