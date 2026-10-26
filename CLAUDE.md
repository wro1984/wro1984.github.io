# HUB dos apps — wro1984.github.io

Tela inicial dos apps do Centro de Operações no celular (PWA). A pessoa entra **uma vez** (matrícula + chave) e vê os
atalhos dos apps liberados para ela. Publicado pelo GitHub Pages na **raiz** de <https://wro1984.github.io/> a partir da
branch `main`. **Todo push na `main` vai para o ar em cerca de 1 minuto**, para todos os usuários.

Leia este arquivo inteiro antes de mudar qualquer coisa.

## Como funciona

```
MAPI (Comunicação → HUB dos apps) ──► hub.json CRIPTOGRAFADO ──► este repo ──► HUB no celular ──► atalhos dos apps
catálogo, perfis, acessos             (commit automático)                  matrícula + chave      /CO_PROB/, /CO_Painel/…
```

- O repositório e o site são **públicos**. A lista de apps de cada pessoa só existe aqui **cifrada**, no `hub.json`.
- Quem gera e publica o `hub.json` é o **MAPI** (repositório `wro1984/mapi5`, módulo `hub.py`, ver `HUB.md` de lá).
  Catálogo de apps, perfis, acessos e chaves são geridos no MAPI, não aqui.
- O HUB fica na **raiz** de propósito: instalado no celular, ele abrange todos os apps em `/CO_PROB/`, `/CO_Painel/` e os
  próximos (o atalho abre dentro do app instalado, sem cair no navegador).

## Regras que não podem ser quebradas

1. **Nunca editar, apagar ou "consertar" o `hub.json`.** Ele é sobrescrito pelo MAPI a cada ação de acesso.
2. **Nunca commitar dados abertos nem segredos** (listas de pessoas, chaves, tokens). O histórico do git é público.
   Para testar, use `tests/fixtures/hub.json` (dados inventados).
3. **Não mudar o formato da criptografia sozinho.** `cripto.js` precisa continuar igual ao que o MAPI gera em `hub.py`:
   - `hub.json`: `{app:"hub", v:1, gerado_em, kdf:{alg:"PBKDF2-SHA256", iter}, acessos:{id:{salt, iv, ct}}}`;
   - `id` = SHA-256 de `"hub:" + MATRÍCULA` (maiúscula, sem espaços);
   - chave da pessoa = PBKDF2-SHA256 (`kdf.iter`, hoje 600 mil) da chave normalizada; `ct` = AES-GCM do JSON
     `{matricula, nome, perfil, apps:[{chave, nome, descricao, icone, url}]}`;
   - **normalização da chave** (`normCodigo`): tira acento, mantém só `A-Z a-z 0-9`, depois maiúscula. Igual a
     `norm_codigo` do MAPI, senão ninguém entra. Não reduza a força do PBKDF2 sem decisão do TI/Segurança.
4. **O service worker (`sw.js`) fica na raiz e só pode responder pelos arquivos do HUB** (lista `CORE`). Os pedidos dos
   outros apps passam direto, sem cache. Nunca faça ele responder, guardar ou apagar algo fora do HUB, nem apagar caches
   que não comecem com `hub-v`: isso quebraria os outros apps de todo mundo.
5. **A credencial fica no IndexedDB `co-hub-acesso`** (CryptoKey não extraível). Os apps do mesmo endereço vão usar esse
   banco no login único: não mude o nome nem o formato (`{id, matricula, chave, salt, desde}`) sem mudar os apps juntos.
6. **Sair do HUB é sair de todos os apps neste aparelho**: apaga a credencial e cancela as inscrições de aviso (push) de
   todos os service workers deste endereço. Cada app apaga os próprios dados quando abre sem acesso.
7. **Não carregar nada de fora**: sem CDNs, fontes externas, analytics. Os atalhos só aceitam endereços `https://`.

## Antes de cada push

1. Atualize a versão com o mesmo número em `app.js` (`VERSION`), `cripto.js` (`VERSAO`), `sw.js` (`VERSION`) e nos
   `?v=` do `index.html`. Versões diferentes = o HUB recusa abrir (de propósito).
2. Arquivo novo que o HUB usa? Inclua em `CORE` no `sw.js`.
3. `npm test` (abre o pacote de exemplo cifrado pelo MAPI) e teste no navegador em ~390 px, claro e escuro.
4. `git pull` antes do push (o MAPI faz commits no `hub.json`). Use merge, não force-push.

## Testar localmente

```
python -m http.server 8000      # na raiz do repositório, com um hub.json de teste (ex.: o "pacote" de tests/fixtures/hub.json)
```
Abra <http://localhost:8000> e entre com `A0001` / `lago-vento-pedra` (dados de `tests/fixtures/hub.json`).
**Não commite** o `hub.json` de teste no lugar do publicado pelo MAPI (`git checkout hub.json`).

## Estrutura

| Arquivo | Papel |
|---|---|
| `index.html` | estrutura e estilos (paleta da empresa, modo escuro) |
| `app.js` | entrada, atalhos, conferência a cada 5 min, sair, instalação |
| `cripto.js` | abrir o `hub.json`, credencial no aparelho (roda também no Node, para os testes) |
| `sw.js` | cache offline **só** dos arquivos do HUB |
| `manifest.webmanifest`, `icons/` | instalação no celular (escopo `/`) |
| `tests/` | teste da criptografia com pacote de exemplo |
| `hub.json` | **gerado pelo MAPI — não editar** |
