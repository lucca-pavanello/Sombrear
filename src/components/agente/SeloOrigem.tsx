import { Globe, HelpCircle, Instagram, Link2, MessageCircle, Phone, Search, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Origem do lead — de onde a pessoa veio antes de cair no WhatsApp.
 *
 * O gestor de tráfego lê esta tela pra decidir onde investir, então cada canal
 * tem cor e ícone fixos: ele bate o olho e reconhece sem ler. O laranja da
 * marca fica de fora de propósito (ver DESIGN.md: laranja é ação e seleção,
 * não categoria) — quem usa laranja aqui é só o chip selecionado no filtro.
 */
export const ORIGENS = [
  { id: 'google',    rotulo: 'Google',    icone: Search,        cor: 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300' },
  { id: 'instagram', rotulo: 'Instagram', icone: Instagram,     cor: 'border-fuchsia-500/25 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300' },
  { id: 'facebook',  rotulo: 'Facebook',  icone: Users,         cor: 'border-indigo-500/25 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300' },
  { id: 'site',      rotulo: 'Site',      icone: Globe,         cor: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300' },
  { id: 'indicacao', rotulo: 'Indicação', icone: Link2,         cor: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  { id: 'direto',    rotulo: 'Direto',    icone: MessageCircle, cor: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  // lead que nasceu de uma ligação atendida pela Amanda de voz (edge function registrar-ligacao)
  { id: 'ligacao',   rotulo: 'Ligação',   icone: Phone,         cor: 'border-teal-500/25 bg-teal-500/10 text-teal-700 dark:text-teal-300' },
] as const

/**
 * Google e Site são um canal só no dado (Lucca, 01/10/2026): quem chega pelo site veio,
 * quase sempre, de uma busca no Google, e separar os dois dividia o mesmo investimento em
 * duas linhas. Contagem, filtro e relatório usam o canal junto; a divisão entre os dois
 * aparece pequena embaixo (DivisaoGoogleSite). O selo de cada lead e o campo de editar a
 * origem continuam mostrando Google ou Site, que é o que está gravado.
 */
export const GOOGLE_SITE = {
  id: 'google_site', rotulo: 'Google + Site', icone: Search,
  cor: 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300',
} as const
const PARTES_GOOGLE_SITE: readonly string[] = ['google', 'site']

/** Os canais como aparecem nos números: Google + Site no lugar dos dois separados. */
export const CANAIS_DO_DADO = [GOOGLE_SITE, ...ORIGENS.filter(o => !PARTES_GOOGLE_SITE.includes(o.id))]

export const SEM_ORIGEM = {
  id: 'sem_origem', rotulo: 'Sem origem', icone: HelpCircle,
  cor: 'border-border bg-muted/60 text-muted-foreground',
} as const

/** Normaliza o que veio do banco: aceita 'Google', 'google_ads', 'GOOGLE ' … */
export function acharOrigem(valor: string | null | undefined) {
  const chave = (valor ?? '').toLowerCase().trim()
  // o próprio id da ausência também precisa voltar como ausência: o relatório
  // agrupa por id e reenvia 'sem_origem' pra cá
  if (!chave || chave === SEM_ORIGEM.id) return SEM_ORIGEM
  // o id do canal junto volta pra cá nos relatórios; sem isso, 'google_site' viraria Google
  if (chave === GOOGLE_SITE.id) return GOOGLE_SITE
  return ORIGENS.find(o => chave === o.id || chave.startsWith(o.id)) ?? {
    id: chave, rotulo: valor as string, icone: HelpCircle,
    cor: 'border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  }
}

/** Canal pra contar e filtrar: igual a acharOrigem, mas Google e Site viram Google + Site. */
export function acharCanal(valor: string | null | undefined) {
  const o = acharOrigem(valor)
  return PARTES_GOOGLE_SITE.includes(o.id) ? GOOGLE_SITE : o
}

/** Quantos dos itens vieram do Google e quantos do Site, pela origem gravada. */
export function contarGoogleSite<T>(itens: T[], origemDe: (item: T) => string | null | undefined) {
  let google = 0, site = 0
  for (const item of itens) {
    const id = acharOrigem(origemDe(item)).id
    if (id === 'google') google++
    else if (id === 'site') site++
  }
  return { google, site }
}

/** A divisão pequena embaixo do Google + Site: "Google 80 · Site 40". */
export function DivisaoGoogleSite({ google, site, className }: { google: number; site: number; className?: string }) {
  return (
    <span className={cn('text-[10px] font-medium tabular-nums text-muted-foreground', className)}>
      Google {google} · Site {site}
    </span>
  )
}

export default function SeloOrigem({ origem, campanha, className, compacto, neutro }: {
  origem: string | null | undefined
  /** campanha/anúncio, quando o canal informa — vira tooltip */
  campanha?: string | null
  className?: string
  /** só o ícone, pra caber em espaço curto */
  compacto?: boolean
  /** pílula neutra e só o ícone na cor do canal: em lista longa, 6 pílulas coloridas
   *  por tela competiam com o status, que é o que pede ação */
  neutro?: boolean
}) {
  const o = acharOrigem(origem)
  const Icone = o.icone
  const corIcone = o.cor.split(' ').filter(c => c.includes('text-')).join(' ')
  return (
    <span
      title={campanha ? `${o.rotulo} · ${campanha}` : o.rotulo}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        neutro ? 'border-border text-foreground/75' : o.cor, className,
      )}
    >
      <Icone className={cn('h-3 w-3 shrink-0', neutro && corIcone)} aria-hidden="true" />
      {!compacto && o.rotulo}
    </span>
  )
}
