/**
 * Agente IA › Ligações.
 *
 * As ligações que a Amanda de voz atendeu: quem ligou, o resumo, a gravação e a conversa
 * inteira, para a equipe saber o que foi combinado antes de responder no WhatsApp.
 *
 * Lista à esquerda, ligação aberta à direita (no celular, uma embaixo da outra). As duas
 * colunas têm teto de altura e rolam por dentro: a aba nunca fica maior que a tela.
 */
import { useMemo, useRef, useState } from 'react'
import { ExternalLink, Headset, Phone, Search } from 'lucide-react'
import { CHATWOOT_BASE_URL } from '@/lib/constants'
import { cn, formatCurrency } from '@/lib/utils'
import { campoBusca } from '@/components/shared/estilos'
import { useAudioLigacao, useLigacoes, type Ligacao } from '@/hooks/useLigacoes'
import { ROTULO_ASSUNTO, ROTULO_WHATSAPP, duracao, filtrarLigacoes, telefoneBonito } from '@/lib/ligacoes'
import AvisoErro from '@/components/shared/AvisoErro'
import EmptyState from '@/components/shared/EmptyState'

const CARTAO = 'rounded-xl border border-border bg-card shadow-sm'
const EYEBROW = 'text-[11px] font-bold uppercase tracking-wider text-foreground/50'
/** teto das duas colunas: rolam por dentro e a aba cabe na tela */
const ALTURA = 'lg:h-[calc(100svh-16rem)] lg:min-h-[28rem]'

function quando(iso: string): string {
  const d = new Date(iso)
  const dia = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })
  const hora = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  return `${dia} às ${hora}`
}

const TOM_WHATSAPP: Record<Ligacao['whatsapp_status'], string> = {
  enviado: 'text-muted-foreground',
  so_nota: 'text-muted-foreground',
  pendente: 'text-muted-foreground',
  sem_telefone: 'text-amber-600 dark:text-amber-400',
  erro: 'text-destructive',
}

function Item({ l, ativa, aoAbrir }: { l: Ligacao; ativa: boolean; aoAbrir: () => void }) {
  const dur = duracao(l.inicio, l.fim)
  return (
    <li>
      <button type="button" onClick={aoAbrir} aria-current={ativa}
        className={cn(
          'flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60',
          ativa ? 'bg-primary/[0.06]' : 'hover:bg-muted/30',
        )}>
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{l.nome?.trim() || 'Sem nome'}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{quando(l.inicio)}</span>
        </span>
        <span className="flex items-baseline gap-2 text-xs text-muted-foreground">
          <span className="truncate tabular-nums">{telefoneBonito(l.telefone ?? l.telefone_chamador) || 'sem telefone'}</span>
          {l.assunto && <span className="shrink-0">· {ROTULO_ASSUNTO[l.assunto]}</span>}
          {dur && <span className="ml-auto shrink-0 tabular-nums">{dur}</span>}
        </span>
      </button>
    </li>
  )
}

function Gravacao({ caminho }: { caminho: string | null | undefined }) {
  const { data: url, isPending, isError } = useAudioLigacao(caminho)
  if (!caminho) {
    return <p className="text-xs text-muted-foreground">Ligação sem gravação.</p>
  }
  if (isError) return <p className="text-xs text-destructive">Não consegui abrir a gravação agora.</p>
  if (isPending || !url) return <div className="h-10 w-full rounded-full skeleton-shimmer" aria-label="Carregando a gravação" />
  return <audio controls preload="metadata" src={url} className="h-10 w-full">Seu navegador não toca o áudio.</audio>
}

