-- SOMBREAR — 0036 — renomear material leva junto a ligação da cortina
--
-- A 0034 deixou a loja renomear materiais. A cortina, porém, acha o custo do
-- tecido pelo nome (precos_cortina_tecidos.catalogo_descricao), e o nome
-- guardado ali não acompanhava a renomeação: em 24/10, 8 dos 12 tecidos de
-- cortina ficaram sem custo depois que a Stella arrumou os nomes. Os 8 foram
-- religados à mão no mesmo dia; esta migration faz a função de editar levar a
-- ligação junto, como já levava a marca de "onde comprei".
--
-- Só troca a função (mesma assinatura). Rollback: reaplicar a da 0034.

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

  -- A cortina acha o custo do tecido pelo NOME do material
  -- (precos_cortina_tecidos.catalogo_descricao). Sem isto, renomear deixava a
  -- ligação apontando para o nome velho e a margem da cortina sem custo —
  -- aconteceu em 24/10 com 8 dos 12 tecidos, consertados à mão.
  update precos_cortina_tecidos t
     set catalogo_descricao = btrim(p_descricao)
   where t.catalogo_descricao in (select a->>'descricao' from jsonb_array_elements(p_alvos) a)
     and t.catalogo_descricao <> btrim(p_descricao);

  -- "Onde comprei" é guardado pela chave do nome; o nome mudou, a marca vai junto.
  if p_chave_antiga is not null and p_chave_nova is not null and p_chave_antiga <> p_chave_nova
     and not exists (select 1 from catalogo_compra_escolhida where material_chave = p_chave_nova) then
    update catalogo_compra_escolhida set material_chave = p_chave_nova
     where material_chave = p_chave_antiga;
  end if;

  return v_total;
end;
$$;
