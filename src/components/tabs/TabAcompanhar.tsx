/**
 * Acompanhar — a fila dos orçamentos enviados que ainda não tiveram resposta.
 *
 * Esta é a tela que faltava pro dash contar a verdade. Todo o resto mede
 * orçamento gerado; aqui se registra o que aconteceu depois, em um toque:
 * Fechou, Não fechou ou Sumiu. Só "Fechou" pede mais alguma coisa (canal e
 * pagamento), porque é o único que vira dinheiro no Semanário.
 *
 * A unidade é o PEDIDO (itens com o mesmo `pedido_id` = um card). Os dados
 * chegam do Dashboard já filtrados pelo Modo Foco; aqui não há segundo
 * `useOrcamentos` (cada um abre um canal realtime). Toda ação atualiza o cache
 * do React Query na hora, grava em segundo plano e oferece "Desfazer"; se a
 * gravação falha, volta ao que era e o erro aparece dentro do card.
 *
 * Regra de ouro da tela: marcar tem que ser mais rápido do que ignorar.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Clock, Search, UserX, Wallet, type LucideIcon } from 'lucide-react'

import { cn, formatCurrency } from '@/lib/utils'
import { supabase, type Orcamento } from '@/lib/supabase'
import type { ToastType } from '@/hooks/useToast'
import { Button } from '@/components/ui/primitives'
import { CustomSelect } from '@/components/ui/CustomSelect'
import EmptyState from '@/components/shared/EmptyState'
import AvisoErro from '@/components/shared/AvisoErro'
import { campoBusca, kpi, segmentado } from '@/components/shared/estilos'
import JanelaDados from '@/components/orcamentos/JanelaDados'
import EditOrcamentoForm from '@/components/orcamentos/EditOrcamentoForm'
import CardPedidoAcompanhar, { type DadosFechou } from '@/components/acompanhar/CardPedido'
import {
  agrupar, contarFaixas, escritaVoltar, escritasFechou, escritasNaoFechou, escritasSumiu,
  filtrar, ordenar, resumir, valoresAnteriores,
  type CardPedido, type Escrita, type FaixaId, type Ordem, type Vista,
} from '@/lib/acompanhar'

type ToastFn = (type: ToastType, message: string, opts?: { duration?: number; undoAction?: () => void }) => void

const POR_PAGINA = 20

const ORDENS: { value: Ordem; label: string }[] = [
  { value: 'recentes', label: 'Mais recentes' },
  { value: 'valor', label: 'Maior valor' },
  { value: 'antigos', label: 'Mais antigos' },
]

export default function TabAcompanhar({ data, loading, error, onRefetch, toast, focoResponsavel }: {
  /** orçamentos já filtrados pelo Modo Foco */
  data: Orcamento[]
  loading: boolean
  error: boolean
  onRefetch: () => void
  toast: ToastFn
  focoResponsavel: string | null
}) {
  const qc = useQueryClient()

  const [faixa, setFaixa] = useState<FaixaId>('novo')
  const [busca, setBusca] = useState('')
  const [responsavel, setResponsavel] = useState('')
  const [ordem, setOrdem] = useState<Ordem>('recentes')
  const [vista, setVista] = useState<Vista>('fila')
  const [limite, setLimite] = useState(POR_PAGINA)
  const [salvando, setSalvando] = useState<Set<string>>(new Set())
  const [erros, setErros] = useState<Record<string, string>>({})
  const [editando, setEditando] = useState<Orcamento | null>(null)

  // linhas atuais por id (o undo e o rollback precisam do valor de ANTES)
  const porId = useRef(new Map<string, Orcamento>())
  porId.current = new Map(data.map((o) => [o.id, o]))
  // o que o "Fechou" desta tela gravou, pra "Voltar pra fila" saber o que pode limpar
  const gravadoAqui = useRef(new Map<string, { valor_cobrado?: number | null; forma_pagamento_real?: string | null }>())

  useEffect(() => { setLimite(POR_PAGINA) }, [faixa, busca, responsavel, ordem, vista])
  // trocar de responsável no Modo Foco não pode deixar um filtro antigo escondido
  useEffect(() => { if (focoResponsavel) setResponsavel('') }, [focoResponsavel])

  const fila = useMemo(() => agrupar(data, 'fila'), [data])
  const respondidos = useMemo(() => agrupar(data, 'respondidos'), [data])
  const resumo = useMemo(() => resumir(fila), [fila])

  const responsaveis = useMemo(
    () => [...new Set([...fila, ...respondidos].map((c) => c.responsavel))].filter(Boolean).sort(),
    [fila, respondidos])

  const base = vista === 'fila' ? fila : respondidos
  const semFaixa = useMemo(
    () => filtrar(base, { busca, responsavel: focoResponsavel ? '' : responsavel }),
    [base, busca, responsavel, focoResponsavel])
  const contagem = useMemo(() => contarFaixas(semFaixa), [semFaixa])
  const lista = useMemo(
    () => ordenar(vista === 'fila' ? filtrar(semFaixa, { faixa }) : semFaixa, ordem, vista),
    [semFaixa, faixa, ordem, vista])

  /* ── cache e gravação ─────────────────────────────────────────────────── */

  function aplicarNoCache(escritas: Escrita[]) {
    const mapa = new Map(escritas.map((e) => [e.id, e.patch]))
    qc.setQueriesData<Orcamento[]>({ queryKey: ['orcamentos'] }, (antigo) =>
      Array.isArray(antigo) ? antigo.map((o) => (mapa.has(o.id) ? { ...o, ...mapa.get(o.id) } : o)) : antigo)
  }

  async function gravar(e: Escrita) {
    const { data: linhas, error: erro } = await supabase.from('orcamentos').update(e.patch).eq('id', e.id).select('id')
    if (erro) throw erro
    if (!linhas || linhas.length === 0) throw new Error('Sem permissão para alterar este orçamento.')
  }

  function marcarSalvando(chave: string, ligado: boolean) {
    setSalvando((s) => { const n = new Set(s); if (ligado) n.add(chave); else n.delete(chave); return n })
  }

  function limparErro(chave: string) {
    setErros((e) => { if (!(chave in e)) return e; const { [chave]: _, ...resto } = e; return resto })
  }

  async function desfazer(anteriores: Escrita[]) {
    aplicarNoCache(anteriores)
    const r = await Promise.allSettled(anteriores.map(gravar))
    if (r.some((x) => x.status === 'rejected')) toast('error', 'Não consegui desfazer tudo. Confira o orçamento.')
    void qc.invalidateQueries({ queryKey: ['orcamentos'] })
  }

  /** Aplica as escritas na hora, grava em segundo plano e devolve o Desfazer no toast. */
  async function executar(card: CardPedido, escritas: Escrita[], mensagem: string) {
    const anteriores: Escrita[] = escritas.map((e) => {
      const atual = porId.current.get(e.id)
      return { id: e.id, patch: atual ? valoresAnteriores(atual, e.patch) : {} }
    })
    limparErro(card.chave)
    marcarSalvando(card.chave, true)
    aplicarNoCache(escritas)
    try {
      const r = await Promise.allSettled(escritas.map(gravar))
      const falha = r.find((x): x is PromiseRejectedResult => x.status === 'rejected')
      if (falha) {
        // desfaz o que chegou a gravar, pra não ficar pedido pela metade
        await Promise.allSettled(anteriores.map(gravar))
        throw falha.reason
      }
      toast('success', mensagem, { duration: 7000, undoAction: () => { void desfazer(anteriores) } })
    } catch (e) {
      aplicarNoCache(anteriores)
      const msg = e instanceof Error && e.message ? e.message : 'Erro desconhecido'
      setErros((x) => ({ ...x, [card.chave]: `Não consegui salvar (${msg}). Nada foi alterado; tente de novo.` }))
    } finally {
      marcarSalvando(card.chave, false)
      void qc.invalidateQueries({ queryKey: ['orcamentos'] })
    }
  }

  async function email() {
    const { data: sess } = await supabase.auth.getSession()
    return sess.session?.user?.email ?? null
  }

  const nome = (c: CardPedido) => c.cliente || 'Orçamento'

  async function aoFechar(card: CardPedido, dados: DadosFechou) {
    const escritas = escritasFechou(card.itens, dados, await email())
    escritas.forEach((e) => gravadoAqui.current.set(e.id, {
      valor_cobrado: e.patch.valor_cobrado ?? null,
      forma_pagamento_real: e.patch.forma_pagamento_real ?? null,
    }))
    await executar(card, escritas, `${nome(card)} — venda registrada`)
  }

  async function aoNaoFechar(card: CardPedido, motivo: string | null) {
    await executar(card, escritasNaoFechou(card.itens, motivo, await email()), `${nome(card)} — marcado como não fechou`)
  }

  async function aoSumir(card: CardPedido) {
    await executar(card, escritasSumiu(card.itens, await email()), `${nome(card)} — marcado como sumiu`)
  }

  async function aoVoltar(card: CardPedido) {
    const escritas = card.itens.map((o) => ({ id: o.id, patch: escritaVoltar(o, gravadoAqui.current.get(o.id)) }))
    await executar(card, escritas, `${nome(card)} — voltou pra fila`)
  }

  function irParaFaixa(f: FaixaId) {
    setVista('fila')
    setFaixa(f)
  }

  const faixasUi: { id: FaixaId; rotulo: string }[] = [
    { id: 'novo', rotulo: 'Novos (até 7 dias)' },
    { id: 'atencao', rotulo: '8 a 30 dias' },
    { id: 'frio', rotulo: 'Mais de 30 dias' },
    { id: 'todos', rotulo: 'Todos' },
  ]

  const visiveis = lista.slice(0, limite)
  const restantes = lista.length - visiveis.length
  const temFiltro = busca.trim() !== '' || (!focoResponsavel && responsavel !== '')

  return (
    <>
      {/* Cabeçalho */}
      <div className="mb-6 text-center">
        <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Acompanhar</h2>
        <p className="mt-0.5 text-sm text-foreground/50">
          Orçamentos enviados que ainda não tiveram resposta. Cobre o cliente e registre o resultado.
        </p>
      </div>

      {/* Resumo — cada cartão também é um filtro */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <CartaoResumo icone={Clock} rotulo="Esperando resposta" valor={String(resumo.fila)}
          ativo={vista === 'fila' && faixa === 'todos'} onClick={() => irParaFaixa('todos')} />
        <CartaoResumo icone={Wallet} rotulo="Valor parado" valor={formatCurrency(resumo.parado)}
          ativo={false} onClick={() => irParaFaixa('todos')} />
        <CartaoResumo icone={UserX} rotulo="Há mais de 30 dias" valor={String(resumo.frios)}
          alerta={resumo.frios > 0} ativo={vista === 'fila' && faixa === 'frio'} onClick={() => irParaFaixa('frio')} />
      </div>

      {/* Barra de ferramentas */}
      <div className="mb-4 space-y-3">
        {vista === 'fila' && (
          <div className="overflow-x-auto">
            <div className={cn(segmentado.trilho, 'w-fit')} role="tablist" aria-label="Tempo de espera">
              {faixasUi.map((f) => (
                <button key={f.id} type="button" role="tab" aria-selected={faixa === f.id}
                  onClick={() => setFaixa(f.id)}
                  className={cn(segmentado.item, faixa === f.id ? segmentado.ativo : segmentado.inativo)}>
                  {f.rotulo} <span className="ml-1 tabular-nums opacity-70">{contagem[f.id]}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-0 flex-1 sm:min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" aria-hidden="true" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} className={campoBusca}
              placeholder="Buscar cliente, telefone, modelo ou tecido…" aria-label="Buscar" />
          </div>
          {!focoResponsavel && responsaveis.length > 1 && (
            <CustomSelect className="w-full sm:w-48" value={responsavel} onChange={setResponsavel}
              options={[{ value: '', label: 'Todos os responsáveis' }, ...responsaveis.map((r) => ({ value: r, label: r }))]} />
          )}
          <CustomSelect className="w-full sm:w-44" value={ordem} onChange={(v) => setOrdem(v as Ordem)} options={ORDENS} />
          <Button variant={vista === 'respondidos' ? 'primary' : 'outline'} size="md"
            onClick={() => setVista((v) => (v === 'fila' ? 'respondidos' : 'fila'))}>
            {vista === 'respondidos' ? 'Ver a fila' : `Já respondidos (${respondidos.length})`}
          </Button>
        </div>
      </div>

      {/* Lista */}
      {error ? (
        <AvisoErro mensagem="Não consegui carregar os orçamentos." aoTentar={onRefetch} />
      ) : loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : lista.length === 0 ? (
        vista === 'respondidos' ? (
          <EmptyState icon={CheckCircle2}
            title={temFiltro ? 'Nenhum resultado' : 'Nada respondido ainda'}
            description={temFiltro ? 'Nenhum pedido respondido combina com a busca.' : 'Marque um orçamento na fila e ele aparece aqui.'}
            action={temFiltro ? { label: 'Limpar busca', onClick: () => { setBusca(''); setResponsavel('') } } : undefined} />
        ) : temFiltro ? (
          <EmptyState icon={Search} title="Nenhum resultado"
            description="Nenhum orçamento da fila combina com a busca."
            action={{ label: 'Limpar busca', onClick: () => { setBusca(''); setResponsavel('') } }} />
        ) : fila.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Fila vazia: tudo respondido"
            description="Cada orçamento novo entra aqui esperando o resultado." />
        ) : (
          <EmptyState icon={CheckCircle2} title="Nenhum orçamento esperando nesta faixa"
            description={`Ainda há ${fila.length} na fila em outras faixas.`}
            action={{ label: 'Ver todos', onClick: () => setFaixa('todos') }} />
        )
      ) : (
        <div className="space-y-3">
          {visiveis.map((c) => (
            <CardPedidoAcompanhar
              key={c.chave}
              card={c}
              vista={vista}
              ocupado={salvando.has(c.chave)}
              erro={erros[c.chave]}
              onFechou={aoFechar}
              onNaoFechou={aoNaoFechar}
              onSumiu={aoSumir}
              onVoltar={aoVoltar}
              onAbrir={(card) => setEditando(card.itens[0])}
              onCopiado={(t) => toast('success', `Telefone ${t} copiado`, { duration: 2000 })}
            />
          ))}
          {restantes > 0 && (
            <div className="flex justify-center pt-1">
              <Button variant="outline" onClick={() => setLimite((l) => l + POR_PAGINA)}>
                Mostrar mais ({restantes} restantes)
              </Button>
            </div>
          )}
        </div>
      )}

      <JanelaDados className="mt-6" />

      {editando && (
        <EditOrcamentoForm orcamento={editando} onClose={() => setEditando(null)} toast={toast} />
      )}
    </>
  )
}

function CartaoResumo({ icone: Icone, rotulo, valor, alerta, ativo, onClick }: {
  icone: LucideIcon
  rotulo: string
  valor: string
  alerta?: boolean
  ativo: boolean
  onClick: () => void
}) {
  const tom = alerta ? 'amber' : 'neutro'
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo}
      className={cn(
        kpi.cartao, kpi.acento[tom], 'flex w-full flex-col items-center text-center',
        'hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        ativo && 'border-primary/50 ring-1 ring-primary/20',
      )}>
      <span className={cn(kpi.chip, kpi.chipCor[tom])}><Icone className="h-4 w-4" aria-hidden="true" /></span>
      <span className={kpi.rotulo}>{rotulo}</span>
      <span className={cn(kpi.valor, kpi.valorCor[tom])}>{valor}</span>
    </button>
  )
}
