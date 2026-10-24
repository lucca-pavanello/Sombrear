/**
 * As migrations 0034 (editar e excluir material do catálogo) e 0035 (duplicar
 * em outras cores) num Postgres de verdade em WebAssembly, em cima do mínimo
 * das tabelas do catálogo.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/0034_catalogo_editar_e_excluir_material.sql'),
  'utf8'
)

const DUPLICAR = readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/0035_catalogo_duplicar_em_cores.sql'),
  'utf8'
)

const LIGACAO_CORTINA = readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/0036_catalogo_renomear_leva_ligacao_cortina.sql'),
  'utf8'
)

const ADMIN = '00000000-0000-0000-0000-0000000000aa'
const VENDEDORA = '00000000-0000-0000-0000-0000000000bb'
const CORTTEX = '8267118c-be47-49ff-99a5-1834f0fdd775'
const TA_DECOR = '8c06ee99-4eb8-4c96-862c-5403d8d5d182'

// O mínimo do Supabase e do catálogo (0033/0035/0042) que a migration usa.
const BASE = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('teste.uid', true), '')::uuid $$;
  create table profiles (id uuid primary key, approved boolean default true, is_admin boolean default false);
  create table estoque_fornecedores (id uuid primary key, nome text not null, ativo boolean default true);
  create table estoque_produtos (id uuid primary key);
  create table catalogo_documentos (
    id uuid primary key default gen_random_uuid(),
    fornecedor_id uuid references estoque_fornecedores(id),
    tipo text not null, referencia text not null, data_documento date,
    tabela_preco text, categoria_cliente text, observacoes text,
    unique (fornecedor_id, referencia));
  create table catalogo_itens (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default timezone('utc', now()),
    documento_id uuid not null references catalogo_documentos(id) on delete cascade,
    codigo_fornecedor text, descricao text not null, categoria text not null,
    cor text, largura_m numeric(6,3),
    quantidade_documento numeric(12,3) not null default 1, unidade_documento text not null default 'M',
    preco_bruto numeric(12,4) not null, desconto_pct numeric(5,2) not null default 0,
    preco_liquido numeric(12,4) not null, subtotal numeric(12,2) not null default 0,
    unidade_canonica text not null default 'm', quantidade_canonica numeric(12,3) not null default 1,
    custo_unitario numeric(12,6) not null,
    produto_id uuid references estoque_produtos(id), observacao text);
  create table precos_cortina_tecidos (id serial primary key, nome text, catalogo_descricao text);
  create table catalogo_compra_escolhida (
    material_chave text primary key, fornecedor_id uuid, marcado_em timestamptz default now());

  -- a view como a 0035 deixou
  create view catalogo_custo_vigente as
  select distinct on (d.fornecedor_id, i.codigo_fornecedor, i.descricao)
    d.fornecedor_id, f.nome as fornecedor, i.codigo_fornecedor, i.descricao, i.categoria, i.cor,
    i.largura_m, i.unidade_canonica, i.custo_unitario, i.preco_bruto, i.desconto_pct, d.tipo,
    d.referencia, d.data_documento, d.tabela_preco, i.produto_id, i.id as item_id,
    i.unidade_documento, i.preco_liquido
  from catalogo_itens i
  join catalogo_documentos d on d.id = i.documento_id
  left join estoque_fornecedores f on f.id = d.fornecedor_id
  where d.tipo in ('pedido', 'lista_manual')
  order by d.fornecedor_id, i.codigo_fornecedor, i.descricao,
           d.data_documento desc nulls last, i.created_at desc;

  insert into auth.users (id) values ('${ADMIN}'), ('${VENDEDORA}');
  insert into profiles (id, is_admin) values ('${ADMIN}', true), ('${VENDEDORA}', false);
  insert into estoque_fornecedores (id, nome) values ('${CORTTEX}', 'CORTTEX'), ('${TA_DECOR}', 'TA DECOR');
`

let db: PGlite

async function como(uid: string) {
  await db.query(`select set_config('teste.uid', $1, false)`, [uid])
}

async function item(fornecedor: string | null, ref: string, data: string, descricao: string,
                    custo: number, codigo: string | null = null, tipo = 'pedido') {
  const d = await db.query<{ id: string }>(
    `insert into catalogo_documentos (fornecedor_id, tipo, referencia, data_documento)
     values ($1, $2, $3, $4)
     on conflict (fornecedor_id, referencia) do update set tipo = excluded.tipo returning id`,
    [fornecedor, tipo, ref, data])
  await db.query(
    `insert into catalogo_itens (documento_id, codigo_fornecedor, descricao, categoria, cor, largura_m,
                                 preco_bruto, preco_liquido, custo_unitario)
     values ($1, $2, $3, 'tecido', 'bege', 3, $4, $4, $4)`,
    [d.rows[0].id, codigo, descricao, custo])
}

type Linha = { fornecedor: string | null; codigo_fornecedor: string | null; descricao: string; custo_unitario: string }

async function vigente(): Promise<Linha[]> {
  const r = await db.query<Linha>(
    `select fornecedor, codigo_fornecedor, descricao, custo_unitario::text
       from catalogo_custo_vigente order by fornecedor nulls last, descricao`)
  return r.rows
}

function alvos(linhas: { fornecedor_id: string | null; codigo: string | null; descricao: string; novo_codigo?: string | null }[]) {
  return JSON.stringify(linhas)
}

async function editar(a: string, descricao: string, chaves: [string, string] | null = null) {
  return db.query<{ n: number }>(
    `select catalogo_editar_material($1::jsonb, $2, 'tecido', 'bege', 3, $3, $4) as n`,
    [a, descricao, chaves?.[0] ?? null, chaves?.[1] ?? null])
}

beforeEach(async () => {
  db = new PGlite()
  await db.exec(BASE)
  await item(CORTTEX, 'CORTTEX-012897', '2026-07-01', 'MICROFIBRA 3.00M BEGE', 6.3, '6137')
  await item(TA_DECOR, 'TADECOR-533152', '2026-07-10', 'MICROFIBRA 3.00M BEGE', 7.1)
  await item(null, 'LISTA-DONA', '2026-06-01', 'VOIL LINHO', 12)
})

describe('catálogo: editar e excluir material (0034)', () => {
  it('sem ajuste nenhum, a view devolve exatamente o mesmo de antes', async () => {
    const antes = await vigente()
    await db.exec(MIGRATION)
    expect(await vigente()).toEqual(antes)
  })

  it('renomear muda o nome nas duas lojas e leva junto o "onde comprei"', async () => {
    await db.exec(MIGRATION)
    await db.query(`insert into catalogo_compra_escolhida (material_chave, fornecedor_id) values ('microfibra 3.00m bege', $1)`, [CORTTEX])
    await como(ADMIN)

    const r = await editar(alvos([
      { fornecedor_id: CORTTEX, codigo: '6137', descricao: 'MICROFIBRA 3.00M BEGE' },
      { fornecedor_id: TA_DECOR, codigo: null, descricao: 'MICROFIBRA 3.00M BEGE' },
    ]), 'Microfibra Bege 3m', ['microfibra 3.00m bege', 'microfibra bege 3m'])
    expect(r.rows[0].n).toBe(2)

    expect((await vigente()).map(l => [l.fornecedor, l.descricao, l.custo_unitario])).toEqual([
      ['CORTTEX', 'Microfibra Bege 3m', '6.300000'],
      ['TA DECOR', 'Microfibra Bege 3m', '7.100000'],
      [null, 'VOIL LINHO', '12.000000'],
    ])
    const marca = await db.query<{ material_chave: string }>(`select material_chave from catalogo_compra_escolhida`)
    expect(marca.rows).toEqual([{ material_chave: 'microfibra bege 3m' }])
  })

  it('depois de renomear, a correção de custo com o nome novo substitui — não duplica', async () => {
    await db.exec(MIGRATION)
    await como(ADMIN)
    await editar(alvos([{ fornecedor_id: CORTTEX, codigo: '6137', descricao: 'MICROFIBRA 3.00M BEGE' }]), 'Microfibra Bege 3m')
    // o que a tela de corrigir custo grava: nome e código como ela vê
    await item(CORTTEX, 'MANUAL-CORTTEX-2026-10-24', '2026-10-24', 'Microfibra Bege 3m', 9.34, '6137', 'lista_manual')

    const corttex = (await vigente()).filter(l => l.fornecedor === 'CORTTEX')
    expect(corttex).toEqual([
      { fornecedor: 'CORTTEX', codigo_fornecedor: '6137', descricao: 'Microfibra Bege 3m', custo_unitario: '9.340000' },
    ])

    // renomear de novo pega os dois registros (o pedido velho e a correção)
    const r = await editar(alvos([{ fornecedor_id: CORTTEX, codigo: '6137', descricao: 'Microfibra Bege 3m' }]), 'Microfibra Bege')
    expect(r.rows[0].n).toBe(2)
    expect((await vigente()).filter(l => l.fornecedor === 'CORTTEX').map(l => l.descricao)).toEqual(['Microfibra Bege'])
  })

  it('troca o código de uma loja só, e aceita item sem fornecedor', async () => {
    await db.exec(MIGRATION)
    await como(ADMIN)
    await editar(alvos([
      { fornecedor_id: TA_DECOR, codigo: null, descricao: 'MICROFIBRA 3.00M BEGE', novo_codigo: '22.139.1' },
    ]), 'MICROFIBRA 3.00M BEGE')
    await editar(alvos([{ fornecedor_id: null, codigo: null, descricao: 'VOIL LINHO' }]), 'Voil de linho')

    const l = await vigente()
    expect(l.find(x => x.fornecedor === 'TA DECOR')?.codigo_fornecedor).toBe('22.139.1')
    expect(l.find(x => x.fornecedor === 'CORTTEX')?.codigo_fornecedor).toBe('6137')
    expect(l.find(x => x.fornecedor === null)?.descricao).toBe('Voil de linho')
  })

  it('excluir tira do catálogo, guarda o documento, e compra nova volta a aparecer', async () => {
    await db.exec(MIGRATION)
    await como(ADMIN)
    const r = await db.query<{ n: number }>(`select catalogo_excluir_material($1::jsonb) as n`, [alvos([
      { fornecedor_id: CORTTEX, codigo: '6137', descricao: 'MICROFIBRA 3.00M BEGE' },
      { fornecedor_id: TA_DECOR, codigo: null, descricao: 'MICROFIBRA 3.00M BEGE' },
    ])])
    expect(r.rows[0].n).toBe(2)
    expect((await vigente()).map(l => l.descricao)).toEqual(['VOIL LINHO'])

    const guardados = await db.query(`select 1 from catalogo_itens where descricao = 'MICROFIBRA 3.00M BEGE'`)
    expect(guardados.rows).toHaveLength(2)
    const historico = await db.query(`select excluido from catalogo_itens_efetivos where descricao = 'MICROFIBRA 3.00M BEGE'`)
    expect(historico.rows).toEqual([{ excluido: true }, { excluido: true }])

    await item(CORTTEX, 'CORTTEX-099999', '2026-11-01', 'MICROFIBRA 3.00M BEGE', 6.9, '6137')
    expect((await vigente()).map(l => [l.fornecedor, l.custo_unitario])).toEqual([
      ['CORTTEX', '6.900000'],
      [null, '12.000000'],
    ])
  })

  it('quem não é administrador não edita nem exclui', async () => {
    await db.exec(MIGRATION)
    await como(VENDEDORA)
    const a = alvos([{ fornecedor_id: null, codigo: null, descricao: 'VOIL LINHO' }])
    await expect(editar(a, 'outro nome')).rejects.toThrow(/administrador/)
    await expect(db.query(`select catalogo_excluir_material($1::jsonb)`, [a])).rejects.toThrow(/administrador/)
  })

  it('alvo que não existe é erro, não "salvo" mudo', async () => {
    await db.exec(MIGRATION)
    await como(ADMIN)
    await expect(editar(alvos([{ fornecedor_id: null, codigo: null, descricao: 'NAO EXISTE' }]), 'X'))
      .rejects.toThrow(/Não achei/)
  })
})

describe('catálogo: duplicar em outras cores (0035)', () => {
  const variacoes = JSON.stringify([
    { descricao: 'MICROFIBRA 3.00M BRANCO', cor: 'branco' },
    { descricao: 'MICROFIBRA 3.00M CINZA', cor: 'cinza' },
  ])
  const material = alvos([
    { fornecedor_id: CORTTEX, codigo: '6137', descricao: 'MICROFIBRA 3.00M BEGE' },
    { fornecedor_id: TA_DECOR, codigo: null, descricao: 'MICROFIBRA 3.00M BEGE' },
  ])

  beforeEach(async () => {
    await db.exec(MIGRATION)
    await db.exec(DUPLICAR)
    await como(ADMIN)
  })

  it('cria cada cor em cada loja, com o mesmo preço, sem código e sem tocar no pedido', async () => {
    const r = await db.query<{ n: number }>(`select catalogo_duplicar_material($1::jsonb, $2::jsonb) as n`, [material, variacoes])
    expect(r.rows[0].n).toBe(4)

    const l = await db.query<Linha & { tipo: string; referencia: string; cor: string }>(
      `select fornecedor, codigo_fornecedor, descricao, custo_unitario::text, tipo, referencia, cor
         from catalogo_custo_vigente where descricao <> 'MICROFIBRA 3.00M BEGE' and descricao <> 'VOIL LINHO'
        order by fornecedor, descricao`)
    expect(l.rows.map(x => [x.fornecedor, x.descricao, x.codigo_fornecedor, x.custo_unitario, x.tipo, x.cor])).toEqual([
      ['CORTTEX', 'MICROFIBRA 3.00M BRANCO', null, '6.300000', 'lista_manual', 'branco'],
      ['CORTTEX', 'MICROFIBRA 3.00M CINZA', null, '6.300000', 'lista_manual', 'cinza'],
      ['TA DECOR', 'MICROFIBRA 3.00M BRANCO', null, '7.100000', 'lista_manual', 'branco'],
      ['TA DECOR', 'MICROFIBRA 3.00M CINZA', null, '7.100000', 'lista_manual', 'cinza'],
    ])
    // O mesmo documento manual do dia que a tela usaria (apelidoFornecedor)
    expect(l.rows.find(x => x.fornecedor === 'TA DECOR')?.referencia).toMatch(/^MANUAL-TA-DECOR-\d{4}-\d{2}-\d{2}$/)

    const pedido = await db.query(`select 1 from catalogo_itens i join catalogo_documentos d on d.id = i.documento_id
                                    where d.referencia = 'CORTTEX-012897'`)
    expect(pedido.rows).toHaveLength(1)
  })

  it('sem fornecedor vai para o mesmo documento de onde veio, e repetir não duplica', async () => {
    const voil = alvos([{ fornecedor_id: null, codigo: null, descricao: 'VOIL LINHO' }])
    const v = JSON.stringify([{ descricao: 'VOIL LINHO BRANCO', cor: null }])
    expect((await db.query<{ n: number }>(`select catalogo_duplicar_material($1::jsonb, $2::jsonb) as n`, [voil, v])).rows[0].n).toBe(1)
    expect((await db.query<{ n: number }>(`select catalogo_duplicar_material($1::jsonb, $2::jsonb) as n`, [voil, v])).rows[0].n).toBe(0)

    const r = await db.query<{ referencia: string }>(
      `select referencia from catalogo_custo_vigente where descricao = 'VOIL LINHO BRANCO'`)
    expect(r.rows).toEqual([{ referencia: 'LISTA-DONA' }])
  })

  it('o apelido do banco é o mesmo da tela', async () => {
    const r = await db.query<{ a: string }>(
      `select catalogo_apelido_fornecedor('Tapeçaria Américana  Decor!') as a`)
    expect(r.rows[0].a).toBe('TAPECARIA-AMERICANA-DECOR')
  })

  it('quem não é administrador não duplica', async () => {
    await como(VENDEDORA)
    await expect(db.query(`select catalogo_duplicar_material($1::jsonb, $2::jsonb)`, [material, variacoes]))
      .rejects.toThrow(/administrador/)
  })
})

describe('catálogo: renomear leva junto a ligação da cortina (0036)', () => {
  it('a cortina continua achando o tecido depois de renomeado', async () => {
    await db.exec(MIGRATION)
    await db.exec(LIGACAO_CORTINA)
    await db.query(`insert into precos_cortina_tecidos (nome, catalogo_descricao) values
      ('Microfibra 90g (3,00m)', 'MICROFIBRA 3.00M BEGE'), ('Voil', 'VOIL LINHO')`)
    await como(ADMIN)
    await editar(alvos([
      { fornecedor_id: CORTTEX, codigo: '6137', descricao: 'MICROFIBRA 3.00M BEGE' },
      { fornecedor_id: TA_DECOR, codigo: null, descricao: 'MICROFIBRA 3.00M BEGE' },
    ]), 'MICROFIBRA 90 grs 3.00 BEGE')

    const r = await db.query<{ nome: string; catalogo_descricao: string }>(
      `select nome, catalogo_descricao from precos_cortina_tecidos order by id`)
    expect(r.rows).toEqual([
      { nome: 'Microfibra 90g (3,00m)', catalogo_descricao: 'MICROFIBRA 90 grs 3.00 BEGE' },
      { nome: 'Voil', catalogo_descricao: 'VOIL LINHO' },
    ])
  })
})
