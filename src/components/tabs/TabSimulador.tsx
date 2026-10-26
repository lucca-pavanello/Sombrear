/**
 * Simulador de balcão — atendente da loja com o cliente na frente.
 * O cálculo roda no SERVIDOR (edge function `simular`, mesmo motor dos agentes);
 * a atendente vê só o valor de venda. Custo e margem só aparecem para admin.
 * Fluxo de visita: dados do cliente ficam preenchidos entre um salvamento e
 * outro (cliente quer ver 3 modelos → troca o modelo e salva de novo);
 * "Limpar" zera a visita inteira.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Calculator, CheckCircle2, ChevronRight, Eraser, History, Layers, Loader2, Trash2, X,
  Ruler, Save, Sparkles, Tag, User, Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { CustomSelect } from '@/components/ui/CustomSelect'
import { Interruptor, BotaoAdicionar } from '@/components/ui/primitives'
import { supabase } from '@/lib/supabase'
import { useCreatePedido } from '@/hooks/useOrcamentos'
import { ratear } from '@/lib/rateio'
import { useToast } from '@/hooks/useToast'
import Toaster from '@/components/ui/Toaster'
import { SUGESTOES_AMBIENTE } from '@/lib/constants'
import { useHistoricoCliente, resumoHistorico } from '@/hooks/useHistoricoCliente'
import { lazyComRecarga } from '@/lib/lazyComRecarga'
import SectionHeader from '@/components/shared/SectionHeader'
import { campo, rotulo, segmentado } from '@/components/shared/estilos'

const CalculadoraCortina = lazyComRecarga(() => import('@/components/cortina/CalculadoraCortina'))

/** Roda no máximo `max` tarefas ao mesmo tempo; o resto espera a vez.
    Cada cálculo faz ~13 consultas no banco — 15 de uma vez derrubam o servidor. */
function criarFila(max: number) {
  let ativos = 0
  const espera: (() => void)[] = []
  return async (tarefa: () => Promise<void>) => {
    if (ativos >= max) await new Promise<void>(r => espera.push(r))
    ativos++
    try { await tarefa() } finally { ativos--; espera.shift()?.() }
  }
}

const brl = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const MODELOS = [
  { id: 'Rolo', label: 'Rolô' },
  { id: 'Rolo Motorizado', label: 'Rolô Motorizado' },
  { id: 'Double', label: 'Double' },
  { id: 'Romana', label: 'Romana' },
  { id: 'PV', label: 'PV' },
  { id: 'PH_Aluminio', label: 'PH Alumínio' },
  { id: 'PH_50', label: 'PH 50mm' },
  // sem persiana: bandô de reposição ou peça de ferragem (vira Bandô/Acessório no motor)
  { id: 'Avulso', label: 'Só bandô / acessório' },
]

const COM_TECIDO = new Set(['Rolo', 'Double', 'Romana', 'Rolo Motorizado'])

/** O produto de uma linha de medida — a principal usa o do topo; uma extra pode ter o seu. */
interface Prod {
  modelo: string
  tecido: string
  artigo: string
  acabamento: string
  corFerragem: 'BRANCA' | 'PRETA'
  avulsoTipo: 'bando' | 'componente'
}

/** modelo que o motor entende: "Só bandô / acessório" vira Bandô ou Acessório */
const modeloMotor = (p: Pick<Prod, 'modelo' | 'avulsoTipo'>) =>
  p.modelo === 'Avulso' ? (p.avulsoTipo === 'bando' ? 'Bandô' : 'Acessório') : p.modelo
/** bandô e acessório avulsos são cobrados só pela largura */
const precisaAltura = (p: Prod) => p.modelo !== 'Avulso'
/** peça de ferragem fixa (comando, tampa…) não tem largura — o motor recusa se for por metro */
const temMedida = (p: Prod, l: number, a: number) =>
  p.modelo === 'Avulso' ? (p.avulsoTipo === 'componente' || l > 0) : l > 0 && a > 0
const prodCompleto = (p: Prod) => COM_TECIDO.has(p.modelo) ? !!p.tecido : !!p.artigo
/** os campos de `entrada` que mudam de uma linha pra outra */
const camposProd = (p: Prod) => ({
  modelo: modeloMotor(p),
  tecido: COM_TECIDO.has(p.modelo) ? (p.tecido || undefined) : undefined,
  artigo: !COM_TECIDO.has(p.modelo) ? (p.artigo || undefined) : undefined,
  acabamento: COM_TECIDO.has(p.modelo) ? p.acabamento : 'nenhum',
  corFerragem: p.corFerragem,
})

/** o seletor do "item" de cada modelo: tecido, artigo, cor do bandô ou peça de ferragem */
function opcoesItem(p: Prod, o: Opcoes | undefined): { rotulo: string; options: { value: string; label: string }[] } {
  const simples = (xs: string[] | undefined) => (xs ?? []).map(x => ({ value: x, label: x }))
  if (COM_TECIDO.has(p.modelo)) return { rotulo: 'Tecido', options: simples(o?.tecidos) }
  if (p.modelo === 'PV') return { rotulo: 'Artigo', options: simples(o?.artigosPV) }
  if (p.modelo === 'PH_Aluminio') return { rotulo: 'Artigo', options: simples(o?.artigosPH) }
  if (p.modelo === 'PH_50') return { rotulo: 'Modelo / cor', options: (o?.ph50 ?? []).map(i => ({ value: i.valor, label: i.label })) }
  if (p.avulsoTipo === 'bando') return { rotulo: 'Cor do bandô', options: [{ value: 'BRANCO', label: 'Branco' }, { value: 'PRETO', label: 'Preto' }] }
  return { rotulo: 'Peça', options: o?.componentes ?? [] }
}

/** "BK BLACKOUT", "Branco", "Rolô branca 38mm · tubo 38" — o que identifica o item na venda */
function descreverItem(p: Prod, o: Opcoes | undefined): string {
  if (COM_TECIDO.has(p.modelo)) return p.tecido
  return opcoesItem(p, o).options.find(x => x.value === p.artigo)?.label ?? p.artigo
}
const rotuloModeloDe = (p: Prod) =>
  p.modelo === 'Avulso' ? modeloMotor(p) : (MODELOS.find(m => m.id === p.modelo)?.label ?? p.modelo)
/** 1.2×1.5m — ou só 1.8m no avulso, que não tem altura */
const medidaTxt = (p: Prod, l: string, a: string) =>
  precisaAltura(p) ? `${l}×${a}m` : (l ? `${l}m` : 'avulso')

interface Opcoes {
  tecidos: string[]
  artigosPV: string[]
  artigosPH: string[]
  ph50: { valor: string; label: string }[]
  componentes?: { value: string; label: string }[]
}

interface Resultado {
  total4x: number
  totalAvista: number
  vendaProduto: number
  vendaAcabamento: number
  instalacao: number | 'sob_consulta' | null
  emPromocao: boolean
  descontoPct: number | null
  observacoes: string[]
  custoProduto?: number
  custoAcabamento?: number
  erro?: string
}

interface Salvo { id: string; modelo: string; detalhe: string; total: number }

// receita compartilhada — ver src/components/shared/estilos.ts
const inputCls = campo
const labelCls = rotulo

