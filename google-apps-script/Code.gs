/**
 * APP de registro de Contas — backend no Google Sheets
 * Login com Google + uma aba por pessoa.
 *
 * Passo a passo completo no README.md. Resumo:
 *  1. Preencha CLIENT_ID e USUARIOS abaixo.
 *  2. Configurações do projeto → Fuso horário: America/Sao_Paulo.
 *  3. Implantar → Nova implantação (ou Gerenciar implantações → Nova versão)
 *       Tipo: App da Web | Executar como: Eu | Quem pode acessar: Qualquer pessoa
 *
 * "Qualquer pessoa" só significa que o app consegue chamar o script.
 * Nenhum dado sai sem uma sessão válida, e a sessão só é criada para
 * quem entrar com uma conta Google listada em USUARIOS.
 */

/* ===================== CONFIGURAÇÃO ===================== */

// ID do cliente OAuth criado no Google Cloud Console (tipo "Aplicativo da Web")
const CLIENT_ID = 'COLE-AQUI-O-ID-DO-CLIENTE.apps.googleusercontent.com';

// Quem pode entrar e o nome da aba de cada pessoa
const USUARIOS = {
  'seu-email@gmail.com': 'Maurício',
  'email-dela@gmail.com': 'Namorada'
};

// Registros feitos antes do login ficavam na aba "Registros".
// No primeiro acesso deste e-mail, essa aba é renomeada para a aba dele. Use '' para não migrar.
const MIGRAR_ABA_ANTIGA_PARA = 'seu-email@gmail.com';
const ABA_ANTIGA = 'Registros';

// Por quantos dias o celular fica logado sem pedir login de novo (renova sozinho com o uso)
const SESSAO_DIAS = 180;

/* ======================================================== */

// Versão do script: o app avisa quando a publicada for mais antiga que a que ele espera.
// Aumente junto com SCRIPT_MIN no index.html sempre que o script ganhar campos novos.
const SCRIPT_VERSAO = 3;

const HEADERS = ['ID', 'Data', 'Descrição', 'Tipo', 'Categoria', 'Valor', 'Criado em', 'Situação', 'Avisos'];
const COL_SITUACAO = 8; // coluna H
const COL_AVISOS = 9;   // coluna I
const AVISO_NOMES = { vespera: 'Dia anterior', dia: 'No dia' };

/* ---------- Endpoints ---------- */

function doGet() {
  return json_({ ok: true, message: 'API do app Minhas Contas. Acesse pelo app.' });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = body.action;

    if (action === 'config') return json_({ ok: true, clientId: CLIENT_ID, versao: SCRIPT_VERSAO });
    if (action === 'login') return json_(Object.assign({ ok: true }, login_(body.credential)));

    const user = auth_(body.session);
    if (!user) return json_({ ok: false, code: 'auth', error: 'Sessão expirada. Entre novamente.' });

    if (action === 'logout') {
      removeSession_(body.session);
      return json_({ ok: true });
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const sh = sheetFor_(user);
      if (action === 'list') return json_({ ok: true, user: user, versao: SCRIPT_VERSAO, records: list_(sh) });
      if (action === 'add' || action === 'update') return json_(Object.assign({ ok: true }, upsert_(sh, body.record || {})));
      if (action === 'delete') return json_(Object.assign({ ok: true }, delete_(sh, body.record || {})));
    } finally {
      lock.releaseLock();
    }
    return json_({ ok: false, error: 'Ação desconhecida' });
  } catch (err) {
    return json_({ ok: false, code: err.auth ? 'auth' : undefined, error: String(err && err.message || err) });
  }
}

/* ---------- Login e sessões ---------- */

