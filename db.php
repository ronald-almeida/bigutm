<?php
/* ============================================================
   BIG UTM — db.php
   Conexão centralizada MySQL
   ============================================================ */

define('DB_HOST', 'localhost');
define('DB_NAME', 'u109861798_bigutm');
define('DB_USER', 'u109861798_bigutm_user');
define('DB_PASS', 'Senhagateway987!');
define('DB_CHARSET', 'utf8mb4');

function dbConnect() {
    static $pdo = null;
    if ($pdo) return $pdo;
    try {
        $dsn = 'mysql:host='.DB_HOST.';dbname='.DB_NAME.';charset='.DB_CHARSET;
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
        return $pdo;
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['error' => 'DB: ' . $e->getMessage()]);
        exit;
    }
}