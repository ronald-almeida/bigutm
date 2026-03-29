<?php
/* ============================================================
   BIG UTM — github_backup.php
   Salva backup dos dados no repositório GitHub via API
   Token armazenado SOMENTE no servidor (nunca exposto ao JS)
   ============================================================ */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if($_SERVER['REQUEST_METHOD']==='OPTIONS'){http_response_code(204);exit;}

/* ── Configurações do repositório ── */
define('GH_OWNER', 'ronald-almeida');
define('GH_REPO',  'bigutm');
define('GH_FILE',  'backup/dados.json');   // caminho do arquivo no repo
define('GH_BRANCH','main');

/* ── Arquivo local onde o token fica salvo ── */
define('TOKEN_FILE', __DIR__.'/.gh_token');  // fora do public_html se possível

/* ── Helpers ── */
function loadToken(){
  if(!file_exists(TOKEN_FILE)) return '';
  return trim(file_get_contents(TOKEN_FILE));
}

function saveToken($t){
  return file_put_contents(TOKEN_FILE, trim($t)) !== false;
}

function ghRequest($method, $path, $payload=null){
  $token = loadToken();
  if(!$token) return ['ok'=>false,'error'=>'Token GitHub não configurado. Vá em Configurações → Backup GitHub para inserir o token.'];

  $url = 'https://api.github.com'.$path;
  $ch  = curl_init();
  $headers = [
    'Authorization: Bearer '.$token,
    'Accept: application/vnd.github+json',
    'User-Agent: BIG-UTM-Backup/1.0',
    'X-GitHub-Api-Version: 2022-11-28',
    'Content-Type: application/json',
  ];
  curl_setopt_array($ch,[
    CURLOPT_URL            => $url,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_HTTPHEADER     => $headers,
    CURLOPT_SSL_VERIFYPEER => true,
  ]);
  if($payload!==null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
  $resp = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $err  = curl_error($ch);
  curl_close($ch);

  if($err) return ['ok'=>false,'error'=>'cURL: '.$err];
  $data = json_decode($resp, true);
  return ['ok'=>in_array($code,[200,201]), 'code'=>$code, 'data'=>$data, 'raw'=>$resp];
}

function backupToGithub($b64Data){
  /* 1. Tenta pegar o SHA atual do arquivo (necessário para update) */
  $get = ghRequest('GET', '/repos/'.GH_OWNER.'/'.GH_REPO.'/contents/'.GH_FILE.'?ref='.GH_BRANCH);

  $sha = null;
  if($get['ok'] && isset($get['data']['sha'])){
    $sha = $get['data']['sha'];
  } elseif(isset($get['code']) && $get['code']===404){
    $sha = null; // arquivo ainda não existe — será criado
  } elseif(!$get['ok']){
    return $get; // erro de autenticação ou outro
  }

  /* 2. Monta conteúdo do backup */
  $now     = (new DateTime('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d H:i:s');
  $content = base64_encode(json_encode([
    'updated_at' => $now,
    'source'     => 'bigcofy.shop/bigutm',
    'data'       => $b64Data
  ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

  /* 3. Faz o commit */
  $payload = [
    'message' => 'backup: '.$now.' (BIG UTM auto-save)',
    'content' => $content,
    'branch'  => GH_BRANCH,
  ];
  if($sha) $payload['sha'] = $sha;

  $put = ghRequest('PUT', '/repos/'.GH_OWNER.'/'.GH_REPO.'/contents/'.GH_FILE, $payload);

  if($put['ok']){
    return ['ok'=>true, 'updated_at'=>$now, 'sha'=>$sha?'updated':'created'];
  } else {
    $msg = $put['data']['message'] ?? $put['raw'] ?? 'Erro desconhecido';
    return ['ok'=>false, 'error'=>'GitHub API: '.$msg, 'code'=>$put['code']??0];
  }
}

/* ══ Roteador ════════════════════════════════════════════ */
if($_SERVER['REQUEST_METHOD']==='POST'){
  $body = file_get_contents('php://input');
  $req  = json_decode($body, true);

  /* Salvar token */
  if(isset($req['action']) && $req['action']==='save_token'){
    $token = trim($req['token'] ?? '');
    if(!$token || (!str_starts_with($token,'ghp_') && !str_starts_with($token,'github_pat_'))){
      echo json_encode(['ok'=>false,'error'=>'Token inválido']);exit;
    }
    $ok = saveToken($token);
    echo json_encode(['ok'=>$ok]);exit;
  }

  /* Fazer backup */
  if(isset($req['data'])){
    $result = backupToGithub($req['data']);
    echo json_encode($result);exit;
  }

  echo json_encode(['ok'=>false,'error'=>'Requisição inválida']);exit;
}

/* GET — status do backup */
if($_SERVER['REQUEST_METHOD']==='GET'){
  $hasToken = !empty(loadToken());
  $get = $hasToken
    ? ghRequest('GET', '/repos/'.GH_OWNER.'/'.GH_REPO.'/contents/'.GH_FILE.'?ref='.GH_BRANCH)
    : null;

  echo json_encode([
    'ok'        => true,
    'configured'=> $hasToken,
    'file'      => GH_OWNER.'/'.GH_REPO.'/'.GH_FILE,
    'exists'    => $get && $get['ok'],
    'last_commit'=> $get['data']['sha'] ?? null,
  ]);exit;
}

echo json_encode(['ok'=>false,'error'=>'Método não suportado']);
