/**
 * Orçamento para a Amanda de voz, sempre pelo motor do Dash (simulador.ts e cortina.ts).
 *
 * A IA nunca faz conta: ela traduz o pedido em campos e esta função devolve o número.
 * "Tecido mais barato" não é regra paralela: calcula todo tecido que serve no modelo (e no
 * tipo pedido, se houver) e fica com o menor total. O número é sempre o do motor.
 */
import { simular, type AcabamentoSim, type DadosSim, type EntradaSim, type ModeloSim } from '../simulador.ts'
import { calcularCortina, type DadosCortina, type ModeloCortina, type SuporteCortina } from '../cortina.ts'

export type TipoTecido = 'blackout' | 'tela_solar' | 'tela_solar_1' | 'tela_solar_3' | 'decorativo'

export interface DadosVoz extends DadosSim {
  /** quais tecidos cada modelo aceita (precos_tecido_modelos) */
  tecidoModelos: { tecido_nome: string; modelo: string }[]
  cortina: DadosCortina
}

export interface PedidoPersiana {
  modelo: ModeloSim
  largura: number
  altura: number
  /** medida do VÃO da janela: a persiana leva +10 cm de cada lado (regra da loja, 18/08) */
  medidaDoVao?: boolean
  quantidade?: number
  /** nome exato do tecido/artigo; vazio = o mais barato que serve */
  tecido?: string
  tipoTecido?: TipoTecido
  corFerragem?: 'BRANCA' | 'PRETA'
  acabamento?: AcabamentoSim
  incluirInstalacao?: boolean
  ph50Acabamento?: 'cadarco' | 'fita'
  motorForca?: EntradaSim['motorForca']
}

export interface PedidoCortina {
  modelo?: ModeloCortina
  largura: number
  altura: number
  /** medida do VÃO: cortina leva +20 cm de cada lado e +20 em cima e embaixo (loja, 19/08) */
  medidaDoVao?: boolean
  /** cortina de porta: embaixo não sobra (só +20 cm na altura) */
  porta?: boolean
  quantidade?: number
  tecido: string
  forro?: string | null
  suporte: SuporteCortina
  incluirColocacao?: boolean
}

export type Orcamento =
  | { ok: true; tecido: string; maisBarato: boolean; largura: number; altura: number;
      total4x: number; totalAvista: number;
      instalacao: number | 'sob_consulta' | null; observacoes: string[] }
  | { ok: false; erro: string; sugestoes?: string[] }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()

/** o motor quer "modelo|cor" no PH 50; a tabela de modelos guarda "modelo - cor" */
const artigoPh50 = (nome: string) => nome.replace(' - ', '|')

function tipoDoTecido(nome: string, modelo: ModeloSim, d: DadosVoz): string {
  if (modelo === 'PV') return /^BK /.test(norm(nome)) ? 'blackout' : 'decorativo'
  if (modelo === 'PH_Aluminio' || modelo === 'PH_50') return 'decorativo'
  return d.tecidos.find(t => norm(t.nome) === norm(nome))?.tipo ?? ''
}

function serveNoTipo(tipo: string, pedido?: TipoTecido): boolean {
  if (!pedido) return true
  if (pedido === 'tela_solar') return tipo.startsWith('tela_solar')
  return tipo === pedido
}

const num = (s: string) => Number(s.replace(',', '.'))

/** "BK LINHO ATÉ 1,40 X 1,40": tecido que só existe até essa medida */
function cabeNoLimite(nome: string, largura?: number, altura?: number): boolean {
  const lim = norm(nome).match(/ATE\s*([\d.,]+)\s*X\s*([\d.,]+)/)
  if (!lim || largura == null || altura == null) return true
  return largura <= num(lim[1]) + 1e-9 && altura <= num(lim[2]) + 1e-9
}

/** "SCREEN 3%", "blackout", "mais barato decorativo": é um tipo, não um nome de tecido */
export function tipoNoTexto(texto: string): TipoTecido | undefined {
  const t = norm(texto)
  if (/\bBK\b|BLACKOUT/.test(t)) return 'blackout'
  if (/(TELA|SCREEN|SOLAR).*\b1\s*%/.test(t)) return 'tela_solar_1'
  if (/(TELA|SCREEN|SOLAR).*\b3\s*%/.test(t)) return 'tela_solar_3'
  if (/TELA|SCREEN|SOLAR/.test(t)) return 'tela_solar'
  if (/DECORATIV|TRANSL/.test(t)) return 'decorativo'
  return undefined
}

