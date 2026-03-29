<?php
/* ============================================================
   BIG UTM — proxy_umbrella.php (UmbrelaPag)
   bigcofy.shop/bigutm/proxy_umbrella.php
   ============================================================ */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, x-api-key');
if($_SERVER['REQUEST_METHOD']==='OPTIONS'){http_response_code(204);exit;}

// Aceita target_url + x_api_key via FormData (como o umbrella.js envia)
$targetUrl = $_POST['target_url'] ?? $_GET['target_url'] ?? '';
$apiKey    = $_POST['x_api_key']  ?? $_GET['x_api_key']  ?? '';

if(!$targetUrl){echo json_encode(['error'=>'target_url não informada']);exit;}
if(!$apiKey)   {echo json_encode(['error'=>'x_api_key não informada']);exit;}

// Valida que a URL é da UmbrelaPag (segurança)
if(strpos($targetUrl,'umbrellapag.com')===false && strpos($targetUrl,'api-gateway.umbrellapag')===false){
  echo json_encode(['error'=>'URL não permitida: '.$targetUrl]);exit;
}

$ch = curl_init();
curl_setopt_array($ch,[
  CURLOPT_URL            => $targetUrl,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT        => 20,
  CURLOPT_FOLLOWLOCATION => true,
  CURLOPT_SSL_VERIFYPEER => true,
  CURLOPT_HTTPHEADER     => [
    'Accept: application/json',
    'x-api-key: '.$apiKey,
    'User-Agent: UMBRELLAB2B/1.0',
  ],
]);
$resp = curl_exec($ch);
$code = curl_getinfo($ch,CURLINFO_HTTP_CODE);
$err  = curl_error($ch);
curl_close($ch);

if($err){echo json_encode(['error'=>'cURL: '.$err]);exit;}
if($code!==200){
  $d=json_decode($resp,true);
  echo json_encode(['error'=>'UmbrelaPag HTTP '.$code.': '.($d['message']??$d['error']??substr($resp,0,120))]);exit;
}
echo $resp;
