-- SOMBREAR — 0044 — a loja edita o nome (e o resto) de um material, e exclui
--
-- Pedido da Stella (24/10): na aba Estoque → Custos, poder editar o nome do
-- produto e todos os campos, e também excluir.
--
-- Por que não basta um UPDATE em catalogo_itens: o item é o que está ESCRITO
-- no documento do fornecedor. O pedido 115104 diz "TRILHO DUPLO", e isso é um
-- fato do papel — a mesma regra da correção de custo (0033) e de esconder
-- coluna (0043). Reescrever o item falsificaria o documento, e reimportar o
-- pedido desfaria a edição.
--
-- Então a edição é uma CAMADA POR CIMA: catalogo_ajustes_material guarda,
-- para cada produto como ele está no papel (fornecedor + código + descrição
-- originais), como a loja quer que ele apareça. A view catalogo_custo_vigente
-- passa a ler os valores ajustados — e por isso o cálculo, o chat de estoque
-- e a tela enxergam o nome novo sem mudar uma linha de código cada.
--
-- Excluir é a mesma camada com uma data: `excluido_em`. Somem do catálogo os
-- registros feitos ATÉ essa data. Se a loja voltar a comprar o material (um
-- pedido novo, ou "Novo material" com o mesmo nome), o registro novo é mais
-- recente que a exclusão e aparece de novo — excluir não vira uma lista negra
-- eterna. E o documento continua inteiro no banco.
--
-- Depende de 0033, 0035 e 0042. Rollback no fim.

-- ------------------------------------------------------------
-- 1. A camada de ajustes
-- ------------------------------------------------------------
create table if not exists catalogo_ajustes_material (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  atualizado_por     uuid references auth.users(id) default auth.uid(),

  -- O produto como está no papel. Fornecedor e código podem ser nulos (a
  -- lista da dona não tem fornecedor; nem todo item tem código).
  fornecedor_id      uuid references estoque_fornecedores(id) on delete cascade,
  codigo_original    text,
  descricao_original text not null,

  -- Como a loja quer que ele apareça. Guarda o retrato completo, não só o
  -- que mudou: a view não precisa adivinhar o que é "não mexeu".
  codigo_fornecedor  text,
  descricao          text not null check (btrim(descricao) <> ''),
  categoria          text not null check (categoria in (
                       'tecido','varao','suporte','ponteira','trilho','entretela',
                       'fita_wave','cordao','botao','rodizio','deslizante','outro')),
  cor                text,
  largura_m          numeric(6,3) check (largura_m is null or largura_m > 0),

  -- Gravado como timezone('utc', now()), a MESMA convenção de
  -- catalogo_itens.created_at (0033). A view compara as duas; com now() puro
  -- a comparação dependeria do fuso da sessão e erraria por horas.
  excluido_em        timestamptz
);

comment on table catalogo_ajustes_material is
  'Como a loja quer que um produto do papel apareca no catalogo (nome, codigo, categoria, cor, largura) e se ela o excluiu. Os itens dos documentos nao sao alterados.';

create unique index if not exists uq_catalogo_ajuste_original on catalogo_ajustes_material (
  coalesce(fornecedor_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(codigo_original, ''),
  descricao_original
);

alter table catalogo_ajustes_material enable row level security;

drop policy if exists catalogo_ajustes_select on catalogo_ajustes_material;
create policy catalogo_ajustes_select on catalogo_ajustes_material for select
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.approved = true));

drop policy if exists catalogo_ajustes_escrever on catalogo_ajustes_material;
create policy catalogo_ajustes_escrever on catalogo_ajustes_material for all
  using (
    exists (select 1 from profiles where profiles.id = auth.uid() and profiles.is_admin = true)
  )
  with check (
    exists (select 1 from profiles where profiles.id = auth.uid() and profiles.is_admin = true)
  );

