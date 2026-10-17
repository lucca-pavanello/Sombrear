-- 0031 — Agenda de visitas técnicas: onde a voz (e depois a Amanda e a equipe) marca visita.
--
-- POR QUE (Lucca, 17/10/2026): primeiro produto do laboratório na Sombrear, voz + agenda.
-- A ligação atende, vê o horário livre e marca a visita aqui. Por enquanto a agenda mora no
-- Dash da Sombrear, não no CRM MIP, pra gastar o mínimo.
--
-- QUEM CHAMA: a voz roda no servidor com a service_role e só usa as duas funções
-- (horarios_livres e marcar_visita). A equipe lê e mexe pela tela (authenticated).
-- Nada aqui depende de segredo do Vault nem de outra migration.

-- ── 1. Como a agenda funciona (uma linha só) ─────────────────────────────
create table if not exists public.agenda_config (
  id                   boolean primary key default true check (id),
  duracao_min          int  not null default 60  check (duracao_min between 15 and 480),
  -- tempo entre uma visita e outra (deslocamento), conta como ocupado
  intervalo_min        int  not null default 30  check (intervalo_min between 0 and 240),
  -- quantas visitas podem acontecer ao mesmo tempo (quantas equipes de medição)
  capacidade           int  not null default 1   check (capacidade between 1 and 10),
  -- de quanto em quanto tempo oferecer horário
  passo_min            int  not null default 60  check (passo_min between 15 and 240),
  -- não marcar em cima da hora nem longe demais
  antecedencia_horas   int  not null default 2   check (antecedencia_horas between 0 and 72),
  dias_a_frente        int  not null default 14  check (dias_a_frente between 1 and 60),
  -- dia da semana (0 = domingo … 6 = sábado) → lista de janelas ["HH:MM","HH:MM"]
  -- padrão = horário da loja: seg a sex 9h–17h, sáb 9h–13h
  janelas              jsonb not null default '{
    "1": [["09:00","17:00"]], "2": [["09:00","17:00"]], "3": [["09:00","17:00"]],
    "4": [["09:00","17:00"]], "5": [["09:00","17:00"]], "6": [["09:00","13:00"]]
  }'::jsonb,
  atualizado_em        timestamptz not null default now()
);
insert into public.agenda_config (id) values (true) on conflict (id) do nothing;

-- ── 2. Folga, feriado, dia sem medição ───────────────────────────────────
create table if not exists public.agenda_bloqueios (
  id         uuid primary key default gen_random_uuid(),
  inicio     timestamptz not null,
  fim        timestamptz not null check (fim > inicio),
  motivo     text,
  criado_em  timestamptz not null default now()
);

