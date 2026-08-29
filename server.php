<?php
if (file_exists(__DIR__ . '/vendor/autoload.php')) {
    require __DIR__ . '/vendor/autoload.php';
} elseif (file_exists(__DIR__ . '/../vendor/autoload.php')) {
    require __DIR__ . '/../vendor/autoload.php';
} else {
    die("Error: vendor/autoload.php not found. Please run composer install.\n");
}

use Workerman\Worker;

// WebSocket 信令伺服器 (支援多房間與 WebRTC P2P Mesh 通話)
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
 * 計算並廣播當前所有房間的成員資訊給所有連線中的客戶端
 */
function broadcastRoomsStatus($clients, $roomNames) {
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

    $payload = json_encode([
        'type' => 'rooms-status',
        'rooms' => $roomsStatus
    ]);

    foreach ($clients as $c) {
        $c->send($payload);
    }
}

$ws_worker->onConnect = function($connection) use (&$clients) {
    $connection->uid = uniqid();
    $connection->roomId = null;
    $connection->nickname = '用戶 ' . substr($connection->uid, -4);
    $connection->micState = true;
    $connection->cameraState = true;
    $clients[$connection->uid] = $connection;
    echo "[連線] UID: {$connection->uid}\n";
};

$ws_worker->onMessage = function($connection, $data) use (&$clients, $roomNames) {
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
            if (!empty($msg['avatar'])) {
                $connection->avatar = $msg['avatar'];
            }
            // 回傳自己的 UID 與所有房間資訊
            $connection->send(json_encode([
                'type' => 'init-ack',
                'uid' => $connection->uid,
                'nickname' => $connection->nickname
            ]));
            broadcastRoomsStatus($clients, $roomNames);
            break;

        case 'join-room':
            $targetRoomId = $msg['roomId'] ?? 'room-1';
            if (!isset($roomNames[$targetRoomId])) {
                $targetRoomId = 'room-1';
            }

            // 如果已經在其他房間，先通知舊房間離開
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

            // 取得同房間的其他使用者清單
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

            // 發送已加入房間訊息給自己
            $connection->send(json_encode([
                'type' => 'joined-room',
                'roomId' => $targetRoomId,
                'roomName' => $roomNames[$targetRoomId],
                'users' => $otherUsers
            ]));

            // 通知同房間的其他成員：有新成員加入
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

            // 廣播房間在線狀態
            broadcastRoomsStatus($clients, $roomNames);
            echo "[加入房間] UID: {$connection->uid} -> {$targetRoomId}\n";
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
                echo "[離開房間] UID: {$connection->uid} 離開 {$currentRoomId}\n";
            }
            break;

        case 'signal':
            // WebRTC 信令轉發 (offer, answer, candidate)
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
            // 廣播本端鏡頭/麥克風開關狀態給同房間成員
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
};

$ws_worker->onClose = function($connection) use (&$clients, $roomNames) {
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
    echo "[斷線] UID: {$connection->uid}\n";
};

Worker::runAll();
