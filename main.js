/* ============================================================
   DISPAROPAY — main.js  v5
   Taxas por gateway: % + fixo por venda + retenção
   ============================================================ */
'use strict';

/* ── Mês helpers ──────────────────────────────────────────── */
function mesKey(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
function mesLabel(key){
  const [y,m]=key.split('-');
  return ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][parseInt(m)-1]+'/'+String(y).slice(-2);
}
function curMesKey(){ return mesKey(new Date()); }

/* ── State ────────────────────────────────────────────────── */
/*
  taxasGw: por gateway, estrutura:
  {
    anubis:   { pct:0, fixo:0, retencao:0, taxaSaque:0 },
    umbrella: { pct:0, fixo:0, retencao:0, taxaSaque:0 }
  }
  - pct       : % sobre faturamento bruto (ex: 2.5)
  - fixo      : R$ fixo por venda aprovada (ex: 0.30)
  - retencao  : % retido pelo gateway (ex: 1.0) — cobrado adicionalmente
  - taxaSaque : R$ por saque realizado (ex: 3.67)
*/
const S = {
  keys:           { anubis:'', umbrella:'', anubisWd:'' },
  taxasGw: {
    anubis:   { pct:0, fixo:0, retencao:0, taxaSaque:0 },
    umbrella: { pct:0, fixo:0, retencao:0, taxaSaque:0 }
  },
  fixos:          { func:{val:0,qtd:0}, cont:{val:0}, escritorio:[], aquisicoes:[] },
  impostos:       [],
  tfa:            [],
  disparos:       [],
  recLeads:       {},
  recCopy:        'Olá {nome}, identificamos que você iniciou um pagamento de R$ {valor} mas não foi concluído. Clique aqui para finalizar sua compra!',
  chipsHistory:   {},
  transactions:   [],
  withdrawals:    [],
  activeSource:   'both',
  historico:      [],
  metas:          {},
  metaPromptDone: '',
  chipPromptDone: ''
};

/* ── Persist & Hydrate ────────────────────────────────────── */
const STORAGE_KEY = 'dp6';

const SAVE_URL = (()=>{
  const host = window.location.hostname;
  const base = (host === 'ronald-almeida.github.io')
    ? 'https://bigcompany.shop/painelv'
    : window.location.href.replace(/\/[^\/]*$/, '');
  return base + '/save.php';
})();

function persist(){
  try{
    const json = JSON.stringify(S);
    try{ localStorage.setItem(STORAGE_KEY, json); }catch(e){}
    const b64 = btoa(unescape(encodeURIComponent(json)));
    fetch(SAVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: b64 })
    }).catch(e => console.warn('[DisparoPay] Erro ao salvar no servidor:', e));
  }catch(e){
    console.error('[DisparoPay] Erro ao salvar:', e);
  }
}

async function hydrateFromServer(){
  try{
    const res = await fetch(SAVE_URL);
    const obj = await res.json();
    if(obj && obj.data){
      const json = decodeURIComponent(escape(atob(obj.data)));
      try{ localStorage.setItem(STORAGE_KEY, json); }catch(e){}
      return json;
    }
  }catch(e){
    console.warn('[DisparoPay] Servidor indisponível, usando localStorage:', e);
  }
  try{ return localStorage.getItem(STORAGE_KEY); }catch(e){ return null; }
}

function hydrate(raw){
  try{
    if(!raw) return;
    const sv = JSON.parse(raw);

    // Primitivos e strings
    if(sv.activeSource)    S.activeSource    = sv.activeSource;
    if(sv.metaPromptDone)  S.metaPromptDone  = sv.metaPromptDone;
    if(sv.chipPromptDone)  S.chipPromptDone  = sv.chipPromptDone;

    // API Keys
    if(sv.keys){
      if(sv.keys.anubis)   S.keys.anubis   = sv.keys.anubis;
      if(sv.keys.umbrella) S.keys.umbrella = sv.keys.umbrella;
    }

    // Taxas por gateway — merge campo a campo para não perder defaults
    if(sv.taxasGw){
      if(sv.taxasGw.anubis)   Object.assign(S.taxasGw.anubis,   sv.taxasGw.anubis);
      if(sv.taxasGw.umbrella) Object.assign(S.taxasGw.umbrella, sv.taxasGw.umbrella);
    }

    // Custos fixos — merge campo a campo
    if(sv.fixos){
      if(sv.fixos.func) Object.assign(S.fixos.func, sv.fixos.func);
      if(sv.fixos.cont) Object.assign(S.fixos.cont, sv.fixos.cont);
      if(Array.isArray(sv.fixos.escritorio)) S.fixos.escritorio = sv.fixos.escritorio;
      if(Array.isArray(sv.fixos.aquisicoes)) S.fixos.aquisicoes = sv.fixos.aquisicoes;
    }

    // Arrays raiz
    if(Array.isArray(sv.impostos)) S.impostos = sv.impostos;
    if(Array.isArray(sv.tfa))      S.tfa      = sv.tfa;
    if(Array.isArray(sv.disparos)) S.disparos = sv.disparos;

    // Dicionários de chave-valor
    if(sv.metas        && typeof sv.metas        === 'object') S.metas        = sv.metas;
    if(sv.chipsHistory && typeof sv.chipsHistory === 'object') S.chipsHistory = sv.chipsHistory;

    // Arrays
    if(Array.isArray(sv.transactions)) S.transactions = sv.transactions;
    if(Array.isArray(sv.withdrawals))  S.withdrawals  = sv.withdrawals;
    if(Array.isArray(sv.historico))    S.historico    = sv.historico;

  }catch(e){
    console.error('[DisparoPay] Erro ao carregar dados:', e);
  }

  // Garante estruturas mínimas sempre
  if(!S.chipsHistory || typeof S.chipsHistory !== 'object') S.chipsHistory = {};
  if(!Array.isArray(S.withdrawals))  S.withdrawals  = [];
  if(!S.metas || typeof S.metas !== 'object') S.metas = {};
  ensureHistorico();
}

// Verifica se localStorage está disponível (modo privado pode bloquear)
(function checkStorage(){
  try{
    localStorage.setItem('_dp_ping', '1');
    localStorage.removeItem('_dp_ping');
  }catch(e){
    console.warn('[DisparoPay] localStorage bloqueado — dados não serão persistidos');
    window._lsBlocked = true;
    document.addEventListener('DOMContentLoaded', ()=>{
      const el = document.getElementById('lsBlockedBanner');
      if(el) el.style.display = 'flex';
    });
  }
})();
function ensureHistorico(){
  if(!Array.isArray(S.historico)) S.historico=[];
  const today=new Date();
  for(let i=5;i>=1;i--){
    const d=new Date(today.getFullYear(),today.getMonth()-i,1), key=mesKey(d);
    if(!S.historico.find(h=>h.key===key))
      S.historico.push({key,mes:mesLabel(key),b:0,l:0,meta:S.metas[key]||0,chips:chipDoMes(key),saques:0});
  }
  const ck=curMesKey();
  if(!S.historico.find(h=>h.key===ck))
    S.historico.push({key:ck,mes:mesLabel(ck),b:0,l:0,meta:S.metas[ck]||0,chips:chipDoMes(ck),saques:0});
  S.historico.sort((a,b)=>a.key.localeCompare(b.key));
  if(S.historico.length>24) S.historico=S.historico.slice(-24);
}

/* ── Chips por mês ────────────────────────────────────────── */
function chipDoMes(key){ const c=S.chipsHistory[key]; return c?c.val:0; }
function setChipMes(key,data){ S.chipsHistory[key]=data; const h=S.historico.find(h=>h.key===key); if(h) h.chips=data.val; persist(); }
function checkChipPrompt(){
  const ck=curMesKey();
  if(S.chipPromptDone===ck) return;
  if(chipDoMes(ck)>0){ S.chipPromptDone=ck; persist(); return; }
  S.chipPromptDone=ck; persist();
  setTimeout(()=>openModal('modalChipPrompt'),1200);
}

