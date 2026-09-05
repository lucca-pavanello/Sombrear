import { useMemo } from 'react'
import { ArrowDown, ArrowUp, Sparkles, TrendingUp } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import { tbl } from './shared/tableStyles'
import { useMlTendencias, useMlAnuncios } from '@/hooks/useMlSemanal'
import { compararTendencias, lerAnuncio, semanas, EXPLICACAO, type Diagnostico } from '@/lib/mlSemanal'

/**
 * A leitura de domingo: o que o mercado procurou e como os nossos anúncios foram.
 *
 * Os números vêm do workflow `Sombrear | ML semanal`, que grava um retrato por semana.
 * O card só compara duas semanas e diz o que mudou — a coleta acontece mesmo quando
 * ninguém abre o dash, que é o que permite comparar meses depois.
 *
 * Enquanto houver uma semana só, o card mostra o retrato e diz que ainda não há com o que
 * comparar. Uma comparação inventada contra o vazio é pior que a ausência dela.
 */

const CORTE_LISTA = 5

const TOM: Record<Diagnostico, string> = {
  fora_do_ar: 'text-muted-foreground',
  vendeu: 'text-emerald-600 dark:text-emerald-400',
  perguntaram_e_nao_compraram: 'text-amber-600 dark:text-amber-400',
  viram_e_nao_perguntaram: 'text-amber-600 dark:text-amber-400',
  ninguem_viu: 'text-red-600 dark:text-red-400',
  pouco_movimento: 'text-muted-foreground',
}

const ROTULO: Record<Diagnostico, string> = {
  fora_do_ar: 'Fora do ar',
  vendeu: 'Vendeu',
  perguntaram_e_nao_compraram: 'Perguntaram, não compraram',
  viram_e_nao_perguntaram: 'Viram, não perguntaram',
  ninguem_viu: 'Ninguém viu',
  pouco_movimento: 'Pouco movimento',
}

function dataCurta(iso: string): string {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a.slice(2)}`
}

export default function MlSemanaCard() {
  const { data: tendencias = [], isLoading: carregandoT } = useMlTendencias()
  const { data: anuncios = [], isLoading: carregandoA } = useMlAnuncios()

  const leitura = useMemo(() => {
    const todas = semanas([...tendencias, ...anuncios])
    const [atual, anterior] = todas
    if (!atual) return null

    return {
      atual,
      anterior: anterior ?? null,
      mercado: compararTendencias(
        tendencias.filter(t => t.semana === atual),
        anterior ? tendencias.filter(t => t.semana === anterior) : [],
      ),
      topo: tendencias.filter(t => t.semana === atual).slice(0, CORTE_LISTA),
      nossos: anuncios
        .filter(a => a.semana === atual)
        .map(a => {
          const antes = anterior ? anuncios.find(x => x.semana === anterior && x.ml_item_id === a.ml_item_id) : undefined
          return { ...a, diagnostico: lerAnuncio(a), visitasAntes: antes?.visitas ?? null }
        }),
    }
  }, [tendencias, anuncios])

  if (carregandoT || carregandoA) return null

  if (!leitura) {
    return (
      <div className={cn(tbl.container, 'px-5 py-4')}>
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="font-display text-sm font-semibold">A leitura de domingo</span>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          A coleta roda todo domingo às 7h e ainda não gravou nenhuma semana. Assim que rodar, aqui
          aparecem as buscas que subiram no Mercado Livre e como cada anúncio nosso foi.
        </p>
      </div>
    )
  }

  const { mercado, nossos, topo, atual, anterior } = leitura
  const primeiraSemana = !anterior

  return (
    <div className={cn(tbl.container, 'px-5 py-4')}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="flex items-center gap-2 font-display text-sm font-semibold">
          <TrendingUp className="h-4 w-4 text-primary" />
          A leitura de {dataCurta(atual)}
        </span>
        <span className="text-xs text-muted-foreground">
          {primeiraSemana
            ? '— primeira semana medida, ainda sem comparação'
            : `— comparada com ${dataCurta(anterior)}`}
        </span>
      </div>

      <div className="mt-4 grid gap-5 md:grid-cols-2">
        {/* ── o mercado ─────────────────────────────────────────────── */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">O que procuraram</h4>

          {primeiraSemana ? (
            <ol className="mt-2 space-y-1 text-sm">
              {topo.map(t => (
                <li key={t.keyword} className="flex gap-2">
                  <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">{t.posicao}.</span>
                  <span>{t.keyword}</span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="mt-2 space-y-3">
              {mercado.subiram.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {mercado.subiram.slice(0, CORTE_LISTA).map(m => (
                    <li key={m.keyword} className="flex items-baseline gap-1.5">
                      <ArrowUp className="h-3 w-3 shrink-0 translate-y-0.5 text-emerald-600 dark:text-emerald-400" />
                      <span>{m.keyword}</span>
                      <span className="text-xs text-muted-foreground">
                        {m.anterior}º → {m.posicao}º
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {mercado.entraram.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {mercado.entraram.slice(0, CORTE_LISTA).map(m => (
                    <li key={m.keyword} className="flex items-baseline gap-1.5">
                      <Sparkles className="h-3 w-3 shrink-0 translate-y-0.5 text-primary" />
                      <span>{m.keyword}</span>
                      <span className="text-xs text-muted-foreground">entrou em {m.posicao}º</span>
                    </li>
                  ))}
                </ul>
              )}

              {mercado.cairam.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {mercado.cairam.slice(0, CORTE_LISTA).map(m => (
                    <li key={m.keyword} className="flex items-baseline gap-1.5">
                      <ArrowDown className="h-3 w-3 shrink-0 translate-y-0.5 text-muted-foreground" />
                      <span className="text-muted-foreground">{m.keyword}</span>
                      <span className="text-xs text-muted-foreground">
                        {m.anterior}º → {m.posicao}º
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {mercado.subiram.length === 0 && mercado.entraram.length === 0 && mercado.cairam.length === 0 && (
                <p className="text-xs text-muted-foreground">O ranking não mudou de uma semana pra outra.</p>
              )}
            </div>
          )}
        </div>

        {/* ── os nossos ─────────────────────────────────────────────── */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Como foram os nossos</h4>

          {nossos.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Nenhum anúncio publicado ainda. Assim que o primeiro subir, ele aparece aqui com visitas,
              perguntas e vendas da semana.
            </p>
          ) : (
            <ul className="mt-2 space-y-2.5">
              {nossos.map(a => (
                <li key={a.ml_item_id} className="text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate" title={a.titulo ?? a.ml_item_id}>
                      {a.titulo ?? a.ml_item_id}
                    </span>
                    {a.preco != null && (
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatCurrency(a.preco)}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-xs">
                    <span className={cn('font-medium', TOM[a.diagnostico])}>{ROTULO[a.diagnostico]}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {a.visitas ?? 0} visita{(a.visitas ?? 0) === 1 ? '' : 's'}
                      {a.visitasAntes != null && ` (era ${a.visitasAntes})`}
                      {' · '}
                      {a.perguntas ?? 0} pergunta{(a.perguntas ?? 0) === 1 ? '' : 's'}
                      {' · '}
                      {a.vendidos ?? 0} venda{(a.vendidos ?? 0) === 1 ? '' : 's'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                    {EXPLICACAO[a.diagnostico]}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
