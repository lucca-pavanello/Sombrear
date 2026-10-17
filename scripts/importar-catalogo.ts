/**
 * Transforma os documentos de fornecedor em SQL para o catálogo de custos.
 *
 *   npx tsx scripts/importar-catalogo.ts --conferir   # só confere a conta
 *   npx tsx scripts/importar-catalogo.ts              # confere e gera o SQL
 *
 * Lê os JSON de scripts/catalogo/, revisados por humano antes de entrar.
 * Deliberadamente não é uma tela de importação: os documentos chegam raramente
 * e em formatos incompatíveis — um deles é foto de tela de celular.
 *
 * Por que gera SQL em vez de gravar direto: este projeto não tem service_role
 * key no .env, e a RLS do catálogo exige admin. O SQL vai para
 * ~/_migrations_para_rodar/, de onde um humano roda — que é o caminho da casa
 * para qualquer escrita em produção, e deixa o que foi gravado auditável.
 *
 * Duas regras que este script existe para garantir:
 *
 *  1. A conta tem de fechar. A soma dos subtotais precisa bater com o total
 *     IMPRESSO no documento, ao centavo. Um documento que não fecha aborta
 *     TUDO — é preferível o catálogo vazio a um custo errado dentro de um
 *     orçamento.
 *
 *  2. Rodar duas vezes não duplica. O par (fornecedor, referência) é único, e
 *     os itens de cada documento são apagados e regravados em bloco.
 *
 * A normalização vem de src/lib/catalogo/normalizar.ts — o mesmo código que
 * catalogo-custos.test.ts prova contra os documentos reais. Nada é recalculado
 * por fora aqui.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'
import {
  conferirDocumento,
  normalizarItem,
  type ItemDocumento,
  type UnidadeDocumento,
} from '../src/lib/catalogo/normalizar'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const SO_CONFERIR = process.argv.includes('--conferir')
const SAIDA = path.join(
  os.homedir(),
  '_migrations_para_rodar',
  'SOMBREAR__0034_catalogo_custos__dados_dos_documentos.sql'
)

interface ItemJson {
  seq: number
  codigo_fornecedor: string | null
  descricao: string
  categoria: string
  cor: string | null
  largura_m: number | null
  quantidade_documento: number
  unidade_documento: UnidadeDocumento
  preco_bruto: number
  desconto_pct: number
  preco_liquido: number
  subtotal: number
  metros_por_rolo?: number
  observacao?: string
}

interface DocJson {
  fornecedor: string
  tipo: string
  referencia: string
  data_documento: string | null
  frete_tipo: string | null
  tabela_preco?: string | null
  categoria_cliente?: string | null
  condicao_pagamento?: string | null
  total_declarado: number
  arquivo_origem?: string
  observacoes?: string
  itens: ItemJson[]
}

const paraItemDocumento = (i: ItemJson): ItemDocumento => ({
  descricao: i.descricao,
  quantidade: i.quantidade_documento,
  unidade: i.unidade_documento,
  precoBruto: i.preco_bruto,
  descontoPct: i.desconto_pct,
  metrosPorRolo: i.metros_por_rolo,
})

/** "24/06/2026" -> "2026-06-24". O JSON guarda como o documento escreve. */
function paraIso(br: string | null): string | null {
  if (!br) return null
  const [d, m, a] = br.split('/')
  return `${a}-${m}-${d}`
}

/** Literal SQL. Aspa simples dentro de texto vira duas — é o que escapa. */
function txt(v: string | null | undefined): string {
  return v === null || v === undefined ? 'null' : `'${v.replace(/'/g, "''")}'`
}
const num = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? 'null' : String(v)

