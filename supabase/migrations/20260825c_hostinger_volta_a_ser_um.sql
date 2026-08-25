-- Desfaz a separacao Hostinger DM/EBN. Nao se sustenta.
--
-- Eu tinha separado pelas duas adquirentes do descritor achando que
-- correspondiam aos dois produtos (dominio e n8n). Os valores desmentem: R$ 51,08
-- aparece 8 vezes, 5 pela DM e 3 pela EBN; R$ 81,08 aparece nas duas; R$ 39,99
-- tambem. As duas adquirentes processam as MESMAS cobrancas -- e por onde passou,
-- nao o que e.
--
-- Mesmo erro que o sufixo "Q4" do Facebook: um sinal que parece estrutura e e
-- coincidencia. Volta a ser um fornecedor so, marcado como nao definido, com os
-- valores recorrentes anotados para ela decidir a regra.
delete from public.fornecedores where padrao like '%HOSTINGER%';

insert into public.fornecedores (nome, padrao, tipo_match, prioridade, definido, nota)
values ('Hostinger', 'HOSTINGER', 'contains', 50, false,
        'Dominio e n8n no mesmo fornecedor e no mesmo cartao. A separacao DM/EBN nao vale -- as duas adquirentes processam as mesmas cobrancas (R$ 51,08 aparece nas duas). Valores recorrentes: R$ 51,08 (8x), R$ 81,08 (3x), R$ 39,99 (2x), R$ 87,99 (2x), R$ 7,08 (2x).');