/* ── Formatters ───────────────────────────────────────────── */
function brl(n){ return 'R$ '+Math.abs(n).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function brlS(n){ if(n>=1e6) return 'R$'+(n/1e6).toFixed(1).replace('.',',')+'M'; if(n>=1e3) return 'R$'+(n/1e3).toFixed(1).replace('.',',')+'k'; return 'R$'+n.toFixed(0); }
function pct(v,t){ return t>0?((v/t)*100).toFixed(1):'0.0'; }
function fmtDt(iso){ 
  if(!iso) return '—'; 
  // Se for YYYY-MM-DD (sem horário), interpreta como local para evitar UTC-3 shift
  if(/^\d{4}-\d{2}-\d{2}$/.test(iso)){
    const [y,m,d] = iso.split('-').map(Number);
    return new Date(y,m-1,d).toLocaleDateString('pt-BR');
  }
  const d=new Date(iso); 
  if(isNaN(d)) return iso; 
  return d.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}); 
}
function set(id,v){ const e=document.getElementById(id); if(e) e.textContent=v; }
function fmt(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

const isPaid  = s=>{ const u=(s||'').toUpperCase(); return ['PAID','APPROVED','COMPLETE','COMPLETED','SUCCESS','CAPTURED'].includes(u); };
const isPend  = s=>{ const u=(s||'').toUpperCase(); return ['PENDING','WAITING','PROCESSING','PENDING_ANALYSIS','PENDING_QUEUE'].includes(u); };
const isRef   = s=>{ const u=(s||'').toUpperCase(); return ['REFUNDED','CHARGEBACK','REVERSED','CANCELLED','CANCELED','REFUSED'].includes(u); };
const isWithd = s=>['paid','completed','success','approved','done','processed','COMPLETED'].includes((s||'').toLowerCase()||s||'');
// AnubisPay real statuses: COMPLETED|PROCESSING|CANCELLED|REFUSED|PENDING_ANALYSIS|PENDING_QUEUE
const isWithdAnubis = s=>{ const u=(s||'').toUpperCase(); return u==='COMPLETED'; };

/* ── Calcular taxas de um gateway ─────────────────────────── */
function totalEscritorio(){ return (S.fixos.escritorio||[]).reduce((a,i)=>a+(i.val||0),0); }
function totalAquisicoes(){ return (S.fixos.aquisicoes||[]).reduce((a,i)=>a+(i.val||0),0); }
function nextEscrId(){ return Date.now()+'_'+Math.random().toString(36).slice(2,6); }

function calcTaxasGw(gw, brutoGw, vendasGw, saquesGw){
  const t = S.taxasGw[gw] || {pct:0,fixo:0,retencao:0,taxaSaque:0};
  const tPct      = brutoGw * (t.pct/100);
  const tFixo     = vendasGw * t.fixo;
  const tRetencao = brutoGw * (t.retencao/100);
  const tSaque    = saquesGw * t.taxaSaque;
  return { tPct, tFixo, tRetencao, tSaque, total: tPct+tFixo+tRetencao+tSaque };
}


/* ── Proxy Config ────────────────────────────────────────────
   .htaccess redireciona /proxy → localhost:3001/proxy
   bigcompany.shop/painelV4/proxy?url=...
─────────────────────────────────────────────────────────── */
function proxyUrl(targetUrl){
  const host = window.location.hostname;
  const base = (host === 'ronald-almeida.github.io')
    ? 'https://bigcompany.shop/painelv'
    : window.location.href.replace(/\/[^\/]*$/, '');
  return { _proxy: true, _targetUrl: targetUrl, _proxyUrl: `${base}/proxy.php` };
}

// Wrapper: envia via POST como form-data (compatível com LiteSpeed)
async function proxyFetch(urlOrObj, options = {}) {
  if (urlOrObj && urlOrObj._proxy) {
    const origHeaders = options.headers || {};
    const form = new FormData();
    form.append('target_url', urlOrObj._targetUrl);
    form.append('headers', JSON.stringify(origHeaders));
    return fetch(urlOrObj._proxyUrl, { method: 'POST', body: form });
  }
  return fetch(urlOrObj, options);
}

/* ============================================================
   GATEWAYS
   ============================================================ */
const AnubisPay = {
  BASE: 'https://api.anubispay.com.br/v1',

  // Ambos endpoints (transações e saques) usam Authorization: Basic base64(apiKey:)
  headers(key){
    return {
      'Authorization': 'Basic ' + btoa(key + ':'),
      'accept':        'application/json'
    };
  },

  // Estrutura real GET /v1/transactions:
  // id, amount (bruto centavos), paidAmount, refundedAmount, status, paymentMethod,
  // createdAt, updatedAt, customer{id,name,email,phone}, fee{netAmount,estimatedFee}
  normTx(tx){
    return {
      id:             tx.id,
      status:         (tx.status || '').toUpperCase(),
      amount:         tx.paidAmount || tx.amount || 0,  // usa paidAmount (valor efetivamente pago)
      netAmount:      tx.fee?.netAmount || 0,
      fee:            tx.fee?.estimatedFee || 0,
      refunded:       tx.refundedAmount || 0,
      paymentMethod:  tx.paymentMethod || 'PIX',
      externalRef:    tx.externalRef || '',
      createdAt:      tx.createdAt || tx.created_at || '',
      customer: {
        name:     tx.customer?.name     || '',
        email:    tx.customer?.email    || '',
        phone:    tx.customer?.phone    || tx.customer?.phoneNumber || '',
        document: tx.customer?.document || tx.customer?.cpf || tx.customer?.taxId || ''
      },
      _gateway: 'anubis'
    };
  },

  // Estrutura real de GET /v1/transfers/ (doc imagem):
  // id (int), companyId, tenantId, amount (centavos bruto), netAmount (centavos líquido),
  // currency, fee (centavos), method (fiat|crypto), status (COMPLETED|PROCESSING|
  // CANCELLED|REFUSED|PENDING_ANALYSIS|PENDING_QUEUE), pixKey, pixKeyType,
  // pixEnd2EndId, description, createdAt, transferredAt, processedAt, updatedAt
  normWd(w){
    return {
      id:          w.id,
      amount:      w.amount    || 0,   // bruto em centavos
      netAmount:   w.netAmount || (w.amount - (w.fee || 0)),
      fee:         w.fee       || 0,
      status:      (w.status   || 'COMPLETED').toUpperCase(),
      method:      w.method    || 'fiat',
      currency:    w.currency  || 'BRL',
      pixKey:      w.pixKey    || '',
      pixKeyType:  w.pixKeyType || '',
      bankName:    w.pixKey    || '',
      createdAt:   w.createdAt     || w.created_at || '',
      processedAt: w.processedAt   || w.transferredAt || '',
      _gateway:    'anubis'
    };
  },

  async fetchTransactions(key, from, to){
    // Response: { pagination: { page, pageSize, totalRecords, totalPages }, data: [...] }
    let all = [], page = 1, totalPages = 1;
    while(page <= totalPages){
      const params = new URLSearchParams({ page, pageSize: 50 });
      const r = await proxyFetch(
        proxyUrl(`${this.BASE}/transactions?${params}`),
        { headers: this.headers(key) }
      );
      if(!r.ok) throw new Error('AnubisPay TX HTTP ' + r.status);
      const json = await r.json();
      const pg   = json.pagination || {};
      totalPages = pg.totalPages || 1;
      const rows = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
      all = all.concat(rows.map(tx => this.normTx(tx)));
      page++;
      if(page > 100) break;
    }
    return filterDate(all, from, to);
  },

  // GET /v1/transfers/
  // Response: { pagination: { page, pageSize, totalRecords, totalPages }, data: [...] }
  // Sem filtro de data no servidor — busca todas as páginas e filtra no cliente
  async fetchWithdrawals(key, from, to){
    let all = [], page = 1, totalPages = 1;
    while(page <= totalPages){
      const params = new URLSearchParams({ page, pageSize: 50 });
      const r = await proxyFetch(
        proxyUrl(`${this.BASE}/transfers/?${params}`),
        { headers: this.headers(key) }
      );
      if(!r.ok) throw new Error('AnubisPay Saques HTTP ' + r.status);
      const json = await r.json();

      // Envelope: { pagination: { totalPages, totalRecords, ... }, data: [...] }
      const pg   = json.pagination || {};
      totalPages = pg.totalPages || 1;
      const rows = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);

      all = all.concat(rows.map(w => this.normWd(w)));
      page++;
      if(page > 100) break; // safety limit
    }
    return filterDate(all, from, to);
  }
};

const UmbrelaPag = {
  BASE: 'https://api-gateway.umbrellapag.com/api',

  headers(key){
    return {
      'x-api-key':   key,
      'User-Agent':  'AtivoB2B/1.0',
      'Content-Type':'application/json'
    };
  },

  // Response: { status, message, data: [ { id, amount, refundedAmount,
  //   paymentMethod, status, createdAt, paidAt, customer, fee } ] }
  // amount em centavos, status: PROCESSING|AUTHORIZED|PAID|REFUNDED|
  //   WAITING_PAYMENT|REFUSED|CHARGEDBACK|CANCELED|IN_PROTEST
  normTx(tx){
    const amt = tx.amount || 0;
    const fee = tx.fee?.fee || tx.fee?.amount || 0;
    return {
      id:            tx.id            || '',
      status:        (tx.status       || '').toUpperCase(),
      amount:        amt,
      netAmount:     tx.fee?.netAmount || (amt - fee),
      fees:          fee,
      paymentMethod: tx.paymentMethod || 'PIX',
      createdAt:     tx.paidAt || tx.createdAt || tx.updatedAt || '',
      customer: {
        name:  tx.customer?.name  || '',
        email: tx.customer?.email || ''
      },
      _gateway: 'umbrella'
    };
  },

  normWd(w){
    const raw = w.amount || 0;
    return {
      id:          w.id              || '',
      amount:      raw,
      fees:        w.fee             || 0,
      netAmount:   raw - (w.fee      || 0),
      status:      (w.status         || 'COMPLETED').toUpperCase(),
      method:      'PIX',
      pixKey:      w.pixKey          || '',
      pixKeyType:  w.pixType         || '',
      createdAt:   w.createdAt       || '',
      bankName:    w.beneficiaryName || w.pixKey || '',
      _gateway:    'umbrella'
    };
  },

  async fetchTransactions(key, from, to){
    let all = [], page = 1;
    while(true){
      const p = new URLSearchParams({ page, limit: 100 });
      if(from) p.set('startDate', from);
      if(to)   p.set('endDate',   to);
      // Filtra só PIX e status relevantes
      p.set('paymentMethods', 'PIX');
      const r = await proxyFetch(proxyUrl(`${this.BASE}/user/transactions?${p}`), { headers: this.headers(key) });
      if(!r.ok){
        const txt = await r.text().catch(()=>'');
        throw new Error('UmbrelaPag TX HTTP ' + r.status + ' — ' + txt.slice(0,100));
      }
      const json = await r.json();
      // Response: { status, message, data: [...] }
      const rows = Array.isArray(json.data) ? json.data : [];
      all = all.concat(rows.map(tx => this.normTx(tx)));
      // Sem paginação documentada — para quando vier menos de 100
      if(rows.length < 100) break;
      page++;
      if(page > 40) break;
    }
    return filterDate(all, from, to);
  },

  async fetchWithdrawals(key, from, to){
    let all = [], page = 1;
    while(true){
      const p = new URLSearchParams({ page, limit: 100, orderDirection: 'desc', orderBy: 'id' });
      const r = await proxyFetch(proxyUrl(`${this.BASE}/user/cashout?${p}`), { headers: this.headers(key) });
      if(!r.ok){
        const txt = await r.text().catch(()=>'');
        throw new Error('UmbrelaPag Saques HTTP ' + r.status + ' — ' + txt.slice(0,100));
      }
      const json  = await r.json();
      // Response: { data: { data: [...], pages, page, limit, total } }
      const inner = json.data?.data || json.data || [];
      const rows  = Array.isArray(inner) ? inner : [];
      all = all.concat(rows.map(w => this.normWd(w)));
      const totalPages = json.data?.pages || 1;
      if(page >= totalPages) break;
      page++;
      if(page > 40) break;
    }
    return filterDate(all, from, to);
  }
};

function filterDate(arr,from,to){
  if(!from||!to) return arr;
  // Usa horário local para evitar problema de UTC-3
  const [fy,fm,fd] = from.split('-').map(Number);
  const [ty,tm,td] = to.split('-').map(Number);
  const f = new Date(fy,fm-1,fd,0,0,0,0);
  const t = new Date(ty,tm-1,td,23,59,59,999);
  return arr.filter(x=>{
    // tenta createdAt, transferredAt, processedAt — usa o primeiro válido
    const raw = x.createdAt || x.transferredAt || x.processedAt || x.updatedAt || '';
    const d = new Date(raw);
    if(isNaN(d)) return true; // sem data: inclui para não perder
    return d >= f && d <= t;
  });
}

