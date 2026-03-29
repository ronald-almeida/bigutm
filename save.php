<?php
/* ============================================================
   BIG UTM — save.php
   bigcofy.shop/bigutm/save.php
   Compatível com o formato { data: base64 } do main.js
   ============================================================ */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if($_SERVER['REQUEST_METHOD']==='OPTIONS'){http_response_code(204);exit;}

$file = __DIR__.'/bigutm_data.json';

/* ── GET — carrega dados ── */
if($_SERVER['REQUEST_METHOD']==='GET'){
  if(file_exists($file)){
    echo file_get_contents($file);
  }else{
    echo json_encode(['data'=>'']);
  }
  exit;
}

/* ── POST — salva dados ── */
if($_SERVER['REQUEST_METHOD']==='POST'){
  $body = file_get_contents('php://input');
  if(!$body){echo json_encode(['ok'=>false,'error'=>'Sem dados']);exit;}
  $decoded = json_decode($body,true);
  if(!$decoded){echo json_encode(['ok'=>false,'error'=>'JSON inválido']);exit;}

  // Aceita tanto { data: base64 } quanto o objeto direto
  $toSave = isset($decoded['data']) ? $decoded : ['data'=>base64_encode($body)];
  $ok = file_put_contents($file, json_encode($toSave,JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE));
  echo json_encode(['ok'=>$ok!==false]);
  exit;
}

echo json_encode(['ok'=>false,'error'=>'Método não suportado']);
