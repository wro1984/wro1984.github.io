/* HUB dos apps — tela de entrada e atalhos.

   Fluxo: baixa o hub.json (cifrado, publicado pelo MAPI) -> com a credencial guardada no aparelho abre a lista de apps
   da pessoa -> mostra os atalhos. Sem credencial, pede matrícula + chave uma vez. Acesso removido ou chave trocada no
   MAPI: apaga o que guardou e volta para a entrada.

   No aparelho fica só: a credencial (CryptoKey não extraível, no IndexedDB, ver cripto.js) e o último hub.json, que
   já é cifrado (para abrir sem internet). Nada da lista de apps fica em texto aberto. */
(function () {
  'use strict';

  const VERSION = '1.3.0';
  const K_PKG = 'hub.pkg';
  const CONFERIR_MS = 5 * 60 * 1000;
  const $ = id => document.getElementById(id);
  const S = { cred: null, conteudo: null, origem: '', conferidoEm: 0, aba: 'Todos', q: '' };

  const load = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };

  function el(tag, attrs, ...filhos) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => { if (k === 'class') n.className = v; else if (v != null) n.setAttribute(k, v); });
    filhos.flat().forEach(f => { if (f != null) n.append(f.nodeType ? f : document.createTextNode(String(f))); });
    return n;
  }

  // ---------- hub.json ----------
  async function baixarPacote() {
    try {
      const r = await fetch('hub.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const texto = await r.text();
      const pacote = JSON.parse(texto);
      HubCripto.conferePacote(pacote);
      save(K_PKG, { texto, em: Date.now() });
      S.origem = 'rede';
      return pacote;
    } catch (e) {
      const guardado = load(K_PKG);
      if (guardado && guardado.texto) { S.origem = 'guardado'; return JSON.parse(guardado.texto); }
      throw new Error('Não consegui baixar a lista de apps. Confira a internet e tente de novo.');
    }
  }

  // ---------- telas ----------
  function mostrar(qual) {
    $('login').hidden = qual !== 'login';
    $('hub').hidden = qual !== 'hub';
    $('carregando').hidden = qual !== 'carregando';
    $('cabLogin').hidden = qual === 'hub';          // no HUB a marca fica dentro da própria tela
    if (qual !== 'hub') fecharConta();
  }

  function mostrarLogin(msg) {
    mostrar('login');
    $('loginErro').textContent = msg || '';
    setTimeout(() => $('loginMat').focus(), 50);
  }

  // o mesmo ícone da tela inicial do app; sem imagem (ou se ela não carregar, ex.: sem internet), o emoji
  function iconeDoApp(a) {
    const caixa = el('span', { class: 'app-ic', 'aria-hidden': 'true' }, a.imagem ? null : (a.icone || '📱'));
    if (a.imagem) {
      const img = el('img', { src: a.imagem, alt: '', loading: 'lazy', decoding: 'async' });
      img.addEventListener('error', () => { caixa.classList.remove('com-img'); caixa.replaceChildren(a.icone || '📱'); });
      caixa.classList.add('com-img');
      caixa.append(img);
    }
    return caixa;
  }

  // ---------- grupos, busca e fixados (layout A2 moderno) ----------
  const TODOS = 'Todos', OUTROS = 'Outros';
  const COR_GRUPO = { 'Relatórios': '#B48FD3', 'Monitoramento': '#FF9901', [OUTROS]: '#99CC33' };
  const K_FIX = 'hub.fix';
  const grupoDe = a => (a.grupo || OUTROS);
  const sem = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  // Fixados são só uma preferência da pessoa, mas o repositório pede que nada da lista de apps fique em texto aberto no
  // aparelho: guardamos só um código curto (por matrícula + app), que o próprio HUB sabe refazer.
  function codigo(texto) {
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < texto.length; i++) {
      const c = texto.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  }
  const codApp = a => codigo('fix:' + (S.conteudo.matricula || S.cred.matricula) + ':' + a.chave);
  function lerFix() {
    const v = load(K_FIX);
    return new Set(v && Array.isArray(v.c) && v.m === codigo('m:' + (S.conteudo.matricula || S.cred.matricula)) ? v.c.filter(x => typeof x === 'string') : []);
  }
  function gravarFix(set) { save(K_FIX, { m: codigo('m:' + (S.conteudo.matricula || S.cred.matricula)), c: [...set] }); }
  function alternarFixo(a) {
    const set = lerFix(), c = codApp(a);
    if (set.has(c)) set.delete(c); else set.add(c);
    gravarFix(set);
    renderLista();
  }

  function abasDisponiveis(apps) {
    const grupos = [];
    apps.forEach(a => { const g = grupoDe(a); if (!grupos.includes(g)) grupos.push(g); });
    if (grupos.length === 1 && grupos[0] === OUTROS) return [];       // ninguém tem grupo: sem abas
    const ordem = ['Relatórios', 'Monitoramento'];
    grupos.sort((x, y) => (ordem.includes(x) ? ordem.indexOf(x) : 9) - (ordem.includes(y) ? ordem.indexOf(y) : 9) || x.localeCompare(y));
    return [TODOS, ...grupos];
  }

  function renderLista() {
    const c = S.conteudo, apps = c.apps;
    const corpo = $('corpo'), abasEl = $('abas');
    const abas = abasDisponiveis(apps);
    if (!abas.includes(S.aba)) S.aba = TODOS;
    const q = sem(S.q.trim());
    const bate = a => !q || sem(a.nome + ' ' + a.descricao + ' ' + grupoDe(a)).includes(q);
    abasEl.hidden = !abas.length;
    abasEl.replaceChildren(...abas.map(n => {
      const qtd = apps.filter(a => (n === TODOS || grupoDe(a) === n) && bate(a)).length;
      const b = el('button', { type: 'button', class: 'aba', role: 'tab', 'aria-selected': String(S.aba === n) }, n, el('span', { class: 'n' }, qtd));
      b.addEventListener('click', () => { S.aba = n; renderLista(); });
      return b;
    }));
    corpo.replaceChildren();
    if (!apps.length) {
      corpo.append(el('div', { class: 'vazio vidro' },
        el('div', { class: 'vazio-ic', 'aria-hidden': 'true' }, '🔒'),
        el('b', {}, 'Nenhum app liberado ainda'),
        el('span', {}, 'Fale com o administrador do MAPI para liberar os apps do seu perfil.')));
      return;
    }
    const fixos = lerFix();
    const itens = apps.filter(a => (S.aba === TODOS || grupoDe(a) === S.aba) && bate(a));
    const fixados = apps.filter(a => fixos.has(codApp(a)));
    if (fixados.length && !q && S.aba === TODOS) {
      corpo.append(el('section', { class: 'fixados', 'aria-label': 'Fixados' }, el('h3', {}, 'Fixados'),
        el('div', { class: 'fix-grade' }, fixados.map(a => el('a', { class: 'fix vidro', href: a.url }, iconeDoApp(a), a.nome)))));
    }
    const lista = el('div', { class: 'lista vidro' });
    lista.append(el('div', { class: 'lista-cab', 'aria-hidden': 'true' }, el('span', {}, 'App'), el('span', {}, 'Descrição'), el('span', {}, 'Grupo'), el('span', {})));
    if (!itens.length) lista.append(el('div', { class: 'sem' }, 'Nenhum app encontrado.'));
    itens.forEach(a => {
      const g = grupoDe(a), fixo = fixos.has(codApp(a));
      const estrela = el('button', { type: 'button', class: 'estrela', 'aria-pressed': String(fixo), 'aria-label': (fixo ? 'Desafixar ' : 'Fixar ') + a.nome });
      estrela.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z"/></svg>';
      estrela.addEventListener('click', () => alternarFixo(a));
      const ponto = el('i', { title: g }); ponto.style.background = COR_GRUPO[g] || '';
      const ponto2 = el('i', {}); ponto2.style.background = COR_GRUPO[g] || 'var(--ink3)';
      lista.append(el('div', { class: 'item' },
        el('a', { class: 'linha', href: a.url },
          iconeDoApp(a),
          el('span', { class: 'tx' }, el('span', { class: 'nome' }, a.nome, ponto), a.descricao ? el('span', { class: 'desc' }, a.descricao) : el('span', { class: 'desc' })),
          el('span', { class: 'grupo' }, ponto2, g),
          el('span', { class: 'abrir' }, 'Abrir')),
        estrela));
    });
    corpo.append(lista);
    if (!fixados.length && apps.length > 3 && !q) corpo.append(el('p', { class: 'dica' }, 'Toque na estrela para fixar os apps que você mais usa.'));
  }

  function renderHub() {
    const c = S.conteudo;
    const primeiro = (c.nome || '').trim().split(/\s+/)[0];
    $('ola').textContent = primeiro ? `Olá, ${primeiro}` : 'Olá';
    $('sub').textContent = S.origem === 'guardado' ? 'Sem internet · última lista guardada' : 'Centro de Operações';
    const mat = c.matricula || S.cred.matricula;
    $('nomeTopo').textContent = c.nome || mat;
    $('perfilTopo').textContent = c.perfil ? `perfil ${c.perfil}` : '';
    $('contaNome').textContent = c.nome || mat;
    $('contaMeta').textContent = [mat, c.perfil ? `perfil ${c.perfil}` : ''].filter(Boolean).join(' · ');
    $('versao').textContent = 'v' + VERSION;
    $('situacao').textContent = S.origem === 'guardado' ? 'sem internet · última lista guardada' : 'atualizado agora';
    renderLista();
    mostrar('hub');
  }

  function fecharConta() {
    const p = $('contaPop');
    if (!p || p.hidden) return;
    p.hidden = true; $('btConta').setAttribute('aria-expanded', 'false');
  }
  function alternarConta() {
    const p = $('contaPop'), abrir = p.hidden;
    p.hidden = !abrir; $('btConta').setAttribute('aria-expanded', String(abrir));
  }

  // ---------- acesso ----------
  // Sair do HUB = sair de todos os apps neste aparelho: cancela também as inscrições de aviso (push) dos apps deste
  // endereço (cada app tem o service worker dele). Os dados guardados por cada app são apagados por ele na próxima abertura.
  async function cancelarAvisos() {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.getRegistrations) return;
    try {
      for (const reg of await navigator.serviceWorker.getRegistrations()) {
        try { const sub = reg.pushManager && await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) { /* segue */ }
      }
    } catch (e) { /* segue */ }
    try { localStorage.removeItem('ps.pushReg'); } catch (e) { /* segue */ }   // Problemas Sistêmicos: refaz a inscrição ao voltar
  }

  async function perderAcesso(msg) {
    await cancelarAvisos();
    await HubCripto.apagarTudo();
    try { localStorage.removeItem(K_PKG); localStorage.removeItem(K_FIX); } catch (e) { /* segue */ }
    S.cred = null; S.conteudo = null; S.aba = 'Todos'; S.q = ''; $('busca').value = '';
    mostrarLogin(msg);
  }

  async function conferir() {
    if (!S.cred) return;
    let pacote;
    try { pacote = await baixarPacote(); } catch (e) { $('situacao').textContent = e.message; return; }
    try {
      S.conteudo = await HubCripto.abrir(pacote, S.cred);
      S.conferidoEm = Date.now();
      renderHub();
    } catch (e) {
      if (e.code === 'sem_acesso') { await perderAcesso(e.message); return; }
      $('situacao').textContent = e.message;
    }
  }

  async function entrar(ev) {
    ev.preventDefault();
    const btn = $('loginBtn'), erro = $('loginErro');
    const mat = $('loginMat').value, chave = $('loginChave').value;
    erro.textContent = '';
    if (!mat.trim() || !chave.trim()) { erro.textContent = 'Informe a matrícula e a chave.'; return; }
    btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      const pacote = await baixarPacote();
      const r = await HubCripto.entrar(pacote, mat, chave);
      try { await HubCripto.salvarCred(r.cred); }
      catch (e) { /* sem IndexedDB (ex.: aba anônima): vale só enquanto a página estiver aberta */ }
      S.cred = r.cred; S.conteudo = r.conteudo; S.conferidoEm = Date.now();
      $('loginForm').reset();
      renderHub();
    } catch (e) {
      erro.textContent = e.message || 'Não foi possível entrar.';
    } finally {
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  }

  async function sair() {
    if (!confirm('Sair deste aparelho? Você vai precisar da matrícula e da chave para entrar de novo.')) return;
    await perderAcesso('');
  }

  // ---------- instalação ----------
  let pedidoInstalar = null;
  const instalado = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const iPhone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function renderInstalar() {
    const box = $('instalar');
    if (instalado()) { box.hidden = true; return; }
    if (pedidoInstalar) {
      box.hidden = false; $('instTexto').textContent = 'Instale o HUB na tela inicial para abrir os apps com um toque.';
      $('instBtn').hidden = false;
    } else if (iPhone()) {
      box.hidden = false; $('instBtn').hidden = true;
      $('instTexto').textContent = 'Para instalar: toque em Compartilhar e depois em "Adicionar à Tela de Início".';
    } else box.hidden = true;
  }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); pedidoInstalar = e; renderInstalar(); });
  window.addEventListener('appinstalled', () => { pedidoInstalar = null; renderInstalar(); });

  // ---------- início ----------
  async function iniciar() {
    $('loginForm').addEventListener('submit', entrar);
    $('btSair').addEventListener('click', sair);
    $('btAtualizar').addEventListener('click', () => { fecharConta(); conferir(); });
    $('btConta').addEventListener('click', alternarConta);
    $('busca').addEventListener('input', e => { S.q = e.target.value; if (S.conteudo) renderLista(); });
    document.addEventListener('click', e => { if (!e.target.closest('.conta-box')) fecharConta(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') fecharConta();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !$('hub').hidden) { e.preventDefault(); $('busca').focus(); }
    });
    $('instBtn').addEventListener('click', async () => {
      if (!pedidoInstalar) return;
      pedidoInstalar.prompt();
      try { await pedidoInstalar.userChoice; } catch (e) { /* segue */ }
      pedidoInstalar = null; renderInstalar();
    });
    $('verChave').addEventListener('change', e => { $('loginChave').type = e.target.checked ? 'text' : 'password'; });
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js', { scope: '/' }).catch(() => { /* sem cache offline */ });
    }
    renderInstalar();
    // conferência periódica: vale também para quem entrar depois (conferir não faz nada sem credencial)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && S.cred && Date.now() - S.conferidoEm > 60 * 1000) conferir();
    });
    setInterval(() => { if (!document.hidden) conferir(); }, CONFERIR_MS);
    if (!HubCripto.temCripto) { mostrarLogin('Este navegador não tem criptografia: abra o HUB pelo endereço https.'); return; }
    mostrar('carregando');
    S.cred = await HubCripto.lerCred();
    if (!S.cred) { mostrarLogin(''); return; }
    await conferir();
    if (!S.conteudo && S.cred) mostrarLogin('Não consegui abrir a lista de apps. Confira a internet e tente de novo.');
  }

  if (HubCripto.versao !== VERSION) {
    document.body.textContent = 'O HUB está numa versão diferente da dos arquivos de segurança. Feche e abra de novo para atualizar.';
    return;
  }
  iniciar();
})();
