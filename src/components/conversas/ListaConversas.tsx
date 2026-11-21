import { useMemo, useState } from 'react'
import { Bell, BellOff, Bot, MessagesSquare, Search, X } from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'
import AvisoErro from '@/components/shared/AvisoErro'
import SeloComEquipe from '@/components/agente/SeloComEquipe'
import { campoBusca, segmentado } from '@/components/shared/estilos'
import { useSomMensagem } from '@/lib/conversas/som'
import {
  aguardando, buscar, contarPorFiltro, encerrada, FILTROS, nomeDaConversa, passaFiltro, previaDaConversa, quandoNaLista,
  telefoneLegivel, type Conversa, type Filtro,
} from '@/lib/conversas/lista'
import { cn } from '@/lib/utils'
import { BotaoIcone, Iniciais } from './pecas'

/**
 * A coluna da esquerda: busca, filtros e as conversas, da mais recente para a mais antiga.
 * Pergunta dos 5 segundos: "quem está esperando resposta?" — por isso o ponto de não lida e o
 * filtro Aguardando ficam à vista.
 */
export default function ListaConversas({ conversas, carregando, erro, tentar, selecionada, selecionar, provisoria }: {
  conversas: Conversa[]
  carregando: boolean
  erro: boolean
  tentar: () => void
  selecionada: number | null
  selecionar: (c: Conversa) => void
  /** banco ainda sem a migration da aba: sem encerradas e sem não lidas */
  provisoria: boolean
}) {
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const som = useSomMensagem()

  // sem a migration, os filtros que dependem das tabelas novas não aparecem
  const filtros = useMemo(() => FILTROS.filter(f => !provisoria || (f.valor !== 'nao_lidas' && f.valor !== 'encerradas')), [provisoria])
  const contagem = useMemo(() => contarPorFiltro(conversas), [conversas])
  const lista = useMemo(() => buscar(conversas.filter(c => passaFiltro(c, filtro)), busca), [conversas, filtro, busca])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2.5 border-b border-border p-3">
        <div className="flex items-center gap-2">
          <MessagesSquare className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <h2 className="font-display text-sm font-semibold tracking-wide">Conversas</h2>
          <span className="text-xs tabular-nums text-muted-foreground">{contagem.todas}</span>
          <BotaoIcone
            rotulo={som.ligado ? 'Som de mensagem nova ligado. Clique para desligar.' : 'Som de mensagem nova desligado. Clique para ligar.'}
            ativo={som.ligado} onClick={som.trocar} className="ml-auto h-8 w-8"
          >
            {som.ligado ? <Bell className="h-4 w-4" aria-hidden="true" /> : <BellOff className="h-4 w-4" aria-hidden="true" />}
          </BotaoIcone>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" aria-hidden="true" />
          <input
            type="search" value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome ou telefone" aria-label="Buscar conversa"
            className={cn(campoBusca, 'pr-8 [&::-webkit-search-cancel-button]:hidden')}
          />
          {busca && (
            <button type="button" onClick={() => setBusca('')} title="Limpar busca" aria-label="Limpar busca"
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className={cn(segmentado.trilho, 'flex-wrap')} role="tablist" aria-label="Filtrar conversas">
          {filtros.map(f => (
            <button
              key={f.valor} type="button" role="tab" aria-selected={filtro === f.valor} title={f.titulo}
              onClick={() => setFiltro(f.valor)}
              className={cn(segmentado.item, 'px-2.5', filtro === f.valor ? segmentado.ativo : segmentado.inativo)}
            >
              {f.rotulo}
              {f.valor !== 'todas' && contagem[f.valor] > 0 && (
                <span className="ml-1 tabular-nums opacity-70">{contagem[f.valor]}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {carregando ? (
          <ul aria-busy="true" aria-label="Carregando conversas">
            {[0, 1, 2, 3, 4, 5].map(i => (
              <li key={i} className="flex items-center gap-3 border-b border-border/60 px-3 py-3">
                <div className="h-9 w-9 shrink-0 rounded-full skeleton-shimmer" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-2/5 rounded skeleton-shimmer" />
                  <div className="h-3 w-4/5 rounded skeleton-shimmer" />
                </div>
              </li>
            ))}
          </ul>
        ) : erro ? (
          <AvisoErro className="m-3" mensagem="Não deu para carregar as conversas." aoTentar={tentar} />
        ) : !lista.length ? (
          <EmptyState
            icon={MessagesSquare} className="px-4 py-12"
            title={busca ? 'Nenhuma conversa com essa busca' : filtro === 'todas' ? 'Nenhuma conversa aberta' : 'Nada neste filtro'}
            description={busca ? 'Confira o nome ou tente só o final do telefone.' : filtro === 'todas' ? 'Quando um cliente escrever no WhatsApp, a conversa aparece aqui.' : undefined}
            action={busca || filtro !== 'todas' ? { label: 'Ver todas as abertas', onClick: () => { setBusca(''); setFiltro('todas') } } : undefined}
          />
        ) : (
          <ul>
            {lista.map(c => {
              const ativa = c.conversa_id === selecionada
              const nome = nomeDaConversa(c)
              return (
                <li key={c.conversa_id}>
                  <button
                    type="button" onClick={() => selecionar(c)} aria-current={ativa ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-center gap-3 border-b border-border/60 px-3 py-3 text-left transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60',
                      ativa ? 'bg-muted/70' : 'hover:bg-muted/30',
                    )}
                  >
                    <Iniciais nome={nome} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className={cn('truncate text-sm', c.nao_lida ? 'font-bold text-foreground' : 'font-semibold text-foreground/90')}>{nome}</span>
                        <span className={cn('ml-auto shrink-0 text-[11px] tabular-nums', c.nao_lida ? 'font-semibold text-primary' : 'text-muted-foreground')}>
                          {quandoNaLista(c.ultima_mensagem_em)}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className={cn('truncate text-xs', c.nao_lida ? 'font-medium text-foreground/80' : 'text-muted-foreground')}>{previaDaConversa(c)}</span>
                        {c.nao_lida && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-primary" role="img" aria-label="Não lida" />}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {c.nome && <span className="text-[11px] tabular-nums text-muted-foreground/80">{telefoneLegivel(c.telefone)}</span>}
                        {encerrada(c) ? (
                          <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">encerrada</span>
                        ) : c.ia_pausada ? (
                          <SeloComEquipe />
                        ) : (
                          <span title="A Amanda está respondendo esta conversa" className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                            <Bot className="h-2.5 w-2.5 shrink-0 text-primary" aria-hidden="true" />IA
                          </span>
                        )}
                        {!encerrada(c) && aguardando(c) && (
                          <span title="O cliente mandou a última mensagem" className="rounded-full border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">aguardando</span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
