/**
 * A migration 0031 (agenda de visitas) rodando num Postgres de verdade em WebAssembly.
 * Os dias são relativos a hoje porque as funções usam now(): antecedência e dias à frente.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/0031_agenda_visitas.sql'), 'utf8')

// o mínimo do Supabase que a migration usa
const BASE = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create table public.profiles (id uuid primary key, is_admin boolean default false);
  create function public.eh_admin() returns boolean language sql stable as $$
    select exists (select 1 from public.profiles where id = auth.uid() and is_admin) $$;
`

/** próximo dia da semana `dow` (0 = domingo) a pelo menos 2 dias de hoje, em São Paulo */
function proximo(dow: number): string {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  d.setDate(d.getDate() + 2)
  while (d.getDay() !== dow) d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-CA')
}

let db: PGlite

async function livres(dia: string): Promise<string[]> {
  const r = await db.query<{ h: string }>(
    `select to_char(h at time zone 'America/Sao_Paulo', 'HH24:MI') as h
       from public.horarios_livres($1::date, $1::date) h`, [dia])
  return r.rows.map((x) => x.h)
}

async function marcar(dia: string, hora: string) {
  return db.query(
    `select * from public.marcar_visita(($1 || ' ' || $2)::timestamp at time zone 'America/Sao_Paulo',
                                        'Maria Teste', '17 99999-0000')`, [dia, hora])
}

beforeEach(async () => {
  db = new PGlite()
  await db.exec(BASE)
  await db.exec(MIGRATION)
})

describe('agenda de visitas (0031)', () => {
  it('oferece o horário da loja: terça 9h às 16h, sábado 9h às 12h, domingo nada', async () => {
    expect(await livres(proximo(2))).toEqual(
      ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'])
    expect(await livres(proximo(6))).toEqual(['09:00', '10:00', '11:00', '12:00'])
    expect(await livres(proximo(0))).toEqual([])
  })

  it('visita marcada ocupa o horário e o deslocamento dos vizinhos', async () => {
    const terca = proximo(2)
    const r = await marcar(terca, '10:00')
    expect(r.rows).toHaveLength(1)
    // 10h às 11h + 30 min de deslocamento: 9h (até 10h30) e 11h (até 12h30) também batem
    expect(await livres(terca)).toEqual(['12:00', '13:00', '14:00', '15:00', '16:00'])
  })

  it('segunda ligação no mesmo horário recebe horario_ocupado', async () => {
    const terca = proximo(2)
    await marcar(terca, '10:00')
    await expect(marcar(terca, '10:00')).rejects.toThrow(/horario_ocupado/)
    await expect(marcar(terca, '11:00')).rejects.toThrow(/horario_ocupado/)
  })

  it('não marca fora da janela nem fora do passo', async () => {
    const terca = proximo(2)
    await expect(marcar(terca, '17:00')).rejects.toThrow(/horario_ocupado/)
    await expect(marcar(terca, '10:30')).rejects.toThrow(/horario_ocupado/)
    await expect(marcar(proximo(0), '10:00')).rejects.toThrow(/horario_ocupado/)
  })

  it('com duas equipes, o mesmo horário aceita duas visitas e recusa a terceira', async () => {
    const terca = proximo(2)
    await db.exec('update public.agenda_config set capacidade = 2')
    await marcar(terca, '10:00')
    await marcar(terca, '10:00')
    await expect(marcar(terca, '10:00')).rejects.toThrow(/horario_ocupado/)
  })

  it('visita cancelada devolve o horário', async () => {
    const terca = proximo(2)
    await marcar(terca, '10:00')
    await db.exec(`update public.visitas set status = 'cancelada'`)
    expect(await livres(terca)).toContain('10:00')
  })

  it('bloqueio tira o horário e não oferece além dos dias à frente', async () => {
    const terca = proximo(2)
    await db.query(
      `insert into public.agenda_bloqueios (inicio, fim, motivo)
       values (($1 || ' 13:00')::timestamp at time zone 'America/Sao_Paulo',
               ($1 || ' 15:00')::timestamp at time zone 'America/Sao_Paulo', 'feriado')`, [terca])
    expect(await livres(terca)).toEqual(['09:00', '10:00', '11:00', '12:00', '15:00', '16:00'])
    const longe = new Date(Date.now() + 40 * 864e5).toLocaleDateString('en-CA')
    expect(await livres(longe)).toEqual([])
  })

  it('anônimo não consulta nem marca', async () => {
    await db.exec('set role anon')
    await expect(livres(proximo(2))).rejects.toThrow(/permission denied/)
    await expect(marcar(proximo(2), '10:00')).rejects.toThrow(/permission denied/)
  })
})
