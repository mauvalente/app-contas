# Minhas Contas (PWA + Google Sheets)

App de celular para registrar pagamentos e recebimentos. Cada pessoa entra com a própria conta Google, e os registros dela vão para uma aba só dela na planilha.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | O app inteiro (telas, estilos e lógica) |
| `manifest.webmanifest`, `icons/` | Permitem instalar na tela inicial do celular |
| `sw.js` | Service worker: abre rápido e funciona offline |
| `google-apps-script/Code.gs` | Script que você cola na planilha (o "endpoint") |

## 1. Publicar o app (endereço fixo)

O login do Google só funciona num endereço fixo com HTTPS, então publique primeiro:

- **Netlify Drop**: em https://app.netlify.com/drop, arraste a pasta `app-contas`. Depois, em *Site configuration → Change site name*, escolha um nome, por exemplo `minhas-contas` → `https://minhas-contas.netlify.app`.
- **GitHub Pages** também serve.

Anote o endereço, sem barra no final. Ele é usado no passo 2.

## 2. Google Cloud: ID do cliente para o login (uma vez)

1. Acesse https://console.cloud.google.com e crie um projeto (ex.: "Minhas Contas").
2. Menu → **APIs e serviços → Tela de permissão OAuth** (pode aparecer como **Google Auth Platform**). Clique em *Começar*:
   - Nome do app: `Minhas Contas`; e-mail de suporte: o seu.
   - Público: **Externo**.
   - Em **Público-alvo / Usuários de teste**, adicione o seu e-mail e o dela. Enquanto o app estiver em "Teste", só esses e-mails conseguem entrar, uma trava a mais.
3. **Clientes → Criar cliente**:
   - Tipo: **Aplicativo da Web**.
   - **Origens JavaScript autorizadas**: o endereço do passo 1 (ex.: `https://minhas-contas.netlify.app`). Para testar no computador, adicione também `http://localhost:8000`.
   - Não precisa de URI de redirecionamento.
4. Copie o **ID do cliente** (termina em `.apps.googleusercontent.com`).

## 3. Planilha e script

1. Na planilha: **Extensões → Apps Script**. Apague o que tiver e cole o `Code.gs`.
2. No topo do script, preencha:
   - `CLIENT_ID`: o ID do passo 2.
   - `USUARIOS`: os e-mails que podem entrar e o nome da aba de cada um.
   - `MIGRAR_ABA_ANTIGA_PARA`: o seu e-mail. No seu primeiro login, a aba antiga "Registros" vira a sua aba e nada se perde.
3. **Configurações do projeto** (engrenagem à esquerda) → fuso `America/Sao_Paulo`.
4. Selecione a função `setup` e clique em **▶ Executar**. Autorize: agora o script também pede acesso a "serviço externo", que ele usa para confirmar o login com o Google.
5. **Implantar**:
   - Primeira vez: *Nova implantação → App da Web*, com *Executar como: Eu* e *Quem pode acessar: Qualquer pessoa*.
   - Já existia: *Gerenciar implantações → ✏️ → Versão: Nova versão → Implantar* (a URL continua a mesma).

> "Qualquer pessoa" só deixa o app **chamar** o script. Nenhum dado é lido nem gravado sem uma sessão criada por um login Google de um e-mail que está em `USUARIOS`. A planilha continua privada no seu Drive.

## 4. No celular

1. Abra o endereço do app e instale:
   - Android (Chrome): menu ⋮ → **Instalar app**.
   - iPhone (Safari): Compartilhar → **Adicionar à Tela de Início**.
2. Na **engrenagem**, cole a URL `/exec` do script e toque em Salvar.
3. Toque em **Fazer login com o Google**. Pronto: o celular fica logado e não pede de novo.

## Como funciona o login

- O Google confirma quem é a pessoa, e o script confere se o e-mail está em `USUARIOS`.
- O script devolve uma **chave de sessão** que fica salva no navegador do celular. Ela vale 180 dias (`SESSAO_DIAS`) e se renova sozinha com o uso.
- Na planilha só fica guardado um "hash" da chave, e não a chave em si.
- **Sair desta conta** (na engrenagem) invalida a chave daquele celular.
- Perdeu um celular? No editor do script, rode `revogarTodasAsSessoes`. Todos terão que entrar de novo.
- Tirar um e-mail de `USUARIOS` bloqueia essa pessoa na hora, mesmo que ela já estivesse logada.

## Como funciona o app

- **Cada pessoa vê só os próprios registros.** Os dados de todos só se juntam na planilha, cada um na sua aba.
- **Tela inicial**: cards por mês/ano com o saldo do mês (recebido − pago) e os totais de entradas e saídas. Toque no card para abrir a lista.
- **＋**: data (hoje por padrão; toque para abrir o calendário), tipo, valor, descrição com **negrito**, *itálico* e emojis, e categoria (digite uma nova ou escolha uma existente).
- **Editar / excluir**: toque num registro para editar. **Excluir registro** pede um segundo toque para confirmar.
- **Engrenagem**: conta logada e botão Sair, URL do script e URLs já usadas (o ✕ remove do aparelho).
- **Sem internet**: registros, edições e exclusões ficam no aparelho como "aguardando envio" e sobem quando a conexão voltar.
- Linhas digitadas direto na planilha ganham um ID automático para poderem ser editadas pelo app.
- Na planilha, negrito fica como `*texto*` e itálico como `_texto_`.
- Ao atualizar os arquivos do app, aumente o número em `CACHE = 'contas-v3'` no `sw.js` para os celulares baixarem a versão nova.

## Testar no computador

`python3 -m http.server 8000` dentro da pasta e abra `http://localhost:8000`. Lembre de ter colocado `http://localhost:8000` nas origens autorizadas do passo 2.
