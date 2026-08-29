<?php
if (file_exists(__DIR__ . '/vendor/autoload.php')) {
    require __DIR__ . '/vendor/autoload.php';
} elseif (file_exists(__DIR__ . '/../vendor/autoload.php')) {
    require __DIR__ . '/../vendor/autoload.php';
} else {
    die("Error: vendor/autoload.php not found. Please run composer install.\n");
}

use Workerman\Worker;

// WebSocket 信令伺服器 (監聽 0.0.0.0:8080)
$ws_worker = new Worker("websocket://0.0.0.0:8080");
$ws_worker->count = 1;

// 儲存所有連接的客戶端 [$uid => $connection]
$clients = [];
// 預設房間定義
$roomNames = [
    'room-1' => '語音大廳 1',
    'room-2' => '遊戲開黑 2',
    'room-3' => '私人會議 3'
];

/**
 * 取得當前房間狀態結構
 */
function getRoomsStatusArray($clients, $roomNames) {
    $roomsStatus = [];
    foreach ($roomNames as $rId => $rName) {
        $roomsStatus[$rId] = [
            'id' => $rId,
            'name' => $rName,
            'users' => []
        ];
    }

    foreach ($clients as $c) {
        if (!empty($c->roomId) && isset($roomsStatus[$c->roomId])) {
            $roomsStatus[$c->roomId]['users'][] = [
                'uid' => $c->uid,
                'nickname' => $c->nickname ?? '用戶 ' . substr($c->uid, -4),
                'avatar' => $c->avatar ?? '',
                'mic' => $c->micState ?? true,
                'camera' => $c->cameraState ?? true
            ];
        }
    }
    return $roomsStatus;
}

/**
 * 廣播當前所有房間狀態給全部連線用戶
 */
function broadcastRoomsStatus($clients, $roomNames) {
    $payload = json_encode([
        'type' => 'rooms-status',
        'rooms' => getRoomsStatusArray($clients, $roomNames)
    ]);

    foreach ($clients as $c) {
        try {
            $c->send($payload);
        } catch (\Throwable $e) {}
    }
}

// 當 WebSocket 握手成功建立時觸發
$ws_worker->onWebSocketConnect = function($connection, $http_header) use (&$clients, $roomNames) {
    $connection->uid = uniqid();
    $connection->roomId = null;
    $connection->nickname = '用戶 ' . substr($connection->uid, -4);
    $connection->micState = true;
    $connection->cameraState = true;
    $clients[$connection->uid] = $connection;

    echo "[WebSocket 連線建立] UID: {$connection->uid}\n";

    // 發送初始化資訊與當前各房間狀態 (合併發送)
    $connection->send(json_encode([
        'type' => 'init-ack',
        'uid' => $connection->uid,
        'nickname' => $connection->nickname,
        'rooms' => getRoomsStatusArray($clients, $roomNames)
    ]));
};

