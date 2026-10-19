-- 0032 · Ligações da Amanda de voz
--
-- Uma linha por ligação: quem ligou, o que pediu, o que a Amanda respondeu e o que foi
-- feito depois (lead no CRM, mensagem no WhatsApp). Quem grava é a edge function
-- registrar-ligacao, chamada pela Amanda de voz quando a ligação termina; o `ref` é o id
-- da ligação no agente, então repetir o envio não duplica.

create table if not exists public.ligacoes (
  id                 uuid primary key default gen_random_uuid(),
  ref                text not null unique check (length(trim(ref)) > 0),
  inicio             timestamptz not null,
  fim                timestamptz,
  -- o número que a linha telefônica informou e o que o cliente confirmou para o WhatsApp
  telefone_chamador  text,
  telefone           text,
  nome               text,
  assunto            text check (assunto in ('orcamento', 'duvida', 'outro')),
  resumo             text,
  -- o último orçamento passado na ligação, como a calculadora devolveu
  orcamento          jsonb,
  -- [{ "quem": "cliente" | "amanda", "texto": "...", "em": "..." }]
  transcricao        jsonb not null default '[]'::jsonb,
  lead_id            uuid references public.crm_sombrear_ia(id) on delete set null,
  conversa_chatwoot  text,
  -- enviado: mensagem ao cliente + nota à equipe · so_nota: a equipe já assumiu o lead
  -- sem_telefone: não deu para identificar o cliente · erro: ver whatsapp_erro
  whatsapp_status    text not null default 'pendente'
                     check (whatsapp_status in ('pendente', 'enviado', 'so_nota', 'sem_telefone', 'erro')),
  whatsapp_erro      text,
  criada_em          timestamptz not null default now()
);
create index if not exists ligacoes_inicio_idx on public.ligacoes (inicio desc);
create index if not exists ligacoes_lead_idx on public.ligacoes (lead_id);

alter table public.ligacoes enable row level security;

-- a equipe lê no Dash; só a edge function (service_role, que ignora RLS) grava
drop policy if exists ligacoes_ver on public.ligacoes;
create policy ligacoes_ver on public.ligacoes for select to authenticated using (true);

revoke all on public.ligacoes from anon;
revoke insert, update, delete, truncate on public.ligacoes from authenticated;
grant select on public.ligacoes to authenticated;
