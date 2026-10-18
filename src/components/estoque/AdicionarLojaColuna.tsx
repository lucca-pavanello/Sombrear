import { useState } from 'react'
import { Loader2, Store } from 'lucide-react'
import { CustomSelect } from '@/components/ui/CustomSelect'
import { useFornecedoresCatalogo } from '@/hooks/useCatalogoManual'
import { useFixarColuna, useCriarFornecedor } from '@/hooks/useCatalogoLojas'
import type { GrupoCatalogo } from '@/hooks/useCatalogoCustos'
import type { ToastType } from '@/hooks/useToast'

/**
 * Acrescentar uma coluna de loja ao catálogo.
 *
 * Existe porque a coluna de uma loja só nascia depois do primeiro preço
 * dela, e o primeiro preço só podia ser digitado numa coluna — um impasse.
 * Aqui a loja escolhe quem quer ver, e a coluna aparece vazia esperando.
 *
 * A coluna é da aba (tecidos ou acessórios), não da tela toda: a Alumitec
 * não tem o que fazer na lista de tecidos.
 */

const campo =
  'w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground ' +
  'placeholder:text-muted-foreground/60 focus:border-brand focus:outline-none transition-colors'
const rotulo = 'mb-1.5 block text-xs font-medium text-muted-foreground'

interface Props {
  grupo: GrupoCatalogo
  /** Lojas que já são coluna aqui — não faz sentido oferecê-las de novo. */
  jaSaoColuna: string[]
  rotuloGrupo: string
  onFechar: () => void
  toast: (type: ToastType, message: string) => void
}

export default function AdicionarLojaColuna({
  grupo, jaSaoColuna, rotuloGrupo, onFechar, toast,
}: Props) {
  const { data: fornecedores = [] } = useFornecedoresCatalogo()
  const fixar = useFixarColuna()
  const criar = useCriarFornecedor()

  const disponiveis = fornecedores.filter(f => !jaSaoColuna.includes(f.id))

  const [modo, setModo] = useState<'existente' | 'nova'>(
    disponiveis.length > 0 ? 'existente' : 'nova'
  )
  const [escolhido, setEscolhido] = useState('')
  const [nomeNovo, setNomeNovo] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const salvando = fixar.isPending || criar.isPending

  async function enviar() {
    setErro(null)
    try {
      const id = modo === 'nova' ? await criar.mutateAsync(nomeNovo) : escolhido
      if (!id) {
        setErro('Escolha uma loja.')
        return
      }
      await fixar.mutateAsync({ grupo, fornecedorId: id })
      const nome =
        modo === 'nova' ? nomeNovo.trim() : fornecedores.find(f => f.id === id)?.nome ?? 'A loja'
      toast('success', `${nome} agora é uma coluna em ${rotuloGrupo.toLowerCase()}.`)
      onFechar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu para adicionar a coluna.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={onFechar}
    >
      <div
        className="w-full max-w-md overflow-y-auto rounded-t-2xl bg-white shadow-xl dark:bg-card sm:rounded-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="border-b border-border px-5 py-4">
          <h3 className="flex items-center gap-2 font-semibold text-foreground">
            <Store className="h-4 w-4 text-brand" />
            Nova coluna de loja
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A coluna entra em <b>{rotuloGrupo.toLowerCase()}</b> e começa vazia. Cada célula
            vira um botão para informar quanto aquele material custa nesta loja.
          </p>
        </div>

        <div className="space-y-4 px-5 py-4">
          {disponiveis.length > 0 && (
            <div className="flex gap-2">
              {(['existente', 'nova'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModo(m)}
                  className={
                    'flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ' +
                    (modo === m
                      ? 'border-brand text-brand'
                      : 'border-border text-muted-foreground hover:text-foreground')
                  }
                >
                  {m === 'existente' ? 'Loja já cadastrada' : 'Loja nova'}
                </button>
              ))}
            </div>
          )}

          {modo === 'existente' ? (
            <div>
              <label className={rotulo}>Loja</label>
              <CustomSelect
                value={escolhido}
                onChange={setEscolhido}
                options={[
                  { value: '', label: 'Escolha a loja…' },
                  ...disponiveis.map(f => ({ value: f.id, label: f.nome })),
                ]}
              />
            </div>
          ) : (
            <div>
              <label className={rotulo}>Nome da loja</label>
              <input
                value={nomeNovo}
                onChange={e => setNomeNovo(e.target.value)}
                placeholder="como a loja chama o fornecedor"
                className={campo}
                autoFocus
              />
              <p className="mt-1 text-xs text-muted-foreground">
                CNPJ, contato e prazo entram depois, no cadastro de fornecedores — aqui só o
                nome, para não atrapalhar quem veio digitar preço.
              </p>
            </div>
          )}

          {erro && (
            <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {erro}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
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
            disabled={salvando || (modo === 'existente' ? !escolhido : !nomeNovo.trim())}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-gradient px-4 py-2 text-sm font-semibold text-white shadow-brand transition-all hover:opacity-90 active:scale-95 disabled:opacity-60"
          >
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            Adicionar coluna
          </button>
        </div>
      </div>
    </div>
  )
}
