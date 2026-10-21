/**
 * As rotas da calculadora da Amanda de voz, iguais na bancada (voz/orcamento/servidor.ts, preços de
 * uma foto) e no ar (supabase/functions/orcamento-voz, preços do banco na hora):
 *   POST .../persiana  PedidoPersiana
 *   POST .../cortina   PedidoCortina
 *   GET  .../tecidos[?modelo=Rolo&tipo=blackout]
 * A voz só troca a URL; quem faz a conta é sempre orcar.ts.
 */
import {
  orcarCortina, orcarPersiana, tecidosDoModelo,
  type DadosVoz, type PedidoCortina, type PedidoPersiana, type TipoTecido,
} from './orcar.ts'
import type { ModeloSim } from '../simulador.ts'

/** campo de DadosVoz → tabela de preços do banco (a foto da bancada tem um JSON por tabela) */
export const TABELAS = {
  tecidos: 'precos_tecidos_vigentes', componentes: 'precos_ferragem_componentes',
  bandos: 'precos_bandos', bandoParams: 'precos_bandos_params', barraFaixas: 'precos_barra_faixas',
  colocacao: 'precos_colocacao', artigos: 'precos_artigos', ph50: 'precos_ph50',
  parametros: 'precos_parametros', romana: 'precos_romana_matriz',
  motorEstrutura: 'precos_motor_estrutura', motorComponentes: 'precos_motor_componentes',
  familias: 'precos_ferragem_familias', tecidoModelos: 'precos_tecido_modelos',
  cortinaTecidos: 'precos_cortina_tecidos', cortinaValores: 'precos_cortina_valores',
} as const

type Linhas = Record<keyof typeof TABELAS, unknown[]>

/** monta os dados do motor a partir das linhas de cada tabela, venham do banco ou da foto */
export async function carregarDados(ler: (tabela: string) => Promise<unknown[]> | unknown[]): Promise<DadosVoz> {
  const campos = Object.keys(TABELAS) as (keyof typeof TABELAS)[]
  const linhas = Object.fromEntries(
    await Promise.all(campos.map(async c => [c, (await ler(TABELAS[c])) ?? []] as const)),
  ) as Linhas
  const { cortinaTecidos, cortinaValores, ...resto } = linhas
  return { ...resto, cortina: { tecidos: cortinaTecidos, valores: cortinaValores } } as unknown as DadosVoz
}

/** a rota é o último pedaço do caminho: /persiana, /functions/v1/orcamento-voz/persiana... */
export function atender(caminho: string, params: URLSearchParams, corpo: Record<string, unknown>,
                        dados: DadosVoz): { status: number; corpo: unknown } {
  const rota = caminho.replace(/\/+$/, '').split('/').pop()
  if (rota === 'persiana') return { status: 200, corpo: orcarPersiana(corpo as unknown as PedidoPersiana, dados) }
  if (rota === 'cortina') return { status: 200, corpo: orcarCortina(corpo as unknown as PedidoCortina, dados) }
  if (rota === 'tecidos') {
    const modelo = params.get('modelo') as ModeloSim | null
    if (modelo === null) {
      return { status: 200, corpo: { cortina: dados.cortina.tecidos.map(t => ({ nome: t.nome, tipo: t.tipo })) } }
    }
    const tipo = (params.get('tipo') || undefined) as TipoTecido | undefined
    return { status: 200, corpo: { modelo, tecidos: tecidosDoModelo(modelo, dados, tipo) } }
  }
  return { status: 404, corpo: { erro: 'rota inexistente' } }
}
