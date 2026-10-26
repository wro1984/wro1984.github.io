/* HUB dos apps — acesso e criptografia do hub.json publicado pelo MAPI.

   O site é público (GitHub Pages), então o hub.json vem CRIPTOGRAFADO: cada pessoa só lê a própria lista de apps.

   FORMATO do hub.json (gerado pelo MAPI, módulo hub.py):
     app      "hub"      v  1
     kdf      PBKDF2-SHA256 com `iter` iterações (hoje 600 mil)
     acessos  { <id>: {salt, iv, ct} }    id = SHA-256("hub:" + MATRÍCULA)
              ct = {matricula, nome, perfil, apps:[{chave, nome, descricao, icone, url}]} em JSON,
                   cifrado (AES-GCM) direto com a chave da pessoa

   A chave da pessoa sai da chave de acesso dela (PBKDF2 com o salt dela). Depois do primeiro login fica guardada no
   aparelho como CryptoKey NÃO extraível: a chave digitada não é guardada, e o script não consegue ler a chave, só usá-la.
   Ela fica no IndexedDB "co-hub-acesso" deste endereço (wro1984.github.io), que os apps em /CO_PROB/, /CO_Painel/ etc.
   também enxergam: é o que permite, na etapa do login único, abrir os apps sem digitar a chave de novo.

   Quem é removido no MAPI some de `acessos` na publicação seguinte: o HUB então apaga o que guardou no aparelho. */
(function (root) {
  'use strict';

  const VERSAO = '1.1.0';
  const C = (root.crypto && root.crypto.subtle) ? root.crypto : null;
  const enc = new TextEncoder();
  const APP = 'hub', PREFIXO = 'hub:';
  const ITER_MIN = 100000, ITER_MAX = 2000000;

  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

  const normMatricula = m => String(m || '').trim().toUpperCase().replace(/\s+/g, '');
  // Igual a nsp.norm_codigo do MAPI (ns_painel.py) e ao normCodigo dos apps: sem acento, só letras e números, e
  // maiúscula DEPOIS de filtrar ("ß".toUpperCase() vira "SS" no JS e não no Python).
  const normCodigo = c => String(c || '').normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

  const erro = (code, msg) => { const e = new Error(msg); e.code = code; return e; };
  const MSG_LOGIN = 'Matrícula ou chave incorreta, ou acesso ainda não liberado.';

  async function idDe(matricula) {
    return hex(await C.subtle.digest('SHA-256', enc.encode(PREFIXO + normMatricula(matricula))));
  }

  async function chaveDoCodigo(codigo, salt, iter) {
    const base = await C.subtle.importKey('raw', enc.encode(normCodigo(codigo)), 'PBKDF2', false, ['deriveKey']);
    return C.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  }

  function conferePacote(p) {
    if (!p || p.app !== APP || p.v !== 1 || !p.acessos || typeof p.acessos !== 'object' || !p.kdf) {
      throw erro('formato', 'hub.json em formato desconhecido.');
    }
    const it = p.kdf.iter;
    if (p.kdf.alg !== 'PBKDF2-SHA256' || !Number.isInteger(it) || it < ITER_MIN || it > ITER_MAX) {
      throw erro('formato', 'hub.json com parâmetros de segurança inválidos.');
    }
  }

  // só passam apps com endereço https e campos de texto: o conteúdo vem de fora e vai para a tela
  function limpar(c) {
    const txt = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    const apps = (Array.isArray(c && c.apps) ? c.apps : []).filter(a => a && typeof a.url === 'string' && /^https:\/\/[^\s"'<>]+$/.test(a.url))
      .map(a => ({ chave: txt(a.chave, 40), nome: txt(a.nome, 80) || 'App', descricao: txt(a.descricao, 200), icone: txt(a.icone, 16), url: a.url }));
    return { matricula: txt(c && c.matricula, 20), nome: txt(c && c.nome, 200), perfil: txt(c && c.perfil, 60), apps };
  }

  async function abrirConteudo(item, chave) {
    let texto;
    try { texto = await C.subtle.decrypt({ name: 'AES-GCM', iv: b64(item.iv) }, chave, b64(item.ct)); }
    catch (e) { throw erro('codigo', MSG_LOGIN); }
    try { return limpar(JSON.parse(new TextDecoder().decode(texto))); }
    catch (e) { throw erro('corrompido', 'A lista de apps publicada está corrompida.'); }
  }

  // primeiro acesso: matrícula + chave -> credencial para guardar no aparelho + conteúdo
  async function entrar(pacote, matricula, codigo) {
    if (!C) throw erro('sem_cripto', 'Este navegador não tem criptografia (abra pelo endereço https do HUB).');
    conferePacote(pacote);
    const id = await idDe(matricula);
    const item = pacote.acessos[id];
    // mesma resposta para "matrícula sem acesso" e "chave errada": não revela quem tem acesso
    if (!item) throw erro('codigo', MSG_LOGIN);
    const chave = await chaveDoCodigo(codigo, b64(item.salt), pacote.kdf.iter);
    const conteudo = await abrirConteudo(item, chave);
    return { cred: { id, matricula: normMatricula(matricula), chave, salt: item.salt, desde: Date.now() }, conteudo };
  }

  // próximos acessos: usa a credencial guardada
  async function abrir(pacote, cred) {
    conferePacote(pacote);
    const item = pacote.acessos[cred.id];
    if (!item) throw erro('sem_acesso', 'Seu acesso ao HUB foi removido. Se precisar, peça de novo ao administrador.');
    // o salt só muda quando o MAPI gera outro código ou outra chave: a guardada não vale mais
    if (item.salt !== cred.salt) throw erro('sem_acesso', 'Sua chave foi trocada. Entre de novo com a chave nova.');
    try { return await abrirConteudo(item, cred.chave); }
    catch (e) { if (e.code === 'codigo') throw erro('sem_acesso', 'Sua chave não abre mais o HUB. Entre de novo.'); throw e; }
  }

  // ---------- aparelho: credencial (IndexedDB guarda CryptoKey sem expor a chave) ----------
  const DB = 'co-hub-acesso', ST = 'cred';
  function db() {
    return new Promise((res, rej) => {
      if (!root.indexedDB) { rej(new Error('sem IndexedDB')); return; }
      const rq = root.indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => { rq.result.createObjectStore(ST); };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  async function op(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(ST, mode); let out;
      const r = fn(t.objectStore(ST)); if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => { d.close(); res(out); }; t.onerror = () => { d.close(); rej(t.error); };
    });
  }
  const lerCred = () => op('readonly', s => s.get('atual')).catch(() => null);
  const salvarCred = c => op('readwrite', s => s.put(c, 'atual'));
  const apagarTudo = () => new Promise(res => {
    if (!root.indexedDB) { res(); return; }
    const rq = root.indexedDB.deleteDatabase(DB);
    rq.onsuccess = rq.onerror = rq.onblocked = () => res();
  });

  const api = { versao: VERSAO, entrar, abrir, lerCred, salvarCred, apagarTudo, idDe, normMatricula, normCodigo,
    conferePacote, temCripto: !!C };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HubCripto = api;
})(typeof self !== 'undefined' ? self : globalThis);