export default function TabSimulador({ modoVenda, aoSalvar }: {
  /** No Semanário a simulação vira VENDA FECHADA direto (não um orçamento aberto). */
  modoVenda?: boolean
  aoSalvar?: () => void
} = {}) {
  const { toasts, toast, dismiss } = useToast()
  const criarPedido = useCreatePedido()
  const [modelo, setModelo] = useState('Rolo')
  const [tecido, setTecido] = useState('')
  const [artigo, setArtigo] = useState('')
  const [avulsoTipo, setAvulsoTipo] = useState<'bando' | 'componente'>('bando')
  const [ph50Acab, setPh50Acab] = useState<'cadarco' | 'fita'>('cadarco')
  const [ph50Bando, setPh50Bando] = useState(false)
  const [corFerragem, setCorFerragem] = useState<'BRANCA' | 'PRETA'>('BRANCA')
  const [motorForca, setMotorForca] = useState<'6N' | '10N' | '20N' | 'WIFI'>('6N')
  // motorização é do PEDIDO: 6 peças numa parede não são 6 motores + 6 controles
  const [motorQtd, setMotorQtd] = useState('')          // vazio = 1 por peça
  const [controleQtd, setControleQtd] = useState('1')
  const [controleCanais, setControleCanais] = useState<'1' | '6' | '16'>('1')
  const [juncaoQtd, setJuncaoQtd] = useState('0')
  const [largura, setLargura] = useState('')
  const [altura, setAltura] = useState('')
  const [quantidade, setQuantidade] = useState('1')
  const [acabamento, setAcabamento] = useState('nenhum')
  // porta dividida em peças leva um bandô só: medida e quantidade próprias
  const [bandoUnico, setBandoUnico] = useState(false)
  const [bandoLargura, setBandoLargura] = useState('')
  const [bandoQtd, setBandoQtd] = useState('')
  const [instalacao, setInstalacao] = useState(false)
  const [cliente, setCliente] = useState('')
  const [telefone, setTelefone] = useState('')
  const [ambiente, setAmbiente] = useState('')
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [calculando, setCalculando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [salvoAtual, setSalvoAtual] = useState(false)
  const [salvos, setSalvos] = useState<Salvo[]>([])
  // desconto/acréscimo dado na mão: vazio = cobra o valor calculado
  // persiana e cortina são dois cálculos diferentes; a chave decide qual aparece
  const [produto, setProduto] = useState<'persiana' | 'cortina'>('persiana')
  const [valorCobrado, setValorCobrado] = useState('')
  // à vista tem 5% de desconto; no cartão vale o valor em 4x
  const [formaPagamento, setFormaPagamento] = useState('cartao_4x')
  // o que a loja combinou define o preço; isto aqui é como o cliente pagou
  const [formaReal, setFormaReal] = useState('')
  // em quantas vezes saiu de verdade — o juro embutido é derivado disto
  const [parcelas, setParcelas] = useState('4')
  /* Mesmo pedido, mais de um tamanho (caso clássico: 3 de 0,96 e 1 de 1,20).
     A linha principal continua sendo largura/altura/quantidade; estas são as
     medidas EXTRAS do mesmo produto, calculadas e salvas junto. */
  const [extras, setExtras] = useState<{
    id: number; largura: string; altura: string; qtd: string; amb: string; resultado: Resultado | null
    /** a entrada (serializada) que gerou o `resultado` — se a linha ou o topo mudou, o resultado não vale mais */
    calcChave: string | null
    /** null = mesmo produto do topo; preenchido quando alguém clica em "trocar modelo" na linha */
    prod: Prod | null
  }[]>([])
  const extraIdRef = useRef(1)
  const [sugestoesAbertas, setSugestoesAbertas] = useState(false)
  /* A venda pode ter PRODUTOS diferentes (Rolô BK + Romana, cada um com suas
     medidas). "Guardar produto" congela as linhas do atual aqui, com a entrada
     já pronta pra salvar — os campos ficam livres pro próximo. */
  const [carrinho, setCarrinho] = useState<{
    id: number; rotuloModelo: string; detalhe: string; ambiente: string
    entradaFinal: Record<string, unknown>; resultado: Resultado
  }[]>([])
  const carrinhoIdRef = useRef(1)
  const ignorarResetCarrinho = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chamadaRef = useRef(0)

  const { data: historicoCliente } = useHistoricoCliente(cliente)
  const { data: opcoes } = useQuery<Opcoes>({
    queryKey: ['simulador-opcoes'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('simular', { body: { acao: 'opcoes' } })
      if (error) throw error
      return data as Opcoes
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  /* Clientes que já passaram pela loja — pro "Moraes" completar sozinho.
     Uma busca só, deduplicada por nome; o telefone vem do registro mais recente. */
  const { data: clientesConhecidos } = useQuery({
    queryKey: ['clientes-conhecidos'],
    queryFn: async () => {
      const { data, error } = await supabase.from('orcamentos')
        .select('cliente, telefone, created_at')
        .not('cliente', 'is', null)
        .order('created_at', { ascending: false })
        .limit(800)
      if (error) throw error
      const mapa = new Map<string, { nome: string; telefone: string | null }>()
      for (const r of data ?? []) {
        const nome = (r.cliente ?? '').trim()
        if (!nome || nome.toLowerCase() === 'balcão') continue
        const chave = nome.toLowerCase()
        const atual = mapa.get(chave)
        if (!atual) mapa.set(chave, { nome, telefone: r.telefone ?? null })
        else if (!atual.telefone && r.telefone) atual.telefone = r.telefone
      }
      return [...mapa.values()]
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
  const sugestoesCliente = useMemo(() => {
    const q = cliente.trim().toLowerCase()
    if (q.length < 2 || !clientesConhecidos) return []
    return clientesConhecidos
      .filter(c => c.nome.toLowerCase().includes(q) && c.nome.toLowerCase() !== q)
      .slice(0, 5)
  }, [cliente, clientesConhecidos])

  const num = (s: string) => parseFloat(s.replace(',', '.')) || 0
  const comTecido = COM_TECIDO.has(modelo)
  const motorizado = modelo === 'Rolo Motorizado'
  const prodTopo: Prod = useMemo(() => ({ modelo, tecido, artigo, acabamento, corFerragem, avulsoTipo }),
    [modelo, tecido, artigo, acabamento, corFerragem, avulsoTipo])
  const entrada = useMemo(() => ({
    modelo: modeloMotor({ modelo, avulsoTipo }),
    tecido: comTecido ? (tecido || undefined) : undefined,
    artigo: !comTecido ? (artigo || undefined) : undefined,
    ph50Acabamento: ph50Acab,
    ph50Bando,
    corFerragem,
    largura: num(largura),
    altura: num(altura),
    quantidade: Math.max(1, Math.round(num(quantidade))),
    acabamento,
    motorForca: motorizado ? motorForca : undefined,
    motorQtd: motorizado && num(motorQtd) > 0 ? Math.round(num(motorQtd)) : undefined,
    controleQtd: motorizado ? Math.max(0, Math.round(num(controleQtd))) : undefined,
    controleCanais: motorizado ? (Number(controleCanais) as 1 | 6 | 16) : undefined,
    juncaoQtd: motorizado ? Math.max(0, Math.round(num(juncaoQtd))) : undefined,
    bandoLargura: bandoUnico ? num(bandoLargura) || undefined : undefined,
    bandoQuantidade: bandoUnico ? Math.round(num(bandoQtd)) || undefined : undefined,
    incluirInstalacao: instalacao,
  }), [modelo, avulsoTipo, comTecido, tecido, artigo, ph50Acab, ph50Bando, corFerragem, largura, altura, quantidade,
    acabamento, motorizado, motorForca, motorQtd, controleQtd, controleCanais, juncaoQtd,
    bandoUnico, bandoLargura, bandoQtd, instalacao])

  const pronto = temMedida(prodTopo, entrada.largura, entrada.altura) && prodCompleto(prodTopo)

  /* ── cálculo no servidor, com debounce (o motor é o mesmo dos agentes) ── */
  useEffect(() => {
    setSalvoAtual(false)
    setValorCobrado('')
    setFormaPagamento('cartao_4x')
    setFormaReal('')
    if (!pronto) { setResultado(null); return }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const id = ++chamadaRef.current
    debounceRef.current = setTimeout(async () => {
      setCalculando(true)
      try {
        const { data, error } = await supabase.functions.invoke('simular', {
          body: { acao: 'calcular', entrada },
        })
        if (id !== chamadaRef.current) return
        if (error) throw error
        setResultado(data as Resultado)
      } catch {
        if (id === chamadaRef.current) setResultado({ erro: 'Não consegui calcular. Tente de novo.' } as Resultado)
      } finally {
        if (id === chamadaRef.current) setCalculando(false)
      }
    }, 500)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [entrada, pronto])

  /* ── medidas extras: mesmo produto, outros tamanhos ──
     Venda de apartamento inteiro chega a 15 medidas (vídeo da Stella, 26/10).
     Antes, cada tecla recalculava TODAS de uma vez: 15 chamadas simultâneas,
     a cada tecla, num banco pequeno — as que falhavam viravam "Calculando…"
     pra sempre, sem erro nem jeito de refazer. Agora cada medida guarda a
     entrada que gerou o seu resultado (`calcChave`), só a que mudou volta pro
     servidor, no máximo 3 por vez, e erro aparece como erro. */
  // a chave ignora o resultado de propósito: depender dele criaria loop
  const extrasChave = JSON.stringify(extras.map(x => [x.id, x.largura, x.altura, x.qtd, x.prod]))
  /** medida com tamanho preenchido — entra na venda (e trava o salvar enquanto não calcula) */
  const extraValida = (x: (typeof extras)[number]) => temMedida(x.prod ?? prodTopo, num(x.largura), num(x.altura))
  /** a entrada que o motor recebe pra esta medida — serializada, é a "assinatura" do resultado */
  const chaveDaExtra = (x: (typeof extras)[number], base = entrada) => JSON.stringify({
    ...base,
    ...(x.prod ? camposProd(x.prod) : {}),
    largura: num(x.largura), altura: num(x.altura),
    quantidade: Math.max(1, Math.round(num(x.qtd))),
    // o bandô de peça única vale UMA vez por venda — vai só na linha principal
    bandoLargura: undefined, bandoQuantidade: undefined,
  })
  const extraEmDia = (x: (typeof extras)[number]) => x.resultado != null && x.calcChave === chaveDaExtra(x)
  // a resposta chega depois; ela compara com o topo de AGORA, não com o da hora que saiu
  const entradaRef = useRef(entrada)
  entradaRef.current = entrada
  /** id da medida → chave que está no servidor agora (não dispara de novo a mesma conta) */
  const extrasEmVooRef = useRef(new Map<number, string>())
  const filaExtrasRef = useRef(criarFila(3))
  const [tentativaExtras, setTentativaExtras] = useState(0)
  const extrasDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    setSalvoAtual(false)
    setValorCobrado('')
    if (extrasDebounceRef.current) clearTimeout(extrasDebounceRef.current)
    extrasDebounceRef.current = setTimeout(() => {
      const emVoo = extrasEmVooRef.current
      const alvos = extras.filter(x => extraValida(x) && prodCompleto(x.prod ?? prodTopo) && !extraEmDia(x))
      for (const x of alvos) {
        const chave = chaveDaExtra(x)
        if (emVoo.get(x.id) === chave) continue
        emVoo.set(x.id, chave)
        void filaExtrasRef.current(async () => {
          // na fila, a medida pode ter mudado de novo — essa conta já não interessa
          if (emVoo.get(x.id) !== chave) return
          const resultado = await calcularExtra(chave)
          if (emVoo.get(x.id) !== chave) return
          emVoo.delete(x.id)
          setExtras(prev => prev.map(y =>
            y.id === x.id && chaveDaExtra(y, entradaRef.current) === chave ? { ...y, resultado, calcChave: chave } : y))
        })
      }
    }, 500)
    return () => { if (extrasDebounceRef.current) clearTimeout(extrasDebounceRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extrasChave, entrada, tentativaExtras])

  /** Uma medida no servidor. Falha de rede/servidor tenta mais uma vez;
      recusa do motor (`erro` com 200) é resposta, não falha. */
  async function calcularExtra(chave: string): Promise<Resultado> {
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      try {
        const { data, error } = await supabase.functions.invoke('simular', {
          body: { acao: 'calcular', entrada: JSON.parse(chave) },
        })
        if (error) throw error
        return data as Resultado
      } catch {
        if (tentativa === 0) await new Promise(r => setTimeout(r, 1000))
      }
    }
    return { erro: 'Não consegui calcular esta medida.' } as Resultado
  }

  const extrasValidas = extras.filter(extraValida)
  const extrasOk = extrasValidas.filter(x => extraEmDia(x) && !x.resultado!.erro)
  const extrasComErro = extrasValidas.filter(x => extraEmDia(x) && x.resultado!.erro)
  const extrasCalculando = extrasValidas.length - extrasOk.length - extrasComErro.length
  const extrasPendentes = extrasValidas.length !== extrasOk.length
  /** joga fora o erro das que falharam — o efeito vê que estão vencidas e calcula de novo */
  function recalcularExtrasComErro() {
    setExtras(p => p.map(x => extrasComErro.some(y => y.id === x.id) ? { ...x, resultado: null, calcChave: null } : x))
    setTentativaExtras(n => n + 1)
  }

  // mexer no carrinho invalida o "salvo" e o valor cobrado — menos ao esvaziar após salvar
  useEffect(() => {
    if (ignorarResetCarrinho.current) { ignorarResetCarrinho.current = false; return }
    setSalvoAtual(false)
    setValorCobrado('')
  }, [carrinho])

  /** As linhas do produto ATUAL (principal + extras), com a entrada pronta pra salvar. */
  function montarLinhasAtuais() {
    if (!resultado || resultado.erro) return null
    const base = [
      { largura, altura, qtd: quantidade, amb: ambiente, resultado: resultado as Resultado, principal: true, prod: null as Prod | null },
      // extra sem ambiente herda o da linha principal
      ...extrasOk.map(x => ({ largura: x.largura, altura: x.altura, qtd: x.qtd, amb: x.amb || ambiente, resultado: x.resultado as Resultado, principal: false, prod: x.prod })),
    ]
    return base.map(l => ({
      rotuloModelo: rotuloModeloDe(l.prod ?? prodTopo),
      detalhe: `${descreverItem(l.prod ?? prodTopo, opcoes)} · ${medidaTxt(l.prod ?? prodTopo, l.largura, l.altura)}${Math.round(num(l.qtd)) > 1 ? ` ×${Math.round(num(l.qtd))}` : ''}`,
      ambiente: l.amb.trim(),
      resultado: l.resultado,
      entradaFinal: { ...entrada,
        ...(l.prod ? camposProd(l.prod) : {}),
        largura: num(l.largura), altura: num(l.altura),
        quantidade: Math.max(1, Math.round(num(l.qtd))),
        // bandô de peça única é um por produto — só a linha principal leva
        bandoLargura: l.principal ? entrada.bandoLargura : undefined,
        bandoQuantidade: l.principal ? entrada.bandoQuantidade : undefined,
      } as Record<string, unknown>,
    }))
  }

  /** Congela o produto atual no carrinho e libera os campos pro próximo. */
  function guardarProduto() {
    const linhas = montarLinhasAtuais()
    if (!linhas || extrasPendentes) return
    setCarrinho(prev => [...prev, ...linhas.map(l => ({ ...l, id: carrinhoIdRef.current++ }))])
    setTecido(''); setArtigo(''); setLargura(''); setAltura(''); setQuantidade('1'); setAmbiente('')
    setExtras([]); setAcabamento('nenhum'); setBandoLargura(''); setBandoQtd('')
    setResultado(null)
  }

  async function salvar() {
    if (salvando || salvoAtual || !soma) return
    if (extrasPendentes) {
      toast('error', 'Tem medida extra incompleta ou com erro — confira antes de salvar.')
      return
    }
    if (pronto && (calculando || !resultado)) {
      toast('error', 'Aguarde o cálculo do produto atual terminar.')
      return
    }
    if (resultado?.erro && pronto) {
      toast('error', 'O produto atual está com erro — corrija ou tire as medidas dele.')
      return
    }
    setSalvando(true)
    try {
      const linhas = [...carrinho, ...(montarLinhasAtuais() ?? [])]
      if (linhas.length === 0) { setSalvando(false); return }

      /* Parcelas + juros: o preço nasce pra 4x; se saiu em 5x/6x, registramos
         quantas vezes e o juro embutido — a taxa é o que a loja quer olhar depois. */
      const cobradoTotal = num(valorCobrado) || null
      const cobradoEfetivo = cobradoTotal ?? soma.t4
      const nParcelas = Math.round(num(parcelas))
      let formaRealFinal = formaReal.trim()
      if (formaPagamento === 'outro' && nParcelas >= 2) {
        const juros = cobradoEfetivo > soma.t4 + 0.009
          ? ` · +${(((cobradoEfetivo - soma.t4) / soma.t4) * 100).toFixed(1)}% de juros`
          : ''
        const auto = `${nParcelas}x de ${brl(cobradoEfetivo / nParcelas)}${juros}`
        formaRealFinal = formaRealFinal ? `${auto} — ${formaRealFinal}` : auto
      }

      /* Valor cobrado diferente do calculado se distribui proporcionalmente
         entre as linhas, pra soma no Semanário bater com o combinado. */
      const cobrados = cobradoTotal != null
        ? ratear(cobradoTotal, linhas.map(l => l.resultado.total4x))
        : null

      /* Mais de um item na mesma venda é, na prática, um pedido só — cria o
         vínculo (metadados: número/data/origem/pagamento) antes de salvar os
         itens, pra não depender de reagrupar por texto de cliente depois. */
      const pedidoId = linhas.length > 1
        ? (await criarPedido.mutateAsync({
            origem: null, forma_pagamento: formaPagamento, forma_pagamento_real: formaRealFinal || null,
          })).id
        : null

      const novos: Salvo[] = []
      for (let i = 0; i < linhas.length; i++) {
        const l = linhas[i]
        const cobradoLinha = cobrados ? cobrados[i] : null
        const { data, error } = await supabase.functions.invoke('simular', {
          body: { acao: 'salvar',
            entrada: l.entradaFinal,
            cliente: cliente.trim(), telefone: telefone.trim(), ambiente: l.ambiente, fechado: !!modoVenda,
            valor_cobrado: cobradoLinha, forma_pagamento: formaPagamento,
            forma_pagamento_real: formaRealFinal || null, pedido_id: pedidoId },
        })
        if (error) throw error
        if ((data as { error?: string }).error) throw new Error((data as { error: string }).error)
        // recusa do motor volta como `erro` (200) — sem isto o item sumia calado
        if ((data as { erro?: string }).erro) throw new Error(`${l.rotuloModelo}: ${(data as { erro: string }).erro}`)
        novos.push({
          id: (data as { id: string }).id,
          modelo: l.rotuloModelo,
          detalhe: l.detalhe,
          total: l.resultado.total4x,
        })
      }
      setSalvos(prev => [...prev, ...novos])
      ignorarResetCarrinho.current = true
      setCarrinho([])
      setSalvoAtual(true)
      toast('success', modoVenda
        ? `Venda registrada no Semanário! (${linhas.length} ${linhas.length > 1 ? 'itens' : 'item'})`
        : `Orçamento salvo na Planilha! (${linhas.length} ${linhas.length > 1 ? 'itens' : 'item'})`)
      aoSalvar?.()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Erro ao salvar. Tente de novo.')
    } finally {
      setSalvando(false)
    }
  }

  /* ── nova visita: zera produto, cliente e a lista de salvos ── */
  function limparTudo() {
    setModelo('Rolo'); setTecido(''); setArtigo(''); setAvulsoTipo('bando'); setPh50Acab('cadarco'); setPh50Bando(false)
    setCorFerragem('BRANCA'); setLargura(''); setAltura(''); setQuantidade('1')
    setAcabamento('nenhum'); setInstalacao(false)
    setCliente(''); setTelefone(''); setAmbiente('')
    setResultado(null); setSalvoAtual(false); setSalvos([]); setValorCobrado(''); setFormaPagamento('cartao_4x'); setFormaReal('')
    setExtras([]); setParcelas('4'); setBandoLargura(''); setBandoQtd('')
    setCarrinho([])
  }

  const ok = resultado && !resultado.erro ? resultado : null

  /* Totais da VENDA (carrinho + produto atual) — é o que a tela mostra */
  const soma = useMemo(() => {
    const rs = [
      ...carrinho.map(c => c.resultado),
      ...(ok ? [ok, ...extrasOk.map(x => x.resultado as Resultado)] : []),
    ]
    if (rs.length === 0) return null
    const t4 = rs.reduce((s, r) => s + r.total4x, 0)
    const av = rs.reduce((s, r) => s + r.totalAvista, 0)
    const sobConsulta = rs.some(r => r.instalacao === 'sob_consulta')
    const instNums = rs.map(r => r.instalacao).filter((v): v is number => typeof v === 'number')
    const inst: number | 'sob_consulta' | null =
      sobConsulta ? 'sob_consulta' : instNums.length ? instNums.reduce((a, b) => a + b, 0) : null
    const custo = rs.every(r => r.custoProduto != null)
      ? rs.reduce((s, r) => s + (r.custoProduto ?? 0) + (r.custoAcabamento ?? 0), 0)
      : null
    return { rs, t4, av, inst, custo }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, extrasChave, extras, carrinho])

  const ehAdminView = soma?.custo != null
  const margem = soma && soma.custo != null
    ? (() => {
        const receita = soma.t4 + (typeof soma.inst === 'number' ? soma.inst : 0)
        return receita > 0 ? ((receita - soma.custo!) / receita) * 100 : null
      })()
    : null

  return (
    <>
      {/* ── Cabeçalho: só como aba; dentro do Semanário seria página dentro de página ── */}
      <div className={cn('mb-6 flex-col items-center gap-2 text-center', modoVenda ? 'hidden' : 'flex')}>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-foreground/40">Dashboard</span>
          <ChevronRight className="h-3 w-3 text-foreground/30" />
          <span className="text-xs font-medium text-primary">Simulador</span>
        </div>
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Preço na hora</h2>
          <p className="mt-0.5 text-sm text-foreground/50">O mesmo cálculo dos orçamentos oficiais, direto do banco de preços.</p>
        </div>
      </div>

      {/* ── Persiana ou cortina: contas diferentes, telas diferentes ── */}
      <div className={cn(segmentado.trilho, 'mx-auto mb-5 w-full max-w-xs')}>
        {([['persiana', 'Persiana'], ['cortina', 'Cortina']] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setProduto(id)}
            className={cn(segmentado.item, 'flex-1 py-2', produto === id ? segmentado.ativo : segmentado.inativo)}>
            {label}
          </button>
        ))}
      </div>

      {produto === 'cortina' && (
        <Suspense fallback={
          <div className="flex justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        }>
          <CalculadoraCortina />
        </Suspense>
      )}

      <div className={cn('grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px] xl:gap-5',
        produto === 'cortina' && 'hidden')}>

        {/* ── COLUNA ESQUERDA: produto + cliente ── */}
        <div className="space-y-4">

          {/* SEÇÃO 1: Produto */}
          <section>
            <SectionHeader step="1" icon={<Layers className="h-3.5 w-3.5" />} title="Produto" />
            <div className="mt-3 rounded-xl border border-border bg-card p-4 sm:p-5 shadow-sm space-y-4">
              {/* mesma grade do Calcular: Modelo | Tecido, depois Ferragem | Acabamento */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Modelo</label>
                  <CustomSelect value={modelo}
                    onChange={v => { setModelo(v); setTecido(''); setArtigo(''); setAcabamento('nenhum'); setPh50Bando(false) }}
                    options={MODELOS.map(m => ({ value: m.id, label: m.label }))} />
                </div>
                {comTecido && (
                  <>
                    <div>
                      <label className={labelCls}>Tecido</label>
                      <CustomSelect value={tecido} onChange={setTecido}
                        options={opcoes?.tecidos ?? []}
                        placeholder={opcoes ? 'Escolha o tecido…' : 'Carregando…'} />
                    </div>
                    {motorizado ? (
                      <div>
                        <label className={labelCls}>Motor</label>
                        <CustomSelect value={motorForca}
                          onChange={v => setMotorForca(v as '6N' | '10N' | '20N' | 'WIFI')}
                          options={[
                            { value: '6N', label: '6N (até 18kg)' },
                            { value: '10N', label: '10N (até 23kg)' },
                            { value: '20N', label: '20N (até 45kg)' },
                            { value: 'WIFI', label: 'WiFi' },
                          ]} />
                      </div>
                    ) : modelo !== 'Romana' ? (
                      <div>
                        <label className={labelCls}>Ferragem</label>
                        <CustomSelect value={corFerragem} onChange={v => setCorFerragem(v as 'BRANCA' | 'PRETA')}
                          options={[{ value: 'BRANCA', label: 'Branca' }, { value: 'PRETA', label: 'Preta' }]} />
                      </div>
                    ) : null}
                    <div>
                      <label className={labelCls}>Acabamento</label>
                      <CustomSelect value={acabamento} onChange={setAcabamento}
                        options={[
                          { value: 'nenhum', label: 'Sem acabamento' },
                          { value: 'bando_branco', label: 'Bandô branco' },
                          { value: 'bando_preto', label: 'Bandô preto' },
                          { value: 'barra', label: 'Barra niveladora' },
                          ...(modelo === 'Rolo' || motorizado ? [{ value: 'kit_box', label: 'Kit Box' }] : []),
                        ]} />
                    </div>

                    {/* Porta larga dividida em peças costuma levar UM bandô cobrindo tudo.
                        Vazio = o bandô acompanha a persiana, como sempre foi. */}
                    {motorizado && (
                      <div className="sm:col-span-2 rounded-lg border border-dashed p-3">
                        <p className="mb-2 text-xs text-foreground/60">
                          Motorização do pedido — peças unidas por junção dividem motor; o controle
                          é um só para todas (escolha os canais).
                        </p>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                          <div>
                            <label className={labelCls}>Motores</label>
                            <input className={inputCls} inputMode="numeric" value={motorQtd}
                              onChange={e => setMotorQtd(e.target.value)}
                              placeholder={quantidade ? `${quantidade} (1 por peça)` : '1 por peça'} />
                          </div>
                          <div>
                            <label className={labelCls}>Controles</label>
                            <input className={inputCls} inputMode="numeric" value={controleQtd}
                              onChange={e => setControleQtd(e.target.value)} />
                          </div>
                          <div>
                            <label className={labelCls}>Canais</label>
                            <CustomSelect value={controleCanais}
                              onChange={v => setControleCanais(v as '1' | '6' | '16')}
                              options={[
                                { value: '1', label: '1 canal' },
                                { value: '6', label: '6 canais' },
                                { value: '16', label: '16 canais' },
                              ]} />
                          </div>
                          <div>
                            <label className={labelCls}>Junções 53mm</label>
                            <input className={inputCls} inputMode="numeric" value={juncaoQtd}
                              onChange={e => setJuncaoQtd(e.target.value)} />
                          </div>
                        </div>
                      </div>
                    )}
                    {(acabamento === 'bando_branco' || acabamento === 'bando_preto') && (
                      <div className="sm:col-span-2">
                        <Interruptor ligado={bandoUnico}
                          onChange={marcado => {
                            setBandoUnico(marcado)
                            if (!marcado) { setBandoLargura(''); setBandoQtd('') }
                            else if (!bandoQtd) setBandoQtd('1')
                          }}
                          detalhe="ex.: porta de 5,20m em 3 rolôs leva UM bandô de 5,20m. Desligado, vai um por peça.">
                          Bandô é uma peça só, diferente da persiana
                        </Interruptor>
                        {bandoUnico && (
                          <div className="mt-3 grid grid-cols-2 gap-3">
                            <div>
                              <label className={labelCls}>Largura do bandô (m)</label>
                              <input className={inputCls} inputMode="decimal" value={bandoLargura}
                                onChange={e => setBandoLargura(e.target.value)}
                                placeholder={largura ? `${largura} (a da persiana)` : 'ex.: 5,20'} />
                            </div>
                            <div>
                              <label className={labelCls}>Quantos bandôs</label>
                              <input className={inputCls} inputMode="numeric" value={bandoQtd}
                                onChange={e => setBandoQtd(e.target.value)}
                                placeholder="1" />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {modelo === 'Avulso' && (
                  <>
                    <div>
                      <label className={labelCls}>O que é</label>
                      <CustomSelect value={avulsoTipo}
                        onChange={v => { setAvulsoTipo(v as 'bando' | 'componente'); setArtigo('') }}
                        options={[{ value: 'bando', label: 'Só o bandô' }, { value: 'componente', label: 'Peça de ferragem' }]} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={labelCls}>{opcoesItem(prodTopo, opcoes).rotulo}</label>
                      <CustomSelect value={artigo} onChange={setArtigo}
                        options={opcoesItem(prodTopo, opcoes).options}
                        placeholder={opcoes ? 'Escolha…' : 'Carregando…'} />
                    </div>
                  </>
                )}

                {(modelo === 'PV' || modelo === 'PH_Aluminio') && (
                  <div>
                    <label className={labelCls}>Artigo</label>
                    <CustomSelect value={artigo} onChange={setArtigo}
                      options={(modelo === 'PV' ? opcoes?.artigosPV : opcoes?.artigosPH) ?? []}
                      placeholder={opcoes ? 'Escolha o artigo…' : 'Carregando…'} />
                  </div>
                )}

                {modelo === 'PH_50' && (
                  <>
                    <div>
                      <label className={labelCls}>Modelo / cor</label>
                      <CustomSelect value={artigo} onChange={setArtigo}
                        options={(opcoes?.ph50 ?? []).map(i => ({ value: i.valor, label: i.label }))}
                        placeholder={opcoes ? 'Escolha…' : 'Carregando…'} />
                    </div>
                    <div>
                      <label className={labelCls}>Acabamento</label>
                      <CustomSelect value={ph50Acab} onChange={v => setPh50Acab(v as 'cadarco' | 'fita')}
                        options={[{ value: 'cadarco', label: 'Com cadarço' }, { value: 'fita', label: 'Com fita' }]} />
                    </div>
                    <div className="flex items-end">
                      <Interruptor ligado={ph50Bando} onChange={setPh50Bando}>Incluir bandô</Interruptor>
                    </div>
                  </>
                )}
              </div>

              <div>
                <div className="mb-1.5 flex items-center gap-2 select-none" aria-hidden="true">
                  <Ruler className="h-3 w-3 text-primary/40" />
                  <span className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-foreground/35">Medidas</span>
                  <div className="flex-1 h-px bg-border/50" />
                </div>
                {/* Uma medida = um sub-cartão, igual ao Calcular. A principal é a
                    primeira; as extras têm numerinho e lixeira. Ambiente por medida:
                    Sala 1 + Quarto na mesma venda. */}
                <div className="space-y-2">
                  {[{ id: 0 as number | null, largura, altura, qtd: quantidade, amb: ambiente, prod: null as Prod | null }, ...extras].map((m, idx) => {
                    const extra = idx > 0
                    const prodLinha = m.prod ?? prodTopo
                    /** o produto em vigor na linha de cima — é dele que a troca parte */
                    const prodAnterior = (idx >= 2 ? extras[idx - 2].prod : null) ?? prodTopo
                    const setProd = (p: Prod | null) => setExtras(q => q.map(y => y.id === m.id ? { ...y, prod: p, resultado: null } : y))
                    const setL = (v: string) => extra ? setExtras(p => p.map(y => y.id === m.id ? { ...y, largura: v, resultado: null } : y)) : setLargura(v)
                    const setA = (v: string) => extra ? setExtras(p => p.map(y => y.id === m.id ? { ...y, altura: v, resultado: null } : y)) : setAltura(v)
                    const setQ = (v: string) => extra ? setExtras(p => p.map(y => y.id === m.id ? { ...y, qtd: v, resultado: null } : y)) : setQuantidade(v)
                    const setAmb = (v: string) => extra ? setExtras(p => p.map(y => y.id === m.id ? { ...y, amb: v } : y)) : setAmbiente(v)
                    const area = (parseFloat(m.largura) || 0) * (parseFloat(m.altura) || 0) * (parseInt(m.qtd) || 1)
                    return (
                      <div key={extra ? `x${m.id}` : 'principal'} className="rounded-lg border border-border/60 bg-muted/10 p-3">
                        {extras.length > 0 && (
                          <div className="mb-2 flex items-center gap-2">
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[9px] font-bold text-foreground/50">{idx + 1}</span>
                            {area > 0 && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">{area.toFixed(2)} m²</span>}
                            {extra && m.prod && (
                              <span className="truncate text-[10px] font-semibold text-foreground/50">{rotuloModeloDe(m.prod)}</span>
                            )}
                            <div className="flex-1" />
                            {/* opcional: a maioria das vendas é tudo igual, então a troca fica atrás do link */}
                            {extra && (
                              <button type="button" onClick={() => setProd(m.prod ? null : { ...prodAnterior })}
                                className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/[0.06] touch-manipulation">
                                {m.prod ? 'usar o mesmo modelo' : 'trocar modelo'}
                              </button>
                            )}
                            {extra && (
                              <button type="button" onClick={() => setExtras(p => p.filter(y => y.id !== m.id))} title="Remover medida"
                                className="rounded-md p-1 text-foreground/30 transition-all duration-150 hover:bg-destructive/10 hover:text-destructive touch-manipulation">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                        {extra && m.prod && (
                          <SeletoresLinha prod={m.prod} opcoes={opcoes} onChange={setProd} />
                        )}
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3">
                          <div>
                            <label className={labelCls}><span className="sm:hidden">Larg. (m)</span><span className="hidden sm:inline">Largura (m)</span></label>
                            <input className={inputCls} inputMode="decimal" placeholder="1,20"
                              value={m.largura} onChange={e => setL(e.target.value.replace(',', '.'))} />
                          </div>
                          <div>
                            <label className={labelCls}><span className="sm:hidden">Alt. (m)</span><span className="hidden sm:inline">Altura (m)</span></label>
                            <input className={cn(inputCls, !precisaAltura(prodLinha) && 'opacity-50')} inputMode="decimal"
                              placeholder={precisaAltura(prodLinha) ? '1,50' : 'não tem'} disabled={!precisaAltura(prodLinha)}
                              value={precisaAltura(prodLinha) ? m.altura : ''} onChange={e => setA(e.target.value.replace(',', '.'))} />
                          </div>
                          <div>
                            <label className={labelCls}>Qtd</label>
                            <input className={inputCls} inputMode="numeric"
                              value={m.qtd} onChange={e => setQ(e.target.value)} />
                          </div>
                          <div className="col-span-3 sm:col-span-1">
                            <label className={labelCls}>Ambiente</label>
                            <input className={inputCls} placeholder={extra ? 'Quarto…' : 'Sala…'} list="sugestoes-ambiente-sim"
                              value={m.amb} onChange={e => setAmb(e.target.value)} />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <datalist id="sugestoes-ambiente-sim">
                  {SUGESTOES_AMBIENTE.map(s => <option key={s} value={s} />)}
                </datalist>
                <BotaoAdicionar className="mt-2"
                  onClick={() => setExtras(p => {
                    // a linha nova herda o produto da de cima (se ela tinha um próprio)
                    const anterior = p[p.length - 1]?.prod ?? null
                    return [...p, { id: extraIdRef.current++, largura: '', altura: '', qtd: '1', amb: '', resultado: null, calcChave: null, prod: anterior && { ...anterior } }]
                  })}>
                  Adicionar medida
                </BotaoAdicionar>

                <Interruptor className="mt-3" ligado={instalacao} onChange={setInstalacao}>Incluir instalação</Interruptor>
              </div>
            </div>
          </section>

          {/* SEÇÃO 2: Cliente (opcional — fica preenchido entre um salvamento e outro) */}
          <section>
            <SectionHeader step="2" icon={<User className="h-3.5 w-3.5" />} title="Cliente"
              hint="— opcional; vale pra todos os modelos que salvar nesta visita" />
            <div className="mt-3 rounded-xl border border-border bg-card p-4 sm:p-5 shadow-sm">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="relative">
                  <label className={labelCls}>Nome</label>
                  <input className={inputCls} placeholder="Balcão" autoComplete="off"
                    value={cliente}
                    onChange={e => { setCliente(e.target.value); setSugestoesAbertas(true) }}
                    onFocus={() => setSugestoesAbertas(true)}
                    onBlur={() => setTimeout(() => setSugestoesAbertas(false), 150)} />
                  {/* cliente conhecido: clica e preenche, sem remontar cadastro */}
                  {sugestoesAbertas && sugestoesCliente.length > 0 && (
                    <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border bg-card shadow-elevated">
                      {sugestoesCliente.map(s => (
                        <button key={s.nome} type="button"
                          onMouseDown={e => {
                            e.preventDefault()
                            setCliente(s.nome)
                            if (s.telefone && !telefone.trim()) setTelefone(s.telefone)
                            setSugestoesAbertas(false)
                          }}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-primary/[0.06]">
                          <span className="truncate font-medium">{s.nome}</span>
                          {s.telefone && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{s.telefone}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {historicoCliente && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-primary">
                      <History className="h-3 w-3 shrink-0" />
                      Cliente conhecido: {resumoHistorico(historicoCliente)}
                    </p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Telefone</label>
                  <input className={inputCls} inputMode="tel" placeholder="(00) 00000-0000"
                    value={telefone} onChange={e => setTelefone(e.target.value)} />
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* ── COLUNA DIREITA: valor + salvar + salvos da visita ── */}
        <div className="xl:sticky xl:top-24 h-fit space-y-3">
          <div className={cn(
            'rounded-xl border-2 bg-card p-5 shadow-sm transition-all',
            ok ? 'border-primary/25' : 'border-border',
            calculando && 'opacity-60',
          )}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-foreground/50">Valor pro cliente</p>
              {calculando && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            </div>

            {!pronto && !ok && carrinho.length === 0 && (
              <p className="mt-3 flex items-center gap-2 text-sm text-foreground/40">
                <Calculator className="h-4 w-4 shrink-0" />
                Escolha o produto e as medidas — o preço aparece aqui na hora.
              </p>
            )}

            {pronto && resultado?.erro && !calculando && (
              <div className="mt-3">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">{resultado.erro}</p>
                {/* atalho: a recusa da ferragem preta tem uma solução óbvia — dar ela pronta */}
                {corFerragem === 'PRETA' && /branca/i.test(resultado.erro) && (
                  <button
                    type="button"
                    onClick={() => setCorFerragem('BRANCA')}
                    className="mt-2 rounded-lg bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-700 transition-colors hover:bg-amber-500/25 dark:text-amber-300"
                  >
                    Cotar com ferragem branca
                  </button>
                )}
              </div>
            )}

            {soma && (
              <>
                <p className="mt-1 font-display text-4xl font-bold tabular-nums text-primary">{brl(soma!.t4)}</p>
                {/* o que compõe a venda: produtos guardados + o atual */}
                {(carrinho.length > 0 || soma!.rs.length > 1) && (
                  <div className="mt-2 space-y-0.5 rounded-lg bg-muted/30 px-2.5 py-2">
                    {carrinho.map(c => (
                      <p key={c.id} className="flex items-center justify-between gap-2 text-xs text-foreground/70">
                        <span className="min-w-0 truncate">{c.rotuloModelo} · {c.detalhe}</span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <span className="font-semibold tabular-nums">{brl(c.resultado.total4x)}</span>
                          <button type="button" onClick={() => setCarrinho(p => p.filter(y => y.id !== c.id))}
                            title="Tirar da venda"
                            className="text-muted-foreground/50 transition-colors hover:text-destructive">
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      </p>
                    ))}
                    {ok && (
                      <p className="flex justify-between gap-2 text-xs text-foreground/70">
                        <span className="tabular-nums">{medidaTxt(prodTopo, largura, altura)} ×{quantidade || 1}</span>
                        <span className="font-semibold tabular-nums">{brl(ok.total4x)}</span>
                      </p>
                    )}
                    {ok && extrasOk.map(x => (
                      <p key={x.id} className="flex justify-between gap-2 text-xs text-foreground/70">
                        <span className="min-w-0 truncate tabular-nums">{x.prod ? `${rotuloModeloDe(x.prod)} · ` : ''}{medidaTxt(x.prod ?? prodTopo, x.largura, x.altura)} ×{x.qtd || 1}</span>
                        <span className="font-semibold tabular-nums">{brl((x.resultado as Resultado).total4x)}</span>
                      </p>
                    ))}
                  </div>
                )}
                {/* produto novo pro MESMO cliente — modelo e tecido diferentes */}
                {ok && !extrasPendentes && (
                  <BotaoAdicionar className="mt-3" tamanho="md" onClick={guardarProduto}>
                    Guardar e adicionar outro produto (modelo/tecido)
                  </BotaoAdicionar>
                )}
                {extrasCalculando > 0 && (
                  <p className="mt-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                    Calculando as medidas extras… faltam {extrasCalculando}
                  </p>
                )}
                {/* sem isto a medida que falhou ficava em "Calculando…" pra sempre */}
                {extrasComErro.length > 0 && (
                  <div className="mt-1.5 space-y-0.5 rounded-lg bg-amber-500/10 px-2.5 py-2">
                    {extrasComErro.map(x => (
                      <p key={x.id} className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                        Medida {extras.findIndex(y => y.id === x.id) + 2} ({medidaTxt(x.prod ?? prodTopo, x.largura, x.altura)}): {x.resultado!.erro}
                      </p>
                    ))}
                    <button type="button" onClick={recalcularExtrasComErro}
                      className="mt-1 rounded-md bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-700 transition-colors hover:bg-amber-500/25 dark:text-amber-300">
                      Tentar de novo
                    </button>
                  </div>
                )}
                <p className="mt-0.5 text-sm text-foreground/60">
                  em até <strong>4x de {brl(soma!.t4 / 4)}</strong> sem juros
                </p>
                <p className="text-sm text-foreground/60">
                  à vista <strong>{brl(soma!.av)}</strong> (−5%)
                </p>
                {soma!.inst != null && (
                  <p className="mt-1 text-sm text-foreground/60">
                    Instalação: <strong>{soma!.inst === 'sob_consulta' ? 'sob consulta' : brl(soma!.inst)}</strong>
                    {typeof soma!.inst === 'number' && <> · total <strong>{brl(soma!.t4 + soma!.inst)}</strong></>}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {ok?.emPromocao && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-bold text-primary">
                      <Tag className="h-3 w-3" /> em promoção{ok.descontoPct != null && ` (−${ok.descontoPct}%)`} — avise o cliente!
                    </span>
                  )}
                  {ok?.observacoes.map((o, i) => <span key={i}>{o}</span>)}
                </div>

                {ehAdminView && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                    <span className="rounded-full bg-muted px-2 py-0.5">
                      Custo: {brl(soma!.custo ?? 0)}
                    </span>
                    {margem != null && (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-600 dark:text-emerald-400">
                        Margem: {margem.toFixed(0)}%
                      </span>
                    )}
                    <span className="text-foreground/35">(só admin vê)</span>
                  </div>
                )}

                <div className="mt-4 border-t border-border/60 pt-4">
                  <label className={labelCls}>Forma de pagamento</label>
                  <div className="mb-3 grid grid-cols-3 gap-1.5">
                    {[
                      { id: 'cartao_4x', rotulo: 'Cartão 4x', valor: () => soma?.t4, vezes: '4' },
                      { id: 'a_vista', rotulo: 'À vista −5%', valor: () => soma?.av, vezes: '1' },
                      { id: 'outro', rotulo: 'Outro', valor: () => undefined, vezes: '' },
                    ].map(op => (
                      <button
                        key={op.id}
                        type="button"
                        onClick={() => {
                          setFormaPagamento(op.id)
                          if (op.vezes) setParcelas(op.vezes)
                          const v = op.valor()
                          // a forma escolhida já preenche o valor real da venda
                          setValorCobrado(v != null ? v.toFixed(2) : '')
                        }}
                        className={cn(
                          'rounded-lg border px-2 py-2 text-xs font-semibold transition-all active:scale-95',
                          formaPagamento === op.id
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-foreground/60 hover:border-muted-foreground/40 hover:bg-muted/30',
                        )}
                      >
                        {op.rotulo}
                      </button>
                    ))}
                  </div>
                  {formaPagamento === 'outro' && (
                    <div className="mb-3">
                      <label className={labelCls}>Em quantas vezes?</label>
                      <input className={inputCls} inputMode="numeric" placeholder="5"
                        value={parcelas} onChange={e => setParcelas(e.target.value)} />
                    </div>
                  )}
                  <label className={labelCls}>Pagou de outro jeito? (opcional)</label>
                  <input
                    className={cn(inputCls, 'mb-3')}
                    placeholder="ex.: 5x no link, PIX + cartão"
                    maxLength={120}
                    value={formaReal}
                    onChange={e => setFormaReal(e.target.value)}
                  />
                  <label className={labelCls}>Valor cobrado do cliente</label>
                  <input
                    className={inputCls}
                    inputMode="decimal"
                    placeholder={soma ? brl(soma.t4).replace('R$ ', '') : ''}
                    value={valorCobrado}
                    onChange={e => setValorCobrado(e.target.value.replace(',', '.'))}
                  />
                  {(() => {
                    const cobrado = num(valorCobrado)
                    const efetivo = cobrado || soma!.t4
                    const n = Math.round(num(parcelas))
                    // "no valor real tem que aparecer embaixo os quatro vezes" — sempre visível
                    const linhaParcela = n >= 2 && efetivo > 0 ? (
                      <p className="mt-1 text-[11px] font-semibold text-foreground/70 tabular-nums">
                        {n}x de {brl(efetivo / n)}
                      </p>
                    ) : null
                    if (!cobrado || Math.abs(cobrado - soma!.t4) < 0.01) {
                      return <>{linhaParcela}<p className="mt-1 mb-3 text-[11px] text-foreground/40">Deixe vazio para cobrar o valor calculado.</p></>
                    }
                    const dif = cobrado - soma!.t4
                    const pct = (dif / soma!.t4) * 100
                    // acréscimo em "Outro" é juros de parcelamento — e é assim que fica gravado
                    const ehJuros = formaPagamento === 'outro' && dif > 0
                    return (
                      <>
                        {linhaParcela}
                        <p className={cn('mt-1 mb-3 text-[11px] font-semibold',
                          dif < 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>
                          {dif < 0 ? 'Desconto' : ehJuros ? 'Juros' : 'Acréscimo'} de {brl(Math.abs(dif))} ({Math.abs(pct).toFixed(1)}%)
                          {dif < 0 && soma!.custo != null && (
                            <> · margem cai para {(((cobrado - soma!.custo!) / cobrado) * 100).toFixed(0)}%</>
                          )}
                          {ehJuros && ' — fica registrado na venda'}
                        </p>
                      </>
                    )
                  })()}
                  <button
                    type="button"
                    onClick={salvar}
                    disabled={salvando || calculando || salvoAtual || extrasPendentes}
                    className={cn(
                      'flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3.5 text-sm font-bold transition-all duration-150 active:scale-[0.98]',
                      salvoAtual
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 cursor-default'
                        : 'bg-brand-gradient text-white shadow-brand hover:opacity-95 disabled:opacity-60',
                    )}
                  >
                    {salvando ? <Loader2 className="h-4 w-4 animate-spin" />
                      : salvoAtual ? <CheckCircle2 className="h-4 w-4" />
                      : <Save className="h-4 w-4" />}
                    {salvoAtual
                      ? (modoVenda ? 'Venda registrada! Troque o modelo pra somar outra' : 'Salvo! Troque o modelo pra salvar outro')
                      : (modoVenda ? 'Registrar venda' : 'Salvar orçamento')}
                  </button>
                  <p className="mt-1.5 text-[11px] text-foreground/40">
                    <Sparkles className="mr-1 inline h-3 w-3" />
                    {modoVenda
                      ? 'Entra como venda fechada no Semanário. Os dados do cliente continuam aqui pro próximo item.'
                      : 'Salva direto na Planilha, sem WhatsApp. Os dados do cliente continuam aqui pro próximo modelo.'}
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Limpar sempre à mão — zera produto, cliente e a lista da visita */}
          <button
            type="button"
            onClick={limparTudo}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/5 hover:text-destructive"
            title="Zera produto, cliente e os salvos — pronto pra próxima visita"
          >
            <Eraser className="h-3.5 w-3.5" />
            Limpar tudo
          </button>

          {/* Salvos nesta visita */}
          {salvos.length > 0 && (
            <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
              <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 px-4 py-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-foreground/50">
                  Salvos nesta visita ({salvos.length})
                </p>
                <button
                  type="button"
                  onClick={limparTudo}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  title="Limpar tudo e começar outra visita"
                >
                  <Eraser className="h-3 w-3" />
                  Limpar tudo
                </button>
              </div>
              <div className="divide-y divide-border/40">
                {salvos.map(s => (
                  <div key={s.id} className="flex items-center gap-2.5 px-4 py-2.5">
                    <Zap className="h-3.5 w-3.5 shrink-0 text-primary/60" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-foreground">{s.modelo}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{s.detalhe}</p>
                    </div>
                    <span className="shrink-0 text-xs font-bold tabular-nums text-primary">{brl(s.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </>
  )
}

/** Os seletores próprios de uma medida extra — aparecem só depois do "trocar modelo". */
function SeletoresLinha({ prod, opcoes, onChange }: { prod: Prod; opcoes: Opcoes | undefined; onChange: (p: Prod) => void }) {
  const item = opcoesItem(prod, opcoes)
  const comTecido = COM_TECIDO.has(prod.modelo)
  return (
    <div className="mb-3 grid grid-cols-1 gap-2 border-b border-border/50 pb-3 sm:grid-cols-2 sm:gap-3">
      <div>
        <label className={labelCls}>Modelo</label>
        <CustomSelect value={prod.modelo}
          onChange={v => onChange({ ...prod, modelo: v, tecido: '', artigo: '', acabamento: 'nenhum' })}
          options={MODELOS.map(m => ({ value: m.id, label: m.label }))} />
      </div>
      {prod.modelo === 'Avulso' && (
        <div>
          <label className={labelCls}>O que é</label>
          <CustomSelect value={prod.avulsoTipo}
            onChange={v => onChange({ ...prod, avulsoTipo: v as 'bando' | 'componente', artigo: '' })}
            options={[{ value: 'bando', label: 'Só o bandô' }, { value: 'componente', label: 'Peça de ferragem' }]} />
        </div>
      )}
      <div>
        <label className={labelCls}>{item.rotulo}</label>
        <CustomSelect value={comTecido ? prod.tecido : prod.artigo}
          onChange={v => onChange(comTecido ? { ...prod, tecido: v } : { ...prod, artigo: v })}
          options={item.options} placeholder={opcoes ? 'Escolha…' : 'Carregando…'} />
      </div>
      {(prod.modelo === 'Rolo' || prod.modelo === 'Double') && (
        <div>
          <label className={labelCls}>Ferragem</label>
          <CustomSelect value={prod.corFerragem} onChange={v => onChange({ ...prod, corFerragem: v as 'BRANCA' | 'PRETA' })}
            options={[{ value: 'BRANCA', label: 'Branca' }, { value: 'PRETA', label: 'Preta' }]} />
        </div>
      )}
      {comTecido && (
        <div>
          <label className={labelCls}>Acabamento</label>
          <CustomSelect value={prod.acabamento} onChange={v => onChange({ ...prod, acabamento: v })}
            options={[
              { value: 'nenhum', label: 'Sem acabamento' },
              { value: 'bando_branco', label: 'Bandô branco' },
              { value: 'bando_preto', label: 'Bandô preto' },
              { value: 'barra', label: 'Barra niveladora' },
              ...(prod.modelo === 'Rolo' || prod.modelo === 'Rolo Motorizado' ? [{ value: 'kit_box', label: 'Kit Box' }] : []),
            ]} />
        </div>
      )}
    </div>
  )
}