function login_(credential) {
  if (!credential) throw authError_('Login do Google ausente');
  if (CLIENT_ID.indexOf('COLE-AQUI') === 0) throw new Error('Preencha o CLIENT_ID no script');

  // O próprio Google confere a assinatura e a validade do token
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw authError_('Login do Google inválido. Tente de novo.');
  const info = JSON.parse(res.getContentText());

  if (info.aud !== CLIENT_ID) throw authError_('Este login não é deste app.');
  if (info.iss !== 'accounts.google.com' && info.iss !== 'https://accounts.google.com') throw authError_('Emissor inválido.');
  if (String(info.email_verified) !== 'true') throw authError_('E-mail do Google não verificado.');
  if (Number(info.exp) * 1000 < Date.now()) throw authError_('Login expirado. Tente de novo.');

  const email = String(info.email || '').toLowerCase();
  const nome = nomeDe_(email);
  if (!nome) throw authError_('O e-mail ' + email + ' não tem acesso. Inclua em USUARIOS no script.');

  const key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const props = PropertiesService.getScriptProperties();
  limparSessoesVencidas_(props);
  props.setProperty('sess_' + hash_(key), JSON.stringify({ email: email, exp: Date.now() + SESSAO_DIAS * 864e5 }));
  return { session: key, user: { email: email, nome: nome } };
}

function auth_(key) {
  if (!key) return null;
  const props = PropertiesService.getScriptProperties();
  const pk = 'sess_' + hash_(key);
  const raw = props.getProperty(pk);
  if (!raw) return null;
  const s = JSON.parse(raw);
  const nome = nomeDe_(s.email);
  if (s.exp < Date.now() || !nome) { props.deleteProperty(pk); return null; }
  // renova quando passou da metade do prazo
  if (s.exp - Date.now() < SESSAO_DIAS * 864e5 / 2) {
    s.exp = Date.now() + SESSAO_DIAS * 864e5;
    props.setProperty(pk, JSON.stringify(s));
  }
  return { email: s.email, nome: nome };
}

function removeSession_(key) {
  PropertiesService.getScriptProperties().deleteProperty('sess_' + hash_(key));
}

function limparSessoesVencidas_(props) {
  const all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('sess_') !== 0) return;
    try { if (JSON.parse(all[k]).exp < Date.now()) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
  });
}

/** Rode pelo editor para deslogar todos os celulares (ex.: perdeu o aparelho). */
function revogarTodasAsSessoes() {
  const props = PropertiesService.getScriptProperties();
  Object.keys(props.getProperties()).forEach(function (k) {
    if (k.indexOf('sess_') === 0) props.deleteProperty(k);
  });
}

function nomeDe_(email) {
  const e = String(email || '').toLowerCase();
  for (const k in USUARIOS) if (k.toLowerCase() === e) return USUARIOS[k];
  return null;
}

// Guarda só o hash da chave: quem abrir as propriedades do script não consegue usá-la
function hash_(s) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s));
}

function authError_(msg) {
  const e = new Error(msg);
  e.auth = true;
  return e;
}

/* ---------- Abas ---------- */

function sheetFor_(user) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(user.nome);
  if (!sh) {
    const antiga = ss.getSheetByName(ABA_ANTIGA);
    if (antiga && MIGRAR_ABA_ANTIGA_PARA && MIGRAR_ABA_ANTIGA_PARA.toLowerCase() === user.email) {
      antiga.setName(user.nome);
      sh = antiga;
    } else {
      sh = ss.insertSheet(user.nome);
    }
  }
  // abas criadas antes destes campos ganham os cabeçalhos novos
  if (sh.getLastRow() > 0 && sh.getRange(1, COL_SITUACAO).getValue() === '') {
    sh.getRange(1, COL_SITUACAO).setValue('Situação').setFontWeight('bold');
  }
  if (sh.getLastRow() > 0 && sh.getRange(1, COL_AVISOS).getValue() === '') {
    sh.getRange(1, COL_AVISOS).setValue('Avisos').setFontWeight('bold');
  }
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sh.getRange('B:B').setNumberFormat('dd/mm/yyyy');
    sh.getRange('F:F').setNumberFormat('"R$" #,##0.00');
    sh.getRange('G:G').setNumberFormat('dd/mm/yyyy hh:mm');
  }
  return sh;
}

/* ---------- Registros ---------- */