-- ------------------------------------------------------------
-- 2. Todos os itens, já com o ajuste aplicado
-- ------------------------------------------------------------
-- Uma linha por item de documento (de qualquer tipo, inclusive orçamento).
-- É a base da view de custo e do histórico. security_invoker: quem lê daqui
-- direto (o histórico da tela) passa pela RLS das tabelas de baixo.
create or replace view catalogo_itens_efetivos
with (security_invoker = true) as
select
  i.id,
  i.created_at,
  i.documento_id,
  d.fornecedor_id,
  f.nome                                                         as fornecedor,
  case when a.id is null then i.codigo_fornecedor else a.codigo_fornecedor end as codigo_fornecedor,
  case when a.id is null then i.descricao         else a.descricao         end as descricao,
  case when a.id is null then i.categoria         else a.categoria         end as categoria,
  case when a.id is null then i.cor               else a.cor               end as cor,
  -- O cast mantém numeric(6,3): sem ele a view de custo mudaria o tipo da
  -- coluna e o "create or replace" abaixo seria recusado.
  (case when a.id is null then i.largura_m        else a.largura_m         end)::numeric(6,3) as largura_m,
  i.codigo_fornecedor                                            as codigo_original,
  i.descricao                                                    as descricao_original,
  i.quantidade_documento,
  i.unidade_documento,
  i.preco_bruto,
  i.desconto_pct,
  i.preco_liquido,
  i.unidade_canonica,
  i.custo_unitario,
  i.produto_id,
  i.observacao,
  d.tipo,
  d.referencia,
  d.data_documento,
  d.tabela_preco,
  d.categoria_cliente,
  -- Excluído = registro feito até a exclusão. O que entrar depois vale.
  (a.excluido_em is not null and i.created_at <= a.excluido_em) as excluido
from catalogo_itens i
join catalogo_documentos d        on d.id = i.documento_id
left join estoque_fornecedores f  on f.id = d.fornecedor_id
left join catalogo_ajustes_material a
       on a.fornecedor_id is not distinct from d.fornecedor_id
      and a.codigo_original is not distinct from i.codigo_fornecedor
      and a.descricao_original = i.descricao;

-- ------------------------------------------------------------
-- 3. O custo vigente passa a ler a base ajustada
-- ------------------------------------------------------------
-- MESMAS colunas, na MESMA ordem da 0035 — "create or replace view" recusa
-- qualquer outra coisa. O agrupamento agora é pelo nome AJUSTADO: o pedido
-- antigo com o nome velho e a correção de hoje com o nome novo viram o mesmo
-- produto, e vale o mais recente, como sempre.
create or replace view catalogo_custo_vigente as
select distinct on (e.fornecedor_id, e.codigo_fornecedor, e.descricao)
  e.fornecedor_id,
  e.fornecedor,
  e.codigo_fornecedor,
  e.descricao,
  e.categoria,
  e.cor,
  e.largura_m,
  e.unidade_canonica,
  e.custo_unitario,
  e.preco_bruto,
  e.desconto_pct,
  e.tipo,
  e.referencia,
  e.data_documento,
  e.tabela_preco,
  e.produto_id,
  e.id                as item_id,
  e.unidade_documento,
  e.preco_liquido
from catalogo_itens_efetivos e
where e.tipo in ('pedido', 'lista_manual')
  and not e.excluido
order by e.fornecedor_id, e.codigo_fornecedor, e.descricao,
         e.data_documento desc nulls last, e.created_at desc;

-- ------------------------------------------------------------
-- 4. Editar e excluir
-- ------------------------------------------------------------
-- p_alvos: as células do material na tela, como a tela as vê (valores
-- AJUSTADOS): [{"fornecedor_id": uuid|null, "codigo": text|null,
-- "descricao": text, "novo_codigo": text|null (opcional)}].
-- Cada alvo pode corresponder a vários produtos do papel (o pedido de julho
-- com o nome antigo E a correção de hoje): todos recebem o ajuste.
--
-- security invoker: a RLS da tabela de ajustes é quem decide se pode. A
-- checagem explícita só troca o "0 linhas" mudo por uma mensagem legível.

