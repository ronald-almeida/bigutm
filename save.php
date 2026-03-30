<?php
/* ============================================================
   BIG UTM — save.php
   Salva e carrega estado do painel no MySQL
   ============================================================ */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

require_once __DIR__ . '/db.php';

/* GET — carrega estado */
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    try {
        $pdo  = dbConnect();
        $stmt = $pdo->query("SELECT data_b64 FROM painel_estado ORDER BY id DESC LIMIT 1");
        $row  = $stmt->fetch();
        echo json_encode(['data' => $row ? $row['data_b64'] : '']);
    } catch (Exception $e) {
        $file = __DIR__ . '/bigutm_data.json';
        echo file_exists($file) ? file_get_contents($file) : json_encode(['data' => '']);
    }
    exit;
}

/* POST — salva estado */
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body    = file_get_contents('php://input');
    $decoded = json_decode($body, true);
    if (!$decoded || !isset($decoded['data'])) {
        echo json_encode(['ok' => false, 'error' => 'JSON inválido']); exit;
    }
    $b64 = $decoded['data'];
    try {
        $pdo   = dbConnect();
        $count = $pdo->query("SELECT COUNT(*) FROM painel_estado")->fetchColumn();
        if ($count > 0) {
            $pdo->prepare("UPDATE painel_estado SET data_b64=?, updated_at=NOW() LIMIT 1")->execute([$b64]);
        } else {
            $pdo->prepare("INSERT INTO painel_estado (data_b64) VALUES (?)")->execute([$b64]);
        }
        file_put_contents(__DIR__ . '/bigutm_data.json', json_encode(['data' => $b64]));
        echo json_encode(['ok' => true, 'storage' => 'mysql']);
    } catch (Exception $e) {
        $ok = file_put_contents(__DIR__ . '/bigutm_data.json', json_encode(['data' => $b64]));
        echo json_encode(['ok' => $ok !== false, 'storage' => 'file', 'error' => $e->getMessage()]);
    }
    exit;
}

echo json_encode(['ok' => false, 'error' => 'Método não suportado']);
