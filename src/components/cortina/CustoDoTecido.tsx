import { Link2Off, TrendingDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { margemDoTecido, formatarMargem, sinalDaMargem, type MargemTecido } from '@/lib/catalogo/margem'
import type { CustoDeCompra } from '@/hooks/useCustoTecidoCortina'
import type { PrecoCortinaTecido } from '@/lib/precos/tipos'

/**
 * O que a loja paga pelo pano desta cortina, ao lado do que ela cobra.
 *
 * Aparece só na conta aberta — o texto do "Copiar orçamento" não é tocado,
 * porque custo é assunto interno e vai para o WhatsApp do cliente.
 *
 * Conta o TECIDO e o FORRO, que são os panos cujo consumo o motor devolve.
 * O pano do franzido atrás usa um consumo próprio que o resultado não expõe,
 * então nessas cortinas a tela avisa que o número está incompleto em vez de
 * fingir que fechou.
 */

const brl = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export interface PanoDaCortina {
  nome: string
  metros: number
  precoPorMetro: number
  custoPorMetro: number | null
  origem: CustoDeCompra | null
}

/** Tecido e forro desta cortina, com preço de venda e custo de compra. */
export function panosDaCortina(
  tecidoNome: string,
  forroNome: string | null,
  consumo: number,
  quantidade: number,
  tabela: PrecoCortinaTecido[],
  custos: Map<string, CustoDeCompra>
): PanoDaCortina[] {
  const metros = consumo * quantidade
  const nomes = forroNome ? [tecidoNome, forroNome] : [tecidoNome]

  return nomes.flatMap(nome => {
    const linha = tabela.find(t => t.nome === nome)
    if (!linha) return []
    const origem = custos.get(nome) ?? null
    return [{
      nome,
      metros,
      precoPorMetro: Number(linha.preco),
      custoPorMetro: origem?.custoPorMetro ?? null,
      origem,
    }]
  })
}

/** Soma os panos que TÊM custo. Os sem ligação ficam de fora dos dois lados. */
export function somarPanos(panos: PanoDaCortina[]): MargemTecido | null {
  const comCusto = panos.filter(p => p.custoPorMetro != null)
  if (comCusto.length === 0) return null
  const venda = comCusto.reduce((s, p) => s + p.metros * p.precoPorMetro, 0)
  const custo = comCusto.reduce((s, p) => s + p.metros * p.custoPorMetro!, 0)
  const metros = comCusto.reduce((s, p) => s + p.metros, 0)
  return margemDoTecido(metros, venda / metros, custo / metros)
}

const CORES: Record<ReturnType<typeof sinalDaMargem>, string> = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  apertada: 'text-amber-600 dark:text-amber-400',
  prejuizo: 'text-destructive',
}

export default function CustoDoTecido({
  panos,
  temFranzido,
}: {
  panos: PanoDaCortina[]
  temFranzido: boolean
}) {
  if (panos.length === 0) return null

  const semLigacao = panos.filter(p => p.custoPorMetro == null)
  const total = somarPanos(panos)

  return (
    <div className="mt-2 rounded-lg bg-muted/40 px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Custo do pano · interno
      </p>

      {panos.filter(p => p.custoPorMetro != null).map(p => {
        const m = margemDoTecido(p.metros, p.precoPorMetro, p.custoPorMetro)!
        return (
          <div key={p.nome} className="mt-1.5 text-[11px]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-foreground">{p.nome}</span>
              <span className={cn('shrink-0 font-semibold tabular-nums', CORES[sinalDaMargem(m.margem)])}>
                {formatarMargem(m.margem)}
              </span>
            </div>
            <p className="text-muted-foreground tabular-nums">
              {p.metros.toFixed(2).replace('.', ',')} m · paga {brl(m.custo)} · cobra {brl(m.venda)}
            </p>
            {p.origem && (
              <p className="text-[10px] text-muted-foreground/70">
                {p.origem.fornecedor ?? 'Sem fornecedor'}
              </p>
            )}
          </div>
        )
      })}

      {total && panos.filter(p => p.custoPorMetro != null).length > 1 && (
        <div className="mt-1.5 flex items-baseline justify-between gap-2 border-t border-border/50 pt-1.5 text-[11px] font-semibold">
          <span>Pano todo</span>
          <span className={cn('tabular-nums', CORES[sinalDaMargem(total.margem)])}>
            {brl(total.custo)} · {formatarMargem(total.margem)}
          </span>
        </div>
      )}

      {semLigacao.length > 0 && (
        <p className="mt-1.5 flex items-start gap-1 text-[10px] text-muted-foreground">
          <Link2Off className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
          <span>
            {semLigacao.map(p => p.nome).join(' e ')} sem custo — em Orçamentos → Custos → Materiais, ligue o
            {' '}tecido e marque (✓) a loja onde compra.
          </span>
        </p>
      )}

      {temFranzido && (
        <p className="mt-1 flex items-start gap-1 text-[10px] text-amber-600 dark:text-amber-400">
          <TrendingDown className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
          <span>O pano do franzido atrás não entra nesta conta — o custo real é maior.</span>
        </p>
      )}
    </div>
  )
}
