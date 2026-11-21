import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle, ArrowLeft, Bot, Check, CheckCheck, CheckCircle2, Download, FileText, Info, MailOpen, MapPin, Smartphone,
} from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'
import AvisoErro from '@/components/shared/AvisoErro'
import { Button } from '@/components/ui/primitives'
import { useAlternarIA, useEncerrarConversa, useMensagens } from '@/hooks/useConversas'
import {
  agruparPorDia, doCelular, encerrada, falhou, hora, juntaComAnterior, linkDoMapa, nomeDaConversa, ROTULO_ANEXO,
  telefoneLegivel, tipoDoAnexo, type Anexo, type Conversa, type Mensagem,
} from '@/lib/conversas/lista'
import { cn } from '@/lib/utils'
import Compositor from './Compositor'
import { BotaoIcone, Confirmar, ImagemAmpliada, Iniciais } from './pecas'

/** o "baixar" ao lado de áudio e vídeo: navegador que não toca ogg/opus (Safari) ainda entrega o arquivo */
function Baixar({ url, nome }: { url: string; nome: string | null }) {
  return (
    <a href={url} download={nome ?? true} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:underline">
      <Download className="h-3 w-3" aria-hidden="true" /> baixar
    </a>
  )
}

function AnexoMidia({ a, ampliar }: { a: Anexo; ampliar: (url: string) => void }) {
  const tipo = tipoDoAnexo(a.tipo)
  if (a.url && tipo === 'imagem') {
    return (
      <button type="button" onClick={() => ampliar(a.url!)} className="block" aria-label="Ampliar imagem">
        <img src={a.url} alt={a.nome ?? 'Imagem'} loading="lazy" className="max-h-64 max-w-full rounded-lg object-cover" />
      </button>
    )
  }
  if (a.url && tipo === 'audio') {
    return (
      <div className="flex flex-col items-start gap-0.5">
        <audio controls preload="none" src={a.url} className="h-10 max-w-full" />
        <Baixar url={a.url} nome={a.nome} />
      </div>
    )
  }
  if (a.url && tipo === 'video') {
    return (
      <div className="flex flex-col items-start gap-0.5">
        <video controls preload="metadata" src={a.url} className="max-h-64 max-w-full rounded-lg" />
        <Baixar url={a.url} nome={a.nome} />
      </div>
    )
  }
  // localização, documento e o que a tela não conhece: um link com o nome
  const link = tipo === 'localizacao' ? linkDoMapa(a) ?? a.url : a.url
  const Icone = tipo === 'localizacao' ? MapPin : FileText
  const rotulo = tipo === 'localizacao' ? `Localização${a.nome ? `: ${a.nome}` : ''}` : a.nome ?? ROTULO_ANEXO[tipo]
  const cls = 'inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background/70 px-2 py-1.5 text-xs font-medium'
  const conteudo = <><Icone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{rotulo}</span></>
  return link
    ? <a href={link} target="_blank" rel="noreferrer" className={cn(cls, 'hover:underline')}>{conteudo}</a>
    : <span className={cls}>{conteudo}</span>
}

/** o ícone de entrega ao lado da hora: enviada, entregue, lida (azul) ou falha */
function Entrega({ m }: { m: Mensagem }) {
  if (m.autor === 'cliente') return null
  if (falhou(m)) return <AlertCircle className="ml-1 inline h-3 w-3 text-destructive" role="img" aria-label="Não foi entregue" />
  if (!m.status_entrega) return null
  if (m.status_entrega === 'sent') return <Check className="ml-1 inline h-3 w-3" role="img" aria-label="Enviada" />
  return <CheckCheck className={cn('ml-1 inline h-3 w-3', m.status_entrega === 'read' && 'text-sky-500')} role="img" aria-label={m.status_entrega === 'read' ? 'Lida' : 'Entregue'} />
}

