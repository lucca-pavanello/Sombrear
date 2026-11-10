/**
 * Análise — o painel de inteligência comercial.
 *
 * O que esta aba era até 09/2026: dez blocos empilhados sobre a calculadora (uso, hora
 * de pico, heatmap de 365 dias, uma regressão linear vendida como previsão), sem filtro
 * de período e com uma definição de receita que divergia da aba irmã "Por canal" — as
 * duas mostravam faturamentos diferentes para o mesmo mês.
 *
 * O que é agora: uma leitura de cima para baixo, uma pergunta por seção, apoiada no dado
 * que a loja realmente tem em volume — as conversas que a Amanda lê e etiqueta. A
 * operação continua disponível, recolhida no fim.
 *
 * Duas regras de honestidade mandam no arquivo:
 *  - toda seção mostra de onde vem o número (a cobertura), porque metade dos campos do
 *    CRM está vazia e um painel que esconde isso decide errado com número certo;
 *  - a comparação com o período anterior é pro-rata: 22 dias de setembro contra agosto
 *    inteiro daria "-68%", que é calendário, não queda.
 */
import { useMemo, useState } from 'react'
import { ChevronRight, FileDown, Users } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import type { Orcamento } from '@/lib/supabase'
import { useCrmLeads, mapaLeadsPorTelefone, acharLeadPorTelefone, normalizarTelefone } from '@/hooks/useAgenteIA'
import { useScrollReveal } from '@/hooks/useScrollReveal'
import { intervaloAtual, periodoAnterior, rotuloAnterior, variacaoPct } from '@/lib/periodos'
import {
  baseObjecoes, rankearObjecoes, coberturaIA, sensibilidadePreco,
  calcularFunil, demandaVsReceita, termometro, analiseDeCanal,
  resumoDinheiro, receitaPorMes, rentabilidadePorModelo, destaqueDeCanal,
  manchete as montarManchete, observacoes as montarObservacoes,
} from '@/lib/analises'
import { CustomSelect } from '@/components/ui/CustomSelect'
import DatePicker from '@/components/ui/DatePicker'
import { Button } from '@/components/ui/primitives'
import JanelaDados from '@/components/orcamentos/JanelaDados'
import AvisoErro from '@/components/shared/AvisoErro'
import TabOrcamentos from '@/components/tabs/TabOrcamentos'
import { cn } from '@/lib/utils'
import { kpi } from '@/components/shared/estilos'


import Abertura from '@/components/analises/Abertura'
import FunilPeriodo from '@/components/analises/FunilPeriodo'
import CoberturaIABanner from '@/components/analises/CoberturaIA'
import ParedeObjecoes from '@/components/analises/ParedeObjecoes'
import DemandaProdutos from '@/components/analises/DemandaProdutos'
import TermometroLeads from '@/components/analises/TermometroLeads'
import CanalHonesto from '@/components/analises/CanalHonesto'
import BlocoDinheiro from '@/components/analises/BlocoDinheiro'
import BlocoOperacional from '@/components/analises/operacional/BlocoOperacional'
import { exportarPdf } from '@/components/analises/exportarPdf'

interface Props {
  data: Orcamento[]
  isLoading?: boolean
  error?: boolean
  resetKey?: number
  /** vendedor em foco no Dashboard — os orçamentos vêm filtrados por ele, as conversas não */
  focoResponsavel?: string
}

const PERIODOS = [
  { value: 'mes', label: 'Este mês' },
  { value: 'mes_passado', label: 'Mês passado' },
  { value: '90d', label: 'Últimos 90 dias' },
  { value: 'ano', label: 'Este ano' },
  { value: 'todos', label: 'Tudo' },
  { value: 'custom', label: 'Escolher datas' },
]

/** Conversa → orçamento: a única conversão cujos dois lados vivem no CRM. */
const taxa = (f: { etapas: { valor: number }[] }) =>
  f.etapas[0].valor > 0 ? (f.etapas[1].valor / f.etapas[0].valor) * 100 : 0

/** Só faz sentido recortar o anterior quando o atual ainda está correndo. */
const PERIODOS_EM_CURSO = new Set(['mes', 'ano'])

/**
 * Esqueleto com a forma e a ordem reais do conteúdo abaixo do filtro: Destaque, os quatro
 * números, a manchete e as seções. Antes ele desenhava uma barra de filtro falsa e caixas
 * de altura chutada, e o cabeçalho sumia enquanto carregava.
 */
