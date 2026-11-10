/**
 * A aba Agente IA e as suas visões: a Visão geral (leads, funil, insights) e as Ligações
 * (o que a Amanda de voz atendeu: resumo, gravação e conversa).
 *
 * Mora aqui, e não dentro de TabAgenteIA, porque aquele arquivo tem saídas antecipadas
 * para carregando e para erro: o seletor desapareceria justamente enquanto a Visão geral
 * carrega, e quem quer as Ligações ficaria preso esperando uma tela que nem ia usar.
 *
 * As Ligações seguem a régua da `ligacoes` (0032): toda a equipe que vê o Agente IA,
 * porque é ela quem responde o cliente depois da ligação.
 */
import { lazy, Suspense, useState } from 'react'
import TabAgenteIA from '@/components/tabs/TabAgenteIA'
import { cn } from '@/lib/utils'

// só carrega quando alguém abre: a Visão geral é o que a maioria usa
const Ligacoes = lazy(() => import('@/components/agente/Ligacoes'))

type Visao = 'geral' | 'ligacoes'

const VISOES: { id: Visao; rotulo: string }[] = [
  { id: 'geral', rotulo: 'Visão geral' },
  { id: 'ligacoes', rotulo: 'Ligações' },
]

const CARREGANDO = <div className="h-64 animate-pulse rounded-xl border border-border bg-card shadow-sm" />

export default function AbaAgente({ resetKey }: { resetKey?: number } = {}) {
  const [visao, setVisao] = useState<Visao>('geral')
  const atual = visao

  return (
    <div className="space-y-4">
      {VISOES.length > 1 && (
        <div className="flex justify-center">
          <div role="group" aria-label="Visão da aba Agente IA"
            className="inline-flex gap-1 rounded-full border border-border bg-muted/30 p-1">
            {VISOES.map(v => (
              <button key={v.id} type="button" onClick={() => setVisao(v.id)} aria-pressed={atual === v.id}
                className={cn(
                  'h-8 rounded-full px-4 text-xs font-semibold transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                  atual === v.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}>
                {v.rotulo}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* a Visão geral fica montada: trocar de visão e voltar não recarrega a lista
          inteira de leads nem perde o filtro que a pessoa tinha escolhido */}
      <div className={atual === 'geral' ? undefined : 'hidden'}>
        <TabAgenteIA resetKey={resetKey} />
      </div>
      {atual === 'ligacoes' && (
        <Suspense fallback={CARREGANDO}>
          <Ligacoes />
        </Suspense>
      )}
    </div>
  )
}
