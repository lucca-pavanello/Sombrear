/**
 * Card de um pedido na tela Acompanhar. Um pedido = um ou mais itens de
 * `orcamentos` com o mesmo `pedido_id` (soltos são pedidos de um item só).
 *
 * O card só coleta a intenção (Fechou / Não fechou / Sumiu / Voltar); quem grava,
 * atualiza o cache e oferece o "Desfazer" é a tela (TabAcompanhar). O erro de uma
 * gravação que falhou aparece AQUI, dentro do card que falhou.
 */
import { useState } from 'react'
import {
  CheckCircle2, ChevronDown, ExternalLink, MessageCircle, ThumbsDown, Undo2, UserX, X,
} from 'lucide-react'

import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/primitives'
import { CustomSelect } from '@/components/ui/CustomSelect'
import SeloOrigem, { ORIGENS } from '@/components/agente/SeloOrigem'
import { campo, rotulo } from '@/components/shared/estilos'
import { DESFECHOS, MOTIVOS_PERDA, faixaEspera } from '@/lib/desfecho'
import {
  formatarTelefone, linkWhatsApp, parseValorBR, resumoItem, type CardPedido,
} from '@/lib/acompanhar'

const CANAIS = [
  { value: '', label: 'Não sei de onde veio' },
  ...ORIGENS.map((o) => ({ value: o.id, label: o.rotulo })),
]

const CHIP_FAIXA = {
  novo: 'border-emerald-500/25 bg-emerald-500/10',
  atencao: 'border-amber-500/25 bg-amber-500/10',
  frio: 'border-rose-500/25 bg-rose-500/10',
} as const

export type DadosFechou = { origem: string; parcelas: number; cobrado: number | null }
/** O que está digitado no painel "Fechou" (texto cru), guardado pela tela caso a gravação falhe. */
export type RascunhoFechou = { origem: string; parcelas: string; cobrado: string }

type Props = {
  card: CardPedido
  vista: 'fila' | 'respondidos'
  ocupado: boolean
  erro?: string
  /** se há, o painel "Fechou" abre já preenchido com isto */
  rascunho?: RascunhoFechou
  onFechou: (card: CardPedido, dados: DadosFechou, digitado: RascunhoFechou) => void
  onNaoFechou: (card: CardPedido, motivo: string | null) => void
  onSumiu: (card: CardPedido) => void
  onVoltar: (card: CardPedido) => void
  onAbrir: (card: CardPedido) => void
  onCopiado: (telefone: string) => void
}