function Aberta({ l, ancora }: { l: Ligacao; ancora: React.RefObject<HTMLDivElement | null> }) {
  const dur = duracao(l.inicio, l.fim)
  const conversa = Number(l.conversa_chatwoot)
  const o = l.orcamento
  return (
    <div ref={ancora} className={cn(CARTAO, 'flex min-h-0 scroll-mt-4 flex-col', ALTURA)}>
      <div className="space-y-3 border-b border-border/60 px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-[15px] font-semibold">{l.nome?.trim() || 'Sem nome'}</h3>
          <span className="text-xs tabular-nums text-muted-foreground">
            {telefoneBonito(l.telefone ?? l.telefone_chamador) || 'sem telefone'} · {quando(l.inicio)}{dur && ` · ${dur}`}
          </span>
          {Number.isFinite(conversa) && conversa > 0 && (
            <a href={`${CHATWOOT_BASE_URL}/app/accounts/1/conversations/${conversa}`} target="_blank" rel="noreferrer noopener"
              className="ml-auto inline-flex items-center gap-1 rounded-sm text-[12px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
              abrir no Chatwoot <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          )}
        </div>
        <div>
          <p className={EYEBROW}>Resumo{l.assunto && ` · ${ROTULO_ASSUNTO[l.assunto]}`}</p>
          <p className="mt-1 text-sm leading-relaxed text-foreground/90">{l.resumo?.trim() || 'Sem resumo.'}</p>
          {o && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Valor passado: {o.maisBarato ? 'a partir de ' : ''}{formatCurrency(o.total4x)} em até 4x
              ({o.tecido}, {o.largura.toLocaleString('pt-BR')} x {o.altura.toLocaleString('pt-BR')})
            </p>
          )}
          <p className={cn('mt-1.5 text-xs', TOM_WHATSAPP[l.whatsapp_status])}>{ROTULO_WHATSAPP[l.whatsapp_status]}</p>
        </div>
        <Gravacao caminho={l.audio_path} />
      </div>

      <div className="max-h-[60svh] min-h-0 flex-1 overflow-y-auto px-5 py-4 lg:max-h-none">
        <p className={cn(EYEBROW, 'mb-3')}>Conversa</p>
        {l.transcricao.length === 0 ? (
          <p className="text-sm text-muted-foreground">A conversa não foi gravada.</p>
        ) : (
          <ol className="space-y-2">
            {l.transcricao.map((f, i) => (
              <li key={i} className={cn('flex', f.quem === 'cliente' ? 'justify-end' : 'justify-start')}>
                <p className={cn(
                  'max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed [overflow-wrap:anywhere]',
                  f.quem === 'cliente' ? 'bg-primary/10 text-foreground' : 'bg-muted/50 text-foreground/90',
                )}>
                  <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {f.quem === 'cliente' ? 'Cliente' : 'Amanda'}
                  </span>
                  {f.texto}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

export default function Ligacoes() {
  const { data: ligacoes = [], isPending, isError, refetch } = useLigacoes()
  const [busca, setBusca] = useState('')
  const [aberta, setAberta] = useState<string | null>(null)
  const ancora = useRef<HTMLDivElement>(null)
  // no celular a ligação aberta fica embaixo da lista: leva até ela
  const abrir = (id: string) => {
    setAberta(id)
    if (window.matchMedia('(max-width: 1023px)').matches) {
      requestAnimationFrame(() => ancora.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }
  const lista = useMemo(() => filtrarLigacoes(ligacoes, busca), [ligacoes, busca])
  const atual = lista.find(l => l.id === aberta) ?? lista[0]

  if (isPending) {
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className={cn(CARTAO, 'h-72 skeleton-shimmer', ALTURA)} aria-label="Carregando as ligações" />
        <div className={cn(CARTAO, 'hidden h-72 skeleton-shimmer lg:block', ALTURA)} />
      </div>
    )
  }
  if (isError) {
    return <AvisoErro mensagem="Não consegui ler as ligações agora." aoTentar={() => void refetch()} className="py-8" />
  }
  if (ligacoes.length === 0) {
    return (
      <div className={CARTAO}>
        <EmptyState icon={Headset} title="Nenhuma ligação ainda"
          description="Quando a Amanda atender o telefone, cada ligação aparece aqui com o resumo, a gravação e a conversa inteira." />
      </div>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className={cn(CARTAO, 'flex min-h-0 flex-col', ALTURA)}>
        <div className="space-y-2 border-b border-border/60 px-4 py-3">
          <p className={EYEBROW}>
            <Phone className="mr-1 inline h-3 w-3 align-[-1px]" aria-hidden="true" />
            {ligacoes.length} ligaç{ligacoes.length === 1 ? 'ão' : 'ões'} atendida{ligacoes.length === 1 ? '' : 's'}
          </p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input type="search" value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por nome ou telefone" aria-label="Buscar ligação" className={campoBusca} />
          </div>
        </div>
        {lista.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma ligação com “{busca.trim()}”.</p>
        ) : (
          <ul className="max-h-80 min-h-0 flex-1 divide-y divide-border/50 overflow-y-auto lg:max-h-none">
            {lista.map(l => <Item key={l.id} l={l} ativa={l.id === atual?.id} aoAbrir={() => abrir(l.id)} />)}
          </ul>
        )}
      </div>
      {atual && <Aberta l={atual} ancora={ancora} />}
    </div>
  )
}