/* ── Sync ─────────────────────────────────────────────────── */
async function syncData(){
  if(!S.keys.anubis&&!S.keys.umbrella){ openModal('modalApiAnubis'); return; }
  const from=document.getElementById('dateFrom').value, to=document.getElementById('dateTo').value;
  setLoading(true); setSyncBtn(true);
  try{
    const fA=S.keys.anubis  &&(S.activeSource==='anubis'  ||S.activeSource==='both');
    const fB=S.keys.umbrella&&(S.activeSource==='umbrella'||S.activeSource==='both');
    const jobs=[];
    if(fA){
      jobs.push(AnubisPay.fetchTransactions(S.keys.anubis, from, to));
      jobs.push(AnubisPay.fetchWithdrawals(S.keys.anubis, from, to));
    }
    if(fB){ jobs.push(umbrellaFetchTransactions(S.keys.umbrella,from,to)); jobs.push(umbrellaFetchWithdrawals(S.keys.umbrella,from,to)); }
    const res=await Promise.allSettled(jobs);
    let allTx=[],allWd=[],i=0;
    if(fA){
      if(res[i].status==='fulfilled') allTx=allTx.concat(res[i].value); else showToast('⚠ AnubisPay TX: '+res[i].reason.message,'yellow'); i++;
      if(res[i].status==='fulfilled') allWd=allWd.concat(res[i].value); else showToast('⚠ AnubisPay Saques: '+res[i].reason.message,'yellow'); i++;
    }
    if(fB){
      if(res[i].status==='fulfilled') allTx=allTx.concat(res[i].value); else showToast('⚠ UmbrelaPag TX: '+res[i].reason.message,'yellow'); i++;
      if(res[i].status==='fulfilled') allWd=allWd.concat(res[i].value); else showToast('⚠ UmbrelaPag Saques: '+res[i].reason.message,'yellow'); i++;
    }
    allTx.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    allWd.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    S.transactions=allTx; S.withdrawals=allWd; persist();
    checkNewTransactions(allTx);
    calc(allTx,allWd,from,to);
    showToast(`✓ ${allTx.length} transações · ${allWd.length} saques`,'green');
  }catch(err){ showToast('✗ '+err.message,'red'); console.error(err); }
  finally{ setLoading(false); setSyncBtn(false); }
}

function setSource(src){
  S.activeSource=src; persist();
  document.querySelectorAll('.source-btn').forEach(b=>b.classList.remove('active-anubis','active-umbrella','active-both'));
  document.getElementById('srcBtn'+src.charAt(0).toUpperCase()+src.slice(1))?.classList.add('active-'+src);
  const tx=src==='both'?S.transactions:S.transactions.filter(t=>t._gateway===src);
  const wd=src==='both'?S.withdrawals :S.withdrawals.filter(w=>w._gateway===src);
  calc(tx,wd,'','');
}

/* ============================================================
   CALC
   ============================================================ */
function calc(txs,wds,from,to){
  // Aplica filtro de data
  if(!from) from = document.getElementById('dateFrom')?.value || '';
  if(!to)   to   = document.getElementById('dateTo')?.value   || '';
  txs = filterDate(txs, from, to);
  wds = filterDate(wds, from, to);

  const sum=arr=>arr.reduce((a,t)=>a+((t.amount||0)/100),0);
  const paid=txs.filter(t=>isPaid(t.status)), pending=txs.filter(t=>isPend(t.status)), refunded=txs.filter(t=>isRef(t.status));
  const wdPaid=wds.filter(w=>isWithd(w.status));

  // Split por gateway
  const paidA=paid.filter(t=>t._gateway==='anubis'),   paidB=paid.filter(t=>t._gateway==='umbrella');
  const wdA  =wdPaid.filter(w=>w._gateway==='anubis'), wdB  =wdPaid.filter(w=>w._gateway==='umbrella');
  const brutoA=sum(paidA), brutoB=sum(paidB), bruto=brutoA+brutoB;
  const wdAmtA=sum(wdA),   wdAmtB=sum(wdB),   totalSaques=wdAmtA+wdAmtB;
  const refundAmt=sum(refunded);

  // Taxas por gateway
  const tA=calcTaxasGw('anubis',  brutoA, paidA.length, wdA.length);
  const tB=calcTaxasGw('umbrella',brutoB, paidB.length, wdB.length);
  const CHECKOUT_PCT = 2.5; // taxa de checkout fixa sobre faturamento bruto
  const tCheckout = bruto * (CHECKOUT_PCT / 100);
  const totTaxas=tA.total+tB.total+tCheckout;

  // Fixos
  const ck=curMesKey();
  const fChip=chipDoMes(ck), fFunc=S.fixos.func.val, fCont=S.fixos.cont.val, fEscr=totalEscritorio(), fAq=totalAquisicoes();
  const totFixos=fChip+fFunc+fCont+fEscr+fAq;
  const totDed=totTaxas+totFixos;

  // Lucro Líquido = Saques Realizados − Taxas − Custos Fixos
  // (somente o que foi sacado é considerado receita realizada)
  const receitaTotal=totalSaques;
  const lucro=totalSaques-totDed;
  const margem=totalSaques>0?(lucro/totalSaques)*100:0;
  const aprov=txs.length>0?((paid.length/txs.length)*100).toFixed(1):0;
  const ticket=paid.length>0?bruto/paid.length:0;

  // ── DOM ──
  set('periodSub',(from&&to?`${fmtDt(from)} → ${fmtDt(to)}`:'Período completo')+' · '+txs.length+' transações');
  // badges na sidebar
  set('navTxBadge', txs.length  || '');
  set('navWdBadge', wds.length  || '');

  // Banner vendas
  set('valBruto',brl(bruto));
  set('chipVendas',paid.length+' vendas PIX aprovadas');
  set('chipAnubis','AnubisPay: '+brlS(brutoA));
  set('chipUmbrella','UmbrelaPag: '+brlS(brutoB));
  set('valTicket',brl(ticket)); set('valAprov',aprov+'%'); set('valRefund',brl(refundAmt));

  // Banner saques
  set('valSaquesTotal',brl(totalSaques));
  set('chipSaquesQtd',wdPaid.length+' saques realizados');
  set('chipSaquesAnubis','AnubisPay: '+brlS(wdAmtA));
  set('chipSaquesUmbrella','UmbrelaPag: '+brlS(wdAmtB));
  set('valReceitaTotal',brl(receitaTotal));

  // KPIs
  set('valTaxasTotal',brl(totTaxas)); set('subTaxas',pct(totTaxas,bruto)+'% do faturamento');
  set('valCheckout',brl(tCheckout)); set('subCheckout',CHECKOUT_PCT+'% do faturamento bruto');
  set('valFixosTotal',brl(totFixos)); set('valDeducoes',brl(totDed)); set('subDed',pct(totDed,receitaTotal)+'% da receita');
  set('subFixos','Chip+Func+Cont+Escr');
  set('valTxCount',txs.length); set('subTx',pending.length+' pendentes · '+refunded.length+' reembolsos');


  // Fixos
  const chipData=S.chipsHistory[ck]||{val:0,qtd:0,unit:0};
  set('valChip','− '+brl(fChip)); set('noteChip',chipData.qtd?chipData.qtd+' chips × '+brl(chipData.unit)+'/chip':mesLabel(ck));
  set('valFunc','− '+brl(fFunc)); set('noteFunc',S.fixos.func.qtd+' funcionário(s)');
  set('valCont','− '+brl(fCont));
  set('valEscritorio','− '+brl(fEscr)); set('noteEscritorio',(S.fixos.escritorio||[]).length+' item(s)');
  set('valAquisicoes','− '+brl(fAq)); set('noteAquisicoes',(S.fixos.aquisicoes||[]).length+' item(s)');

  // ── Resultado Líquido ──
  const lEl=document.getElementById('valLucro');
  lEl.textContent=(lucro<0?'− ':'')+brl(lucro); lEl.className='rh-val '+(lucro>=0?'green':'red');
  const mEl=document.getElementById('valMargem');
  mEl.textContent=margem.toFixed(1)+'%'; mEl.className='rh-val '+(margem>=20?'blue':margem>=10?'yellow':'red');

  // Breakdown resultado

  // historico
  const hEntry=S.historico.find(h=>h.key===ck);
  if(hEntry){ hEntry.b=bruto; hEntry.l=Math.max(lucro,0); hEntry.saques=totalSaques; hEntry.chips=fChip; }

  renderMeta(bruto);
  renderChart();
  renderTable(txs);
  renderWithdrawals(wds);
}

/* ── Tabela transações ────────────────────────────────────── */
const ST_LBL={paid:'Pago',approved:'Pago',completed:'Pago',complete:'Pago',success:'Pago',pending:'Pendente',waiting:'Pendente',processing:'Processando',refunded:'Reembolso',chargeback:'Estorno',reversed:'Estorno',canceled:'Cancelado',cancelled:'Cancelado',failed:'Falhou'};
const ST_CLS={paid:'bg',approved:'bg',completed:'bg',complete:'bg',success:'bg',pending:'by',waiting:'by',processing:'by',refunded:'br',chargeback:'br',reversed:'br',canceled:'bgr',cancelled:'bgr',failed:'bgr'};

function renderTable(override){
  const body=document.getElementById('txBody');
  const fSt=document.getElementById('filterSt').value, fGw=document.getElementById('filterGw').value;
  const q=(document.getElementById('searchIn').value||'').toLowerCase();
  const src=override||S.transactions;
  const txs=src.filter(t=>{
    const st=(t.status||'').toLowerCase(), nm=(t.customer?.name||t.customer?.email||String(t.id||'')).toLowerCase();
    if(fSt&&st!==fSt) return false; if(fGw&&t._gateway!==fGw) return false;
    if(q&&!nm.includes(q)&&!String(t.id||'').includes(q)) return false; return true;
  }).slice(0,200);
  set('txLbl','('+txs.length+')');
  if(!txs.length){ body.innerHTML=`<tr><td colspan="5"><div class="empty-state">Nenhuma transação.<br>Configure a API e clique em Buscar.</div></td></tr>`; return; }
  body.innerHTML=txs.map(t=>{
    const st=(t.status||'').toLowerCase(), amt=(t.amount||0)/100;
    const nm=t.customer?.name||t.customer?.email||'Cliente', tid=t.id?'#'+String(t.id).slice(-8):'—';
    const stLbl=ST_LBL[st]||st, stCls=ST_CLS[st]||'bgr', pos=isPaid(st), isA=t._gateway==='anubis';
    return `<tr>
      <td><div class="td-desc"><div class="tx-icon ${isA?'':'purple'}">🟩</div>
        <div><div class="tx-name">${nm}</div><div class="tx-sub">${tid}</div>
        <div class="tx-gw" style="color:${isA?'var(--anubis)':'var(--umbrella)'}">${isA?'AnubisPay':'UmbrelaPag'}</div></div></div></td>
      <td class="col-method" style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--green);font-weight:600">PIX</td>
      <td class="col-date"   style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ink2)">${fmtDt(t.createdAt)}</td>
      <td class="col-status"><span class="badge ${stCls}">${stLbl}</span></td>
      <td style="text-align:right"><span class="amount ${pos?'pos':'neg'}">${pos?'+':'−'} ${brl(amt)}</span></td>
    </tr>`;
  }).join('');
}