$ws_worker->onMessage = function($connection, $data) use (&$clients, $roomNames) {
    try {
        $msg = json_decode($data, true);
        if (!$msg || !isset($msg['type'])) {
            return;
        }

        $type = $msg['type'];

        switch ($type) {
            case 'init':
                if (!empty($msg['nickname'])) {
                    $connection->nickname = htmlspecialchars(trim($msg['nickname']));
                }
                broadcastRoomsStatus($clients, $roomNames);
                break;

            case 'join-room':
                $targetRoomId = $msg['roomId'] ?? 'room-1';
                if (!isset($roomNames[$targetRoomId])) {
                    $targetRoomId = 'room-1';
                }

                // 若先前在其他房間，通知舊房間成員
                if (!empty($connection->roomId) && $connection->roomId !== $targetRoomId) {
                    $oldRoomId = $connection->roomId;
                    foreach ($clients as $c) {
                        if ($c !== $connection && $c->roomId === $oldRoomId) {
                            $c->send(json_encode([
                                'type' => 'user-left',
                                'uid' => $connection->uid,
                                'roomId' => $oldRoomId
                            ]));
                        }
                    }
                }

                $connection->roomId = $targetRoomId;
                if (!empty($msg['nickname'])) {
                    $connection->nickname = htmlspecialchars(trim($msg['nickname']));
                }
                $connection->micState = $msg['micState'] ?? true;
                $connection->cameraState = $msg['cameraState'] ?? true;

                // 取得同房間的其他使用者
                $otherUsers = [];
                foreach ($clients as $c) {
                    if ($c !== $connection && $c->roomId === $targetRoomId) {
                        $otherUsers[] = [
                            'uid' => $c->uid,
                            'nickname' => $c->nickname,
                            'avatar' => $c->avatar ?? '',
                            'mic' => $c->micState,
                            'camera' => $c->cameraState
                        ];
                    }
                }

                // 回傳已成功加入房間訊息 (包含房間內已有成員)
                $connection->send(json_encode([
                    'type' => 'joined-room',
                    'roomId' => $targetRoomId,
                    'roomName' => $roomNames[$targetRoomId],
                    'users' => $otherUsers
                ]));

                // 通知同房間其他成員有新人加入
                foreach ($clients as $c) {
                    if ($c !== $connection && $c->roomId === $targetRoomId) {
                        $c->send(json_encode([
                            'type' => 'user-joined',
                            'roomId' => $targetRoomId,
                            'user' => [
                                'uid' => $connection->uid,
                                'nickname' => $connection->nickname,
                                'avatar' => $connection->avatar ?? '',
                                'mic' => $connection->micState,
                                'camera' => $connection->cameraState
                            ]
                        ]));
                    }
                }

                broadcastRoomsStatus($clients, $roomNames);
                echo "[加入房間] UID: {$connection->uid} -> {$targetRoomId} ({$roomNames[$targetRoomId]})\n";
                break;

            case 'leave-room':
                if (!empty($connection->roomId)) {
                    $currentRoomId = $connection->roomId;
                    $connection->roomId = null;

                    foreach ($clients as $c) {
                        if ($c !== $connection && $c->roomId === $currentRoomId) {
                            $c->send(json_encode([
                                'type' => 'user-left',
                                'uid' => $connection->uid,
                                'roomId' => $currentRoomId
                            ]));
                        }
                    }

                    $connection->send(json_encode([
                        'type' => 'left-room',
                        'roomId' => $currentRoomId
                    ]));

                    broadcastRoomsStatus($clients, $roomNames);
                    echo "[離開房間] UID: {$connection->uid}\n";
                }
                break;

            case 'signal':
                $targetUid = $msg['targetUid'] ?? null;
                $signalData = $msg['signal'] ?? null;

                if ($targetUid && isset($clients[$targetUid])) {
                    $clients[$targetUid]->send(json_encode([
                        'type' => 'signal',
                        'fromUid' => $connection->uid,
                        'fromNickname' => $connection->nickname,
                        'signal' => $signalData
                    ]));
                }
                break;

            case 'media-state':
                $connection->micState = $msg['mic'] ?? true;
                $connection->cameraState = $msg['camera'] ?? true;

                if (!empty($connection->roomId)) {
                    foreach ($clients as $c) {
                        if ($c !== $connection && $c->roomId === $connection->roomId) {
                            $c->send(json_encode([
                                'type' => 'user-media-state',
                                'uid' => $connection->uid,
                                'mic' => $connection->micState,
                                'camera' => $connection->cameraState
                            ]));
                        }
                    }
                    broadcastRoomsStatus($clients, $roomNames);
                }
                break;
        }
    } catch (\Throwable $e) {
        echo "[錯誤] " . $e->getMessage() . "\n";
    }
};

$ws_worker->onClose = function($connection) use (&$clients, $roomNames) {
    if (!empty($connection->uid) && isset($clients[$connection->uid])) {
        if (!empty($connection->roomId)) {
            $rId = $connection->roomId;
            foreach ($clients as $c) {
                if ($c !== $connection && $c->roomId === $rId) {
                    $c->send(json_encode([
                        'type' => 'user-left',
                        'uid' => $connection->uid,
                        'roomId' => $rId
                    ]));
                }
            }
        }

        unset($clients[$connection->uid]);
        broadcastRoomsStatus($clients, $roomNames);
        echo "[連線關閉] UID: {$connection->uid}\n";
    }
};

Worker::runAll();
