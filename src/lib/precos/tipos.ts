/**
 * Tipos das tabelas `precos_*` — o vocabulário que o motor de orçamento fala.
 *
 * Moram aqui, e não em `usePrecos.ts`, por um motivo concreto: o motor
 * (`src/lib/simulador.ts`) roda nos dois lados — no dash e dentro da Edge
 * Function `simular`. Enquanto os tipos vinham do hook, o lado Deno não
 * conseguia importar o arquivo de verdade (o hook puxa React Query e o alias
 * `@/`), e a saída tinha sido manter uma CÓPIA colada à mão do motor em
 * `supabase/functions/simular/calc.ts`. Essa cópia divergiu em silêncio duas
 * vezes e uma aspa órfã nela já derrubou um deploy.
 *
 * Então: nenhum import aqui. Só tipo. É o que permite o motor ter um dono só.
 * `usePrecos.ts` reexporta tudo, então quem já importava de lá não muda nada.
 */

export interface PrecoTecido {
  id: number; nome: string; tipo: 'blackout' | 'tela_solar' | 'tela_solar_1' | 'tela_solar_3' | 'decorativo' | 'outro'
  largura: number; preco: number
}
export interface PrecoArtigo { id: number; categoria: 'PV' | 'PH_ALUMINIO'; nome: string; preco: number }
export interface PrecoPh50 {
  id: number; modelo: string; cor: string; preco_cadarco: number
  preco_fita: number | null; bando_ml: number | null; aba_pc: number | null
}
export interface PrecoFerragemFamilia {
  familia: string; cor: string; espessura: number; larg_min: number; larg_max: number; passo: number
}
export interface PrecoFerragemComponente {
  id: number; familia: string; cor: string; espessura: number
  item: string; tipo_custo: 'por_metro' | 'fixo' | 'opcional_ml' | 'opcional_par'; valor: number
}
export interface PrecoFerragemEscada { familia: string; cor: string; espessura: number; largura: number; custo: number }
export interface PrecoBando { id: number; cor: string; largura: number; qtd_cd: number; qtd_par: number | null }
export interface PrecoBandoParams { cor: string; preco_metro: number; par: number; cd1: number; cd2: number }
export interface PrecoColocacao { id: number; ml_min: number; ml_max: number; preco: number }
export interface PrecoMotorEstrutura {
  id: number; largura: number; alt_faixa: string; valor: number
  obs: string | null; grupo: string | null; valor_extra: number | null; ordem: number | null
}
export interface PrecoMotorComponente { id: number; item: string; custo: number; quantidade: number | null }
export interface PrecoRomanaMatriz { largura: number; altura: number; custo: number }
export interface PrecoParametro { chave: string; valor: number; descricao: string | null }
export interface PrecoPromocao {
  id: number; alvo_tipo: 'tecido' | 'artigo' | 'modelo'; alvo_nome: string
  desconto_pct: number; inicio: string; fim: string
}
export interface PrecoBarraFaixa { largura_min: number; qtd_presilhas: number }
export interface PrecoTecidoModelo { tecido_nome: string; modelo: string }
export interface PrecoTecidoVigente {
  id: number; nome: string; tipo: string; largura: number
  preco: number; preco_cheio: number; desconto_pct: number | null; em_promocao: boolean
  promo_fim: string | null
}

export interface PrecoCortinaTecido {
  id: number; nome: string; tipo: string; preco: number
  largura_rolo: number; observacao: string | null
  /**
   * De qual material comprado vem este tecido de venda. Dito pela loja, uma
   * vez: "Microfibra 90g (3,00m)" não se parece com "MICROFIBRA 3.00M BEGE",
   * e casar por nome deu zero acerto nos 12 tecidos.
   * Aponta para a chave da view de custo, não para a linha — a linha muda a
   * cada correção de custo.
   */
  catalogo_fornecedor_id?: string | null
  catalogo_descricao?: string | null
  catalogo_codigo?: string | null
}
export interface PrecoCortinaValor {
  chave: string; valor: number | null; descricao: string | null
}