/* ── Tabela saques ────────────────────────────────────────── */
function renderWithdrawals(override){
  const body=document.getElementById('wdBody'); if(!body) return;
  const fGw=document.getElementById('filterWdGw')?.value||'';
  const src=override||S.withdrawals;
  const wds=src.filter(w=>!fGw||w._gateway===fGw).slice(0,200);
  const paidWds=wds.filter(w=>isWithd(w.status));
  const totalWd=paidWds.reduce((a,w)=>a+((w.amount||0)/100),0);
  const wdA=paidWds.filter(w=>w._gateway==='anubis').reduce((a,w)=>a+((w.amount||0)/100),0);
  const wdB=paidWds.filter(w=>w._gateway==='umbrella').reduce((a,w)=>a+((w.amount||0)/100),0);
  // alimenta cards da página Saques
  set('wdTotalLbl',  brl(totalWd));
  set('wdCountLbl',  wds.length+' saques');
  set('wdAnubisLbl', brl(wdA));
  set('wdBlackLbl',  brl(wdB));
  if(!wds.length){ body.innerHTML=`<tr><td colspan="4"><div class="empty-state">Nenhum saque no período.</div></td></tr>`; return; }
  body.innerHTML=wds.map(w=>{
    const gross=(w.amount||0)/100, net=(w.netAmount||w.amount||0)/100, isA=w._gateway==='anubis', ok=isWithd(w.status);
    const amt = gross;
    return `<tr>
      <td><div class="td-desc"><div class="tx-icon ${isA?'':'purple'}">🏦</div>
        <div><div class="tx-name">${w.bankName||'Banco'}</div><div class="tx-sub">${w.id?'#'+String(w.id).slice(-8):'—'}</div>
        <div class="tx-gw" style="color:${isA?'var(--anubis)':'var(--umbrella)'}">${isA?'AnubisPay':'UmbrelaPag'}</div></div></div></td>
      <td class="col-date" style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ink2)">${fmtDt(w.createdAt)}</td>
      <td><span class="badge ${ok?'bg':'by'}">${ok?'Realizado':'Pendente'}</span></td>
      <td style="text-align:right"><span class="amount pos">+ ${brl(amt)}</span></td>
    </tr>`;
  }).join('');
}

/* ── Chart ────────────────────────────────────────────────── */
function renderChart(){
  const wrap=document.getElementById('chartWrap'); if(!wrap) return;
  const data=S.historico.slice(-6);
  const mx=Math.max(...data.map(d=>Math.max(d.b,d.meta||0)),1);
  wrap.innerHTML=data.map(d=>{
    const bH=Math.max(Math.round((d.b/mx)*90),d.b>0?3:0);
    const lH=d.l>0?Math.max(Math.round((d.l/mx)*90),3):0;
    const mH=d.meta>0?Math.max(Math.round((d.meta/mx)*90),2):0;
    const sH=(d.saques||0)>0?Math.max(Math.round(((d.saques||0)/mx)*90),3):0;
    const bateu=d.meta>0&&d.b>=d.meta;
    return `<div class="c-col">
      <div class="c-bars">
        <div class="cbar g${bateu?' cbar-batida':''}" style="height:${bH}px" title="Fat: ${brlS(d.b)}"></div>
        <div class="cbar b" style="height:${lH}px" title="Lucro: ${brlS(d.l)}"></div>
        ${sH?`<div class="cbar s" style="height:${sH}px" title="Saques: ${brlS(d.saques||0)}"></div>`:''}
        ${mH?`<div class="cbar meta-bar" style="height:${mH}px" title="Meta: ${brlS(d.meta)}"></div>`:''}
      </div><span class="c-lbl">${d.mes}</span>
    </div>`;
  }).join('');
}

/* ── Metas ────────────────────────────────────────────────── */
function getMetaMes(key){ return S.metas[key]||0; }
function setMetaMes(key,val){ S.metas[key]=val; const h=S.historico.find(h=>h.key===key); if(h) h.meta=val; persist(); }

function renderMeta(brutoAtual){
  const today=new Date(),ck=curMesKey(),meta=getMetaMes(ck);
  const card=document.getElementById('metaCard'); if(!card) return;
  if(!meta){ card.innerHTML=`<div class="meta-empty"><div class="meta-empty-txt">Nenhuma meta para <strong>${mesLabel(ck)}</strong></div><button class="meta-def-btn" onclick="openModalMeta()">+ Definir meta do mês</button></div>`; return; }
  const falta=Math.max(meta-brutoAtual,0),progPct=Math.min((brutoAtual/meta)*100,100),bateu=brutoAtual>=meta;
  const diasMes=new Date(today.getFullYear(),today.getMonth()+1,0).getDate(),diaAtual=today.getDate(),diasRest=diasMes-diaAtual;
  const projecao=diaAtual>0?(brutoAtual/diaAtual)*diasMes:0;
  card.innerHTML=`
    <div class="meta-top"><div><div class="meta-label">Meta de ${mesLabel(ck)}</div><div class="meta-valor">${brl(meta)}</div></div><button class="meta-edit-btn" onclick="openModalMeta()">✎</button></div>
    <div class="meta-progress-wrap"><div class="meta-progress-bar"><div class="meta-progress-fill${bateu?' meta-batida':''}" style="width:${progPct}%"></div></div><span class="meta-pct-lbl">${progPct.toFixed(1)}%</span></div>
    <div class="meta-stats">
      <div class="meta-stat"><div class="meta-stat-lbl">Faturado</div><div class="meta-stat-val green">${brlS(brutoAtual)}</div></div>
      <div class="meta-stat"><div class="meta-stat-lbl">${bateu?'Superado':'Falta'}</div><div class="meta-stat-val ${bateu?'green':'yellow'}">${bateu?'+'+brlS(brutoAtual-meta):brlS(falta)}</div></div>
      <div class="meta-stat"><div class="meta-stat-lbl">Projeção</div><div class="meta-stat-val ${projecao>=meta?'green':'red'}">${brlS(projecao)}</div></div>
      <div class="meta-stat"><div class="meta-stat-lbl">Dias rest.</div><div class="meta-stat-val blue">${diasRest}d</div></div>
    </div>${bateu?'<div class="meta-badge-batida">🏆 Meta batida! Parabéns!</div>':''}`;
}

function openModalMeta(k){ const key=k||curMesKey(), meta=getMetaMes(key); set('metaModalTitle','Meta de '+mesLabel(key)); const inp=document.getElementById('inputMeta'); if(inp) inp.value=meta||''; document.getElementById('metaKeyHidden').value=key; openModal('modalMeta'); }
function saveMeta(){ const key=document.getElementById('metaKeyHidden').value, val=parseFloat(document.getElementById('inputMeta').value)||0; if(val<=0){showErr('metaErr','Insira um valor maior que zero');return;} setMetaMes(key,val);closeModal('modalMeta'); renderMeta(calcBrutoAtual());renderHistoricoMetas();renderChart(); showToast('✓ Meta '+brl(val)+' salva','green'); }
function calcBrutoAtual(){ return S.transactions.filter(t=>isPaid(t.status)).reduce((a,t)=>a+((t.amount||0)/100),0); }
function checkMetaPrompt(){ const ck=curMesKey(); if(S.metaPromptDone===ck||getMetaMes(ck)>0){S.metaPromptDone=ck;persist();return;} S.metaPromptDone=ck;persist(); setTimeout(()=>openModal('modalMetaPrompt'),800); }
function confirmarMetaPrompt(){ closeModal('modalMetaPrompt'); openModalMeta(); }

function renderHistoricoMetas(){
  const tbody=document.getElementById('metaHistBody'); if(!tbody) return;
  const ck=curMesKey(), rows=S.historico.filter(h=>h.key<ck&&h.meta>0).slice(-8).reverse();
  if(!rows.length){ tbody.innerHTML=`<tr><td colspan="6" class="empty-td">Nenhuma meta registrada ainda.<br>Defina uma meta mensal para acompanhar seu progresso.</td></tr>`; return; }
  tbody.innerHTML=rows.map(h=>{ const bateu=h.b>=h.meta,pctVal=h.meta>0?Math.min((h.b/h.meta)*100,100):0;
    return `<tr>
      <td class="td-mono fw6">${h.mes}</td>
      <td class="td-mono">${brl(h.meta)}</td>
      <td class="td-mono" style="color:var(--green)">${brl(h.b)}</td>
      <td><div class="prog-wrap"><div class="prog-bar"><div class="prog-fill" style="width:${pctVal}%;background:${bateu?'var(--green)':'var(--yellow)'}"></div></div><span class="prog-lbl" style="color:${bateu?'var(--green)':'var(--yellow)'}">${pctVal.toFixed(0)}%</span></div></td>
      <td><span class="badge ${bateu?'bg':'by'}">${bateu?'✓ Batida':'Não batida'}</span></td>
      <td><button class="fixo-btn" onclick="openModalMeta('${h.key}')">editar</button></td>
    </tr>`;
  }).join('');
}

/* ── Chips mensais ────────────────────────────────────────── */
function openChipModal(keyOverride){ const key=keyOverride||curMesKey(), c=S.chipsHistory[key]||{val:0,qtd:0,unit:0}; set('chipModalTitle','Chips — '+mesLabel(key)); document.getElementById('chipKeyHidden').value=key; document.getElementById('chipQtd').value=c.qtd||''; document.getElementById('chipUnit').value=c.unit||''; document.getElementById('chipTotal').value=c.val||''; openModal('modalChip'); }
function saveChip(){ const key=document.getElementById('chipKeyHidden').value, qtd=parseInt(document.getElementById('chipQtd').value)||0, unit=parseFloat(document.getElementById('chipUnit').value)||0, total=parseFloat(document.getElementById('chipTotal').value)||0, val=total>0?total:qtd*unit; if(val<=0){showErr('chipErr','Insira qtd × valor ou total');return;} setChipMes(key,{val,qtd,unit}); closeModal('modalChip'); if(S.transactions.length) calc(S.transactions,S.withdrawals,'',''); else updateFixosDisplay(); renderChipHistorico(); showToast('✓ Chips '+mesLabel(key)+' — '+brl(val),'green'); }

