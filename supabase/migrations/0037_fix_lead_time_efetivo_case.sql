-- 0037: corrige a view de lead time efetivo (diferença de caixa no join)
--
-- Bug: estoque_fornecedor_categorias.tipo_produto guarda 'Tecido' / 'Ferragem' /
-- 'Acessorio' (capitalizado), mas estoque_categorias.tipo guarda 'tecido' /
-- 'ferragem' / 'acessorio' (minúsculo). O join `fc.tipo_produto = tipos.tipo`
-- nunca casava, então a view SEMPRE caía no prazo geral do fornecedor
-- (origem_lead_time = 'geral_fornecedor') e ignorava o prazo por categoria.
--
-- Correção: comparar com lower() dos dois lados. Colunas, nomes e tipos da view
-- ficam exatamente como na 0010 (tipo_produto continua saindo em minúsculo,
-- vindo de estoque_categorias.tipo).

create or replace view estoque_vw_fornecedor_lead_time_efetivo as
select
  f.id as fornecedor_id,
  f.nome as fornecedor_nome,
  tipos.tipo as tipo_produto,
  coalesce(fc.lead_time_dias, f.prazo_entrega_dias, 7) as lead_time_efetivo_dias,
  coalesce(fc.prazo_pagamento_dias, null) as prazo_pagamento_dias,
  case
    when fc.id is not null then 'especifico'
    else 'geral_fornecedor'
  end as origem_lead_time
from estoque_fornecedores f
cross join (
  select distinct ec.tipo
  from estoque_categorias ec
  join estoque_produtos p on p.categoria_id = ec.id
  where p.ativo = true
) tipos
left join estoque_fornecedor_categorias fc
  on fc.fornecedor_id = f.id
 and lower(fc.tipo_produto) = lower(tipos.tipo)
 and fc.ativo = true
where f.ativo = true;

-- ROLLBACK (volta ao comportamento da 0010, com o bug de caixa):
-- create or replace view estoque_vw_fornecedor_lead_time_efetivo as
-- select
--   f.id as fornecedor_id,
--   f.nome as fornecedor_nome,
--   tipos.tipo as tipo_produto,
--   coalesce(fc.lead_time_dias, f.prazo_entrega_dias, 7) as lead_time_efetivo_dias,
--   coalesce(fc.prazo_pagamento_dias, null) as prazo_pagamento_dias,
--   case
--     when fc.id is not null then 'especifico'
--     else 'geral_fornecedor'
--   end as origem_lead_time
-- from estoque_fornecedores f
-- cross join (
--   select distinct ec.tipo
--   from estoque_categorias ec
--   join estoque_produtos p on p.categoria_id = ec.id
--   where p.ativo = true
-- ) tipos
-- left join estoque_fornecedor_categorias fc on fc.fornecedor_id = f.id and fc.tipo_produto = tipos.tipo and fc.ativo = true
-- where f.ativo = true;
