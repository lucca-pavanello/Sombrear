/**
 * Servidor local de orçamento para a Amanda de voz: as rotas de src/lib/voz/rotas.ts por HTTP.
 *
 * Bancada: os preços vêm de uma foto das tabelas precos_* (JSON, um arquivo por tabela, no
 * formato da Management API: [{ "d": [...] }]). No ar é a função orcamento-voz, com os preços do banco.
 *
 *   npx tsx voz/orcamento/servidor.ts <pasta-da-foto> [porta=8791]
 */
import { createServer } from 'node:http'
import { atender } from '../../src/lib/voz/rotas'
import { carregarFoto } from './foto'

const [dir, porta = '8791'] = process.argv.slice(2)
if (!dir) { console.error('uso: servidor.ts <pasta-da-foto> [porta]'); process.exit(2) }
const dados = await carregarFoto(dir)

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
    const r = atender(url.pathname, url.searchParams, corpo, dados)
    responder(r.status, r.corpo)
  } catch (e) {
    responder(400, { erro: e instanceof Error ? e.message : 'pedido inválido' })
  }
}).listen(Number(porta), '127.0.0.1', () => console.log(`orçamento em http://127.0.0.1:${porta}`))
