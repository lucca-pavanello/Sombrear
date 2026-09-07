-- O upload de foto nunca funcionou: todo envio morria em 42P10.
--
-- A 0016 criou a chave única de `sobras_fotos` como índice de EXPRESSÃO, usando
-- COALESCE(abertura, '') para que dois tecidos sem abertura não fossem tratados como
-- distintos (em Postgres, NULL != NULL, então um índice comum deixaria duplicar).
--
-- Só que o hook `useEnviarFoto` faz upsert com `onConflict: 'familia,abertura,cor,tipo'`,
-- por NOME DE COLUNA. O Postgres precisa casar o alvo do ON CONFLICT com um índice único,
-- e uma lista de colunas não casa com um índice de expressão. Resultado:
--   ERROR 42P10: there is no unique or exclusion constraint matching the ON CONFLICT
-- em todo upload, de qualquer tecido. Na tela isso aparecia como "Não consegui enviar a
-- foto", sem dizer por quê.
--
-- A saída é NULLS NOT DISTINCT (Postgres 15+, e aqui roda 17): mantém a proteção contra
-- duplicata quando `abertura` é NULL e, por ser um índice de colunas simples, casa com o
-- onConflict que o código já manda. Assim os dois lados voltam a falar a mesma língua sem
-- precisar mudar o hook.
drop index if exists public.idx_sobras_fotos_chave;

create unique index idx_sobras_fotos_chave
  on public.sobras_fotos (familia, abertura, cor, tipo) nulls not distinct;

comment on index public.idx_sobras_fotos_chave is
  'Chave do jogo de fotos. NULLS NOT DISTINCT de propósito: sem isso, tecidos sem abertura duplicariam, e um índice de expressão quebraria o upsert do dash (42P10).';
