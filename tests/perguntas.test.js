'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('catálogos têm 900 perguntas distribuídas por tema e dificuldade', () => {
  const catalogs = {
    gerais: require('../perguntas/gerais.json'),
    filmes: require('../perguntas/filmes.json'),
    paises: require('../perguntas/paises.json'),
    musica: require('../perguntas/musica.json'),
    ciencia: require('../perguntas/ciencia.json')
  };
  const seen = new Set();

  for (const [theme, catalog] of Object.entries(catalogs)) {
    assert.deepEqual(Object.keys(catalog), ['facil', 'medio', 'dificil']);
    const counts = theme === 'gerais' ? [167, 167, 166] : [34, 33, 33];
    assert.deepEqual(Object.values(catalog).map(pool => pool.length), counts, theme);

    for (const [question, answer] of Object.values(catalog).flat()) {
      assert.match(question, /^\S+ .+\?$/u);
      assert.ok(question.length <= 320, question);
      assert.ok(answer.length <= 180, question);
      assert.ok(answer.split('|').every(value => value.trim().length <= 120 && /[\p{L}\p{N}]/u.test(value)), question);
      const key = question.normalize('NFD').replace(/[^a-z0-9]/gi, '').toLowerCase();
      assert.equal(seen.has(key), false, question);
      seen.add(key);
    }
  }
  assert.equal(seen.size, 900);
});
