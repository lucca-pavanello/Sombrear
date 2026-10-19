/** Lê a foto das tabelas precos_* (um JSON por tabela, formato da Management API: [{ "d": [...] }]). */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DadosVoz } from '../../src/lib/voz/orcar'

export function carregarFoto(dir: string): DadosVoz {
  const ler = (t: string) => JSON.parse(readFileSync(join(dir, `${t}.json`), 'utf8'))[0].d
  return {
    tecidos: ler('precos_tecidos_vigentes'), componentes: ler('precos_ferragem_componentes'),
    bandos: ler('precos_bandos'), bandoParams: ler('precos_bandos_params'),
    barraFaixas: ler('precos_barra_faixas'), colocacao: ler('precos_colocacao'),
    artigos: ler('precos_artigos'), ph50: ler('precos_ph50'), parametros: ler('precos_parametros'),
    romana: ler('precos_romana_matriz'), motorEstrutura: ler('precos_motor_estrutura'),
    motorComponentes: ler('precos_motor_componentes'), familias: ler('precos_ferragem_familias'),
    tecidoModelos: ler('precos_tecido_modelos'),
    cortina: { tecidos: ler('precos_cortina_tecidos'), valores: ler('precos_cortina_valores') },
  }
}
