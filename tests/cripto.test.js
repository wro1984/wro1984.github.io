// Confere, em Node, que o cripto.js abre o hub.json que o MAPI cifra (tests/fixtures/hub.json, gerado por
// hub.montar_pacote do MAPI com dados inventados) e que recusa o que deve recusar.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const H = require('../cripto.js');
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hub.json'), 'utf8'));

test('normalização igual à do MAPI', () => {
  assert.strictEqual(H.normCodigo('Girassól 2026!'), 'GIRASSOL2026');
  assert.strictEqual(H.normCodigo('lago-vento-pedra'), 'LAGOVENTOPEDRA');
  assert.strictEqual(H.normCodigo('straße'), 'STRAE');          // ß some, como no Python
  assert.strictEqual(H.normMatricula(' a00 01 '), 'A0001');
});

test('cada pessoa abre só a própria lista, com a chave digitada de outro jeito', async () => {
  const a = await H.entrar(fx.pacote, fx.acessos_teste[0].matricula, fx.acessos_teste[0].chave);
  assert.strictEqual(a.conteudo.nome, 'Pessoa Exemplo A');
  assert.deepStrictEqual(a.conteudo.apps.map(x => x.chave), ['problemas-sistemicos', 'ns-painel']);   // o javascript: saiu
  // ícone: imagem https fica; javascript: vira vazio (o HUB mostra o emoji)
  assert.strictEqual(a.conteudo.apps[0].imagem, 'https://wro1984.github.io/CO_PROB/icons/icon-192.png');
  assert.strictEqual(a.conteudo.apps[1].imagem, '');
  const b = await H.entrar(fx.pacote, fx.acessos_teste[1].matricula, fx.acessos_teste[1].chave);
  assert.deepStrictEqual(b.conteudo.apps, []);
  // próximos acessos com a credencial guardada
  const de_novo = await H.abrir(fx.pacote, a.cred);
  assert.strictEqual(de_novo.apps.length, 2);
});

test('chave errada e matrícula sem acesso dão a mesma mensagem', async () => {
  const e1 = await H.entrar(fx.pacote, 'A0001', 'outra-chave-qualquer').catch(e => e);
  const e2 = await H.entrar(fx.pacote, 'Z9999', 'lago-vento-pedra').catch(e => e);
  assert.strictEqual(e1.code, 'codigo');
  assert.strictEqual(e1.message, e2.message);
});

test('removido no MAPI ou chave trocada: sem_acesso', async () => {
  const a = await H.entrar(fx.pacote, 'A0001', 'lago-vento-pedra');
  const semA = JSON.parse(JSON.stringify(fx.pacote));
  delete semA.acessos[a.cred.id];
  assert.strictEqual((await H.abrir(semA, a.cred).catch(e => e)).code, 'sem_acesso');
  const trocada = JSON.parse(JSON.stringify(fx.pacote));
  trocada.acessos[a.cred.id].salt = Buffer.from('outro-salt-16byt').toString('base64');
  assert.strictEqual((await H.abrir(trocada, a.cred).catch(e => e)).code, 'sem_acesso');
});

test('recusa pacote fora do formato ou com KDF fraco', () => {
  assert.throws(() => H.conferePacote({ ...fx.pacote, app: 'outro' }));
  assert.throws(() => H.conferePacote({ ...fx.pacote, kdf: { alg: 'PBKDF2-SHA256', iter: 1000 } }));
  assert.doesNotThrow(() => H.conferePacote(fx.pacote));
});
