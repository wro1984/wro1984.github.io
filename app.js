/* HUB dos apps — tela de entrada e atalhos.

   Fluxo: baixa o hub.json (cifrado, publicado pelo MAPI) -> com a credencial guardada no aparelho abre a lista de apps
   da pessoa -> mostra os atalhos. Sem credencial, pede matrícula + chave uma vez. Acesso removido ou chave trocada no
   MAPI: apaga o que guardou e volta para a entrada.

   No aparelho fica só: a credencial (CryptoKey não extraível, no IndexedDB, ver cripto.js) e o último hub.json, que
   já é cifrado (para abrir sem internet). Nada da lista de apps fica em texto aberto. */
(function () {
  'use strict';

  const VERSION = '1.1.0';
  const K_PKG = 'hub.pkg';
  const CONFERIR_MS = 5 * 60 * 1000;
  const $ = id => document.getElementById(id);
  const S = { cred: null, conteudo: null, origem: '', conferidoEm: 0 };

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
    $('rodape').hidden = qual !== 'hub';
    $('btAtualizar').hidden = qual !== 'hub';
  }

  function mostrarLogin(msg) {
    mostrar('login');
    $('loginErro').textContent = msg || '';
    setTimeout(() => $('loginMat').focus(), 50);
  }

  function renderHub() {
    const c = S.conteudo;
    const primeiro = (c.nome || '').trim().split(/\s+/)[0];
    $('ola').textContent = primeiro ? `Olá, ${primeiro}!` : 'Olá!';
    $('perfil').textContent = c.perfil ? `Perfil: ${c.perfil}` : '';
    const lista = $('apps');
    lista.replaceChildren();
    if (!c.apps.length) {
      lista.append(el('div', { class: 'vazio' },
        el('div', { class: 'vazio-ic', 'aria-hidden': 'true' }, '🔒'),
        el('b', {}, 'Nenhum app liberado ainda'),
        el('span', {}, 'Fale com o administrador do MAPI para liberar os apps do seu perfil.')));
    } else {
      c.apps.forEach(a => lista.append(el('a', { class: 'app', href: a.url },
        el('span', { class: 'app-ic', 'aria-hidden': 'true' }, a.icone || '📱'),
        el('span', { class: 'app-tx' }, el('b', {}, a.nome), a.descricao ? el('span', {}, a.descricao) : null),
        el('span', { class: 'app-seta', 'aria-hidden': 'true' }, '›'))));
    }
    $('quem').textContent = `${c.matricula || S.cred.matricula}`;
    $('versao').textContent = 'v' + VERSION;
    $('situacao').textContent = S.origem === 'guardado' ? 'sem internet · última lista guardada' : 'atualizado agora';
    mostrar('hub');
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
    try { localStorage.removeItem(K_PKG); } catch (e) { /* segue */ }
    S.cred = null; S.conteudo = null;
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
    $('btAtualizar').addEventListener('click', conferir);
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