function zerarChip(){ const key=document.getElementById('chipKeyHidden').value; setChipMes(key,{val:0,qtd:0,unit:0}); closeModal('modalChip'); if(S.transactions.length) calc(S.transactions,S.withdrawals,'',''); else updateFixosDisplay(); renderChipHistorico(); showToast('Chips zerados','yellow'); }
function confirmarChipPrompt(){ closeModal('modalChipPrompt'); openChipModal(); }

function renderChipHistorico(){
  const tbody=document.getElementById('chipHistBody'); if(!tbody) return;
  const ck=curMesKey(), rows=S.historico.slice(-8).reverse();
  // atualiza card resumo do mês atual na página chips
  const cAtual=S.chipsHistory[ck]||{val:0,qtd:0,unit:0};
  set('chipMesAtualLabel', mesLabel(ck));
  set('chipMesAtualVal',   cAtual.val>0 ? '− '+brl(cAtual.val) : '— Não registrado');
  set('chipMesAtualNote',  cAtual.qtd ? cAtual.qtd+' chips × '+brl(cAtual.unit||0)+'/chip' : 'Clique em "Registrar / Editar" para adicionar');
  if(!rows.length){ tbody.innerHTML=`<tr><td colspan="5" class="empty-td">Nenhum registro de chips ainda.<br>Registre os chips do mês atual para começar.</td></tr>`; return; }
  tbody.innerHTML=rows.map(h=>{
    const c=S.chipsHistory[h.key]||{val:0,qtd:0,unit:0}, isAtual=h.key===ck;
    return `<tr>
      <td class="td-mono fw6">${h.mes}${isAtual?' <span class="badge bb" style="font-size:9px;margin-left:4px">Atual</span>':''}</td>
      <td class="td-mono">${c.qtd||'—'}</td>
      <td class="td-mono">${c.unit>0?brl(c.unit):'—'}</td>
      <td class="td-mono" style="color:var(--red)">${c.val>0?'− '+brl(c.val):'—'}</td>
      <td><button class="fixo-btn" onclick="openChipModal('${h.key}')">editar</button></td>
    </tr>`;
  }).join('');
}

/* ── Fixos func/cont ──────────────────────────────────────── */
function updateFixosDisplay(){
  const ck=curMesKey(),c=S.chipsHistory[ck]||{val:0,qtd:0,unit:0};
  set('valChip','− '+brl(c.val||0)); set('noteChip',c.qtd?c.qtd+' chips × '+brl(c.unit||0)+'/chip':mesLabel(ck));
  set('valFunc','− '+brl(S.fixos.func.val)); set('noteFunc',S.fixos.func.qtd+' funcionário(s)');
  const fE=totalEscritorio(), fAq=totalAquisicoes();
  set('valCont','− '+brl(S.fixos.cont.val));
  set('valEscritorio','− '+brl(fE)); set('noteEscritorio',(S.fixos.escritorio||[]).length+' item(s)');
  set('valAquisicoes','− '+brl(fAq)); set('noteAquisicoes',(S.fixos.aquisicoes||[]).length+' item(s)');
  set('valFixosTotal',brl((c.val||0)+S.fixos.func.val+S.fixos.cont.val+fE+fAq));
}
let curFixo='';
function openFixoModal(type){ curFixo=type; const titles={func:'Funcionário(s)',cont:'Contador'}; set('fixoTitle','Editar — '+titles[type]); let html=''; if(type==='func') html=`<div class="form-group"><label class="form-label">Número de Funcionários</label><input class="form-input" type="number" id="fiQtd" value="${S.fixos.func.qtd}" placeholder="Ex: 2"></div><div class="form-group"><label class="form-label">Custo Total (R$/mês)</label><input class="form-input" type="number" id="fiTotal" step="0.01" value="${S.fixos.func.val||''}" placeholder="Ex: 4000.00"></div>`; else html=`<div class="form-group"><label class="form-label">Honorários do Contador (R$/mês)</label><input class="form-input" type="number" id="fiTotal" step="0.01" value="${S.fixos.cont.val||''}" placeholder="Ex: 600.00"></div>`; document.getElementById('fixoBody').innerHTML=html; openModal('modalFixo'); }
function saveFixo(){ const qtd=parseInt(document.getElementById('fiQtd')?.value)||0, tot=parseFloat(document.getElementById('fiTotal')?.value)||0; if(curFixo==='func'){S.fixos.func.qtd=qtd;S.fixos.func.val=tot;} else{S.fixos.cont.val=tot;} persist(); closeModal('modalFixo'); if(S.transactions.length) calc(S.transactions,S.withdrawals,'',''); else updateFixosDisplay(); showToast('✓ Custo salvo','green'); }

/* ── API Keys ─────────────────────────────────────────────── */
function saveApiKeyAnubis(){
  const k = document.getElementById('inputApiAnubis').value.trim();
  if(!k){ showErr('apiErrAnubis','Insira a API Key'); return; }
  S.keys.anubis = k;
  persist();
  closeModal('modalApiAnubis');
  updateApiStatus();
  syncData();
}
function saveApiUmbrella(){
  const k = document.getElementById('inputApiUmbrella').value.trim();
  if(!k){ showErr('apiErrUmbrella','Insira a API Key'); return; }
  S.keys.umbrella = k;
  persist();
  closeModal('modalApiUmbrella');
  updateApiStatus();
  syncData();
}
function updateApiStatus(){
  const conn=(dotId,txtId,pillId,on,label,cls)=>{ document.getElementById(dotId)?.classList.toggle(cls,on); const t=document.getElementById(txtId);if(t)t.textContent=label+(on?' ✓':''); document.getElementById(pillId)?.classList.toggle('connected',on); };
  conn('apiDotAnubis','apiTxtAnubis','pillAnubis',!!S.keys.anubis,'AnubisPay','on-green');
  conn('apiDotUmbrella','apiTxtUmbrella','pillUmbrella',!!S.keys.umbrella,'UmbrelaPag','on-purple');
  const btn=document.getElementById('btnSync'); if(btn) btn.disabled=!S.keys.anubis&&!S.keys.umbrella;
}

/* ── Taxas por gateway ────────────────────────────────────── */
function openTaxasModal(gw){
  const target=gw||'anubis';
  // ativa tab
  document.querySelectorAll('.taxa-tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('taxaTab'+target.charAt(0).toUpperCase()+target.slice(1))?.classList.add('active');
  document.querySelectorAll('.taxa-panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('taxaPanel'+target.charAt(0).toUpperCase()+target.slice(1))?.classList.add('active');
  // preenche campos
  ['anubis','umbrella'].forEach(g=>{
    const t=S.taxasGw[g]||{pct:0,fixo:0,retencao:0,taxaSaque:0};
    document.getElementById(`tp_${g}_pct`)      && (document.getElementById(`tp_${g}_pct`).value=t.pct);
    document.getElementById(`tp_${g}_fixo`)     && (document.getElementById(`tp_${g}_fixo`).value=t.fixo);
    document.getElementById(`tp_${g}_retencao`) && (document.getElementById(`tp_${g}_retencao`).value=t.retencao);
    document.getElementById(`tp_${g}_saque`)    && (document.getElementById(`tp_${g}_saque`).value=t.taxaSaque);
  });
  openModal('modalTaxa');
}
function switchTaxaTab(gw){
  document.querySelectorAll('.taxa-tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('taxaTab'+gw.charAt(0).toUpperCase()+gw.slice(1))?.classList.add('active');
  document.querySelectorAll('.taxa-panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('taxaPanel'+gw.charAt(0).toUpperCase()+gw.slice(1))?.classList.add('active');
}
function saveTaxas(){
  ['anubis','umbrella'].forEach(g=>{
    if(!S.taxasGw[g]) S.taxasGw[g]={pct:0,fixo:0,retencao:0,taxaSaque:0};
    S.taxasGw[g].pct      =parseFloat(document.getElementById(`tp_${g}_pct`)?.value)||0;
    S.taxasGw[g].fixo     =parseFloat(document.getElementById(`tp_${g}_fixo`)?.value)||0;
    S.taxasGw[g].retencao =parseFloat(document.getElementById(`tp_${g}_retencao`)?.value)||0;
    S.taxasGw[g].taxaSaque=parseFloat(document.getElementById(`tp_${g}_saque`)?.value)||0;
  });
  persist(); closeModal('modalTaxa');
  if(S.transactions.length) calc(S.transactions,S.withdrawals,'','');
  showToast('✓ Taxas salvas','green');
}

/* ── Roteamento de páginas ────────────────────────────────── */
const PAGE_TITLES = {
  resultado:  'Resultado Financeiro',
  transacoes: 'Transações PIX',
  saques:     'Saques',
  metas:      'Metas',
  chips:      'Chips',
  escritorio: 'Gastos de Escritório'
};
const PAGE_BREADCRUMBS = {
  resultado:  'Resultado',
  transacoes: 'Transações',
  saques:     'Saques',
  metas:      'Metas',
  chips:      'Chips',
  escritorio: 'Escritório'
};

let currentPage = 'resultado';



/* ── Browser Notifications ──────────────────────────────── */
let _knownTxIds = new Set();

const PUSH_SERVER  = 'https://bigcompany.shop/push-proxy.php';
const VAPID_PUBLIC = 'BDm_AABF01xcVAphGRFx8eIaZqvRYVgMsQ0ghF6nGuQOwSrMt_uhnR7S-PqpDLrR_aLbCDebfsJI4OxeYLTSFfE';

function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function subscribePush(reg){
  try{
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC)
    });
    await fetch(PUSH_SERVER + '/subscribe', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(sub)
    });
    console.log('[Push] Inscrito com sucesso');
  } catch(e) {
    console.warn('[Push] Erro ao inscrever:', e);
  }
}

function initNotifications(){
  if(!('Notification' in window) || !('serviceWorker' in navigator)) return;
  if(Notification.permission === 'default'){
    setTimeout(()=>{
      const banner = document.createElement('div');
      banner.id = 'notifBanner';
      banner.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#0d2137;border:1px solid rgba(0,255,135,.3);border-radius:12px;padding:14px 18px;z-index:9999;display:flex;align-items:center;gap:12px;font-family:var(--font-ui);font-size:12px;color:#fff;box-shadow:0 4px 24px rgba(0,0,0,.4);';
      banner.innerHTML = '<span style="color:#00ff87;font-size:18px;">🔔</span><span>Ativar notificações de vendas?</span><button onclick="enableNotifications()" style="background:#00ff87;color:#000;border:none;border-radius:6px;padding:5px 12px;font-weight:700;cursor:pointer;font-size:11px;">Ativar</button><button onclick="this.parentNode.remove()" style="background:transparent;border:none;color:#666;cursor:pointer;font-size:16px;">✕</button>';
      document.body.appendChild(banner);
    }, 2000);
  } else if(Notification.permission === 'granted'){
    navigator.serviceWorker.ready.then(subscribePush);
  }
}