// Cria ou atualiza (se o ID já existir), então reenviar o mesmo registro nunca duplica
function upsert_(sh, r) {
  const id = String(r.id || '').trim();
  const data = String(r.data || '');
  const tipo = String(r.tipo || '').toLowerCase();
  const valor = Number(r.valor);
  const descricao = String(r.descricao || '').trim();
  const categoria = String(r.categoria || '').trim();
  const pendente = String(r.situacao || 'pago') === 'pendente';
  const avisos = avisosTexto_(r.avisos);

  if (!id) throw new Error('ID ausente');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error('Data inválida');
  if (tipo !== 'pagamento' && tipo !== 'recebimento') throw new Error('Tipo inválido');
  if (!(valor > 0)) throw new Error('Valor inválido');
  if (!descricao) throw new Error('Descrição vazia');

  const values = [
    parseDate_(data),
    safe_(descricao),
    tipo === 'pagamento' ? 'Pagamento' : 'Recebimento',
    safe_(categoria),
    Math.round(valor * 100) / 100
  ];

  const situacao = tipo === 'pagamento' ? (pendente ? 'A pagar' : 'Pago') : (pendente ? 'A receber' : 'Recebido');

  const row = findRow_(sh, id);
  if (row > 0) {
    sh.getRange(row, 2, 1, values.length).setValues([values]);
    sh.getRange(row, COL_SITUACAO, 1, 2).setValues([[situacao, avisos]]);
    return { id: id, updated: true };
  }
  sh.getRange(sh.getLastRow() + 1, 1, 1, HEADERS.length).setValues([[id].concat(values, [new Date(), situacao, avisos])]);
  return { id: id, created: true };
}

function delete_(sh, r) {
  const id = String(r.id || '').trim();
  if (!id) throw new Error('ID ausente');
  const row = findRow_(sh, id);
  if (row > 0) sh.deleteRow(row);
  return { id: id, deleted: row > 0 };
}

function findRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) return i + 2;
  }
  return -1;
}

function list_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const tz = Session.getScriptTimeZone();
  const values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  const out = [];
  values.forEach(function (row, i) {
    if (!row[1] && !row[2] && !row[5]) return; // linha vazia
    // Linha digitada à mão na planilha: ganha um ID para poder ser editada/excluída pelo app
    if (!row[0]) {
      row[0] = Utilities.getUuid();
      sh.getRange(i + 2, 1).setValue(row[0]);
    }
    const d = row[1];
    out.push({
      id: String(row[0]),
      data: d instanceof Date ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : String(d),
      descricao: String(row[2] || ''),
      tipo: /^rec/i.test(String(row[3])) ? 'recebimento' : 'pagamento',
      categoria: String(row[4] || ''),
      valor: Number(row[5]) || 0,
      // vazio (registros antigos) conta como pago
      situacao: /^a /i.test(String(row[7] || '').trim()) ? 'pendente' : 'pago',
      avisos: avisosLista_(row[8])
    });
  });
  return out;
}

/* ---------- Avisos ---------- */

// ['vespera','dia'] -> "Dia anterior, No dia"; lista vazia -> "Nenhum"
function avisosTexto_(lista) {
  if (!Array.isArray(lista)) return '';
  const nomes = ['vespera', 'dia'].filter(function (k) { return lista.indexOf(k) >= 0; })
    .map(function (k) { return AVISO_NOMES[k]; });
  return nomes.length ? nomes.join(', ') : 'Nenhum';
}

// célula vazia (registros antigos) -> null: o app trata como "os dois"
function avisosLista_(texto) {
  const t = String(texto || '').trim();
  if (!t) return null;
  const out = [];
  if (/anterior/i.test(t)) out.push('vespera');
  if (/no dia/i.test(t)) out.push('dia');
  return out;
}

/* ---------- Utilitários ---------- */

function parseDate_(s) {
  const p = s.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2], 12, 0, 0); // meio-dia evita virar o dia por fuso
}

// Impede que textos começando com = + - @ sejam interpretados como fórmula
function safe_(s) {
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Rode uma vez pelo editor (▶ Executar) para autorizar o script (planilha + acesso externo). */
function setup() {
  SpreadsheetApp.getActiveSpreadsheet().getName();
  UrlFetchApp.fetch('https://www.googleapis.com/generate_204', { muteHttpExceptions: true });
  PropertiesService.getScriptProperties().getKeys();
}
