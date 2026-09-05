-- Medição semanal do Mercado Livre + correções que a pesquisa de mercado (04/09) trouxe.
--
-- Por que gravar em vez de só consultar na hora: "o anúncio está melhorando?" não tem
-- resposta sem histórico. A API do ML devolve o AGORA — visitas do período, posição atual
-- da palavra na busca — e nada disso fica guardado do lado dele. Uma linha por semana por
-- chave é o suficiente pra ver uma palavra subindo e um anúncio perdendo visita.
--
-- Contexto que motivou as duas tabelas: `GET /sites/MLB/search` passou a devolver 403 mesmo
-- com token, então a leitura de mercado vem de `trends` (o que as pessoas digitam) e
-- `highlights` (o ranking de mais vendidos), que continuam abertos.

-- ── 1) As fotos passam de 4 para 6, e a CAPA muda ────────────────────────────
-- O anúncio de +500 vendidos que serviu de referência tem 8 fotos e a primeira é AMBIENTE,
-- não fundo branco. A capa é o que aparece na busca, e nessa categoria quem vende mostra a
-- persiana instalada, não o tecido recortado. Os dois tipos novos (ambiente_2 e medida)
-- também vieram de lá.
alter table public.sobras_fotos drop constraint if exists sobras_fotos_tipo_check;
alter table public.sobras_fotos add constraint sobras_fotos_tipo_check
  check (tipo in ('ambiente', 'ambiente_2', 'zoom', 'medida', 'fundo_branco', 'explicativa'));

comment on column public.sobras_fotos.ordem is
  'Posição da foto no anúncio. A de ordem 0 é a CAPA (a que aparece na busca do ML) e deve ser um ambiente.';

-- ── 2) O que o mercado procura, semana a semana ──────────────────────────────
create table if not exists public.ml_tendencias_semana (
  semana   date    not null,
  keyword  text    not null,
  posicao  integer not null,
  coletado_em timestamptz not null default now(),
  primary key (semana, keyword)
);

comment on table public.ml_tendencias_semana is
  'Top 50 buscas da categoria MLB4771 por semana (GET /trends). Serve pra ver uma palavra subir ou entrar no ranking.';
comment on column public.ml_tendencias_semana.semana is
  'Domingo da coleta. A PK (semana, keyword) faz a coleta ser idempotente: rodar duas vezes no mesmo domingo não duplica.';

create index if not exists idx_ml_tendencias_keyword on public.ml_tendencias_semana (keyword, semana desc);

-- ── 3) Como cada anúncio nosso foi na semana ─────────────────────────────────
create table if not exists public.ml_anuncios_semana (
  semana      date not null,
  ml_item_id  text not null,
  titulo      text,
  status      text,
  preco       numeric(10,2),
  visitas     integer,
  perguntas   integer,
  vendidos    integer,
  coletado_em timestamptz not null default now(),
  primary key (semana, ml_item_id)
);

comment on table public.ml_anuncios_semana is
  'Foto semanal de cada anúncio da conta no ML. Visitas sem pergunta = preço ou foto; nenhuma visita = título.';
comment on column public.ml_anuncios_semana.visitas is
  'Visitas DA SEMANA (GET /items/visits com date_from/date_to), não o acumulado — é o acumulado que esconde a queda.';

create index if not exists idx_ml_anuncios_item on public.ml_anuncios_semana (ml_item_id, semana desc);

-- ── 4) RLS, no mesmo padrão das outras tabelas do ML ─────────────────────────
alter table public.ml_tendencias_semana enable row level security;
alter table public.ml_anuncios_semana   enable row level security;

drop policy if exists ml_tendencias_ver on public.ml_tendencias_semana;
create policy ml_tendencias_ver on public.ml_tendencias_semana for select to authenticated using (public.eh_aprovado());

drop policy if exists ml_anuncios_ver on public.ml_anuncios_semana;
create policy ml_anuncios_ver on public.ml_anuncios_semana for select to authenticated using (public.eh_aprovado());

-- Escrita é só do n8n (service role, que não passa por RLS). Ninguém edita a medição na
-- mão: um número corrigido no banco é um histórico que mente.