function enableNotifications(){
  Notification.requestPermission().then(async p=>{
    const banner = document.getElementById('notifBanner');
    if(banner) banner.remove();
    if(p === 'granted'){
      const reg = await navigator.serviceWorker.ready;
      await subscribePush(reg);
      showToast('Notificações ativadas!','green');
    } else {
      showToast('Permissão negada','yellow');
    }
  });
}

function notifyTx(tx){
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  const isPaid = tx.status === 'PAID' || tx.status === 'AUTHORIZED';
  const title  = isPaid ? 'VENDA APROVADA' : 'VENDA GERADA';
  const valor  = brl((tx.amount||0)/100);
  const body   = `Venda >> ${valor}`;
  const iconUrl = 'https://ronald-almeida.github.io/bigutm/logo.png';
  new Notification(title, { body, icon: iconUrl, badge: iconUrl });
}

function checkNewTransactions(newTxs){
  if(!newTxs.length) return;
  // Primeira carga — apenas popula o set sem notificar
  if(_knownTxIds.size === 0){
    newTxs.forEach(tx => _knownTxIds.add(tx.id));
    return;
  }
  newTxs.forEach(tx => {
    if(!_knownTxIds.has(tx.id)){
      _knownTxIds.add(tx.id);
      if(tx.status === 'PAID' || tx.status === 'AUTHORIZED' || tx.status === 'WAITING_PAYMENT'){
        notifyTx(tx);
      }
    }
  });
}





/* ── Recuperação de Vendas ──────────────────────────────── */
let _recPage = 1;
const REC_PER_PAGE = 20;
let _recMinTime = 30;
let _recStatus = 'todos';
let _recValor = 0;

function getLeadsFromTx(){
  const minMinutes = _recMinTime;
  const now = Date.now();
  const isMonth = (document.getElementById('recMinTime')?.value === 'month');
  let startOfMonth = 0, endOfMonth = Infinity;
  if(isMonth){
    const d = new Date();
    startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    endOfMonth   = new Date(d.getFullYear(), d.getMonth()+1, 0, 23, 59, 59, 999).getTime();
  }
  const window = minMinutes * 60 * 1000;
  const seen = new Set();
  return S.transactions
    .filter(tx => {
      if(tx.status !== 'WAITING_PAYMENT') return false;
      const txTime = new Date(tx.createdAt).getTime();
      if(isMonth){
        if(txTime < startOfMonth || txTime > endOfMonth) return false;
      } else {
        const age = now - txTime;
        if(age > window) return false;
      }
      if(seen.has(tx.id)) return false;
      seen.add(tx.id);
      return true;
    })
    .map(tx => {
      const lead = S.recLeads[tx.id] || {};
      return {
        id:        tx.id,
        nome:      tx.customer?.name     || 'Desconhecido',
        email:     tx.customer?.email    || '',
        phone:     tx.customer?.phone    || '',
        document:  tx.customer?.document || '',
        valor:     (tx.amount || 0) / 100,
        createdAt: tx.createdAt,
        status:    lead.status || 'pendente',
        acionado:  lead.acionado || false,
        gateway:   tx._gateway
      };
    });
}

function renderRecuperacao(){
  const leads = getLeadsFromTx();
  // Lê filtros dos elementos se existirem, senão usa estado
  const selTime = document.getElementById('recMinTime');
  const selStatus = document.getElementById('recFiltroStatus');
  const inpValor = document.getElementById('recFiltroValor');
  if(selTime)   _recMinTime  = selTime.value === 'month' ? 'month' : (parseInt(selTime.value) || 720);
  if(selStatus) _recStatus   = selStatus.value           || 'todos';
  if(inpValor)  _recValor    = parseFloat(inpValor.value)||0;
  const filtroStatus = _recStatus;
  const filtroValor  = _recValor;

  // Restore copy
  const copyEl = document.getElementById('recCopy');
  if(copyEl && S.recCopy) copyEl.value = S.recCopy;

  let filtered = leads;
  if(filtroStatus !== 'todos') filtered = filtered.filter(l => l.status === filtroStatus);
  if(filtroValor > 0)          filtered = filtered.filter(l => l.valor >= filtroValor);

  // Stats
  const pendentes   = leads.filter(l=>l.status==='pendente');
  const recuperados = leads.filter(l=>l.status==='recuperado');
  const ignorados   = leads.filter(l=>l.status==='ignorado');
  const valAberto   = pendentes.reduce((a,l)=>a+l.valor,0);
  set('recTotalLeads',     leads.length);
  set('recValorAberto',    brlS(valAberto));
  set('recTotalRecuperados', recuperados.length);
  set('recTotalIgnorados',  ignorados.length);

  // Paginação
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / REC_PER_PAGE));
  if(_recPage > pages) _recPage = 1;
  const slice = filtered.slice((_recPage-1)*REC_PER_PAGE, _recPage*REC_PER_PAGE);

  const tbody = document.getElementById('recBody');
  if(!tbody) return;

  if(!slice.length){
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">Nenhum lead encontrado com os filtros selecionados.</div></td></tr>`;
  } else {
    tbody.innerHTML = slice.map(lead => {
      const statusColor = lead.status==='recuperado' ? '#00ff87' : lead.status==='ignorado' ? '#4a5568' : '#f6c90e';
      const statusLabel = lead.status==='recuperado' ? '✓ Recuperado' : lead.status==='ignorado' ? '✗ Ignorado' : '⏳ Pendente';
      const phoneClean = (lead.phone||'').replace(/\D/g,'');
      const hasPhone = phoneClean.length >= 10;
      const acionadoBadge = lead.acionado ? '<span style="font-size:9px;color:#00ff87;margin-left:4px;">✓ acionado</span>' : '';
      return `<tr>
        <td>
          <div style="font-weight:500;color:#fff;">${lead.nome}</div>
          <div style="font-size:10px;color:var(--t3);">${lead.document ? maskDoc(lead.document) : '—'}</div>
        </td>
        <td>
          <div style="font-size:11px;">${lead.phone || '—'}${acionadoBadge}</div>
          <div style="font-size:10px;color:var(--t3);">${lead.email || '—'}</div>
        </td>
        <td style="color:#f6c90e;font-weight:600;">R$ ${brl(lead.valor)}</td>
        <td style="font-size:11px;">${fmtDt(lead.createdAt)}</td>
        <td><span style="color:${statusColor};font-size:11px;font-weight:600;">${statusLabel}</span></td>
        <td>
          <div style="display:flex;gap:5px;flex-wrap:wrap;">
            ${hasPhone ? `<button class="btn-save" style="font-size:9px;padding:4px 8px;background:rgba(0,200,100,.15);border-color:rgba(0,200,100,.3);" onclick="enviarWhatsApp('${lead.id}')">WhatsApp</button>` : ''}
            <button class="fixo-btn" style="font-size:9px;" onclick="setLeadStatus('${lead.id}','recuperado')">Recuperado</button>
            <button class="fixo-btn" style="font-size:9px;color:var(--t3);" onclick="setLeadStatus('${lead.id}','ignorado')">Ignorar</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  // Render paginação
  const pag = document.getElementById('recPaginacao');
  if(pag){
    pag.innerHTML = pages <= 1 ? '' : Array.from({length:pages},(_,i)=>
      `<button class="fixo-btn" style="font-size:10px;${i+1===_recPage?'color:#00ff87;border-color:#00ff87;':''}" onclick="_recPage=${i+1};renderRecuperacao()">${i+1}</button>`
    ).join('');
  }
}

function maskDoc(doc){
  const d = doc.replace(/\D/g,'');
  if(d.length===11) return d.slice(0,3)+'.***.***-'+d.slice(9);
  return doc.slice(0,4)+'****'+doc.slice(-2);
}

function buildCopy(lead){
  const copy = document.getElementById('recCopy')?.value || S.recCopy || '';
  return copy
    .replace(/{nome}/g,     lead.nome   || '')
    .replace(/{cpf}/g,      lead.document || '')
    .replace(/{telefone}/g, lead.phone   || '')
    .replace(/{valor}/g,    brl(lead.valor))
    .replace(/{data}/g,     fmtDt(lead.createdAt));
}

function enviarWhatsApp(id){
  const leads = getLeadsFromTx();
  const lead = leads.find(l=>l.id===id);
  if(!lead) return;
  const phoneClean = lead.phone.replace(/\D/g,'');
  const phone = phoneClean.startsWith('55') ? phoneClean : '55'+phoneClean;
  const msg = buildCopy(lead);
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  // Marca como acionado
  if(!S.recLeads[id]) S.recLeads[id] = {};
  S.recLeads[id].acionado = true;
  persist();
  window.open(url, '_blank');
  renderRecuperacao();
}

function setLeadStatus(id, status){
  if(!S.recLeads[id]) S.recLeads[id] = {};
  S.recLeads[id].status = status;
  persist();
  renderRecuperacao();
  showToast(status==='recuperado'?'✓ Marcado como recuperado':'Lead ignorado', status==='recuperado'?'green':'yellow');
}

function salvarCopyRec(){
  S.recCopy = document.getElementById('recCopy')?.value || '';
  persist();
  showToast('Copy salva','green');
}

function exportarLeadsCSV(){
  const leads = getLeadsFromTx();
  const header = 'Nome,CPF,Telefone,Email,Valor,Data,Status,Acionado';
  const rows = leads.map(l =>
    [l.nome, l.document, l.phone, l.email, brl(l.valor), fmtDt(l.createdAt), l.status, l.acionado?'Sim':'Não']
    .map(v => `"${(v||'').replace(/"/g,'""')}"`)
    .join(',')
  );
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'leads_recuperacao.csv';
  a.click(); URL.revokeObjectURL(url);
  showToast('CSV exportado','green');
}

/* ── Disparos ───────────────────────────────────────────── */
const MESES_LABEL = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function disparosMesAtual(){
  const now = new Date();
  return now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
}

function renderDisparosMesSel(){
  const sel = document.getElementById('disparosMesSel');
  if(!sel) return;
  // Coleta meses únicos dos registros + mês atual
  const meses = new Set(S.disparos.map(d=>d.data.slice(0,7)));
  meses.add(disparosMesAtual());
  const sorted = Array.from(meses).sort((a,b)=>b.localeCompare(a));
  sel.innerHTML = sorted.map(m=>{
    const [y,mo] = m.split('-');
    return `<option value="${m}">${MESES_LABEL[parseInt(mo)-1]} ${y}</option>`;
  }).join('');
}