function EsqueletoAnalises() {
  const linha = (fonte: string, largura: string) => (
    <span className={cn('flex h-[1lh] items-center', fonte)}><span className={cn('h-[0.7em] rounded skeleton-shimmer', largura)} /></span>
  )
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Carregando a análise">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 rounded-xl border border-border bg-card p-5 shadow-sm lg:grid-cols-[1.15fr_1fr] lg:gap-6 lg:p-6">
          <div className="flex flex-col items-center lg:items-start">
            {linha('text-[11px]', 'w-40')}
            <span className="mt-1 flex h-[1lh] items-center text-4xl leading-none sm:text-5xl"><span className="h-[0.8em] w-56 rounded skeleton-shimmer" /></span>
            {linha('mt-2 text-[11px]', 'w-28')}
          </div>
          <div className="border-t border-border/60 pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            {linha('text-lg leading-snug', 'w-3/4')}
            <div className="mt-3 space-y-2.5">
              {[0, 1].map(i => (
                <div key={i}>
                  {linha('text-base', i ? 'w-40' : 'w-24')}
                  <div className="mt-1 h-2.5 rounded-full skeleton-shimmer" />
                </div>
              ))}
            </div>
            <div className="mt-2.5">
              {linha('text-[11px] leading-relaxed', 'w-full')}
              {linha('text-[11px] leading-relaxed', 'w-2/3')}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={cn(kpi.cartao, kpi.acento.neutro, 'flex flex-col items-center gap-0.5 text-center')}>
              <span className={cn(kpi.chip, 'h-7 w-7 skeleton-shimmer')} />
              {linha(kpi.rotulo, 'w-20')}
              <span className={cn(kpi.valor, 'flex h-[1lh] items-center')}><span className="h-[0.8em] w-16 rounded skeleton-shimmer" /></span>
              <div className="min-h-[22px] w-full">{linha(kpi.sub, 'mx-auto w-14')}</div>
            </div>
          ))}
        </div>
        <div className="mx-auto flex max-w-3xl flex-col items-center">
          {linha('text-sm', 'w-2/3')}
          {linha('text-sm sm:hidden', 'w-1/2')}
        </div>
        <div className="mx-auto max-w-3xl space-y-1.5">
          {[0, 1, 2].map(i => (
            <div key={i}>
              {linha('text-sm', i === 1 ? 'w-3/4' : 'w-5/6')}
              {linha('text-sm sm:hidden', 'w-1/2')}
            </div>
          ))}
        </div>
      </div>
      {[0, 1, 2].map(i => (
        <div key={i}>
          {linha('text-sm', 'w-40')}
          {linha('mt-1 text-xs', 'w-56')}
          <div className="mt-3 h-56 rounded-xl border border-border bg-card shadow-sm" />
        </div>
      ))}
    </div>
  )
}

