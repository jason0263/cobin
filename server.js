// server.js - Cobin Voice & Video 雲端一體化伺服器 (支援 Render.com 24/7 雲端部署)

const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const PORT = process.env.PORT || 8080;

// 1. 提供前端靜態檔案託管
app.use(express.static(__dirname));

// 根目錄直接訪問首頁
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 建立 HTTP 伺服器
const server = http.createServer(app);

// 2. 建立 WebSocket 信令伺服器 (共享同一個 HTTP 伺服器與連接埠)
const wss = new WebSocketServer({ server });

const clients = new Map(); // uid -> { ws, uid, nickname, roomId, micState, cameraState, isScreen, avatar }
const roomNames = {
    'room-1': '語音大廳 1',
    'room-2': '遊戲開黑 2',
    'room-3': '私人會議 3'
};

function getRoomsStatusArray() {
    const status = {};
    for (const [rId, rName] of Object.entries(roomNames)) {
        status[rId] = {
            id: rId,
            name: rName,
            users: []
        };
    }

    for (const client of clients.values()) {
        if (client.roomId && status[client.roomId]) {
            status[client.roomId].users.push({
                uid: client.uid,
                nickname: client.nickname,
                avatar: client.avatar || '',
                mic: client.micState,
                camera: client.cameraState
            });
        }
    }
    return status;
}

function broadcastRoomsStatus() {
    const payload = JSON.stringify({
        type: 'rooms-status',
        rooms: getRoomsStatusArray()
    });

    for (const client of clients.values()) {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(payload);
        }
    }
}

wss.on('connection', (ws) => {
    const uid = Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    const clientData = {
        ws,
        uid,
        roomId: null,
        nickname: '用戶 ' + uid.slice(-4),
        micState: true,
        cameraState: true,
        isScreen: false,
        avatar: ''
    };
    clients.set(uid, clientData);

    console.log(`[WebSocket 連線建立] UID: ${uid}`);

    // 發送初始化確認與當前房間在線狀態
    ws.send(JSON.stringify({
        type: 'init-ack',
        uid: uid,
        nickname: clientData.nickname,
        rooms: getRoomsStatusArray()
    }));

    ws.on('message', (message) => {
        let msg;
        try {
            msg = JSON.parse(message);
        } catch (e) {
            return;
        }

        if (!msg || !msg.type) return;

        switch (msg.type) {
            case 'init':
                if (msg.nickname) {
                    clientData.nickname = String(msg.nickname).trim();
                }
                broadcastRoomsStatus();
                break;

            case 'join-room': {
                const targetRoomId = roomNames[msg.roomId] ? msg.roomId : 'room-1';

                // 若先前在其他房間，通知舊房間成員離開
                if (clientData.roomId && clientData.roomId !== targetRoomId) {
                    const oldRoomId = clientData.roomId;
                    for (const other of clients.values()) {
                        if (other.uid !== uid && other.roomId === oldRoomId && other.ws.readyState === WebSocket.OPEN) {
                            other.ws.send(JSON.stringify({
                                type: 'user-left',
                                uid: uid,
                                roomId: oldRoomId
                            }));
                        }
                    }
                }

                clientData.roomId = targetRoomId;
                if (msg.nickname) clientData.nickname = String(msg.nickname).trim();
                clientData.micState = msg.micState !== undefined ? Boolean(msg.micState) : true;
                clientData.cameraState = msg.cameraState !== undefined ? Boolean(msg.cameraState) : true;

                // 取得同房間的其他已有成員
                const existingUsers = [];
                for (const other of clients.values()) {
                    if (other.uid !== uid && other.roomId === targetRoomId) {
                        existingUsers.push({
                            uid: other.uid,
                            nickname: other.nickname,
                            avatar: other.avatar || '',
                            mic: other.micState,
                            camera: other.cameraState
                        });
                    }
                }

                // 回傳成功加入房間訊息 (包含房間已有成員)
                ws.send(JSON.stringify({
                    type: 'joined-room',
                    roomId: targetRoomId,
                    roomName: roomNames[targetRoomId],
                    users: existingUsers
                }));

                // 通知同房間其他人有新成員加入
                for (const other of clients.values()) {
                    if (other.uid !== uid && other.roomId === targetRoomId && other.ws.readyState === WebSocket.OPEN) {
                        other.ws.send(JSON.stringify({
                            type: 'user-joined',
                            roomId: targetRoomId,
                            user: {
                                uid: uid,
                                nickname: clientData.nickname,
                                avatar: clientData.avatar || '',
                                mic: clientData.micState,
                                camera: clientData.cameraState
                            }
                        }));
                    }
                }

                broadcastRoomsStatus();
                console.log(`[加入房間] UID: ${uid} -> ${targetRoomId}`);
                break;
            }

            case 'leave-room': {
                if (clientData.roomId) {
                    const currentRoomId = clientData.roomId;
                    clientData.roomId = null;

                    for (const other of clients.values()) {
                        if (other.uid !== uid && other.roomId === currentRoomId && other.ws.readyState === WebSocket.OPEN) {
                            other.ws.send(JSON.stringify({
                                type: 'user-left',
                                uid: uid,
                                roomId: currentRoomId
                            }));
                        }
                    }

                    ws.send(JSON.stringify({
                        type: 'left-room',
                        roomId: currentRoomId
                    }));

                    broadcastRoomsStatus();
                    console.log(`[離開房間] UID: ${uid}`);
                }
                break;
            }

            case 'signal': {
                const targetUid = msg.targetUid;
                const signalData = msg.signal;

                if (targetUid && clients.has(targetUid)) {
                    const targetClient = clients.get(targetUid);
                    if (targetClient.ws.readyState === WebSocket.OPEN) {
                        targetClient.ws.send(JSON.stringify({
                            type: 'signal',
                            fromUid: uid,
                            fromNickname: clientData.nickname,
                            signal: signalData
                        }));
                    }
                }
                break;
            }

            case 'media-state': {
                clientData.micState = Boolean(msg.mic);
                clientData.cameraState = Boolean(msg.camera);
                clientData.isScreen = Boolean(msg.isScreen);

                if (clientData.roomId) {
                    for (const other of clients.values()) {
                        if (other.uid !== uid && other.roomId === clientData.roomId && other.ws.readyState === WebSocket.OPEN) {
                            other.ws.send(JSON.stringify({
                                type: 'user-media-state',
                                uid: uid,
                                mic: clientData.micState,
                                camera: clientData.cameraState,
                                isScreen: clientData.isScreen
                            }));
                        }
                    }
                    broadcastRoomsStatus();
                }
                break;
            }
        }
    });

    ws.on('close', () => {
        if (clientData.roomId) {
            const rId = clientData.roomId;
            for (const other of clients.values()) {
                if (other.uid !== uid && other.roomId === rId && other.ws.readyState === WebSocket.OPEN) {
                    other.ws.send(JSON.stringify({
                        type: 'user-left',
                        uid: uid,
                        roomId: rId
                    }));
                }
            }
        }

        clients.delete(uid);
        broadcastRoomsStatus();
        console.log(`[連線關閉] UID: ${uid}`);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(`🚀 Cobin Voice & Video 雲端伺服器已啟動`);
    console.log(`📡 監聽連接埠: ${PORT}`);
    console.log(`🌐 靜態網頁與 WebSocket 同步就緒！`);
    console.log(`====================================================`);
});
