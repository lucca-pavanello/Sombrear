import { useState } from 'react'
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CustomSelect } from '@/components/ui/CustomSelect'
import { useEditarMaterial, useExcluirMaterial } from '@/hooks/useCatalogoManual'
import { ROTULO_CATEGORIA, type CategoriaCatalogo } from '@/hooks/useCatalogoCustos'
import { chaveMaterial, SEM_FORNECEDOR, type MaterialPivotado } from '@/lib/catalogo/pivo'
import { alvosComCodigo, alvosDoMaterial, validarEdicaoMaterial } from '@/lib/catalogo/editarMaterial'
import type { ToastType } from '@/hooks/useToast'

/**
 * Editar um material inteiro — nome, categoria, cor, largura e o código em
 * cada loja — ou excluir o material do catálogo.
 *
 * O custo NÃO é editado aqui: custo é de cada loja e tem a própria tela
 * (clicar no preço). Aqui fica o que é do material.
 *
 * Nada reescreve o documento do fornecedor: a edição é um ajuste por cima, e
 * excluir tira do catálogo o que foi registrado até hoje. Se a loja voltar a
 * comprar, o registro novo aparece de novo.
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

export default function EditarMaterialModal({ material, onFechar, toast }: Props) {
  const editar = useEditarMaterial()
  const excluir = useExcluirMaterial()
  const celulas = [...material.porFornecedor.values()]

  const [descricao, setDescricao] = useState(material.descricao)
  const [categoria, setCategoria] = useState<string>(material.categoria)
  const [cor, setCor] = useState(material.cor ?? '')
  const [largura, setLargura] = useState(material.largura_m?.toString().replace('.', ',') ?? '')
  const [codigos, setCodigos] = useState(
    () => new Map(celulas.map(c => [c.fornecedor_id ?? SEM_FORNECEDOR, c.codigo_fornecedor ?? '']))
  )
  const [erro, setErro] = useState<string | null>(null)
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)

  const ocupado = editar.isPending || excluir.isPending

  async function salvar() {
    setErro(null)
    const larguraM = largura.trim() ? Number(largura.replace(',', '.')) : null
    const problema = validarEdicaoMaterial({ descricao, categoria, larguraM, codigos })
    if (problema) {
      setErro(problema)
      return
    }
    try {
      await editar.mutateAsync({
        alvos: alvosComCodigo(celulas, codigos),
        descricao,
        categoria,
        cor: cor.trim() || null,
        larguraM,
        chaveAntiga: material.chave,
        chaveNova: chaveMaterial(descricao),
      })
      toast('success', `${descricao.trim()} foi atualizado em todas as lojas.`)
      onFechar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu para salvar.')
    }
  }

  async function confirmarExclusao() {
    setErro(null)
    try {
      await excluir.mutateAsync(alvosDoMaterial(celulas))
      toast('success', `${material.descricao} saiu do catálogo.`)
      onFechar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu para excluir.')
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
          <h3 className="font-semibold text-foreground">Editar material</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Muda em todas as lojas de uma vez. O documento do fornecedor fica como está. Para mudar
            o custo, toque no preço da loja.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label className={rotulo}>Nome do material</label>
            <input
              value={descricao}
              onChange={e => setDescricao(e.target.value)}
              className={campo}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
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
            <div>
              <label className={rotulo}>Cor</label>
              <input value={cor} onChange={e => setCor(e.target.value)} className={campo} />
            </div>
          </div>

          <div>
            <label className={rotulo}>Largura em metros</label>
            <input
              value={largura}
              onChange={e => setLargura(e.target.value)}
              inputMode="decimal"
              placeholder="ex.: 3,00"
              className={campo}
            />
          </div>

          {celulas.length > 0 && (
            <div>
              <label className={rotulo}>Código em cada loja</label>
              <div className="space-y-2">
                {celulas.map(c => {
                  const id = c.fornecedor_id ?? SEM_FORNECEDOR
                  return (
                    <div key={id} className="flex items-center gap-3">
                      <span className="w-2/5 shrink-0 truncate text-sm text-foreground">
                        {c.fornecedor ?? 'Sem fornecedor'}
                      </span>
                      <input
                        value={codigos.get(id) ?? ''}
                        onChange={e =>
                          setCodigos(prev => new Map(prev).set(id, e.target.value))
                        }
                        placeholder="sem código"
                        className={campo}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {confirmandoExclusao && (
            <div className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-foreground">
                <b>{material.descricao}</b> sai do catálogo e do cálculo
                {celulas.length > 1 ? `, nas ${celulas.length} lojas` : ''}. Os documentos dos
                fornecedores ficam guardados. Se a loja voltar a comprar, é só cadastrar de novo.
              </p>
            </div>
          )}

          {erro && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {erro}
            </div>
          )}
        </div>

        {/* Fora da área que rola: no celular o botão de salvar nunca some. */}
        <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
          {confirmandoExclusao ? (
            <>
              <button
                type="button"
                onClick={() => setConfirmandoExclusao(false)}
                disabled={ocupado}
                className="ml-auto rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={() => void confirmarExclusao()}
                disabled={ocupado}
                className="inline-flex items-center gap-2 rounded-xl bg-destructive px-4 py-2 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-95 disabled:opacity-60"
              >
                {excluir.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Excluir material
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setConfirmandoExclusao(true)}
                disabled={ocupado}
                className="inline-flex items-center gap-1.5 rounded-xl px-2 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/5"
              >
                <Trash2 className="h-4 w-4" /> Excluir
              </button>
              <button
                type="button"
                onClick={onFechar}
                className="ml-auto rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void salvar()}
                disabled={ocupado}
                className={cn(
                  'inline-flex items-center gap-2 rounded-xl bg-brand-gradient px-4 py-2 text-sm font-semibold text-white shadow-brand',
                  'transition-all hover:opacity-90 active:scale-95 disabled:opacity-60'
                )}
              >
                {editar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Salvar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
