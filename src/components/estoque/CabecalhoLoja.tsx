import { useState } from 'react'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOcultarColuna, useRenomearLoja } from '@/hooks/useCatalogoLojas'
import type { GrupoCatalogo } from '@/hooks/useCatalogoCustos'
import type { ToastType } from '@/hooks/useToast'

/**
 * O cabeçalho de uma coluna de loja: o nome, e o que dá para fazer com ela.
 *
 * Renomear muda o nome do FORNECEDOR, não de um rótulo da tela — ele aparece
 * no cadastro de fornecedores, nos lotes e nos documentos. O aviso está no
 * título do botão porque descobrir isso depois é pior.
 *
 * Excluir ESCONDE a coluna e não apaga custo nenhum. Quando a loja tem
 * preços, a confirmação diz quantos são e que continuam guardados: a dona
 * precisa saber que não está jogando fora o histórico de compra.
 */

interface Props {
  grupo: GrupoCatalogo
  fornecedorId: string
  nome: string
  /** Quantos materiais deste grupo têm preço nesta loja. */
  comPreco: number
  toast: (type: ToastType, message: string) => void
}

export default function CabecalhoLoja({ grupo, fornecedorId, nome, comPreco, toast }: Props) {
  const [editando, setEditando] = useState(false)
  const [rascunho, setRascunho] = useState(nome)
  const [confirmando, setConfirmando] = useState(false)
  const renomear = useRenomearLoja()
  const ocultar = useOcultarColuna()

  async function salvarNome() {
    if (rascunho.trim() === nome) {
      setEditando(false)
      return
    }
    try {
      await renomear.mutateAsync({ fornecedorId, nome: rascunho })
      toast('success', `A loja agora se chama ${rascunho.trim()}.`)
      setEditando(false)
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Não deu para renomear.')
    }
  }

  async function excluir() {
    try {
      await ocultar.mutateAsync({ grupo, fornecedorId })
      toast(
        'success',
        comPreco > 0
          ? `Coluna ${nome} escondida. Os ${comPreco} preços continuam guardados.`
          : `Coluna ${nome} removida.`
      )
      setConfirmando(false)
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Não deu para excluir a coluna.')
    }
  }

  if (editando) {
    return (
      <div className="flex items-center justify-end gap-1">
        <input
          value={rascunho}
          onChange={e => setRascunho(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') void salvarNome()
            if (e.key === 'Escape') {
              setRascunho(nome)
              setEditando(false)
            }
          }}
          autoFocus
          className="w-32 rounded-lg border border-brand bg-background px-2 py-1 text-xs font-normal text-foreground focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void salvarNome()}
          disabled={renomear.isPending}
          title="Salvar o nome"
          className="rounded-md p-1 text-brand transition-colors hover:bg-muted/60"
        >
          {renomear.isPending
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Check className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => {
            setRascunho(nome)
            setEditando(false)
          }}
          title="Cancelar"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/60"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div className="group/loja flex items-center justify-end gap-1">
      <span>{nome}</span>
      <button
        type="button"
        onClick={() => setEditando(true)}
        title={`Renomear — muda o nome do fornecedor em todo o sistema, não só nesta coluna`}
        className="rounded-md p-1 text-muted-foreground/0 transition-colors group-hover/loja:text-muted-foreground hover:bg-muted/60 hover:!text-brand"
      >
        <Pencil className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={() => setConfirmando(true)}
        title={`Excluir a coluna ${nome} desta aba`}
        className="rounded-md p-1 text-muted-foreground/0 transition-colors group-hover/loja:text-muted-foreground hover:bg-muted/60 hover:!text-destructive"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      {confirmando && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setConfirmando(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 text-left shadow-xl dark:bg-card"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="font-semibold text-foreground">Excluir a coluna {nome}?</h3>
            <p className="mt-2 text-sm font-normal text-muted-foreground">
              {comPreco > 0 ? (
                <>
                  Esta loja tem preço em <b>{comPreco}</b>{' '}
                  {comPreco === 1 ? 'material' : 'materiais'} desta aba. A coluna some da tela,
                  mas <b>nenhum custo é apagado</b> — o histórico de compra continua inteiro e
                  a coluna volta por “Nova loja” quando você quiser.
                </>
              ) : (
                <>
                  A coluna está vazia e some da tela. Dá para trazer de volta por “Nova loja”.
                </>
              )}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmando(false)}
                className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void excluir()}
                disabled={ocultar.isPending}
                className={cn(
                  'inline-flex items-center gap-2 rounded-xl bg-destructive px-4 py-2 text-sm font-semibold text-white',
                  'transition-all hover:opacity-90 active:scale-95 disabled:opacity-60'
                )}
              >
                {ocultar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Excluir coluna
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