create or replace function catalogo_editar_material(
  p_alvos       jsonb,
  p_descricao   text,
  p_categoria   text,
  p_cor         text,
  p_largura_m   numeric,
  p_chave_antiga text default null,
  p_chave_nova   text default null
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_alvo   jsonb;
  v_orig   record;
  v_codigo text;
  v_total  integer := 0;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Só administrador pode editar o catálogo de custos.';
  end if;
  if p_descricao is null or btrim(p_descricao) = '' then
    raise exception 'O material precisa de um nome.';
  end if;

  for v_alvo in select * from jsonb_array_elements(p_alvos) loop
    for v_orig in
      select distinct e.fornecedor_id, e.codigo_original, e.descricao_original, e.codigo_fornecedor
        from catalogo_itens_efetivos e
       where e.fornecedor_id is not distinct from nullif(v_alvo->>'fornecedor_id', '')::uuid
         and e.codigo_fornecedor is not distinct from nullif(v_alvo->>'codigo', '')
         and e.descricao = v_alvo->>'descricao'
    loop
      v_codigo := case when v_alvo ? 'novo_codigo'
                       then nullif(btrim(v_alvo->>'novo_codigo'), '')
                       else v_orig.codigo_fornecedor end;

      insert into catalogo_ajustes_material as a (
        fornecedor_id, codigo_original, descricao_original,
        codigo_fornecedor, descricao, categoria, cor, largura_m
      ) values (
        v_orig.fornecedor_id, v_orig.codigo_original, v_orig.descricao_original,
        v_codigo, btrim(p_descricao), p_categoria, nullif(btrim(p_cor), ''), p_largura_m
      )
      on conflict (
        (coalesce(fornecedor_id, '00000000-0000-0000-0000-000000000000'::uuid)),
        (coalesce(codigo_original, '')),
        descricao_original
      ) do update set
        codigo_fornecedor = excluded.codigo_fornecedor,
        descricao         = excluded.descricao,
        categoria         = excluded.categoria,
        cor               = excluded.cor,
        largura_m         = excluded.largura_m,
        atualizado_em     = now(),
        atualizado_por    = auth.uid();

      v_total := v_total + 1;
    end loop;
  end loop;

  if v_total = 0 then
    raise exception 'Não achei esse material no catálogo — nada foi alterado. Recarregue a tela.';
  end if;

  -- "Onde comprei" é guardado pela chave do nome; o nome mudou, a marca vai junto.
  if p_chave_antiga is not null and p_chave_nova is not null and p_chave_antiga <> p_chave_nova
     and not exists (select 1 from catalogo_compra_escolhida where material_chave = p_chave_nova) then
    update catalogo_compra_escolhida set material_chave = p_chave_nova
     where material_chave = p_chave_antiga;
  end if;

  return v_total;
end;
$$;

create or replace function catalogo_excluir_material(p_alvos jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_alvo  jsonb;
  v_orig  record;
  v_total integer := 0;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Só administrador pode excluir do catálogo de custos.';
  end if;

  for v_alvo in select * from jsonb_array_elements(p_alvos) loop
    for v_orig in
      select distinct e.fornecedor_id, e.codigo_original, e.descricao_original,
             e.codigo_fornecedor, e.descricao, e.categoria, e.cor, e.largura_m
        from catalogo_itens_efetivos e
       where e.fornecedor_id is not distinct from nullif(v_alvo->>'fornecedor_id', '')::uuid
         and e.codigo_fornecedor is not distinct from nullif(v_alvo->>'codigo', '')
         and e.descricao = v_alvo->>'descricao'
    loop
      insert into catalogo_ajustes_material as a (
        fornecedor_id, codigo_original, descricao_original,
        codigo_fornecedor, descricao, categoria, cor, largura_m, excluido_em
      ) values (
        v_orig.fornecedor_id, v_orig.codigo_original, v_orig.descricao_original,
        v_orig.codigo_fornecedor, v_orig.descricao, v_orig.categoria, v_orig.cor,
        v_orig.largura_m, timezone('utc', now())
      )
      on conflict (
        (coalesce(fornecedor_id, '00000000-0000-0000-0000-000000000000'::uuid)),
        (coalesce(codigo_original, '')),
        descricao_original
      ) do update set
        excluido_em    = timezone('utc', now()),
        atualizado_em  = now(),
        atualizado_por = auth.uid();

      v_total := v_total + 1;
    end loop;
  end loop;

  if v_total = 0 then
    raise exception 'Não achei esse material no catálogo — nada foi excluído. Recarregue a tela.';
  end if;
  return v_total;
end;
$$;

grant execute on function catalogo_editar_material(jsonb, text, text, text, numeric, text, text) to authenticated;
grant execute on function catalogo_excluir_material(jsonb) to authenticated;

-- ============================================================
-- PROVA (rodar depois, como conferência)
-- ============================================================
-- 1. Sem nenhum ajuste, a view devolve exatamente o mesmo que antes:
--    select count(*) from catalogo_custo_vigente;   -- mesmo número de antes
-- 2. select count(*) from catalogo_itens_efetivos where excluido;   -- 0
-- 3. select * from catalogo_ajustes_material;   -- vazio até a loja editar

-- ============================================================
-- ROLLBACK
-- ============================================================
-- 1. Reaplicar a view da 0035 (custo_vigente lendo catalogo_itens direto).
-- 2. drop function if exists catalogo_excluir_material(jsonb);
--    drop function if exists catalogo_editar_material(jsonb, text, text, text, numeric, text, text);
--    drop view if exists catalogo_itens_efetivos;
--    drop table if exists catalogo_ajustes_material;
--    (os documentos e os itens nunca foram tocados — nada a restaurar)