function renderDisparos(){
  renderDisparosMesSel();
  const sel = document.getElementById('disparosMesSel');
  const mes = sel ? sel.value : disparosMesAtual();
  const [y,mo] = mes.split('-');
  const mesNome = MESES_LABEL[parseInt(mo)-1] + ' ' + y;

  const registros = S.disparos.filter(d=>d.data.startsWith(mes)).sort((a,b)=>b.data.localeCompare(a.data));
  const total = registros.reduce((a,d)=>a+(d.qtd||0),0);

  set('disparosTotalMes', total.toLocaleString('pt-BR'));
  set('disparosMesLabel', mesNome + ' — ' + registros.length + ' registro(s)');

  const tbody = document.getElementById('disparosBody');
  if(!tbody) return;
  if(!registros.length){
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state">Nenhum disparo registrado para ${mesNome}.</div></td></tr>`;
    return;
  }
  tbody.innerHTML = registros.map((item,i)=>{
    const [ay,am,ad] = item.data.split('-');
    const dataFmt = `${MESES_LABEL[parseInt(am)-1]} — dia ${parseInt(ad)}`;
    return `<tr>
      <td>${dataFmt}</td>
      <td style="color:#00ff87;font-weight:600;">${item.qtd.toLocaleString('pt-BR')} enviadas</td>
      <td style="color:var(--t3);font-size:11px;">${item.obs||'—'}</td>
      <td><button class="fixo-btn" style="color:var(--red);border-color:var(--red);" onclick="removeDisparo('${item._id}')">remover</button></td>
    </tr>`;
  }).join('');
}

function openAddDisparo(){
  const now = new Date();
  document.getElementById('disparoData').value = now.toISOString().slice(0,10);
  document.getElementById('disparoQtd').value = '';
  document.getElementById('disparoObs').value = '';
  showErr('disparoErr','');
  openModal('modalAddDisparo');
}

function saveDisparo(){
  const data = document.getElementById('disparoData').value;
  const qtd  = parseInt(document.getElementById('disparoQtd').value)||0;
  const obs  = document.getElementById('disparoObs').value.trim();
  if(!data){ showErr('disparoErr','Selecione a data'); return; }
  if(qtd<=0){ showErr('disparoErr','Insira uma quantidade maior que zero'); return; }
  const _id = Date.now().toString();
  S.disparos.push({ _id, data, qtd, obs });
  persist();
  closeModal('modalAddDisparo');
  renderDisparos();
  showToast('Disparo registrado','green');
}

function removeDisparo(id){
  S.disparos = S.disparos.filter(d=>d._id!==id);
  persist();
  renderDisparos();
  showToast('Registro removido','yellow');
}

/* ── 2FA ────────────────────────────────────────────────── */
function render2FA(){
  const grid = document.getElementById('tfaGrid');
  if(!grid) return;
  if(!S.tfa.length){
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">Nenhum código cadastrado.<br>Clique em "+ Adicionar" para começar.</div>`;
    return;
  }
  grid.innerHTML = S.tfa.map((item,i) => `
    <div style="background:var(--glass2);border:1px solid var(--b2);border-radius:14px;padding:16px 18px;">
      <div style="font-size:10px;color:rgba(255,255,255,.45);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;">${item.nome}</div>
      <div style="font-family:var(--font-mono);font-size:13px;color:#fff;word-break:break-all;margin-bottom:12px;">${item.codigo}</div>
      <div style="display:flex;gap:8px;">
        <button class="btn-save" style="flex:1;font-size:10px;padding:6px;" onclick="copiar2FA(${i})">Copiar</button>
        <button class="fixo-btn" style="color:var(--red);border-color:var(--red);" onclick="remove2FA(${i})">remover</button>
      </div>
    </div>`).join('');
}

function openAdd2FA(){
  document.getElementById('tfaNome').value='';
  document.getElementById('tfaCodigo').value='';
  document.getElementById('tfaEditIdx').value='';
  showErr('tfaErr','');
  openModal('modalAdd2FA');
}

function save2FA(){
  const nome   = document.getElementById('tfaNome').value.trim();
  const codigo = document.getElementById('tfaCodigo').value.trim();
  if(!nome)  { showErr('tfaErr','Insira um nome'); return; }
  if(!codigo){ showErr('tfaErr','Insira o código'); return; }
  S.tfa.push({ nome, codigo });
  persist();
  closeModal('modalAdd2FA');
  render2FA();
  showToast('Código 2FA salvo','green');
}

function remove2FA(i){
  S.tfa.splice(i,1);
  persist();
  render2FA();
  showToast('Código removido','yellow');
}

function copiar2FA(i){
  const codigo = S.tfa[i].codigo;
  navigator.clipboard.writeText(codigo).then(()=>{
    showToast('Código copiado!','green');
  }).catch(()=>{
    // fallback
    const el = document.createElement('textarea');
    el.value = codigo;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showToast('Código copiado!','green');
  });
}

/* ── Impostos ───────────────────────────────────────────── */
function renderImpostos(){
  // Simulador
  const fat = calcBrutoAtual ? calcBrutoAtual() : 0;
  const el = document.getElementById('impFaturamento');
  if(el) el.textContent = 'R$ ' + brl(fat);
  calcSimuladorImposto();

  // Tabela
  const tbody = document.getElementById('impostosBody');
  if(!tbody) return;
  if(!S.impostos.length){
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">Nenhum imposto registrado.<br>Clique em "+ Adicionar" para começar.</div></td></tr>`;
    return;
  }
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  tbody.innerHTML = S.impostos
    .slice().sort((a,b)=>b.mes.localeCompare(a.mes))
    .map((item,i)=>{
      const [ano,m] = item.mes.split('-');
      const mesNome = meses[parseInt(m)-1] + ' ' + ano;
      const badge = item.status === 'pago'
        ? `<span style="color:#00ff87;font-weight:600;">✓ Pago</span>`
        : `<span style="color:#f6c90e;font-weight:600;">⏳ Pendente</span>`;
      return `<tr>
        <td>${mesNome}</td>
        <td class="amount neg">${brl(item.val)}</td>
        <td>${badge}</td>
        <td style="color:var(--t3);font-size:11px;">${item.obs||'—'}</td>
        <td style="display:flex;gap:6px;">
          <button class="fixo-btn" onclick="toggleImpostoStatus(${S.impostos.indexOf(item)})">${item.status==='pago'?'Reabrir':'Marcar pago'}</button>
          <button class="fixo-btn" style="color:var(--red);border-color:var(--red);" onclick="removeImposto(${S.impostos.indexOf(item)})">remover</button>
        </td>
      </tr>`;
    }).join('');
}

function calcSimuladorImposto(){
  const aliquota = parseFloat(document.getElementById('impAliquota')?.value)||0;
  const fat = calcBrutoAtual ? calcBrutoAtual() : 0;
  const estimado = fat * (aliquota/100);
  const el = document.getElementById('impEstimado');
  if(el) el.textContent = 'R$ ' + brl(estimado);
  const elFat = document.getElementById('impFaturamento');
  if(elFat) elFat.textContent = 'R$ ' + brl(fat);
}

function openAddImposto(){
  const now = new Date();
  const mes = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  document.getElementById('impostoMes').value = mes;
  document.getElementById('impostoVal').value = '';
  document.getElementById('impostoStatus').value = 'pendente';
  document.getElementById('impostoObs').value = '';
  document.getElementById('impostoEditIdx').value = '';
  showErr('impostoErr','');
  openModal('modalAddImposto');
}

function saveImposto(){
  const mes = document.getElementById('impostoMes').value;
  const val = parseFloat(document.getElementById('impostoVal').value)||0;
  const status = document.getElementById('impostoStatus').value;
  const obs = document.getElementById('impostoObs').value.trim();
  if(!mes){ showErr('impostoErr','Selecione o mês'); return; }
  if(val<=0){ showErr('impostoErr','Insira um valor maior que zero'); return; }
  S.impostos.push({ mes, val, status, obs });
  persist();
  closeModal('modalAddImposto');
  renderImpostos();
  showToast('Imposto salvo','green');
}

function removeImposto(i){
  S.impostos.splice(i,1);
  persist();
  renderImpostos();
  showToast('Imposto removido','yellow');
}

function toggleImpostoStatus(i){
  S.impostos[i].status = S.impostos[i].status === 'pago' ? 'pendente' : 'pago';
  persist();
  renderImpostos();
  showToast(S.impostos[i].status === 'pago' ? 'Marcado como pago' : 'Reaberto','green');
}

/* ── Aquisições ─────────────────────────────────────────── */
function renderAquisicoes(){
  const tbody = document.getElementById('aqBody');
  if(!tbody) return;
  const total = totalAquisicoes();
  set('aqTotal', brlS(total));
  set('aqCount', S.fixos.aquisicoes.length + ' item(s)');
  if(!S.fixos.aquisicoes.length){
    tbody.innerHTML=`<tr><td colspan="4"><div class="empty-state">Nenhuma aquisição cadastrada.<br>Clique em "+ Adicionar" para começar.</div></td></tr>`;
    return;
  }
  const catLabel = { celular:'Celular', hospedagem:'Hospedagem', vpn:'VPN', proxy:'Proxy', outro:'Outro' };
  tbody.innerHTML = S.fixos.aquisicoes.map((item,i)=>`
    <tr>
      <td>${item.desc}</td>
      <td><span class="badge">${catLabel[item.cat]||item.cat}</span></td>
      <td class="amount neg">${brl(item.val)}</td>
      <td><button class="fixo-btn" onclick="removeAq(${i})">remover</button></td>
    </tr>`).join('');
}

function openAddAq(){
  document.getElementById('aqDesc').value='';
  document.getElementById('aqVal').value='';
  document.getElementById('aqCat').value='celular';
  document.getElementById('aqEditId').value='';
  showErr('aqErr','');
  openModal('modalAddAq');
}

function saveAq(){
  const desc = document.getElementById('aqDesc').value.trim();
  const val  = parseFloat(document.getElementById('aqVal').value)||0;
  const cat  = document.getElementById('aqCat').value;
  if(!desc){ showErr('aqErr','Insira uma descrição'); return; }
  if(val<=0){ showErr('aqErr','Insira um valor maior que zero'); return; }
  S.fixos.aquisicoes.push({ desc, cat, val });
  persist();
  closeModal('modalAddAq');
  renderAquisicoes();
  if(S.transactions.length) calc(S.transactions,S.withdrawals,'',''); else updateFixosDisplay();
  showToast('Aquisição salva','green');
}

