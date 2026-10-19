/**
 * Servidor local de orçamento para a Amanda de voz: expõe src/lib/voz/orcar.ts por HTTP.
 *
 * Bancada: os preços vêm de uma foto das tabelas precos_* (JSON, um arquivo por tabela, no
 * formato da Management API: [{ "d": [...] }]). No ar, a mesma função vai ler do Supabase.
 *
 *   npx tsx voz/orcamento/servidor.ts <pasta-da-foto> [porta=8791]
 */
import { createServer } from 'node:http'
import {
  orcarCortina, orcarPersiana, tecidosDoModelo,
  type PedidoCortina, type PedidoPersiana, type TipoTecido,
} from '../../src/lib/voz/orcar'
import type { ModeloSim } from '../../src/lib/simulador'
import { carregarFoto } from './foto'

const [dir, porta = '8791'] = process.argv.slice(2)
if (!dir) { console.error('uso: servidor.ts <pasta-da-foto> [porta]'); process.exit(2) }
const dados = carregarFoto(dir)

createServer(async (req, res) => {
  const responder = (status: number, corpo: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(corpo))
  }
  try {
    const url = new URL(req.url ?? '/', 'http://local')
    let corpo: Record<string, unknown> = {}
    if (req.method === 'POST') {
      let bruto = ''
      for await (const c of req) bruto += c
      corpo = bruto ? JSON.parse(bruto) : {}
    }
    if (url.pathname === '/persiana') return responder(200, orcarPersiana(corpo as unknown as PedidoPersiana, dados))
    if (url.pathname === '/cortina') return responder(200, orcarCortina(corpo as unknown as PedidoCortina, dados))
    if (url.pathname === '/tecidos') {
      const modelo = url.searchParams.get('modelo') as ModeloSim | null
      if (modelo === null) {
        return responder(200, { cortina: dados.cortina.tecidos.map(t => ({ nome: t.nome, tipo: t.tipo })) })
      }
      const tipo = (url.searchParams.get('tipo') || undefined) as TipoTecido | undefined
      return responder(200, { modelo, tecidos: tecidosDoModelo(modelo, dados, tipo) })
    }
    responder(404, { erro: 'rota inexistente' })
  } catch (e) {
    responder(400, { erro: e instanceof Error ? e.message : 'pedido inválido' })
  }
}).listen(Number(porta), '127.0.0.1', () => console.log(`orçamento em http://127.0.0.1:${porta}`))