const dinheiroBR = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function CardPedidoAcompanhar({
  card, vista, ocupado, erro, rascunho, onFechou, onNaoFechou, onSumiu, onVoltar, onAbrir, onCopiado,
}: Props) {
  const [modo, setModo] = useState<'fechou' | 'perdido' | null>(rascunho ? 'fechou' : null)
  const [itensAbertos, setItensAbertos] = useState(false)

  const [origem, setOrigem] = useState(rascunho?.origem ?? card.origem ?? '')
  const [parcelas, setParcelas] = useState(rascunho?.parcelas ?? '')
  const [cobrado, setCobrado] = useState(rascunho?.cobrado ?? dinheiroBR(card.total))
  const [erroCampo, setErroCampo] = useState<string | null>(null)

  const faixa = faixaEspera(card.dias)
  const d = card.desfecho ? DESFECHOS[card.desfecho] : null
  const whats = linkWhatsApp(card)
  const fone = formatarTelefone(card.telefone)
  const varios = card.itens.length > 1
  // pedido com itens já respondidos (ex.: fechados pela tabela de Orçamentos): o card mostra só os que faltam
  const respondidosFora = Math.max(0, card.itensNoPedido - card.itens.length)
  const parcial = respondidosFora > 0

  function alternar(m: 'fechou' | 'perdido') {
    setErroCampo(null)
    if (m === 'fechou' && modo !== 'fechou') {
      setOrigem(card.origem ?? '')
      setParcelas('')
      setCobrado(dinheiroBR(card.total))
    }
    setModo((atual) => (atual === m ? null : m))
  }

  function confirmarFechou() {
    const texto = cobrado.trim()
    const valor = texto ? parseValorBR(texto) : null
    if (texto && valor == null) {
      setErroCampo('Não entendi esse valor. Digite assim: 1.200,50')
      return
    }
    const n = parseInt(parcelas, 10)
    setErroCampo(null)
    onFechou(card, { origem, parcelas: Number.isFinite(n) && n > 0 ? n : 0, cobrado: valor }, { origem, parcelas, cobrado })
  }

  async function copiar() {
    if (!fone) return
    try {
      await navigator.clipboard.writeText(fone)
      onCopiado(fone)
    } catch { /* sem permissão de área de transferência: o número continua visível */ }
  }

  return (
    <article className={cn('rounded-xl border border-border bg-card p-4 shadow-sm', ocupado && 'opacity-70')}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
        {/* Esquerda: quem é, há quanto tempo, o que pediu */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 truncate text-base font-bold text-foreground">{card.cliente || 'Sem nome'}</h3>
            {card.origem && <SeloOrigem origem={card.origem} compacto />}
            {d && (
              <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-semibold', d.cor)}>
                {d.curto}{card.motivo ? ` · ${card.motivo}` : ''}
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {card.responsavel && <span>{card.responsavel}</span>}
            {fone && (
              <>
                <span aria-hidden="true">·</span>
                <button type="button" onClick={copiar} title="Copiar telefone"
                  className="rounded tabular-nums hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
                  {fone}
                </button>
              </>
            )}
            {vista === 'fila' ? (
              <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums', CHIP_FAIXA[card.faixa], faixa.cor)}>
                {card.dias === 0 ? 'hoje' : `há ${card.dias} dia${card.dias > 1 ? 's' : ''}`}
              </span>
            ) : (
              <span className="tabular-nums">
                respondido em {formatDate(card.respondidoEm ?? card.criadoEm)}
              </span>
            )}
          </div>

          <div className="mt-2 text-sm text-foreground/80">
            {varios ? (
              <button type="button" onClick={() => setItensAbertos((v) => !v)} aria-expanded={itensAbertos}
                className="inline-flex items-center gap-1 rounded font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
                {card.itens.length} itens
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', itensAbertos && 'rotate-180')} aria-hidden="true" />
              </button>
            ) : (
              <p className="truncate">{resumoItem(card.itens[0])}</p>
            )}
            {varios && itensAbertos && (
              <ul className="mt-1.5 space-y-1 border-l-2 border-border pl-3 text-xs text-muted-foreground">
                {card.itens.map((o) => (
                  <li key={o.id} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate">{resumoItem(o)}</span>
                    <span className="shrink-0 tabular-nums">
                      {formatCurrency(Number(o.valor_venda ?? 0) + Number(o.instalacao ?? 0))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {card.observacoes && (
            <p className="mt-1 truncate text-xs italic text-muted-foreground" title={card.observacoes}>
              {card.observacoes}
            </p>
          )}
        </div>

        {/* Direita: valor e ações */}
        <div className="flex flex-col gap-2 lg:items-end">
          <p className="font-display text-xl font-bold tabular-nums text-foreground">{formatCurrency(card.total)}</p>

          {vista === 'fila' ? (
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <Button size="sm" onClick={() => alternar('fechou')} disabled={ocupado} aria-expanded={modo === 'fechou'}
                className="bg-emerald-600 text-white hover:bg-emerald-600/90">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Fechou
              </Button>
              <Button variant="outline" size="sm" onClick={() => alternar('perdido')} disabled={ocupado} aria-expanded={modo === 'perdido'}>
                <ThumbsDown className="h-3.5 w-3.5" aria-hidden="true" /> Não fechou
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onSumiu(card)} disabled={ocupado}>
                <UserX className="h-3.5 w-3.5" aria-hidden="true" /> Sumiu
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <Button variant="outline" size="sm" loading={ocupado} onClick={() => onVoltar(card)}>
                {!ocupado && <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />} Voltar pra fila
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1 lg:justify-end">
            {vista === 'fila' && (whats ? (
              <a href={whats} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-emerald-600 transition-colors hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 dark:text-emerald-400">
                <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" /> Cobrar no WhatsApp
              </a>
            ) : (
              <span title="Este orçamento não tem telefone" aria-disabled="true"
                className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-muted-foreground/50">
                <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" /> Sem telefone
              </span>
            ))}
            <Button variant="ghost" size="sm" onClick={() => onAbrir(card)}>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Abrir
            </Button>
          </div>
        </div>
      </div>

      {/* Painel do "Fechou" */}
      {vista === 'fila' && modo === 'fechou' && (
        <div className="mt-3 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.04] p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={rotulo}>De onde veio o cliente?</label>
              <CustomSelect className="w-full py-2" value={origem} onChange={setOrigem} options={CANAIS} />
            </div>
            <div>
              <label className={rotulo} htmlFor={`parc-${card.chave}`}>Em quantas vezes?</label>
              <input id={`parc-${card.chave}`} value={parcelas} onChange={(e) => setParcelas(e.target.value)}
                inputMode="numeric" placeholder="ex.: 6" className={campo} />
            </div>
            <div>
              <label className={rotulo} htmlFor={`pago-${card.chave}`}>
                {parcial
                  ? `Quanto o cliente pagou por ${card.itens.length === 1 ? 'este item' : `estes ${card.itens.length} itens`}?`
                  : `Quanto o cliente pagou${varios ? ' (pedido todo)' : ''}?`}
              </label>
              <input id={`pago-${card.chave}`} value={cobrado} onChange={(e) => setCobrado(e.target.value)}
                inputMode="decimal" placeholder={dinheiroBR(card.total)} className={campo} />
            </div>
          </div>
          {erroCampo
            ? <p role="alert" className="mt-2 text-xs font-medium text-destructive">{erroCampo}</p>
            : <p className="mt-2 text-[11px] text-muted-foreground">
                Já vem com o valor do orçamento. Se o cliente pagou outro valor, é só trocar.
                {varios ? ' Vale para os itens juntos e é dividido entre eles.' : ''}
                {parcial && ` Este pedido tem mais ${respondidosFora} item${respondidosFora > 1 ? 'ns' : ''} já respondido${respondidosFora > 1 ? 's' : ''}.`}
              </p>}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setModo(null)}>
              <X className="h-3.5 w-3.5" aria-hidden="true" /> Cancelar
            </Button>
            <Button size="sm" loading={ocupado} onClick={confirmarFechou}
              className="bg-emerald-600 text-white hover:bg-emerald-600/90">
              {!ocupado && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />} Confirmar venda
            </Button>
          </div>
        </div>
      )}

      {/* Painel do "Não fechou" */}
      {vista === 'fila' && modo === 'perdido' && (
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Por quê? Um toque e já registra.</p>
          <div className="flex flex-wrap gap-2">
            {MOTIVOS_PERDA.map((m) => (
              <button key={m} type="button" disabled={ocupado} onClick={() => onNaoFechou(card, m)}
                className="rounded-full border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:opacity-50">
                {m}
              </button>
            ))}
            <button type="button" disabled={ocupado} onClick={() => onNaoFechou(card, null)}
              className="rounded-full border border-dashed px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50">
              Não disse
            </button>
          </div>
        </div>
      )}

      {erro && (
        <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive">
          {erro}
        </p>
      )}
    </article>
  )
}