const dinheiro = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function main() {
  const dir = path.resolve(AQUI, 'catalogo')
  const arquivos = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()
  if (arquivos.length === 0) {
    console.error(`Nenhum JSON em ${dir}`)
    process.exit(1)
  }

  // ── 1. Conferir TUDO antes de gerar QUALQUER coisa ───────────
  console.log('Conferindo a soma de cada documento contra o total impresso:\n')
  const docs: DocJson[] = arquivos.map(f =>
    JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
  )
  let reprovados = 0

  for (const d of docs) {
    const c = conferirDocumento(d.itens.map(paraItemDocumento), d.total_declarado)
    console.log(
      `  ${d.referencia.padEnd(20)} ${String(d.itens.length).padStart(2)} itens  ` +
        `somado ${dinheiro(c.somado).padStart(10)}  declarado ${dinheiro(c.declarado).padStart(10)}  ` +
        `dif ${dinheiro(c.diferenca).padStart(7)}  ${c.fecha ? 'ok' : 'NÃO FECHA'}`
    )
    if (!c.fecha) reprovados++
  }

  if (reprovados > 0) {
    console.error(
      `\n${reprovados} documento(s) não fecham com o total impresso. Nada foi gerado.\n` +
        'Confira a leitura do documento antes de insistir — custo errado aqui vira preço errado no orçamento.'
    )
    process.exit(1)
  }
  console.log(`\nOs ${docs.length} documentos fecham ao centavo.`)

  if (SO_CONFERIR) {
    console.log('(--conferir: parando aqui, sem gerar SQL)')
    return
  }

  // ── 2. Gerar o SQL ───────────────────────────────────────────
  const L: string[] = [
    '-- ============================================================',
    '-- SOMBREAR 0034 - Catalogo de custos: os dados dos documentos',
    '--',
    '-- GERADO por scripts/importar-catalogo.ts a partir dos JSON em',
    '-- scripts/catalogo/. Nao editar a mao: edite o JSON e gere de novo.',
    '--',
    '-- Cada documento apaga e regrava seus proprios itens, e o par',
    '-- (fornecedor, referencia) e unico. Rodar duas vezes nao duplica.',
    '--',
    '-- Depende da migration 0033 (tabelas e fornecedores).',
    '-- ============================================================',
    '',
    'begin;',
    '',
  ]

  let totalItens = 0
  for (const d of docs) {
    const forn = `(select id from estoque_fornecedores where nome = ${txt(d.fornecedor)} limit 1)`
    L.push(`-- ---- ${d.referencia}  (${d.tipo}, ${d.itens.length} itens, total ${dinheiro(d.total_declarado)}) ----`)
    L.push('insert into catalogo_documentos (')
    L.push('  fornecedor_id, tipo, referencia, data_documento, frete_tipo,')
    L.push('  tabela_preco, categoria_cliente, condicao_pagamento, total_declarado,')
    L.push('  arquivo_origem, observacoes')
    L.push(') values (')
    L.push(`  ${forn}, ${txt(d.tipo)}, ${txt(d.referencia)}, ${txt(paraIso(d.data_documento))}, ${txt(d.frete_tipo)},`)
    L.push(`  ${txt(d.tabela_preco)}, ${txt(d.categoria_cliente)}, ${txt(d.condicao_pagamento)}, ${num(d.total_declarado)},`)
    L.push(`  ${txt(d.arquivo_origem)}, ${txt(d.observacoes)}`)
    L.push(')')
    L.push('on conflict (fornecedor_id, referencia) do update set')
    L.push('  tipo = excluded.tipo, data_documento = excluded.data_documento,')
    L.push('  frete_tipo = excluded.frete_tipo, tabela_preco = excluded.tabela_preco,')
    L.push('  categoria_cliente = excluded.categoria_cliente,')
    L.push('  condicao_pagamento = excluded.condicao_pagamento,')
    L.push('  total_declarado = excluded.total_declarado,')
    L.push('  arquivo_origem = excluded.arquivo_origem, observacoes = excluded.observacoes;')
    L.push('')

    const alvo =
      `(select d.id from catalogo_documentos d where d.referencia = ${txt(d.referencia)} ` +
      `and d.fornecedor_id = ${forn})`

    L.push(`delete from catalogo_itens where documento_id = ${alvo};`)
    L.push('')
    L.push('insert into catalogo_itens (')
    L.push('  documento_id, seq, codigo_fornecedor, descricao, categoria, cor, largura_m,')
    L.push('  quantidade_documento, unidade_documento, preco_bruto, desconto_pct,')
    L.push('  preco_liquido, subtotal, unidade_canonica, quantidade_canonica,')
    L.push('  custo_unitario, observacao')
    L.push(') values')

    const linhas = d.itens.map(i => {
      const n = normalizarItem(paraItemDocumento(i))
      if (Math.abs(n.subtotal - i.subtotal) >= 0.005) {
        throw new Error(
          `${d.referencia} item ${i.seq}: subtotal calculado ${n.subtotal} ` +
            `nao bate com o do documento ${i.subtotal}.`
        )
      }
      totalItens++
      return (
        `  (${alvo}, ${num(i.seq)}, ${txt(i.codigo_fornecedor)}, ${txt(i.descricao)}, ` +
        `${txt(i.categoria)}, ${txt(i.cor)}, ${num(i.largura_m)}, ` +
        `${num(i.quantidade_documento)}, ${txt(i.unidade_documento)}, ${num(i.preco_bruto)}, ` +
        `${num(i.desconto_pct)}, ${num(n.precoLiquido)}, ${num(n.subtotal)}, ` +
        `${txt(n.unidadeCanonica)}, ${num(n.quantidadeCanonica)}, ${num(n.custoUnitario)}, ` +
        `${txt(i.observacao)})`
      )
    })
    L.push(linhas.join(',\n') + ';')
    L.push('')
  }

  L.push('commit;')
  L.push('')
  L.push('-- ============================================================')
  L.push('-- PROVA (rodar depois; a coluna "diferenca" tem de ser 0.00 em todas)')
  L.push('-- ============================================================')
  L.push('-- select d.referencia, d.tipo, count(i.id) as itens, d.total_declarado,')
  L.push('--        round(sum(i.subtotal), 2) as somado,')
  L.push('--        d.total_declarado - round(sum(i.subtotal), 2) as diferenca')
  L.push('--   from catalogo_documentos d join catalogo_itens i on i.documento_id = d.id')
  L.push('--  group by d.id order by d.referencia;')

  fs.mkdirSync(path.dirname(SAIDA), { recursive: true })
  fs.writeFileSync(SAIDA, L.join('\n'), 'utf-8')

  console.log(`\n${totalItens} itens em ${docs.length} documentos.`)
  console.log(`SQL gerado em:\n  ${SAIDA}`)
}

try {
  main()
} catch (e) {
  console.error('\n' + (e instanceof Error ? e.message : String(e)))
  process.exit(1)
}
