-- Aba Conversas do dash: a equipe atende o WhatsApp sem abrir o Chatwoot.
--
-- O Chatwoot continua sendo o centro (conta 1, caixa 5). Quem lê é a tela, por
-- `conversas_sombrear`; quem escreve são as edge functions (service role):
-- `mensagens-chatwoot` (o webhook, que já espelhava as mensagens) e `conversas` (enviar,
-- pausar a IA, encerrar). O navegador só grava o que é dele: a leitura de cada pessoa.
--
-- Rodar um comando por vez no SQL Editor (o WAF do Supabase derruba o arquivo inteiro).

-- 1) Entrega de cada mensagem enviada e a marca de "veio do celular"
alter table public.mensagens_sombrear
  add column if not exists status_entrega text check (status_entrega in ('sent', 'delivered', 'read', 'failed'));

alter table public.mensagens_sombrear
  add column if not exists erro_entrega text;

alter table public.mensagens_sombrear
  add column if not exists do_celular boolean not null default false;

update public.mensagens_sombrear set do_celular = true where canal_envio = 'celular' and not do_celular;

-- 2) O estado da conversa no Chatwoot (aberta ou encerrada, e as etiquetas: `humano` = IA
--    pausada). As mensagens não guardam isso. Quem grava é o webhook (toda mensagem traz a
--    conversa junto) e a function `conversas`, na hora em que muda.
create table if not exists public.conversas_estado (
  conversa_id   bigint primary key,                 -- id da conversa no Chatwoot
  status        text not null default 'open',       -- open | resolved | pending | snoozed
  etiquetas     text[] not null default '{}',
  atualizada_em timestamptz not null default now()
);

alter table public.conversas_estado enable row level security;

drop policy if exists conversas_estado_ver on public.conversas_estado;
create policy conversas_estado_ver on public.conversas_estado
  for select to authenticated using (public.eh_aprovado());

-- 3) Lida e não lida, por pessoa. Abrir a conversa grava `lida_em`; "marcar como não lida"
--    liga `nao_lida` até a pessoa abrir de novo.
create table if not exists public.conversas_lidas (
  conversa_id bigint not null,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lida_em     timestamptz,
  nao_lida    boolean not null default false,
  primary key (conversa_id, user_id)
);

alter table public.conversas_lidas enable row level security;

drop policy if exists conversas_lidas_ver on public.conversas_lidas;
create policy conversas_lidas_ver on public.conversas_lidas
  for select to authenticated using (public.eh_aprovado() and user_id = auth.uid());

drop policy if exists conversas_lidas_inserir on public.conversas_lidas;
create policy conversas_lidas_inserir on public.conversas_lidas
  for insert to authenticated with check (public.eh_aprovado() and user_id = auth.uid());

drop policy if exists conversas_lidas_editar on public.conversas_lidas;
create policy conversas_lidas_editar on public.conversas_lidas
  for update to authenticated
  using (public.eh_aprovado() and user_id = auth.uid())
  with check (public.eh_aprovado() and user_id = auth.uid());

-- 4) A lista da aba: uma linha por conversa. security_invoker faz valer a RLS de quem
--    consulta, então `nao_lida` sai já para a pessoa logada (auth.uid()).
--    Nota interna (privada) não conta como última mensagem nem como recebida.
create or replace view public.conversas_sombrear
with (security_invoker = true) as
with resumo as (
  select m.conversa_id,
         max(m.inbox_id) as inbox_id,
         max(m.telefone) as telefone,
         (array_agg(m.lead_id order by m.enviada_em desc) filter (where m.lead_id is not null))[1] as lead_id,
         max(m.enviada_em) filter (where m.autor = 'cliente') as ultima_recebida_em,
         count(*) as total_mensagens
    from public.mensagens_sombrear m
   where not m.privada
   group by m.conversa_id
), ultima as (
  select distinct on (m.conversa_id)
         m.conversa_id, m.enviada_em, m.autor, m.conteudo, m.excluida,
         m.anexos -> 0 ->> 'tipo' as anexo_tipo
    from public.mensagens_sombrear m
   where not m.privada
   order by m.conversa_id, m.enviada_em desc, m.id desc
)
select r.conversa_id,
       r.inbox_id,
       r.telefone,
       r.lead_id,
       l.nome,
       u.enviada_em as ultima_mensagem_em,
       u.autor as ultimo_autor,
       case when u.excluida then null else left(u.conteudo, 160) end as ultimo_conteudo,
       u.anexo_tipo as ultimo_anexo_tipo,
       r.ultima_recebida_em,
       r.total_mensagens,
       coalesce(e.status, 'open') as status,
       -- com o estado gravado, vale a etiqueta do Chatwoot; sem ele (conversa de antes desta
       -- migration), o que o CRM da Amanda sabe: a mesma regra do estaComEquipe() do dash
       case when e.conversa_id is not null then 'humano' = any (e.etiquetas)
            else coalesce('humano' = any (string_to_array(replace(lower(l.chatwoot_labels), ' ', ''), ',')), false)
                 or lower(btrim(coalesce(l.precisa_humano, ''))) = 'sim'
       end as ia_pausada,
       case when ld.nao_lida then true
            when ld.lida_em is null then u.autor = 'cliente'
            else coalesce(r.ultima_recebida_em > ld.lida_em, false)
       end as nao_lida
  from resumo r
  join ultima u on u.conversa_id = r.conversa_id
  left join public.crm_sombrear_ia l on l.id = r.lead_id
  left join public.conversas_estado e on e.conversa_id = r.conversa_id
  left join public.conversas_lidas ld on ld.conversa_id = r.conversa_id and ld.user_id = auth.uid();

-- 5) Permissão da área, como as outras (admin entra sempre)
alter table public.profiles
  add column if not exists pode_conversas boolean default false;

-- 6) Realtime: mensagem nova e mudança de estado chegam na tela sem recarregar
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mensagens_sombrear') then
    alter publication supabase_realtime add table public.mensagens_sombrear;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversas_estado') then
    alter publication supabase_realtime add table public.conversas_estado;
  end if;
end $$;
