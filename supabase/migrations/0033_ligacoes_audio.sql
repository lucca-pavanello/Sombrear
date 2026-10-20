-- 0033 · Gravação das ligações da Amanda de voz
--
-- A voz manda o áudio depois de registrar a ligação (edge function registrar-ligacao, ?audio=<ref>).
-- O arquivo fica no bucket privado `ligacoes-audio` e o caminho em `ligacoes.audio_path`; o Dash
-- (aba Agente IA > Ligações) toca com link assinado. Quem grava é a function (service_role).

alter table public.ligacoes add column if not exists audio_path text;

insert into storage.buckets (id, name, public)
values ('ligacoes-audio', 'ligacoes-audio', false)
on conflict (id) do nothing;

-- a equipe ouve no Dash (mesma régua da tabela: todo usuário logado); ninguém grava pelo app
drop policy if exists ligacoes_audio_ouvir on storage.objects;
create policy ligacoes_audio_ouvir on storage.objects for select to authenticated
  using (bucket_id = 'ligacoes-audio');
