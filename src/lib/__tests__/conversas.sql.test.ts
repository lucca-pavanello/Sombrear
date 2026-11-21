/**
 * A migration 0039 (aba Conversas) rodando num Postgres de verdade em WebAssembly: a view da
 * lista, o não lida por pessoa e as políticas. Nada aqui toca o banco da loja.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/0039_conversas.sql'), 'utf8')
const MENSAGENS = readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/0023_mensagens_sombrear.sql'), 'utf8')

const ANA = '00000000-0000-0000-0000-00000000000a'
const BIA = '00000000-0000-0000-0000-00000000000b'
const PENDENTE = '00000000-0000-0000-0000-00000000000c'
const LEAD = '11111111-1111-1111-1111-111111111111'

// o mínimo do Supabase que as duas migrations usam; quem está logado vem de app.uid
const BASE = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('app.uid', true), '')::uuid $$;
  create table public.profiles (id uuid primary key, approved boolean, is_admin boolean default false);
  create function public.eh_aprovado() returns boolean language sql stable security definer as $$
    select exists (select 1 from public.profiles where id = auth.uid() and approved) $$;
  create table public.crm_sombrear_ia (id uuid primary key, nome text, chatwoot_labels text, precisa_humano text);
  create publication supabase_realtime;
`

let db: PGlite

/** roda como a pessoa logada; o savepoint deixa o teste seguir depois de uma recusa do banco */
async function como<T>(uid: string, sql: string): Promise<T[]> {
  await db.exec(`savepoint pessoa; set role authenticated; select set_config('app.uid', '${uid}', false);`)
  try {
    const linhas = (await db.query<T>(sql)).rows
    await db.exec('reset role; release savepoint pessoa;')
    return linhas
  } catch (e) {
    await db.exec('rollback to savepoint pessoa; reset role;')
    throw e
  }
}

type Linha = { conversa_id: number; nome: string | null; ultimo_autor: string; ultimo_conteudo: string | null; ultimo_anexo_tipo: string | null; status: string; ia_pausada: boolean; nao_lida: boolean; total_mensagens: number }
const lista = (uid: string) => como<Linha>(uid, 'select * from public.conversas_sombrear order by conversa_id')

// Um banco só para o arquivo (subir o Postgres em WebAssembly custa segundos); cada teste roda
// numa transação desfeita no fim, então nenhum enxerga o que o outro gravou.
beforeAll(async () => {
  db = new PGlite()
  await db.exec(BASE)
  await db.exec(MENSAGENS)
  await db.exec(`
    insert into auth.users values ('${ANA}'), ('${BIA}'), ('${PENDENTE}');
    insert into public.profiles values ('${ANA}', true), ('${BIA}', true), ('${PENDENTE}', null);
    insert into public.crm_sombrear_ia values ('${LEAD}', 'Juliana', 'orcado, Humano', null);
    insert into public.mensagens_sombrear (id, conversa_id, inbox_id, lead_id, telefone, autor, canal_envio, privada, conteudo, anexos, enviada_em) values
      (1, 100, 5, null,      '+5517999990000', 'cliente', null,       false, 'oi',            '[]', '2026-11-20T12:00:00Z'),
      (2, 100, 5, '${LEAD}', '+5517999990000', 'ia',      null,       false, 'Olá! Sou a Amanda', '[]', '2026-11-20T12:01:00Z'),
      (3, 100, 5, '${LEAD}', '+5517999990000', 'cliente', null,       false, null, '[{"tipo":"image","url":"https://x/f.jpg","nome":"f.jpg"}]', '2026-11-20T12:05:00Z'),
      (4, 100, 5, '${LEAD}', '+5517999990000', 'equipe',  'chatwoot', true,  'nota interna',  '[]', '2026-11-20T12:06:00Z'),
      (5, 200, 5, null,      '+5517888880000', 'cliente', null,       false, 'tem pronta entrega?', '[]', '2026-11-20T10:00:00Z'),
      (6, 200, 5, null,      '+5517888880000', 'equipe',  'celular',  false, 'Tem sim',       '[]', '2026-11-20T10:10:00Z');
  `)
  await db.exec(MIGRATION)
  await db.exec(`
    grant usage on schema public, auth to authenticated;
    grant select on all tables in schema public to authenticated;
    grant insert, update on public.conversas_lidas to authenticated;
  `)
}, 120_000)

beforeEach(async () => { await db.exec('begin') })
afterEach(async () => { await db.exec('rollback') })

