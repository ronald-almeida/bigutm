<?php
/* ============================================================
   BIG UTM — proxy.php (AnubisPay)
   bigcofy.shop/bigutm/proxy.php
   ============================================================ */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, x-api-key');
if($_SERVER['REQUEST_METHOD']==='OPTIONS'){http_response_code(204);exit;}

$key      = $_GET['key']       ?? $_POST['key']       ?? '';
$from     = $_GET['date_from'] ?? $_POST['date_from'] ?? '';
$to       = $_GET['date_to']   ?? $_POST['date_to']   ?? '';
$endpoint = $_GET['endpoint']  ?? 'transactions';

if(!$key){echo json_encode(['error'=>'Chave AnubisPay não informada']);exit;}

$params = ['limit'=>100,'page'=>1];
if($from) $params['start_date'] = $from;
if($to)   $params['end_date']   = $to;

$url = 'https://api.anubispy.com/v1/'.$endpoint.'?'.http_build_query($params);

$ch = curl_init();
curl_setopt_array($ch,[
  CURLOPT_URL            => $url,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT        => 20,
  CURLOPT_FOLLOWLOCATION => true,
  CURLOPT_SSL_VERIFYPEER => true,
  CURLOPT_HTTPHEADER     => [
    'Accept: application/json',
    'Authorization: Bearer '.$key,
    'x-api-key: '.$key,
  ],
]);
$resp  = curl_exec($ch);
$code  = curl_getinfo($ch,CURLINFO_HTTP_CODE);
$err   = curl_error($ch);
curl_close($ch);

if($err){echo json_encode(['error'=>'cURL: '.$err]);exit;}
if($code!==200){
  $d=json_decode($resp,true);
  echo json_encode(['error'=>'AnubisPay HTTP '.$code.': '.($d['message']??$d['error']??$resp)]);exit;
}
echo $resp;
