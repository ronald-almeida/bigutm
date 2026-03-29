<?php
/* ============================================================
   BIG UTM — push-proxy.php
   bigcofy.shop/bigutm/push-proxy.php
   Redireciona para o Push Server no Railway
   ============================================================ */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if($_SERVER['REQUEST_METHOD']==='OPTIONS'){http_response_code(204);exit;}

define('RAILWAY_URL','https://bigutm-push-production.up.railway.app');

$body   = file_get_contents('php://input');
$method = $_SERVER['REQUEST_METHOD'];
$path   = $_GET['path'] ?? '/push';

$ch = curl_init();
curl_setopt_array($ch,[
  CURLOPT_URL            => RAILWAY_URL.$path,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT        => 12,
  CURLOPT_CUSTOMREQUEST  => $method,
  CURLOPT_POSTFIELDS     => $body,
  CURLOPT_HTTPHEADER     => ['Content-Type: application/json','Content-Length: '.strlen($body)],
  CURLOPT_SSL_VERIFYPEER => true,
]);
$resp = curl_exec($ch);
$code = curl_getinfo($ch,CURLINFO_HTTP_CODE);
$err  = curl_error($ch);
curl_close($ch);

if($err){http_response_code(502);echo json_encode(['ok'=>false,'error'=>$err]);exit;}
http_response_code($code?:200);
echo $resp?:json_encode(['ok'=>true]);