describe('migration 0039: colunas e realtime', () => {
  it('do_celular nasce preenchido para o que já tinha vindo do celular', async () => {
    const r = await db.query<{ id: number; do_celular: boolean }>('select id, do_celular from public.mensagens_sombrear where id in (5, 6) order by id')
    expect(r.rows.map(x => x.do_celular)).toEqual([false, true])
  })

  it('status de entrega só aceita os quatro valores', async () => {
    await db.exec(`update public.mensagens_sombrear set status_entrega = 'read' where id = 6`)
    await expect(db.exec(`update public.mensagens_sombrear set status_entrega = 'voando' where id = 6`)).rejects.toThrow()
  })

  it('rodar duas vezes não quebra, e as duas tabelas estão no realtime', async () => {
    await db.exec(MIGRATION)
    const r = await db.query<{ tablename: string }>(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`)
    expect(r.rows.map(x => x.tablename)).toEqual(['conversas_estado', 'mensagens_sombrear'])
  })

  it('profiles ganha pode_conversas desligado', async () => {
    const r = await db.query<{ pode_conversas: boolean }>(`select pode_conversas from public.profiles where id = '${ANA}'`)
    expect(r.rows[0].pode_conversas).toBe(false)
  })
})

describe('conversas_sombrear', () => {
  it('uma linha por conversa, com a última mensagem que o cliente vê (nota interna não conta)', async () => {
    const [a, b] = await lista(ANA)
    expect(a).toMatchObject({ conversa_id: 100, nome: 'Juliana', ultimo_autor: 'cliente', ultimo_conteudo: null, ultimo_anexo_tipo: 'image', status: 'open' })
    expect(Number(a.total_mensagens)).toBe(3)
    expect(b).toMatchObject({ conversa_id: 200, nome: null, ultimo_autor: 'equipe', ultimo_conteudo: 'Tem sim', ultimo_anexo_tipo: null })
  })

  it('IA pausada: sem estado gravado vale a etiqueta do CRM; com estado, a do Chatwoot', async () => {
    expect((await lista(ANA)).map(c => c.ia_pausada)).toEqual([true, false])
    await db.exec(`insert into public.conversas_estado (conversa_id, status, etiquetas) values (100, 'resolved', '{vip}'), (200, 'open', '{humano}')`)
    const depois = await lista(ANA)
    expect(depois.map(c => c.ia_pausada)).toEqual([false, true])
    expect(depois.map(c => c.status)).toEqual(['resolved', 'open'])
  })

  it('não lida é por pessoa: a Ana abriu, para a Bia continua não lida', async () => {
    expect((await lista(ANA)).map(c => c.nao_lida)).toEqual([true, false])
    await como(ANA, `insert into public.conversas_lidas (conversa_id, lida_em) values (100, '2026-11-20T12:10:00Z')`)
    expect((await lista(ANA))[0].nao_lida).toBe(false)
    expect((await lista(BIA))[0].nao_lida).toBe(true)
  })

  it('mensagem nova do cliente depois da leitura volta a ser não lida; marcar como não lida também', async () => {
    await como(ANA, `insert into public.conversas_lidas (conversa_id, lida_em) values (100, '2026-11-20T12:10:00Z'), (200, '2026-11-20T12:10:00Z')`)
    await db.exec(`insert into public.mensagens_sombrear (id, conversa_id, autor, conteudo, enviada_em) values (7, 100, 'cliente', 'e o prazo?', '2026-11-20T13:00:00Z')`)
    await como(ANA, `update public.conversas_lidas set nao_lida = true where conversa_id = 200`)
    expect((await lista(ANA)).map(c => c.nao_lida)).toEqual([true, true])
  })

  it('quem não foi aprovado não lê nada', async () => {
    expect(await lista(PENDENTE)).toEqual([])
  })
})

describe('conversas_lidas: cada um só mexe na sua', () => {
  it('não grava no nome de outra pessoa nem lê a leitura dela', async () => {
    await como(ANA, `insert into public.conversas_lidas (conversa_id, lida_em) values (100, now())`)
    await expect(como(BIA, `insert into public.conversas_lidas (conversa_id, user_id, lida_em) values (200, '${ANA}', now())`)).rejects.toThrow()
    expect(await como(BIA, 'select * from public.conversas_lidas')).toEqual([])
    await expect(como(PENDENTE, `insert into public.conversas_lidas (conversa_id, lida_em) values (100, now())`)).rejects.toThrow()
  })

  it('o estado da conversa é só leitura para o navegador', async () => {
    await expect(como(ANA, `insert into public.conversas_estado (conversa_id) values (100)`)).rejects.toThrow()
  })
})
