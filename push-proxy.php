<?php
/* ============================================================
   BIG UTM — push-proxy.php
   Tenta servidor local (Node.js Hostinger) primeiro,
   Railway como fallback
   ============================================================ */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if($_SERVER['REQUEST_METHOD']==='OPTIONS'){http_response_code(204);exit;}

/* Tenta local primeiro, Railway como fallback */
$servers = [
  'http://127.0.0.1:3000',
  'https://bigutm-push-production.up.railway.app'
];

$body   = file_get_contents('php://input');
$method = $_SERVER['REQUEST_METHOD'];
$path   = '/push';

foreach($servers as $server){
  $ch = curl_init();
  curl_setopt_array($ch,[
    CURLOPT_URL            => $server.$path,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 8,
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_POSTFIELDS     => $body,
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json','Content-Length: '.strlen($body)],
    CURLOPT_SSL_VERIFYPEER => false,
  ]);
  $resp = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $err  = curl_error($ch);
  curl_close($ch);

  if(!$err && $code >= 200 && $code < 500){
    http_response_code($code);
    echo $resp;
    exit;
  }
}

http_response_code(502);
echo json_encode(['ok'=>false,'error'=>'Push server indisponível']);