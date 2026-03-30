<?php
/* ============================================================
   BIG UTM — sync_github.php
   Sincroniza arquivos do servidor para o GitHub automaticamente
   bigcofy.shop/bigutm/sync_github.php
   ============================================================ */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if($_SERVER['REQUEST_METHOD']==='OPTIONS'){http_response_code(204);exit;}

/* ── Configurações ── */
define('GH_OWNER',  'ronald-almeida');
define('GH_REPO',   'bigutm');
define('GH_BRANCH', 'main');
/* ── Arquivos a sincronizar ── */
$SYNC_FILES = [
  'index.html',
  'style.css',
  'main.js',
  'umbrella.js',
  'sw.js',
  'manifest.json',
  'proxy.php',
  'proxy_umbrella.php',
  'save.php',
  'push-proxy.php',
  'github_backup.php',
  'sync_github.php',
];

/* ── Helpers ── */
function loadToken(){
  try{
    require_once __DIR__ . '/db.php';
    $pdo  = dbConnect();
    $stmt = $pdo->prepare("SELECT valor FROM config WHERE chave='gh_token' LIMIT 1");
    $stmt->execute();
    $row  = $stmt->fetch();
    return $row ? trim($row['valor']) : '';
  }catch(Exception $e){ return ''; }
}

function ghGet($path){
  $token = loadToken();
  $ch = curl_init();
  curl_setopt_array($ch,[
    CURLOPT_URL            => 'https://api.github.com'.$path,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_HTTPHEADER     => [
      'Authorization: Bearer '.$token,
      'Accept: application/vnd.github+json',
      'User-Agent: BIG-UTM-Sync/1.0',
      'X-GitHub-Api-Version: 2022-11-28',
    ],
  ]);
  $resp = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  return ['code'=>$code, 'data'=>json_decode($resp,true)];
}

function ghPut($path, $payload){
  $token = loadToken();
  $ch = curl_init();
  curl_setopt_array($ch,[
    CURLOPT_URL            => 'https://api.github.com'.$path,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_CUSTOMREQUEST  => 'PUT',
    CURLOPT_POSTFIELDS     => json_encode($payload),
    CURLOPT_HTTPHEADER     => [
      'Authorization: Bearer '.$token,
      'Accept: application/vnd.github+json',
      'User-Agent: BIG-UTM-Sync/1.0',
      'X-GitHub-Api-Version: 2022-11-28',
      'Content-Type: application/json',
    ],
  ]);
  $resp = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $err  = curl_error($ch);
  curl_close($ch);
  return ['code'=>$code, 'data'=>json_decode($resp,true), 'err'=>$err];
}

function syncFile($filename){
  $localPath = __DIR__.'/'.$filename;

  // Arquivo existe localmente?
  if(!file_exists($localPath)){
    return ['file'=>$filename, 'status'=>'skipped', 'reason'=>'não encontrado localmente'];
  }

  $localContent  = file_get_contents($localPath);
  $localB64      = base64_encode($localContent);
  $ghPath        = '/repos/'.GH_OWNER.'/'.GH_REPO.'/contents/'.$filename.'?ref='.GH_BRANCH;

  // Pega SHA atual do arquivo no GitHub
  $get  = ghGet($ghPath);
  $sha  = null;

  if($get['code'] === 200 && isset($get['data']['sha'])){
    $sha = $get['data']['sha'];

    // Compara conteúdo — se igual, não faz commit desnecessário
    $remoteB64 = $get['data']['content'] ?? '';
    $remoteB64 = str_replace(["\n","\r"," "], '', $remoteB64);
    $localB64clean = str_replace(["\n","\r"," "], '', chunk_split($localB64,60));
    if($remoteB64 === str_replace(["\n","\r"," "], '', chunk_split($localB64,60))){
      return ['file'=>$filename, 'status'=>'unchanged'];
    }
  } elseif($get['code'] === 404){
    $sha = null; // arquivo novo
  } else {
    return ['file'=>$filename, 'status'=>'error', 'reason'=>'GitHub GET '.$get['code']];
  }

  // Faz o commit
  $now     = (new DateTime('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d H:i:s');
  $payload = [
    'message' => 'sync: '.$filename.' — '.$now,
    'content' => base64_encode($localContent),
    'branch'  => GH_BRANCH,
  ];
  if($sha) $payload['sha'] = $sha;

  $put = ghPut('/repos/'.GH_OWNER.'/'.GH_REPO.'/contents/'.$filename, $payload);

  if(in_array($put['code'], [200, 201])){
    return ['file'=>$filename, 'status'=>$sha ? 'updated' : 'created'];
  } else {
    $msg = $put['data']['message'] ?? $put['err'] ?? 'HTTP '.$put['code'];
    return ['file'=>$filename, 'status'=>'error', 'reason'=>$msg];
  }
}

/* ══ Roteador ════════════════════════════════════════════════ */
if($_SERVER['REQUEST_METHOD'] === 'POST'){
  $body = json_decode(file_get_contents('php://input'), true);
  $mode = $body['mode'] ?? 'all'; // 'all' ou arquivo específico

  if(!loadToken()){
    echo json_encode(['ok'=>false,'error'=>'Token GitHub não configurado.']);exit;
  }

  $results = [];
  $files   = ($mode !== 'all' && in_array($mode, $SYNC_FILES))
    ? [$mode]
    : $SYNC_FILES;

  foreach($files as $f){
    $results[] = syncFile($f);
  }

  $updated  = count(array_filter($results, fn($r)=>$r['status']==='updated'));
  $created  = count(array_filter($results, fn($r)=>$r['status']==='created'));
  $errors   = count(array_filter($results, fn($r)=>$r['status']==='error'));
  $unchanged= count(array_filter($results, fn($r)=>$r['status']==='unchanged'));

  echo json_encode([
    'ok'        => $errors === 0,
    'summary'   => [
      'updated'   => $updated,
      'created'   => $created,
      'unchanged' => $unchanged,
      'errors'    => $errors,
    ],
    'results'   => $results,
    'synced_at' => (new DateTime('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d H:i:s'),
  ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
  exit;
}

/* GET — status */
if($_SERVER['REQUEST_METHOD'] === 'GET'){
  echo json_encode([
    'ok'         => true,
    'service'    => 'BIG UTM GitHub Sync',
    'configured' => !empty(loadToken()),
    'files'      => $SYNC_FILES,
    'repo'       => GH_OWNER.'/'.GH_REPO,
  ]);
  exit;
}

echo json_encode(['ok'=>false,'error'=>'Método não suportado']);