-- ── 3. As visitas ────────────────────────────────────────────────────────
create table if not exists public.visitas (
  id             uuid primary key default gen_random_uuid(),
  inicio         timestamptz not null,
  fim            timestamptz not null check (fim > inicio),
  cliente_nome   text not null check (length(trim(cliente_nome)) > 0),
  telefone       text not null check (length(regexp_replace(telefone, '\D', '', 'g')) >= 10),
  endereco       text,
  observacao     text,
  status         text not null default 'marcada' check (status in ('marcada', 'cancelada', 'feita')),
  origem         text not null default 'equipe'  check (origem in ('voz', 'whatsapp', 'equipe')),
  -- id da ligação no orquestrador de voz, pra achar a gravação/transcrição
  ligacao_ref    text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists visitas_inicio_idx on public.visitas (inicio) where status = 'marcada';

-- ── 4. Horários livres ───────────────────────────────────────────────────
-- Devolve o início de cada horário que ainda cabe uma visita, no período pedido
-- (dias do calendário de São Paulo), respeitando janela, antecedência, dias à frente,
-- bloqueios e capacidade. Uma visita ocupa [inicio, fim + intervalo).
create or replace function public.horarios_livres(p_de date, p_ate date)
returns setof timestamptz
language sql stable
set search_path = public
as $$
  with c as (select * from public.agenda_config where id),
  dias as (
    select d::date as dia
    from c, generate_series(
      greatest(p_de, (now() at time zone 'America/Sao_Paulo')::date),
      least(p_ate, (now() at time zone 'America/Sao_Paulo')::date + c.dias_a_frente),
      interval '1 day') d
  ),
  janelas as (
    select dias.dia, (j->>0)::time as abre, (j->>1)::time as fecha
    from dias, c,
         jsonb_array_elements(coalesce(c.janelas -> extract(dow from dias.dia)::int::text, '[]'::jsonb)) j
  ),
  candidatos as (
    select (s at time zone 'America/Sao_Paulo') as inicio
    from janelas, c,
         generate_series(janelas.dia + janelas.abre,
                         janelas.dia + janelas.fecha - make_interval(mins => c.duracao_min),
                         make_interval(mins => c.passo_min)) s
  )
  select k.inicio
  from candidatos k, c
  where k.inicio >= now() + make_interval(hours => c.antecedencia_horas)
    and not exists (
      select 1 from public.agenda_bloqueios b
      where tstzrange(b.inicio, b.fim) && tstzrange(k.inicio, k.inicio + make_interval(mins => c.duracao_min))
    )
    and (
      select count(*) from public.visitas v
      where v.status = 'marcada'
        and tstzrange(v.inicio, v.fim + make_interval(mins => c.intervalo_min))
         && tstzrange(k.inicio, k.inicio + make_interval(mins => c.duracao_min + c.intervalo_min))
    ) < c.capacidade
  order by k.inicio;
$$;

-- ── 5. Marcar ────────────────────────────────────────────────────────────
-- Só marca num horário que horarios_livres oferece agora. Duas ligações no mesmo
-- horário: o lock serializa e a segunda recebe 'horario_ocupado'.
create or replace function public.marcar_visita(
  p_inicio timestamptz, p_cliente_nome text, p_telefone text,
  p_endereco text default null, p_observacao text default null,
  p_origem text default 'voz', p_ligacao_ref text default null
) returns public.visitas
language plpgsql volatile
security definer
set search_path = public
as $$
declare
  v public.visitas;
  dur int;
  dia date := (p_inicio at time zone 'America/Sao_Paulo')::date;
begin
  perform pg_advisory_xact_lock(hashtext('agenda_visitas'));
  if not exists (select 1 from public.horarios_livres(dia, dia) h where h = p_inicio) then
    raise exception 'horario_ocupado' using errcode = 'P0001',
      hint = 'Consulte horarios_livres e ofereça outro horário.';
  end if;
  select duracao_min into dur from public.agenda_config where id;
  insert into public.visitas (inicio, fim, cliente_nome, telefone, endereco, observacao, origem, ligacao_ref)
  values (p_inicio, p_inicio + make_interval(mins => dur), trim(p_cliente_nome), p_telefone,
          nullif(trim(p_endereco), ''), nullif(trim(p_observacao), ''), p_origem, p_ligacao_ref)
  returning * into v;
  return v;
end $$;

-- ── 6. Acesso ────────────────────────────────────────────────────────────
alter table public.agenda_config   enable row level security;
alter table public.agenda_bloqueios enable row level security;
alter table public.visitas          enable row level security;

-- a equipe vê e cuida da agenda; só o admin muda como ela funciona
drop policy if exists agenda_config_le on public.agenda_config;
create policy agenda_config_le on public.agenda_config for select to authenticated using (true);
drop policy if exists agenda_config_admin on public.agenda_config;
create policy agenda_config_admin on public.agenda_config for update to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists agenda_bloqueios_equipe on public.agenda_bloqueios;
create policy agenda_bloqueios_equipe on public.agenda_bloqueios for all to authenticated
  using (true) with check (true);

drop policy if exists visitas_equipe on public.visitas;
create policy visitas_equipe on public.visitas for all to authenticated
  using (true) with check (true);

revoke all on public.agenda_config, public.agenda_bloqueios, public.visitas from anon;
grant select, update on public.agenda_config to authenticated;
grant select, insert, update, delete on public.agenda_bloqueios, public.visitas to authenticated;

-- as funções: a voz chama pela service_role; a equipe também pode usar pela tela
revoke execute on function public.horarios_livres(date, date) from public, anon;
revoke execute on function public.marcar_visita(timestamptz, text, text, text, text, text, text) from public, anon;
grant execute on function public.horarios_livres(date, date) to authenticated, service_role;
grant execute on function public.marcar_visita(timestamptz, text, text, text, text, text, text) to authenticated, service_role;
