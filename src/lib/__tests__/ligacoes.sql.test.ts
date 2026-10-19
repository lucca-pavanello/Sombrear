/**
 * A migration 0032 (ligações da Amanda de voz) rodando num Postgres de verdade em WebAssembly.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/0032_ligacoes.sql'), 'utf8')

// o mínimo do Supabase que a migration usa
const BASE = `
  create role anon; create role authenticated; create role service_role;
  create table public.crm_sombrear_ia (id uuid primary key default gen_random_uuid(), nome text);
`

let db: PGlite

beforeEach(async () => {
  db = new PGlite()
  await db.exec(BASE)
  await db.exec(MIGRATION)
})

const inserir = (extra = '') => db.query(
  `insert into public.ligacoes (ref, inicio${extra ? ', ' + extra.split('=')[0] : ''})
   values ('lig-1', now()${extra ? ', ' + extra.split('=')[1] : ''}) returning *`)

describe('ligações (0032)', () => {
  it('grava com os padrões: pendente, conversa vazia', async () => {
    const r = await inserir()
    expect(r.rows[0]).toMatchObject({ ref: 'lig-1', whatsapp_status: 'pendente', transcricao: [] })
  })

  it('o ref não repete', async () => {
    await inserir()
    await expect(inserir()).rejects.toThrow(/unique|duplicate/i)
  })

  it('recusa assunto e status fora da lista', async () => {
    await expect(inserir("assunto='reclamacao'")).rejects.toThrow(/check/i)
    await expect(inserir("whatsapp_status='mandado'")).rejects.toThrow(/check/i)
  })

  it('upsert pelo ref atualiza a mesma linha (o que a edge function faz)', async () => {
    await inserir()
    await db.query(`insert into public.ligacoes (ref, inicio, whatsapp_status) values ('lig-1', now(), 'enviado')
                    on conflict (ref) do update set whatsapp_status = excluded.whatsapp_status`)
    const r = await db.query<{ n: number; s: string }>(`select count(*)::int n, max(whatsapp_status) s from public.ligacoes`)
    expect(r.rows[0]).toEqual({ n: 1, s: 'enviado' })
  })

  it('apagar o lead não apaga a ligação', async () => {
    const lead = (await db.query<{ id: string }>(`insert into public.crm_sombrear_ia (nome) values ('x') returning id`)).rows[0].id
    await db.query(`insert into public.ligacoes (ref, inicio, lead_id) values ('lig-1', now(), $1)`, [lead])
    await db.query(`delete from public.crm_sombrear_ia`)
    const r = await db.query<{ lead_id: string | null }>(`select lead_id from public.ligacoes`)
    expect(r.rows).toEqual([{ lead_id: null }])
  })

  it('a equipe logada lê, o anônimo não', async () => {
    await inserir()
    await db.exec(`set role authenticated`)
    expect((await db.query(`select * from public.ligacoes`)).rows).toHaveLength(1)
    await expect(db.query(`insert into public.ligacoes (ref, inicio) values ('lig-2', now())`)).rejects.toThrow(/permission|policy/i)
    await db.exec(`reset role; set role anon`)
    await expect(db.query(`select * from public.ligacoes`)).rejects.toThrow(/permission/i)
  })

  it('rodar a migration de novo não quebra', async () => {
    await expect(db.exec(MIGRATION)).resolves.toBeDefined()
  })
})
