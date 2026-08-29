// server.js (Root entry for Render.com)

const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const PORT = process.env.PORT || 8080;

// 自動尋找 index.html 所在目錄 (支援根目錄與 cobin/ 子目錄)
const staticDir = fs.existsSync(path.join(__dirname, 'cobin', 'index.html')) 
    ? path.join(__dirname, 'cobin') 
    : __dirname;

console.log(`[Cobin] 靜態檔案目錄: ${staticDir}`);
app.use(express.static(staticDir));
app.use('/cobin/cobin', express.static(staticDir));
app.use('/cobin', express.static(staticDir));

app.get('*', (req, res) => {
    res.sendFile(path.join(staticDir, 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const clients = new Map();
const roomNames = {
    'room-1': '語音大廳 1',
    'room-2': '遊戲開黑 2',
    'room-3': '私人會議 3'
};

function getRoomsStatusArray() {
    const status = {};
    for (const [rId, rName] of Object.entries(roomNames)) {
        status[rId] = { id: rId, name: rName, users: [] };
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

    ws.send(JSON.stringify({
        type: 'init-ack',
        uid: uid,
        nickname: clientData.nickname,
        rooms: getRoomsStatusArray()
    }));

    ws.on('message', (message) => {
        let msg;
        try { msg = JSON.parse(message); } catch (e) { return; }
        if (!msg || !msg.type) return;

        switch (msg.type) {
            case 'init':
                if (msg.nickname) clientData.nickname = String(msg.nickname).trim();
                broadcastRoomsStatus();
                break;

            case 'join-room': {
                const targetRoomId = roomNames[msg.roomId] ? msg.roomId : 'room-1';

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

                ws.send(JSON.stringify({
                    type: 'joined-room',
                    roomId: targetRoomId,
                    roomName: roomNames[targetRoomId],
                    users: existingUsers
                }));

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
    console.log(`====================================================`);
});