function removeAq(i){
  S.fixos.aquisicoes.splice(i,1);
  persist();
  renderAquisicoes();
  if(S.transactions.length) calc(S.transactions,S.withdrawals,'',''); else updateFixosDisplay();
  showToast('Aquisição removida','yellow');
}

function goPage(id){
  // esconde todas as páginas
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  // mostra a página alvo
  const target = document.getElementById('page-'+id);
  if(target) target.classList.add('active');

  // atualiza nav items
  document.querySelectorAll('.nav-item[data-page]').forEach(n => {
    n.classList.toggle('active', n.dataset.page === id);
  });

  // atualiza títulos
  set('pageTitle',    PAGE_TITLES[id]     || id);
  set('breadcrumb',   PAGE_BREADCRUMBS[id]|| id);

  currentPage = id;
  closeSidebar();
  if(id === 'metas')      renderHistoricoMetas();
  if(id === 'chips')      renderChipHistorico();
  if(id === 'escritorio') renderEscritorio();

  // scroll to top
  document.querySelector('.main')?.scrollTo(0, 0);
}

/* ── Mobile sidebar ───────────────────────────────────────── */
function toggleSidebar(){ document.querySelector('.sidebar')?.classList.toggle('open'); document.getElementById('sidebarOverlay')?.classList.toggle('visible'); }
function closeSidebar(){ document.querySelector('.sidebar')?.classList.remove('open'); document.getElementById('sidebarOverlay')?.classList.remove('visible'); }

/* ── Período ──────────────────────────────────────────────── */
function setPeriod(p){ const today=new Date(); let from,to=today; if(p==='today') from=new Date(today); else if(p==='week'){from=new Date(today);from.setDate(today.getDate()-7);} else if(p==='month') from=new Date(today.getFullYear(),today.getMonth(),1); else if(p==='last'){from=new Date(today.getFullYear(),today.getMonth()-1,1);to=new Date(today.getFullYear(),today.getMonth(),0);} document.getElementById('dateFrom').value=fmt(from); document.getElementById('dateTo').value=fmt(to); document.querySelectorAll('.period-btn').forEach(b=>b.classList.remove('active')); document.querySelector(`[data-period="${p}"]`)?.classList.add('active'); }

/* ── Modais / UI ──────────────────────────────────────────── */
function openModal(id){document.getElementById(id)?.classList.add('open');}
function closeModal(id){document.getElementById(id)?.classList.remove('open');}
document.addEventListener('click',e=>{ if(e.target.classList.contains('modal-bg')) e.target.classList.remove('open'); });
function setLoading(on){document.getElementById('loadingBar')?.classList.toggle('active',on);}
function setSyncBtn(sync){const b=document.getElementById('btnSync');if(!b)return;b.classList.toggle('syncing',sync);b.disabled=sync;}
function showErr(id,msg){const e=document.getElementById(id);if(!e)return;e.textContent=msg;e.style.display='block';setTimeout(()=>e.style.display='none',3500);}
function showToast(msg,type){const t=document.getElementById('toast');t.textContent=msg;t.className='toast '+type+' show';setTimeout(()=>t.classList.remove('show'),3200);}

/* ── Init ─────────────────────────────────────────────────── */

/* ══ ESCRITÓRIO ══════════════════════════════════════════ */
function renderEscritorio(){
  const tbody = document.getElementById('escrBody');
  if(!tbody) return;
  const items = S.fixos.escritorio || [];
  set('escrTotal', '− '+brl(totalEscritorio()));
  set('escrCount', items.length+' item(s)');
  if(!items.length){
    tbody.innerHTML=`<tr><td colspan="4"><div class="empty-state">Nenhum gasto cadastrado.<br>Clique em "+ Adicionar" para começar.</div></td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(item=>`
    <tr>
      <td>
        <div class="tx-name">${item.nome||'—'}</div>
        ${item.nota?`<div class="tx-sub">${item.nota}</div>`:''}
      </td>
      <td class="amount neg">− ${brl(item.val||0)}</td>
      <td><button class="fixo-btn" onclick="openEditEscr('${item.id}')">editar</button></td>
      <td><button class="fixo-btn" style="color:var(--red);border-color:rgba(248,113,113,.2)" onclick="deleteEscr('${item.id}')">remover</button></td>
    </tr>`).join('');
}

function openAddEscr(){
  set('escrModalTitle','Adicionar Gasto');
  document.getElementById('escrIdHidden').value='';
  document.getElementById('escrNome').value='';
  document.getElementById('escrVal').value='';
  document.getElementById('escrNota').value='';
  const e=document.getElementById('escrErr'); if(e){e.style.display='none';e.textContent='';}
  openModal('modalEscritorio');
  setTimeout(()=>document.getElementById('escrNome')?.focus(),100);
}

function openEditEscr(id){
  const item=(S.fixos.escritorio||[]).find(i=>i.id===id);
  if(!item) return;
  set('escrModalTitle','Editar Gasto');
  document.getElementById('escrIdHidden').value=id;
  document.getElementById('escrNome').value=item.nome||'';
  document.getElementById('escrVal').value=item.val||'';
  document.getElementById('escrNota').value=item.nota||'';
  const e=document.getElementById('escrErr'); if(e){e.style.display='none';e.textContent='';}
  openModal('modalEscritorio');
}

function saveEscr(){
  const id   = document.getElementById('escrIdHidden').value;
  const nome = document.getElementById('escrNome').value.trim();
  const val  = parseFloat(document.getElementById('escrVal').value)||0;
  const nota = document.getElementById('escrNota').value.trim();
  if(!nome){ showErr('escrErr','Insira o nome do gasto'); return; }
  if(val<=0){ showErr('escrErr','Insira um valor maior que zero'); return; }
  if(!S.fixos.escritorio) S.fixos.escritorio=[];
  if(id){
    const idx=S.fixos.escritorio.findIndex(i=>i.id===id);
    if(idx>=0) S.fixos.escritorio[idx]={id,nome,val,nota};
  } else {
    S.fixos.escritorio.push({id:nextEscrId(),nome,val,nota});
  }
  persist();
  closeModal('modalEscritorio');
  renderEscritorio();
  if(S.transactions.length) calc(S.transactions,S.withdrawals,'','');
  else updateFixosDisplay();
  showToast('✓ '+nome+' — '+brl(val),'green');
}

function deleteEscr(id){
  S.fixos.escritorio=(S.fixos.escritorio||[]).filter(i=>i.id!==id);
  persist();
  renderEscritorio();
  if(S.transactions.length) calc(S.transactions,S.withdrawals,'','');
  else updateFixosDisplay();
  showToast('Gasto removido','yellow');
}

/* ── Auth ───────────────────────────────────────────────── */
const AUTH_KEY   = 'bigutm_auth';
const AUTH_DAYS  = 60;
// Senha em hash simples (SHA-like via btoa) — troque o valor abaixo
// Senha padrão: bigutm2024 → para trocar, gere: btoa('suasenha')
const SENHA_HASH = btoa('bigutm2024');

function checkSession(){
  try{
    const raw = localStorage.getItem(AUTH_KEY);
    if(!raw) return false;
    const { hash, exp } = JSON.parse(raw);
    if(Date.now() > exp) { localStorage.removeItem(AUTH_KEY); return false; }
    return hash === SENHA_HASH;
  }catch(e){ return false; }
}

function saveSession(){
  const exp = Date.now() + (AUTH_DAYS * 24 * 60 * 60 * 1000);
  localStorage.setItem(AUTH_KEY, JSON.stringify({ hash: SENHA_HASH, exp }));
}

function checkLogin(){
  const input = document.getElementById('loginInput');
  const err   = document.getElementById('loginErr');
  if(!input) return;
  const val = input.value.trim();
  if(btoa(val) === SENHA_HASH){
    saveSession();
    showApp();
  } else {
    err.style.display = 'block';
    input.value = '';
    input.focus();
    setTimeout(()=>{ err.style.display='none'; }, 3000);
  }
}

function showApp(){
  const login = document.getElementById('loginScreen');
  const app   = document.getElementById('appLayout');
  if(login) login.style.display = 'none';
  if(app)   app.style.display   = '';
  if(window._pendingInit){ window._pendingInit=false; init(); }
}

function initAuth(){
  if(checkSession()){
    showApp();
  } else {
    const login = document.getElementById('loginScreen');
    if(login) login.style.display = 'flex';
    setTimeout(()=>{ document.getElementById('loginInput')?.focus(); }, 100);
  }
}

function init(){
  // Carrega do servidor primeiro, localStorage como fallback
  hydrateFromServer().then(raw => {
    hydrate(raw);
    const today=new Date(),first=new Date(today.getFullYear(),today.getMonth(),1);
    document.getElementById('dateFrom').value=fmt(first);
    document.getElementById('dateTo').value=fmt(today);
    if(S.keys.anubis)   document.getElementById('inputApiAnubis').value=S.keys.anubis;
    if(S.keys.umbrella) document.getElementById('inputApiUmbrella').value=S.keys.umbrella;
    updateApiStatus();
    goPage('resultado');
    renderChart(); renderTable(); renderWithdrawals(); updateFixosDisplay(); renderEscritorio(); render2FA(); renderAquisicoes(); renderImpostos(); renderDisparos();
    renderMeta(calcBrutoAtual()); renderHistoricoMetas(); renderChipHistorico();
    if(S.transactions.length) calc(S.transactions,S.withdrawals,'','');
    checkMetaPrompt(); checkChipPrompt();
    if(!S.keys.anubis&&!S.keys.umbrella) setTimeout(()=>openModal('modalApiAnubis'),600);
  initNotifications();

  // Auto-refresh a cada 2 minutos com countdown
  // Cria elemento do countdown dinamicamente
  const autoEl = document.createElement('span');
  autoEl.style.cssText = 'font-size:10px;color:#4a5568;font-family:monospace;margin-right:6px;vertical-align:middle;';
  autoEl.textContent = '60s';
  const btnSync = document.getElementById('btnSync');
  if(btnSync) btnSync.parentNode.insertBefore(autoEl, btnSync);

  let autoRefreshSecs = 60;
  setInterval(()=>{
    autoRefreshSecs--;
    autoEl.textContent = autoRefreshSecs + 's';
    if(autoRefreshSecs <= 0){
      autoRefreshSecs = 60;
      autoEl.textContent = '60s';
      if(S.keys.anubis || S.keys.umbrella) syncData();
    }
  }, 1000);
  });
}
// Aguarda todas as fontes carregarem antes de inicializar
// Evita o flash onde fontes fallback aparecem nos valores
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(init);
} else {
  init();
}
