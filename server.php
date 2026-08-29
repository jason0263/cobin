<?php
require __DIR__.'/vendor/autoload.php';

use Workerman\Worker;

// WebSocket server listening on port 8080
$ws_worker = new Worker("websocket://0.0.0.0:8080");
$ws_worker->count = 1; // single process is enough for demo

// Store all active connections
$clients = [];

$ws_worker->onConnect = function($connection) use (&$clients) {
    $connection->uid = uniqid();
    $clients[$connection->uid] = $connection;
    echo "[Connect] {$connection->uid}\n";
};

$ws_worker->onMessage = function($connection, $data) use (&$clients) {
    $msg = json_decode($data, true);
    if (!$msg) {
        return;
    }
    $type = $msg['type'] ?? '';
    switch ($type) {
        case 'init':
            $connection->nickname = $msg['nickname'] ?? 'Anonymous';
            break;
        case 'chat':
            $payload = [
                'type'    => 'chat',
                'from'    => $connection->nickname ?? $connection->uid,
                'message' => $msg['message'] ?? ''
            ];
            foreach ($clients as $c) {
                $c->send(json_encode($payload));
            }
            break;
        case 'signal':
            // Forward signalling data to every other peer
            $payload = [
                'type'   => 'signal',
                'from'   => $connection->nickname ?? $connection->uid,
                'signal' => $msg['signal'] ?? []
            ];
            foreach ($clients as $c) {
                if ($c !== $connection) {
                    $c->send(json_encode($payload));
                }
            }
            break;
        default:
            // Unknown message type – ignore
            break;
    }
};

$ws_worker->onClose = function($connection) use (&$clients) {
    unset($clients[$connection->uid]);
    echo "[Close] {$connection->uid}\n";
};

Worker::runAll();
