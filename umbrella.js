/* ============================================================
   UmbrelaPag — Integration Module
   Carregado separadamente do main.js para evitar conflitos
   ============================================================ */

const UMBRELLA_BASE = 'https://api-gateway.umbrellapag.com/api';
const UMBRELLA_PROXY = (()=>{
  const base = window.location.href.replace(/\/[^\/]*$/, '');
  return base + '/proxy_umbrella.php';
})();

function umbrellaHeaders(key){
  return {
    'x-api-key':  key,
    'User-Agent': 'UMBRELLAB2B/1.0'
  };
}

function umbrellaNormTx(tx){
  const amt = tx.amount || 0;
  const fee = tx.fee?.estimatedFee || tx.fee?.fee || 0;
  return {
    id:            tx.id            || '',
    status:        (tx.status       || '').toUpperCase(),
    amount:        amt,
    netAmount:     tx.fee?.netAmount || (amt - fee),
    fees:          fee,
    paymentMethod: tx.paymentMethod || 'PIX',
    createdAt:     tx.paidAt || tx.createdAt || tx.updatedAt || '',
    customer: {
      name:  tx.customer?.name  || tx.customer?.document?.number || '',
      email: tx.customer?.email || ''
    },
    _gateway: 'umbrella'
  };
}

function umbrellaNormWd(w){
  const raw = w.amount || 0;
  return {
    id:          w.id              || '',
    amount:      raw,
    fees:        w.fee             || 0,
    netAmount:   raw - (w.fee      || 0),
    status:      (w.status         || 'COMPLETED').toUpperCase(),
    method:      'PIX',
    pixKey:      w.pixKey          || '',
    createdAt:   w.createdAt       || '',
    bankName:    w.beneficiaryName || w.pixKey || '',
    _gateway:    'umbrella'
  };
}

async function umbrellaFetch(url, headers){
  const form = new FormData();
  form.append('target_url', url);
  form.append('x_api_key',  headers['x-api-key'] || '');
  const r = await fetch(UMBRELLA_PROXY, { method: 'POST', body: form });
  if(!r.ok){
    const txt = await r.text().catch(()=>'');
    throw new Error('UmbrelaPag HTTP ' + r.status + ' — ' + txt.slice(0,120));
  }
  return r.json();
}

async function umbrellaFetchTransactions(key, from, to){
  // UmbrelaPag nao suporta filtro de data via query — retorna tudo e filtra localmente
  const p = new URLSearchParams({ limit: 100 });
  const url  = `${UMBRELLA_BASE}/user/transactions?${p}`;
  const json = await umbrellaFetch(url, umbrellaHeaders(key));
  // Response: { data: { data: [...] } } ou { data: [...] }
  const inner = json.data?.data || json.data || [];
  const rows = Array.isArray(inner) ? inner : [];
  return rows.map(tx => umbrellaNormTx(tx));
}

async function umbrellaFetchWithdrawals(key, from, to){
  let all = [], page = 1;
  while(true){
    const p = new URLSearchParams({ page, limit: 100, orderDirection: 'desc', orderBy: 'id' });
    const url  = `${UMBRELLA_BASE}/user/cashout?${p}`;
    const json = await umbrellaFetch(url, umbrellaHeaders(key));
    const inner = json.data?.data || json.data || [];
    const rows  = Array.isArray(inner) ? inner : [];
    all = all.concat(rows.map(w => umbrellaNormWd(w)));
    const totalPages = json.data?.pages || 1;
    if(page >= totalPages) break;
    page++;
    if(page > 40) break;
  }
  return all;
}
