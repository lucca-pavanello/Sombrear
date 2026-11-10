import { Suspense, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { lazyComRecarga } from '@/lib/lazyComRecarga'
import { cn } from '@/lib/utils'
import { segmentado } from '@/components/shared/estilos'

const TabSimulador = lazyComRecarga(() => import('@/components/tabs/TabSimulador'))
const TabCotacao   = lazyComRecarga(() => import('@/components/tabs/TabCotacao'))

/**
 * Orçamentos › Calcular: as duas formas de calcular num lugar só.
 *  - Preço na hora (antigo Simulador): conta na tela, para o balcão.
 *  - Orçamento completo (antigo Calcular): vários ambientes, vai pro n8n e pode ir no WhatsApp.
 *
 * O modo mora na URL (`?modo=na-hora|completo`). Cada lado só monta quando é
 * visitado e depois fica montado (escondido), para não perder o que foi digitado
 * ao alternar.
 */

type Modo = 'na-hora' | 'completo'

const MODOS: { id: Modo; rotulo: string; ajuda: string }[] = [
  { id: 'na-hora',  rotulo: 'Preço na hora',      ajuda: 'Calcula na tela, na hora — pensado para o balcão.' },
  { id: 'completo', rotulo: 'Orçamento completo', ajuda: 'Vários ambientes: envia para cálculo e pode mandar o orçamento no WhatsApp.' },
]

export default function TabCalcular() {
  const [searchParams, setSearchParams] = useSearchParams()
  const modo: Modo = searchParams.get('modo') === 'na-hora' ? 'na-hora' : 'completo'
  const [visitados, setVisitados] = useState<Set<Modo>>(() => new Set([modo]))

  // visitar um modo (pelo seletor ou direto pela URL) o mantém montado
  if (!visitados.has(modo)) setVisitados(prev => new Set([...prev, modo]))

  function trocar(novo: Modo) {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev)
      p.set('modo', novo)
      return p
    }, { replace: true })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5 text-center">
        <div className={cn(segmentado.trilho, 'mx-auto w-fit')}>
          {MODOS.map(({ id, rotulo }) => (
            <button key={id} onClick={() => trocar(id)} aria-pressed={modo === id}
              className={cn(segmentado.item, modo === id ? segmentado.ativo : segmentado.inativo)}>
              {rotulo}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{MODOS.find(m => m.id === modo)?.ajuda}</p>
      </div>

      {visitados.has('na-hora') && (
        <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted/40" />}>
          <div className={modo === 'na-hora' ? undefined : 'tab-hidden'}>
            <TabSimulador />
          </div>
        </Suspense>
      )}
      {visitados.has('completo') && (
        <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted/40" />}>
          <div className={modo === 'completo' ? undefined : 'tab-hidden'}>
            <TabCotacao />
          </div>
        </Suspense>
      )}
    </div>
  )
}