/** memo: a conversa pode ter centenas de bolhas e, a cada mensagem nova, só a que mudou desenha de novo */
const Bolha = memo(function Bolha({ m, junta, ampliar }: { m: Mensagem; junta: boolean; ampliar: (url: string) => void }) {
  const sai = m.autor !== 'cliente'
  const ia = m.autor === 'ia'
  const celular = m.autor === 'equipe' && doCelular(m)
  const anexos = m.anexos ?? []
  return (
    <div className={cn('flex max-w-[min(80%,34rem)] flex-col', sai ? 'items-end self-end' : 'items-start self-start', junta ? 'mt-0.5' : 'mt-3')}>
      {!junta && sai && (
        <span className="mb-1 flex items-center gap-1 px-1 text-[11px] font-semibold text-muted-foreground">
          {ia
            ? <><Bot className="h-3 w-3 text-primary" aria-hidden="true" /> Amanda (IA)</>
            : <>{m.autor_nome ?? 'Equipe'}{celular && (
                <span title="Respondida pelo WhatsApp do aparelho da loja" className="inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[10px] font-bold">
                  <Smartphone className="h-2.5 w-2.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />do celular
                </span>
              )}</>}
        </span>
      )}
      <div className={cn(
        'whitespace-pre-wrap break-words rounded-2xl border px-3 py-2 text-sm leading-relaxed',
        sai ? 'rounded-br-md' : 'rounded-bl-md',
        !sai && 'border-transparent bg-muted text-foreground',
        ia && 'border-border bg-card',
        sai && !ia && 'border-sky-500/20 bg-sky-500/10',
        falhou(m) && 'border-destructive/50',
      )}>
        {m.excluida ? (
          <span className="italic text-muted-foreground">Mensagem apagada</span>
        ) : (
          <>
            {anexos.length > 0 && (
              <div className={cn('flex flex-col items-start gap-1.5', m.conteudo && 'mb-1.5')}>
                {anexos.map((a, i) => <AnexoMidia key={i} a={a} ampliar={ampliar} />)}
              </div>
            )}
            {m.conteudo}
          </>
        )}
        <span className="-mb-0.5 mt-0.5 block text-right text-[11px] tabular-nums text-muted-foreground">{hora(m.enviada_em)}<Entrega m={m} /></span>
      </div>
      {falhou(m) && (
        <p role="alert" className="mt-1 flex max-w-full items-start gap-1 px-1 text-xs text-destructive">
          <AlertCircle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" /> Não foi entregue{m.erro_entrega ? `: ${m.erro_entrega}` : '.'}
        </p>
      )}
    </div>
  )
})

