import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Info, MessagesSquare } from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'
import { cartao } from '@/components/shared/estilos'
import ListaConversas from '@/components/conversas/ListaConversas'
import PainelChat from '@/components/conversas/PainelChat'
import DetalheLead from '@/components/conversas/DetalheLead'
import { useConversas, useMarcarLeitura } from '@/hooks/useConversas'
import { useProfile } from '@/hooks/useProfile'
import type { Conversa } from '@/lib/conversas/lista'
import { cn } from '@/lib/utils'

/**
 * Conversas: a equipe atende o WhatsApp da loja sem abrir o Chatwoot. Três colunas num cartão só
 * (lista, conversa, detalhes do lead); no celular, uma por vez. O Chatwoot continua sendo o
 * centro: a tela lê o espelho e toda escrita passa pela edge function `conversas`.
 */
export default function TabConversas() {
  const { data: perfil } = useProfile()
  const lista = useConversas()
  const conversas = lista.data?.conversas ?? []
  const provisoria = lista.data?.provisoria ?? false
  const [aberta, setAberta] = useState<number | null>(null)
  const [detalhes, setDetalhes] = useState(false)
  const selecionada = useMemo(() => conversas.find(c => c.conversa_id === aberta) ?? null, [conversas, aberta])
  const { mutate: marcar } = useMarcarLeitura(perfil?.id)

  // Abrir a conversa marca como lida pra quem abriu; mensagem nova com ela aberta também, porque
  // quem está olhando já viu. Uma vez por abertura e por mensagem nova: sem isso, "marcar como
  // não lida" com a conversa ainda na tela seria desfeito na hora pela própria abertura.
  const marcouAbertura = useRef<string | null>(null)
  useEffect(() => {
    if (!selecionada) { marcouAbertura.current = null; return }
    if (provisoria || !perfil?.id) return
    const chave = `${selecionada.conversa_id}:${selecionada.ultima_recebida_em ?? ''}`
    if (marcouAbertura.current === chave) return
    marcouAbertura.current = chave
    if (selecionada.nao_lida) marcar({ conversaId: selecionada.conversa_id, naoLida: false })
  }, [selecionada, provisoria, perfil?.id, marcar])

  const selecionar = useCallback((c: Conversa) => setAberta(c.conversa_id), [])
  const voltar = useCallback(() => { setAberta(null); setDetalhes(false) }, [])
  const marcarNaoLida = () => {
    if (!selecionada) return
    marcar({ conversaId: selecionada.conversa_id, naoLida: true })
    voltar()
  }

  return (
    <div className="space-y-3">
      {provisoria && (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-amber-500/30 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <span>
            <strong className="font-semibold text-foreground">Modo de leitura provisório.</strong> O banco ainda não recebeu a migration da aba (0039):
            a lista mostra as conversas dos últimos 30 dias, sem não lidas e sem encerradas, e o envio só funciona depois que a função <code>conversas</code> for publicada.
          </span>
        </p>
      )}
      {/* a altura fecha a tela: cabeçalho e barra de abas em cima, o cartão ocupa o resto */}
      <div className={cn(cartao, 'flex h-[calc(100dvh-12.5rem)] min-h-[30rem] overflow-hidden')}>
        <div className={cn('w-full min-w-0 shrink-0 border-border lg:w-[21rem] lg:border-r xl:w-[23rem]', selecionada && 'max-lg:hidden')}>
          <ListaConversas
            conversas={conversas}
            carregando={lista.isLoading}
            erro={lista.isError}
            tentar={() => { void lista.refetch() }}
            selecionada={aberta}
            selecionar={selecionar}
            provisoria={provisoria}
          />
        </div>

        <div className={cn('min-w-0 flex-1', !selecionada && 'max-lg:hidden', selecionada && detalhes && 'max-xl:hidden')}>
          {selecionada ? (
            <PainelChat
              conversa={selecionada}
              voltar={voltar}
              marcarNaoLida={provisoria ? undefined : marcarNaoLida}
              abrirDetalhes={() => setDetalhes(d => !d)}
              detalhesAbertos={detalhes}
              provisoria={provisoria}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <EmptyState icon={MessagesSquare} title="Escolha uma conversa" description="As conversas do WhatsApp da loja aparecem ao lado, com a IA e a equipe na mesma linha do tempo." />
            </div>
          )}
        </div>

        {selecionada && detalhes && (
          <div className="w-full min-w-0 shrink-0 border-border xl:w-[21rem] xl:border-l">
            <DetalheLead conversa={selecionada} fechar={() => setDetalhes(false)} />
          </div>
        )}
      </div>
    </div>
  )
}
