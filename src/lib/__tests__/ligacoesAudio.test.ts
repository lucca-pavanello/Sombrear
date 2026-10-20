/**
 * Gravação das ligações: a migration 0033 num Postgres de verdade (PGlite) e o
 * recebimento do áudio pela edge function registrar-ligacao (./audio.ts).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { BUCKET, LIMITE_BYTES, guardarAudio, type Arquivos } from '../../../supabase/functions/registrar-ligacao/audio'

const ler = (n: string) => readFileSync(path.resolve(__dirname, '../../../supabase/migrations', n), 'utf8')
const M32 = ler('0032_ligacoes.sql')
const M33 = ler('0033_ligacoes_audio.sql')

// o mínimo do Supabase (tabela do CRM e o schema storage) que as migrations usam
const BASE = `
  create role anon; create role authenticated; create role service_role;
  create table public.crm_sombrear_ia (id uuid primary key default gen_random_uuid(), nome text);
  create schema storage; grant usage on schema storage to authenticated, anon;
  create table storage.buckets (id text primary key, name text not null, public boolean default false);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant select on storage.objects to authenticated, anon;
`

describe('gravação das ligações (0033)', () => {
  let db: PGlite
  beforeEach(async () => {
    db = new PGlite()
    await db.exec(BASE)
    await db.exec(M32)
    await db.exec(M33)
  })

  it('a ligação ganha audio_path e o bucket nasce privado', async () => {
    await db.query(`insert into public.ligacoes (ref, inicio, audio_path) values ('voz-1', now(), 'voz-1.ogg')`)
    expect((await db.query(`select audio_path from public.ligacoes`)).rows).toEqual([{ audio_path: 'voz-1.ogg' }])
    expect((await db.query(`select id, public from storage.buckets`)).rows).toEqual([{ id: 'ligacoes-audio', public: false }])
  })

  it('a equipe logada ouve só o que é do bucket das ligações; o anônimo não ouve nada', async () => {
    await db.exec(`insert into storage.objects (bucket_id, name) values ('ligacoes-audio', 'voz-1.ogg'), ('outro', 'x.png')`)
    await db.exec(`set role authenticated`)
    expect((await db.query(`select name from storage.objects`)).rows).toEqual([{ name: 'voz-1.ogg' }])
    await db.exec(`reset role; set role anon`)
    expect((await db.query(`select name from storage.objects`)).rows).toEqual([])
  })

  it('rodar a migration de novo não quebra', async () => {
    await expect(db.exec(M33)).resolves.toBeDefined()
  })
})

function arquivosFalsos(existe = true) {
  const subidos: { caminho: string; tipo: string; n: number }[] = []
  const marcados: { ref: string; caminho: string }[] = []
  const a: Arquivos = {
    existeLigacao: async () => existe,
    subir: async (caminho, bytes, tipo) => { subidos.push({ caminho, tipo, n: bytes.byteLength }) },
    marcar: async (ref, caminho) => { marcados.push({ ref, caminho }) },
  }
  return { a, subidos, marcados }
}

const OGG = new Uint8Array([79, 103, 103, 83])

describe('receber o áudio (registrar-ligacao ?audio=)', () => {
  it('guarda no bucket com o ref como nome e marca na ligação', async () => {
    const f = arquivosFalsos()
    const r = await guardarAudio('voz-1ec8c526-15a5', 'audio/ogg', OGG, f.a)
    expect(r).toEqual({ status: 200, corpo: { ok: true, audio_path: 'voz-1ec8c526-15a5.ogg' } })
    expect(f.subidos).toEqual([{ caminho: 'voz-1ec8c526-15a5.ogg', tipo: 'audio/ogg', n: 4 }])
    expect(f.marcados).toEqual([{ ref: 'voz-1ec8c526-15a5', caminho: 'voz-1ec8c526-15a5.ogg' }])
    expect(BUCKET).toBe('ligacoes-audio')
  })

  it('ref com barra ou ponto não vira caminho de arquivo', async () => {
    for (const ref of ['../x', 'a/b', 'voz.1', '', null]) {
      const f = arquivosFalsos()
      expect((await guardarAudio(ref, 'audio/ogg', OGG, f.a)).status).toBe(400)
      expect(f.subidos).toEqual([])
    }
  })

  it('recusa o que não é áudio, vazio ou grande demais', async () => {
    const f = arquivosFalsos()
    expect((await guardarAudio('voz-1', 'text/html', OGG, f.a)).status).toBe(400)
    expect((await guardarAudio('voz-1', 'audio/ogg', new Uint8Array(0), f.a)).status).toBe(400)
    expect((await guardarAudio('voz-1', 'audio/ogg', new Uint8Array(LIMITE_BYTES + 1), f.a)).status).toBe(413)
    expect(f.subidos).toEqual([])
  })

  it('sem a ligação registrada antes, não guarda o áudio', async () => {
    const f = arquivosFalsos(false)
    expect((await guardarAudio('voz-1', 'audio/ogg; codecs=opus', OGG, f.a)).status).toBe(404)
    expect(f.subidos).toEqual([])
  })
})
