-- Fotos de referência de modelo — a Amanda mostrar, não só descrever.
--
-- Generaliza o mecanismo [MIDIA_BANDO] que já roda em produção (Amanda | Agente principal):
-- quando o cliente pergunta o que é o bandô, a Amanda emite um marcador, um node baixa a
-- foto de um bucket e manda como anexo real no Chatwoot. A própria sticky note do workflow
-- já dizia "padrão reaproveitável para outras mídias fixas" — isto é essa extensão.
--
-- Motivo de existir: não havia (e não há hoje) nenhuma medição de que mandar foto de modelo
-- ajude ou atrapalhe a venda — a lembrança de "não mandar foto" era outra coisa (decisão de
-- 07/2026 de não mandar link de catálogo em PDF porque as fotos ainda não existiam). A
-- taxonomia de objeções já recomenda o contrário ("mandar foto real... antes de
-- perguntarem"). Por isso a coluna de instrumentação no fim deste arquivo: sem dado,
-- "ajuda ou atrapalha" é opinião.
--
-- Vocabulário real (levantado no motor de preço e no banco, NÃO o nome que a fábrica usa
-- nas fotos — que mistura tecido e acabamento no mesmo texto, tipo "Rolô com bkout+bandô"):
--   modelo:      Rolo, Rolo Motorizado, Double, Romana, PV, PH_Aluminio, PH_50, Painel
--                (Painel existe no formulário e no classificador de texto, mas NUNCA foi
--                precificado — zero orçamento real usa esse modelo. A foto pode existir e
--                ser mostrada mesmo assim; só não dá pra cotar até alguém montar o motor.)
--   tecido_tipo: blackout, decorativo, tela_solar_1, tela_solar_3 (Rolô/Double); null = qualquer
--   acabamento:  Sem, Bando Branco, Bando Preto, Barra Niveladora, Kit Box, Cadarço, Fita;
--                null = qualquer — mesmos valores literais de orcamentos.acabamentos

create table public.modelo_fotos_referencia (
  id             uuid primary key default gen_random_uuid(),
  modelo         text not null,
  tecido_tipo    text,
  acabamento     text,
  url            text not null,
  ativo          boolean not null default true,
  atualizado_por text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.modelo_fotos_referencia is
  'Uma foto de referência por combinação modelo+tecido+acabamento, pra Amanda mostrar em vez de só descrever. Gerenciado por script/n8n — sem tela no dash por enquanto (decisão explícita, pode mudar depois).';
comment on column public.modelo_fotos_referencia.modelo is
  'Um dos 7 modelos reais do motor de preço, ou "Painel" (existe no formulário, sem motor ainda). Nunca o nome cru que a fábrica usa no arquivo da foto.';
comment on column public.modelo_fotos_referencia.tecido_tipo is
  'null = vale pra qualquer tecido daquele modelo (coringa). Mesma precedência de precoMl.ts/acharRegraPreco: mais específico vence.';
comment on column public.modelo_fotos_referencia.acabamento is
  'null = vale pra qualquer acabamento (coringa). Mesmos valores literais de orcamentos.acabamentos (Sem, Bando Branco, Kit Box...).';

-- Chave de negócio, mesmo desenho de precos_ml/sobras_fotos: coalesce nas colunas nullable
-- pra dois coringas não colidirem, e pra nunca existir duas fotos "titulares" da mesma combinação.
create unique index idx_modelo_fotos_chave
  on public.modelo_fotos_referencia (modelo, coalesce(tecido_tipo, ''), coalesce(acabamento, ''));

alter table public.modelo_fotos_referencia enable row level security;

drop policy if exists modelo_fotos_ver on public.modelo_fotos_referencia;
create policy modelo_fotos_ver on public.modelo_fotos_referencia
  for select to authenticated using (public.eh_aprovado());

drop policy if exists modelo_fotos_editar on public.modelo_fotos_referencia;
create policy modelo_fotos_editar on public.modelo_fotos_referencia
  for all to authenticated using (public.eh_aprovado()) with check (public.eh_aprovado());

-- Bucket público de propósito, mesmo motivo do sobras-fotos: o Chatwoot baixa a foto pela
-- URL na hora de mandar o anexo. Se tomar 403 ao baixar, a mensagem sai sem a imagem.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('modelo-fotos-referencia', 'modelo-fotos-referencia', true, 10485760,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists modelo_fotos_leitura_publica on storage.objects;
create policy modelo_fotos_leitura_publica on storage.objects
  for select to public using (bucket_id = 'modelo-fotos-referencia');

drop policy if exists modelo_fotos_upload on storage.objects;
create policy modelo_fotos_upload on storage.objects
  for insert to authenticated with check (bucket_id = 'modelo-fotos-referencia' and public.eh_aprovado());

drop policy if exists modelo_fotos_storage_update on storage.objects;
create policy modelo_fotos_storage_update on storage.objects
  for update to authenticated using (bucket_id = 'modelo-fotos-referencia' and public.eh_aprovado());

drop policy if exists modelo_fotos_storage_delete on storage.objects;
create policy modelo_fotos_storage_delete on storage.objects
  for delete to authenticated using (bucket_id = 'modelo-fotos-referencia' and public.eh_admin());

-- Instrumentação: booleano, não contador — o que se quer comparar é "recebeu foto de modelo
-- nesta conversa" contra desfecho (lead_score, orcamento_aceito), não quantas fotos.
alter table public.crm_sombrear_ia
  add column if not exists recebeu_foto_modelo boolean not null default false;

comment on column public.crm_sombrear_ia.recebeu_foto_modelo is
  'true se a Amanda mandou pelo menos uma foto de modelo nesta conversa (via [MIDIA_MODELO]). Cruzar com lead_score/orcamento_aceito daqui a algumas semanas pra medir o efeito de verdade, em vez de opinião.';