/** tecidos que o modelo aceita, no tipo pedido e na medida, com o nome que o motor entende */
export function tecidosDoModelo(modelo: ModeloSim, d: DadosVoz, tipo?: TipoTecido,
                                largura?: number, altura?: number): string[] {
  const nomes = [...new Set(d.tecidoModelos.filter(m => m.modelo === modelo).map(m => m.tecido_nome))]
  return nomes.filter(n => serveNoTipo(tipoDoTecido(n, modelo, d), tipo) && cabeNoLimite(n, largura, altura))
}

function entrada(p: PedidoPersiana, tecido: string): EntradaSim {
  const comArtigo = p.modelo === 'PV' || p.modelo === 'PH_Aluminio' || p.modelo === 'PH_50'
  return {
    modelo: p.modelo,
    tecido: comArtigo ? undefined : tecido,
    artigo: comArtigo ? (p.modelo === 'PH_50' ? artigoPh50(tecido) : tecido) : undefined,
    ph50Acabamento: p.ph50Acabamento,
    corFerragem: p.corFerragem ?? 'BRANCA',
    largura: p.largura,
    altura: p.altura,
    quantidade: p.quantidade ?? 1,
    acabamento: p.acabamento ?? 'nenhum',
    motorForca: p.motorForca,
    incluirInstalacao: p.incluirInstalacao ?? false,
  }
}

const r2m = (v: number) => Math.round(v * 100) / 100

export function orcarPersiana(pedido: PedidoPersiana, d: DadosVoz): Orcamento {
  const p = pedido.medidaDoVao
    ? { ...pedido, largura: r2m(pedido.largura + 0.2), altura: r2m(pedido.altura + 0.2), medidaDoVao: false }
    : pedido
  const todos = tecidosDoModelo(p.modelo, d)
  let candidatos: string[]
  const exato = p.tecido?.trim() ? todos.find(n => norm(n) === norm(p.tecido!)) : undefined
  // texto que só diz o tipo ("SCREEN 3%", "mais barato blackout") vira busca do mais barato
  if (p.tecido?.trim() && !exato && (/MAIS BARAT|A PARTIR|QUALQUER/.test(norm(p.tecido)) || tipoNoTexto(p.tecido))) {
    return orcarPersiana({ ...p, tecido: undefined, tipoTecido: p.tipoTecido ?? tipoNoTexto(p.tecido) }, d)
  }
  if (p.tecido?.trim()) {
    const achado = exato
    if (!achado) {
      const pedaco = norm(p.tecido).split(' ')
      const parecidos = todos.filter(n => pedaco.some(w => w.length > 2 && norm(n).includes(w)))
      return { ok: false, erro: `Tecido "${p.tecido}" não existe para ${p.modelo}.`,
               sugestoes: (parecidos.length ? parecidos : todos).slice(0, 8) }
    }
    candidatos = [achado]
  } else {
    candidatos = tecidosDoModelo(p.modelo, d, p.tipoTecido, p.largura, p.altura)
    if (!candidatos.length) {
      return { ok: false, erro: `${p.modelo} não tem tecido${p.tipoTecido ? ` do tipo ${p.tipoTecido}` : ''} nessa medida.` }
    }
  }

  let melhor: (Orcamento & { ok: true }) | null = null
  let ultimoErro = ''
  for (const t of candidatos) {
    const r = simular(entrada(p, t), d)
    if ('erro' in r) { ultimoErro = r.erro; continue }
    if (!melhor || r.totalAvista < melhor.totalAvista) {
      melhor = { ok: true, tecido: t, maisBarato: !p.tecido?.trim(), largura: p.largura,
                 altura: p.altura, total4x: r.total4x,
                 totalAvista: r.totalAvista, instalacao: r.instalacao, observacoes: r.observacoes }
    }
  }
  return melhor ?? { ok: false, erro: ultimoErro || 'Nenhum tecido serve nessa medida.' }
}

export function orcarCortina(p: PedidoCortina, d: DadosVoz): Orcamento {
  const largura = p.medidaDoVao ? r2m(p.largura + 0.4) : p.largura
  const altura = p.medidaDoVao ? r2m(p.altura + (p.porta ? 0.2 : 0.4)) : p.altura
  const r = calcularCortina({
    modelo: p.modelo ?? 'wave', largura, altura, tecido: p.tecido,
    forro: p.forro ?? null, suporte: p.suporte, quantidade: p.quantidade ?? 1,
    incluirColocacao: p.incluirColocacao ?? false,
  }, d.cortina)
  if ('erro' in r) {
    return { ok: false, erro: r.erro,
             sugestoes: d.cortina.tecidos.filter(t => t.tipo === 'tecido').map(t => t.nome) }
  }
  return { ok: true, tecido: p.tecido, maisBarato: false, largura, altura, total4x: r.parcelado, totalAvista: r.avista,
           instalacao: null, observacoes: r.observacoes }
}
