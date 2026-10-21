/** Lê a foto das tabelas precos_* (um JSON por tabela, formato da Management API: [{ "d": [...] }]). */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DadosVoz } from '../../src/lib/voz/orcar'
import { carregarDados } from '../../src/lib/voz/rotas'

export function carregarFoto(dir: string): Promise<DadosVoz> {
  return carregarDados(t => JSON.parse(readFileSync(join(dir, `${t}.json`), 'utf8'))[0].d)
}
