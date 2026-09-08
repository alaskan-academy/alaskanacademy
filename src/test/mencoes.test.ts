import { describe, it, expect } from 'vitest';
import { partirMencoes, ehMencao } from '@/features/producao/mencoes';

/**
 * O caso que trouxe este arquivo: a Jaqueline escreveu "@Jessica Maihato
 * informando um detalhe" e a Jessica Gavazza recebeu o aviso.
 *
 * Eram dois defeitos com a mesma raiz — uma menção lida só até o primeiro
 * espaço. No banco, `LIKE '%@jessica%'` casava com as duas Jessicas; aqui,
 * `/(@\S+)/` pintava só "@Jessica" e deixava "Maihato" em texto comum, de
 * modo que a tela concordava com o erro.
 *
 * O do banco vive na migração `20260908d`. Este prende o da tela.
 */

const EQUIPE = ['Jaqueline Coelho', 'Jessica Gavazza', 'Jessica Maihato'];

const mencoes = (texto: string, nomes = EQUIPE) =>
  partirMencoes(texto, nomes).filter(ehMencao);

describe('onde uma menção termina', () => {
  it('leva o sobrenome junto', () => {
    // O defeito exato do print: sem isto sai ['@Jessica'].
    expect(mencoes('@Jessica Maihato informando um detalhe'))
      .toEqual(['@Jessica Maihato']);
  });

  it('não confunde uma xará com a outra', () => {
    expect(mencoes('@Jessica Gavazza confere aí')).toEqual(['@Jessica Gavazza']);
  });

  it('prefere o nome mais longo, venha ele em que ordem vier no cadastro', () => {
    // Alternativa de regex casa a PRIMEIRA que serve. Se a ordem do cadastro
    // decidisse, "Jessica Gavazza" listada antes bastaria para "@Jessica
    // Maihato" voltar a ser cortado no espaço.
    const invertido = [...EQUIPE].reverse();
    expect(mencoes('@Jessica Maihato', invertido)).toEqual(['@Jessica Maihato']);
  });

  it('acha mais de uma menção na mesma frase', () => {
    expect(mencoes('@Jaqueline Coelho e @Jessica Maihato, vejam'))
      .toEqual(['@Jaqueline Coelho', '@Jessica Maihato']);
  });

  it('não perde quem foi digitado na mão e não está no cadastro', () => {
    // Some do destaque seria pior que pintar demais: a pessoa escreveu uma
    // menção e a tela fingiria que não.
    expect(mencoes('@ana vê isso')).toEqual(['@ana']);
  });

  it('ignora maiúscula e minúscula, como o gatilho faz', () => {
    expect(mencoes('@jessica maihato olha')).toEqual(['@jessica maihato']);
  });

  it('devolve o texto inteiro nos pedaços, sem comer caractere', () => {
    const texto = '@Jessica Maihato informando um detalhe pra essas variações';
    expect(partirMencoes(texto, EQUIPE).join('')).toBe(texto);
  });

  it('não trata um cadastro vazio como erro', () => {
    expect(mencoes('@alguem aí', [])).toEqual(['@alguem']);
    expect(mencoes('sem menção nenhuma', [])).toEqual([]);
  });

  it('não deixa nome com pontuação virar sintaxe de regex', () => {
    // "J. R." tem pontos, que em regex casam com qualquer caractere. Sem
    // escapar, "@JXRX" também seria menção.
    expect(mencoes('@J. R. Santos ok', ['J. R. Santos'])).toEqual(['@J. R. Santos']);
    expect(mencoes('@JXRX Santos ok', ['J. R. Santos'])).toEqual(['@JXRX']);
  });
});