export default function TabAnalises({ data, isLoading, error, resetKey, focoResponsavel }: Props) {
  const { data: leads = [], isPending: carregandoLeads, isError: erroLeads, refetch: releLeads } = useCrmLeads()
  const qc = useQueryClient()

  const [periodo, setPeriodo] = useState('mes')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [baixando, setBaixando] = useState(false)

  // Rules of Hooks: TUDO antes dos early returns. A versão anterior chamava
  // `useScrollReveal` depois dos returns de loading e erro, então a contagem de hooks
  // mudava entre renders — quebra latente que só não aparecia porque a aba costuma
  // montar com os dados já em cache.
  const prorata = PERIODOS_EM_CURSO.has(periodo)
  const faixaAtual = useMemo(() => intervaloAtual(periodo, de, ate), [periodo, de, ate])
  const faixaAnterior = useMemo(
    () => periodoAnterior(periodo, de, ate, new Date(), prorata),
    [periodo, de, ate, prorata],
  )

  const mapaTel = useMemo(() => mapaLeadsPorTelefone(leads), [leads])

  const calc = useMemo(() => {
    const base = baseObjecoes(leads, faixaAtual, faixaAnterior)
    const baseAnterior = baseObjecoes(leads, faixaAnterior, null)

    const funil = calcularFunil(leads, data, faixaAtual, mapaTel, normalizarTelefone)
    const dinheiro = resumoDinheiro(data, faixaAtual)

    // Sem faixa anterior não há comparação — e "faixa nula" significa TUDO nas funções
    // de cálculo, então passá-la adiante compararia o período com o histórico inteiro e
    // devolveria 0% em vez de "sem base de comparação". Acontece em "Tudo" e em
    // "Escolher datas" sem as duas pontas preenchidas.
    const anterior = faixaAnterior
      ? {
          funil: calcularFunil(leads, data, faixaAnterior, mapaTel, normalizarTelefone),
          dinheiro: resumoDinheiro(data, faixaAnterior),
        }
      : null

    // telefones que já viraram pedido — o termômetro usa pra não cobrar quem já comprou
    const telefonesComVenda = new Set(
      data.filter((o) => o.fechado === true && o.telefone).map((o) => normalizarTelefone(o.telefone)),
    )

    const demanda = demandaVsReceita(base.analisadas, data, faixaAtual)
    const objecoes = rankearObjecoes(base)
    const canais = analiseDeCanal(leads, data, faixaAtual, (tel) => acharLeadPorTelefone(mapaTel, tel))

    return {
      base,
      funil,
      dinheiro,
      objecoes,
      demanda,
      cobertura: coberturaIA(leads, base),
      sensibilidade: sensibilidadePreco(base),
      termo: termometro(leads, faixaAtual, (l) => {
        const tel = normalizarTelefone(l.whatsapp ?? l.identificador_usuario)
        return !!tel && telefonesComVenda.has(tel)
      }),
      canais,
      destaqueCanal: destaqueDeCanal(canais),
      porMes: receitaPorMes(data),
      porModelo: rentabilidadePorModelo(data, faixaAtual),
      deltas: {
        receita: anterior ? variacaoPct(dinheiro.receita, anterior.dinheiro.receita) : null,
        pedidos: anterior ? variacaoPct(dinheiro.pedidos, anterior.dinheiro.pedidos) : null,
        ticket: anterior ? variacaoPct(dinheiro.ticketPorPedido ?? 0, anterior.dinheiro.ticketPorPedido ?? 0) : null,
        taxaOrcamento: anterior ? variacaoPct(taxa(funil), taxa(anterior.funil)) : null,
      },
      observacoes: montarObservacoes(objecoes, demanda.linhas, dinheiro, base.analisadas.length),
      naoAnalisadoAnterior: baseAnterior.analisadas.length === 0,
    }
  }, [leads, data, faixaAtual, faixaAnterior, mapaTel])

  const rotuloPeriodo = PERIODOS.find((p) => p.value === periodo)?.label ?? ''
  const manchete = useMemo(
    () => montarManchete(rotuloPeriodo, calc.funil, calc.dinheiro),
    [rotuloPeriodo, calc],
  )
  const rotuloComparacao = rotuloAnterior(periodo, prorata)

  const containerRef = useScrollReveal([data, leads, periodo])

  async function baixarPdf() {
    setBaixando(true)
    try {
      await exportarPdf({
        rotuloPeriodo, manchete,
        funil: calc.funil, dinheiro: calc.dinheiro,
        objecoes: calc.objecoes, analisadas: calc.base.analisadas.length,
        demanda: calc.demanda.linhas, canais: calc.canais, porModelo: calc.porModelo,
      })
    } finally {
      setBaixando(false)
    }
  }

  // Os quatro estados (DESIGN.md + padrão TECPAV/Garimpo): cabeçalho e filtro ficam de pé
  // em todos. Carregando mostra a forma real; sem dado lido, só o erro (nunca zeros); com
  // dado velho em cache e erro na releitura, o aviso vai por cima do dado.
  const carregando = isLoading || carregandoLeads
  const semOrcamentos = !!error && data.length === 0
  const semConversas = erroLeads && leads.length === 0
  const tentarDeNovo = () => {
    if (error) void qc.refetchQueries({ queryKey: ['orcamentos'] })
    if (erroLeads) void releLeads()
  }

  return (
    <div className="space-y-6" ref={containerRef}>
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-foreground/40">Dashboard</span>
          <ChevronRight className="h-3 w-3 text-foreground/30" aria-hidden="true" />
          <span className="text-xs font-medium text-primary">Relatórios</span>
        </div>
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Análise comercial</h2>
          <p className="mt-0.5 text-sm text-foreground/50">
            De onde vem o cliente, por onde ele passa e quanto disso vira dinheiro.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm">
        <CustomSelect className="w-44 py-2" value={periodo} onChange={setPeriodo} options={PERIODOS} />
        {periodo === 'custom' && (
          <>
            <DatePicker value={de} onChange={setDe} placeholder="De" className="w-40" />
            <DatePicker value={ate} onChange={setAte} placeholder="Até" min={de || undefined} className="w-40" />
          </>
        )}
        <Button variant="outline" onClick={baixarPdf} loading={baixando} disabled={carregando || semOrcamentos || semConversas}>
          {!baixando && <FileDown className="h-4 w-4" aria-hidden="true" />}
          PDF
        </Button>
      </div>

      {/* O foco por vendedor vale para os pedidos, nunca para as conversas — o CRM não
          tem dono. Sem este aviso, o funil casaria as conversas da loja inteira com as
          vendas de uma pessoa e a taxa de conversão sairia errada pra baixo. */}
      {focoResponsavel && (
        <p className="flex items-center justify-center gap-2 text-center text-xs text-foreground/55">
          <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          Pedidos filtrados por <strong className="font-semibold text-foreground/75">{focoResponsavel}</strong>;
          as conversas e objeções são da loja inteira, porque o atendimento da Amanda não tem vendedor.
        </p>
      )}

      {carregando ? (
        <EsqueletoAnalises />
      ) : semOrcamentos || semConversas ? (
        <AvisoErro
          mensagem={semOrcamentos ? 'Não consegui ler os pedidos agora.' : 'Não consegui ler as conversas agora.'}
          aoTentar={tentarDeNovo} className="py-8" />
      ) : (
        <>
          {(error || erroLeads) && (
            <AvisoErro mensagem="Não consegui atualizar agora. Mostrando o que foi lido por último."
              aoTentar={tentarDeNovo} />
          )}

          {/* Painel de vendas: o antigo "Lista" de Orçamentos (KPIs, ranking, gráficos e fechados),
              com os filtros dele. Usa os mesmos orçamentos (já filtrados pelo Modo Foco). Fica no
              mesmo ramo protegido do resto: nunca mostra zeros quando carregando ou com erro.
              Não sincroniza a URL: a tela fica montada e apagaria a query das outras abas. */}
          <section aria-labelledby="painel-vendas" className="space-y-4">
            <h3 id="painel-vendas" className="text-center font-display text-lg font-semibold tracking-tight">
              Painel de vendas
            </h3>
            <TabOrcamentos data={data} loading={false} resetKey={resetKey} sincronizarUrl={false} />
          </section>

          <Abertura
            manchete={manchete}
            observacoes={calc.observacoes}
            funil={calc.funil}
            dinheiro={calc.dinheiro}
            rotuloComparacao={rotuloComparacao}
            rotuloPeriodo={rotuloPeriodo}
            deltas={calc.deltas}
            destaqueCanal={calc.destaqueCanal}
            semCanal={calc.canais.semCanal}
          />

          {/* A ordem daqui pra baixo responde a quem decide investimento primeiro: de onde
              vem a gente, como ela anda pelo funil e quanto disso virou dinheiro. Só depois
              entram as perguntas de operação da loja — o que trava e o que pedem. */}
          <CanalHonesto canais={calc.canais} />

          <FunilPeriodo funil={calc.funil} />

          <BlocoDinheiro
            porMes={calc.porMes}
            porModelo={calc.porModelo}
            dinheiro={calc.dinheiro}
            resetKey={resetKey}
          />

          <CoberturaIABanner cobertura={calc.cobertura} />

          <ParedeObjecoes
            linhas={calc.objecoes}
            analisadas={calc.base.analisadas.length}
            naoCliente={calc.base.naoCliente.length}
            rotuloComparacao={calc.naoAnalisadoAnterior ? '' : rotuloComparacao}
          />

          <DemandaProdutos
            linhas={calc.demanda.linhas}
            totalConversas={calc.demanda.totalConversas}
            totalReceita={calc.demanda.totalReceita}
          />

          <TermometroLeads termometro={calc.termo} sensibilidade={calc.sensibilidade} />

          <BlocoOperacional data={data} />
        </>
      )}

      <JanelaDados />
    </div>
  )
}