export default function PainelChat({ conversa, voltar, marcarNaoLida, abrirDetalhes, detalhesAbertos, provisoria }: {
  conversa: Conversa
  voltar: () => void
  /** marca como não lida pra quem está logado e volta pra lista; undefined = banco sem a tabela */
  marcarNaoLida?: () => void
  abrirDetalhes: () => void
  detalhesAbertos: boolean
  provisoria: boolean
}) {
  const msgs = useMensagens(conversa.conversa_id)
  const rolagem = useRef<HTMLDivElement>(null)
  const grupos = useMemo(() => agruparPorDia(msgs.data ?? []), [msgs.data])
  const iaAtiva = !conversa.ia_pausada
  const encerradaJa = encerrada(conversa)
  const alternarIA = useAlternarIA()
  const encerrar = useEncerrarConversa()
  const [confirmaIA, setConfirmaIA] = useState(false)
  const [confirmaFim, setConfirmaFim] = useState(false)
  const [ampliada, setAmpliada] = useState<string | null>(null)
  const nome = nomeDaConversa(conversa)

  // abre no fim; mensagem nova também leva pro fim
  useLayoutEffect(() => {
    const el = rolagem.current
    if (el) el.scrollTop = el.scrollHeight
  }, [conversa.conversa_id, msgs.data?.length])
  useEffect(() => { rolagem.current?.focus({ preventScroll: true }) }, [conversa.conversa_id])

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col" aria-label={`Conversa com ${nome}`}>
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-2 sm:px-4">
        <BotaoIcone rotulo="Voltar pra lista" onClick={voltar} className="-ml-1 lg:hidden"><ArrowLeft className="h-4 w-4" aria-hidden="true" /></BotaoIcone>
        <Iniciais nome={nome} className="max-sm:hidden" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{nome}</span>
            {encerradaJa && <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">encerrada</span>}
          </p>
          {conversa.nome && <p className="truncate text-xs tabular-nums text-muted-foreground">{telefoneLegivel(conversa.telefone)}</p>}
        </div>

        <button
          type="button" role="switch" aria-checked={iaAtiva} onClick={() => setConfirmaIA(true)}
          title={iaAtiva ? 'A IA está respondendo esta conversa. Clique pra pausar.' : 'A IA está calada nesta conversa. Clique pra religar.'}
          aria-label={iaAtiva ? 'IA ativa, pausar' : 'IA pausada, religar'}
          className={cn(
            'inline-flex h-8 shrink-0 items-center gap-2 rounded-full border pl-2.5 pr-1.5 text-xs font-semibold transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
            iaAtiva ? 'border-primary/30 text-primary hover:bg-primary/5' : 'border-border text-muted-foreground hover:bg-muted',
          )}
        >
          <Bot className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">{iaAtiva ? 'IA ativa' : 'IA pausada'}</span>
          <span className={cn('relative inline-flex h-4 w-7 rounded-full transition-colors', iaAtiva ? 'bg-emerald-500' : 'bg-muted-foreground/30')} aria-hidden="true">
            <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-white transition-[left]', iaAtiva ? 'left-[14px]' : 'left-0.5')} />
          </span>
        </button>
        {!encerradaJa && !provisoria && (
          <>
            <Button variant="outline" size="sm" onClick={() => setConfirmaFim(true)} title="Encerrar o atendimento desta conversa" className="hidden shrink-0 xl:inline-flex">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />Encerrar
            </Button>
            <BotaoIcone rotulo="Encerrar conversa" onClick={() => setConfirmaFim(true)} className="xl:hidden"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /></BotaoIcone>
          </>
        )}
        {marcarNaoLida && <BotaoIcone rotulo="Marcar como não lida" onClick={marcarNaoLida}><MailOpen className="h-4 w-4" aria-hidden="true" /></BotaoIcone>}
        <BotaoIcone rotulo={detalhesAbertos ? 'Fechar detalhes do lead' : 'Detalhes do lead'} ativo={detalhesAbertos} onClick={abrirDetalhes} aria-pressed={detalhesAbertos}>
          <Info className="h-4 w-4" aria-hidden="true" />
        </BotaoIcone>
      </header>

      <div ref={rolagem} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto bg-muted/20 px-3 py-4 focus:outline-none sm:px-6">
        {msgs.isLoading ? (
          <div className="flex flex-col gap-3" aria-busy="true" aria-label="Carregando mensagens">
            {[60, 40, 72, 35, 55].map((w, i) => (
              <div key={i} style={{ width: `${w}%` }} className={cn('h-12 rounded-2xl skeleton-shimmer', i % 2 ? 'self-end' : 'self-start')} />
            ))}
          </div>
        ) : msgs.isError ? (
          <AvisoErro mensagem="Não deu para carregar as mensagens." aoTentar={() => { void msgs.refetch() }} />
        ) : !grupos.length ? (
          <EmptyState icon={Info} title="Sem mensagens nesta conversa" description="Mande a primeira mensagem pelo campo abaixo." />
        ) : (
          <div className="flex flex-col">
            {grupos.map(g => (
              <div key={g.dia} className="flex flex-col">
                <div className="sticky top-0 z-10 my-3 flex justify-center">
                  <span className="inline-flex h-6 items-center rounded-full border border-border bg-card px-2.5 text-[11px] font-semibold text-muted-foreground shadow-sm">{g.rotulo}</span>
                </div>
                {g.itens.map((m, i) => <Bolha key={m.id} m={m} junta={juntaComAnterior(m, g.itens[i - 1])} ampliar={setAmpliada} />)}
              </div>
            ))}
          </div>
        )}
      </div>

      <Compositor key={conversa.conversa_id} conversa={conversa} />

      <Confirmar
        aberto={confirmaIA} aoFechar={() => { setConfirmaIA(false); alternarIA.reset() }}
        titulo={iaAtiva ? 'Pausar a IA nesta conversa?' : 'Religar a IA nesta conversa?'}
        rotuloConfirmar={iaAtiva ? 'Pausar IA' : 'Religar IA'}
        ocupado={alternarIA.isPending} erro={alternarIA.error?.message}
        aoConfirmar={() => alternarIA.mutate({ conversaId: conversa.conversa_id, ligada: !iaAtiva }, { onSuccess: () => setConfirmaIA(false) })}
      >
        {iaAtiva
          ? 'A Amanda para de responder este cliente até você religar. Mandar uma mensagem por aqui também pausa a IA.'
          : 'A Amanda volta a responder este cliente assim que ele escrever.'}
      </Confirmar>

      <Confirmar
        aberto={confirmaFim} aoFechar={() => { setConfirmaFim(false); encerrar.reset() }}
        titulo="Encerrar esta conversa?" rotuloConfirmar="Encerrar"
        ocupado={encerrar.isPending} erro={encerrar.error?.message}
        aoConfirmar={() => encerrar.mutate(conversa.conversa_id, { onSuccess: () => setConfirmaFim(false) })}
      >
        A conversa sai das abertas e a IA volta a ficar ligada: se o cliente escrever de novo, a Amanda atende e a conversa reabre. Se você mandar uma mensagem por aqui, ela também reabre.
      </Confirmar>

      <ImagemAmpliada url={ampliada} aoFechar={() => setAmpliada(null)} />
    </section>
  )
}
