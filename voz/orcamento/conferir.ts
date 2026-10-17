/**
 * Confere src/lib/voz/orcar.ts contra os orçamentos que a Amanda do WhatsApp fez de verdade
 * (orcamentos_sombrear_ia, valor base sem acabamento), com a foto dos preços.
 *
 *   npx tsx voz/orcamento/conferir.ts <pasta-da-foto>   (precisa de orcamentos_ia.json na pasta)
 *
 * 17/10/2026: 78 de 88 iguais ao centavo; o resto está explicado no voz/README.md.
 */
import { readFileSync } from 'node:fs'
import { orcarPersiana } from '../../src/lib/voz/orcar'
import { carregarFoto } from './foto'
const dir = process.argv[2]
const ler = (t: string) => JSON.parse(readFileSync(`${dir}/${t}.json`, 'utf8'))[0].d
const d = carregarFoto(dir)
const MOD: Record<string, any> = { 'Rolo': 'Rolo', 'PH Aluminio': 'PH_Aluminio', 'Double': 'Double', 'PV': 'PV', 'Romana': 'Romana' }
const g = JSON.parse(readFileSync(`${dir}/orcamentos_ia.json`, 'utf8'))[0].d
let bate = 0, perto = 0, erro = 0; const linhas: string[] = []
for (const o of g) {
    const r = orcarPersiana({ modelo: MOD[o.modelo], largura: o.largura, altura: o.altura, quantidade: o.quantidade,
    tecido: o.tecido ?? undefined,
    acabamento: 'nenhum' }, d)
  const alvo = Number(o.valor_venda_total_base)
  if (!r.ok) { erro++; linhas.push(`ERRO ${o.dia} ${o.modelo} ${o.largura}x${o.altura} "${o.tecido}" -> ${r.erro}`); continue }
  const dif = r.total4x - alvo
  if (Math.abs(dif) < 0.02) bate++; else if (Math.abs(dif) / alvo < 0.05) perto++
  if (Math.abs(dif) >= 0.02) linhas.push(`${o.dia} ${o.modelo} ${o.largura}x${o.altura}x${o.quantidade} "${o.tecido}" ${o.acabamento ?? ''} | amanda ${alvo} | motor ${r.total4x} (${r.tecido}) | dif ${dif.toFixed(2)}`)
}
console.log(`total ${g.length} | igual ao centavo ${bate} | ate 5% ${perto} | erro ${erro}`)
console.log(linhas.slice(0, 40).join('\n'))
