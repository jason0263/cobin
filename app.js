// app.js - Cobin Voice & Video (多房間 WebRTC 即時通話前端邏輯)

(() => {
    console.log('[Cobin] app.js 已載入');

    // ==== 動態解析 WebSocket 信令位址 (支援本地、區域網路與遠端網域) ====
    const urlParams = new URLSearchParams(window.location.search);
    const customWs = urlParams.get('ws'); // 支援自訂 ?ws=xxx 參數

    let wsUrl = '';
    if (customWs) {
        wsUrl = customWs.startsWith('ws') ? customWs : `ws://${customWs}`;
    } else if (location.protocol === 'https:') {
        // 如果透過 HTTPS 訪問 (例如 ngrok / cloudflare / 自訂網域)
        wsUrl = `wss://${location.hostname}:8080`;
    } else if (location.hostname && location.hostname !== 'localhost' && location.hostname !== '') {
        // 如果透過區域網路 IP (例如 192.168.x.x) 或外網 IP 訪問
        wsUrl = `ws://${location.hostname}:8080`;
    } else {
        // 本機預設
        wsUrl = 'ws://127.0.0.1:8080';
    }

    let ws = null;
    let myUid = null;
    let myNickname = '用戶 ' + Math.floor(1000 + Math.random() * 9000);
    try {
        const saved = localStorage.getItem('cobin_nickname');
        if (saved) myNickname = saved;
    } catch (e) {}

    let currentRoomId = null;
    let currentRoomName = '';
    let pendingRoomId = null;

    // 媒體狀態
    let localStream = null;
    let screenStream = null;
    let isMicEnabled = true;
    let isCameraEnabled = true;
    let isScreenSharing = false;

    // WebRTC PeerConnections: { [targetUid]: { pc, nickname, videoElement } }
    const peers = {};

    // 通話計時
    let callTimerInterval = null;
    let callStartTimestamp = 0;

    // 音訊檢測 (Speaking Indicator)
    let audioContext = null;

    // ICE 配置 (Google STUN)
    const rtcConfig = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    };

    // ==== DOM 元素快取 ====
    const wsStatusTag = document.getElementById('wsStatusTag');
    const myAvatarSm = document.getElementById('myAvatarSm');
    const myNicknameText = document.getElementById('myNicknameText');
    const lobbyScreen = document.getElementById('lobbyScreen');
    const stageHeader = document.getElementById('stageHeader');
    const videoGrid = document.getElementById('videoGrid');
    const floatingActionBar = document.getElementById('floatingActionBar');
    const currentRoomNameTitle = document.getElementById('currentRoomNameTitle');
    const callDurationTimer = document.getElementById('callDurationTimer');
    const roomParticipantsCount = document.getElementById('roomParticipantsCount');
    
    const localVideo = document.getElementById('localVideo');
    const localVideoTile = document.getElementById('localVideoTile');
    const localAvatarPlaceholder = document.getElementById('localAvatarPlaceholder');
    const localAvatarCircle = document.getElementById('localAvatarCircle');
    const localAvatarName = document.getElementById('localAvatarName');
    const localTagLabel = document.getElementById('localTagLabel');
    const localMicIndicator = document.getElementById('localMicIndicator');

    const btnShareScreen = document.getElementById('btnShareScreen');
    const btnCamera = document.getElementById('btnCamera');
    const btnMic = document.getElementById('btnMic');
    const camIconOn = document.getElementById('camIconOn');
    const camIconOff = document.getElementById('camIconOff');
    const micIconOn = document.getElementById('micIconOn');
    const micIconOff = document.getElementById('micIconOff');

    const nicknameModal = document.getElementById('nicknameModal');
    const nicknameInput = document.getElementById('nicknameInput');
    const toastMsg = document.getElementById('toastMsg');

    const roomNameMap = {
        'room-1': '語音大廳 1',
        'room-2': '遊戲開黑 2',
        'room-3': '私人會議 3'
    };

    // ==== 初始化使用者個人介面 ====
    function updateMyProfileUI() {
        myNicknameText.textContent = myNickname;
        myAvatarSm.textContent = myNickname.charAt(0).toUpperCase();
        localAvatarCircle.textContent = myNickname.charAt(0).toUpperCase();
        localAvatarName.textContent = myNickname;
        localTagLabel.textContent = `${myNickname} (我)`;
    }
    updateMyProfileUI();

    // ==== WebSocket 連線核心 ====
    function initWebSocket() {
        console.log(`[Cobin] 嘗試連線至信令伺服器: ${wsUrl}`);

        try {
            ws = new WebSocket(wsUrl);
        } catch (err) {
            console.error('[Cobin] WebSocket 創建失敗:', err);
            setTimeout(initWebSocket, 2500);
            return;
        }

        ws.onopen = () => {
            console.log(`[Cobin] ✅ WebSocket 成功連線 (${wsUrl})`);
            if (wsStatusTag) {
                wsStatusTag.textContent = '🟢 已連線';
                wsStatusTag.style.color = 'var(--accent-green)';
            }
            const globalText = document.getElementById('globalStatusText');
            if (globalText) {
                globalText.textContent = '🟢 伺服器在線';
                globalText.parentElement.style.borderColor = 'rgba(35, 165, 90, 0.4)';
                globalText.parentElement.style.color = 'var(--accent-green)';
            }

            // 送出暱稱初始化
            ws.send(JSON.stringify({
                type: 'init',
                nickname: myNickname
            }));

            // 如果有等待中的房間加入請求，立即發送
            if (pendingRoomId) {
                const target = pendingRoomId;
                pendingRoomId = null;
                sendJoinRoomSignal(target);
            }
        };

        ws.onclose = (event) => {
            console.warn(`[Cobin] ⚠️ WebSocket 斷線 (代碼: ${event.code})`);
            if (wsStatusTag) {
                wsStatusTag.textContent = '🔴 未連線';
                wsStatusTag.style.color = 'var(--accent-red)';
            }
            const globalText = document.getElementById('globalStatusText');
            if (globalText) {
                globalText.textContent = '🔴 連線中斷 (重試中)';
                globalText.parentElement.style.borderColor = 'rgba(242, 63, 67, 0.4)';
                globalText.parentElement.style.color = 'var(--accent-red)';
            }
            setTimeout(initWebSocket, 2000);
        };

        ws.onerror = (err) => {
            console.error('[Cobin] WebSocket 發生錯誤:', err);
        };

        ws.onmessage = async (event) => {
            let data;
            try {
                data = JSON.parse(event.data);
            } catch (e) {
                return;
            }

            console.log('[Cobin] 收到信令:', data.type, data);

            switch (data.type) {
                case 'init-ack':
                    myUid = data.uid;
                    if (data.rooms) {
                        renderRoomsStatus(data.rooms);
                    }
                    break;

                case 'rooms-status':
                    renderRoomsStatus(data.rooms);
                    break;

                case 'joined-room':
                    handleJoinedRoomSuccess(data);
                    break;

                case 'user-joined':
                    handleUserJoined(data.user);
                    break;

                case 'user-left':
                    handleUserLeft(data.uid);
                    break;

                case 'signal':
                    handleSignalMessage(data.fromUid, data.fromNickname, data.signal);
                    break;

                case 'user-media-state':
                    handleUserMediaState(data.uid, data.mic, data.camera);
                    break;

                case 'left-room':
                    cleanupCallState();
                    break;
            }
        };
    }

    function handleWsError() {
        // 切換下一個 host 重試 (127.0.0.1 <-> localhost)
        currentHostIndex = (currentHostIndex + 1) % wsHosts.length;
        setTimeout(initWebSocket, 2000);
    }

    initWebSocket();

    // ==== 渲染左側房間在線列表 ====
    function renderRoomsStatus(rooms) {
        if (!rooms) return;
        for (const roomId in rooms) {
            const roomData = rooms[roomId];
            const countBadge = document.getElementById(`count-${roomId}`);
            const usersSublist = document.getElementById(`users-${roomId}`);

            if (countBadge) {
                countBadge.textContent = `${roomData.users.length} 人`;
            }

            if (usersSublist) {
                usersSublist.innerHTML = '';
                roomData.users.forEach(u => {
                    const tag = document.createElement('div');
                    tag.className = 'room-user-tag';
                    tag.innerHTML = `
                        <span class="user-dot"></span>
                        <span>${escapeHtml(u.nickname)} ${u.uid === myUid ? '(我)' : ''}</span>
                    `;
                    usersSublist.appendChild(tag);
                });
            }
        }

        if (currentRoomId && rooms[currentRoomId]) {
            const count = rooms[currentRoomId].users.length;
            roomParticipantsCount.textContent = `${count} 位成員在線`;
        }
    }

    // ==== 核心：點擊房間立即進入通話 ====
    window.joinRoom = async function(roomId) {
        console.log('[Cobin] 點擊進入房間:', roomId);
        if (currentRoomId === roomId) return;

        if (currentRoomId) {
            await leaveRoomInternal();
        }

        currentRoomId = roomId;
        currentRoomName = roomNameMap[roomId] || roomId;
        currentRoomNameTitle.textContent = currentRoomName;

        // 1. 0 延遲切換 UI
        document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
        const activeItem = document.getElementById(`room-item-${roomId}`);
        if (activeItem) activeItem.classList.add('active');

        lobbyScreen.style.display = 'none';
        stageHeader.style.display = 'flex';
        videoGrid.style.display = 'grid';
        floatingActionBar.classList.remove('hidden');
        startCallTimer();
        adjustGridColumns();

        // 2. 獲取本地媒體 (鏡頭與麥克風)
        try {
            await initLocalMedia();
        } catch (err) {
            console.warn('[Cobin] 媒體請求失敗:', err);
            showToast('⚠️ 請允許存取麥克風與鏡頭');
        }

        // 3. 送出加入房間信令
        if (ws && ws.readyState === WebSocket.OPEN) {
            sendJoinRoomSignal(roomId);
        } else {
            pendingRoomId = roomId;
            showToast('🚀 正在連接信令伺服器...');
        }
    };

    function sendJoinRoomSignal(roomId) {
        ws.send(JSON.stringify({
            type: 'join-room',
            roomId: roomId,
            nickname: myNickname,
            micState: isMicEnabled,
            cameraState: isCameraEnabled
        }));
    }

    // ==== 初始化本地媒體 ====
    async function initLocalMedia() {
        if (!localStream) {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
                    audio: true
                });
            } catch (e) {
                try {
                    localStream = await navigator.mediaDevices.getUserMedia({
                        video: false,
                        audio: true
                    });
                    isCameraEnabled = false;
                } catch (e2) {
                    console.error('[Cobin] 存取麥克風失敗:', e2);
                }
            }

            if (localStream) {
                localVideo.srcObject = localStream;
                setupLocalAudioAnalysis(localStream);
            }
        }

        if (localStream) {
            localStream.getAudioTracks().forEach(t => t.enabled = isMicEnabled);
            localStream.getVideoTracks().forEach(t => t.enabled = isCameraEnabled);
        }

        updateCameraUI();
        updateMicUI();
    }

    // ==== 伺服器確認加入房間 ====
    async function handleJoinedRoomSuccess(data) {
        currentRoomName = data.roomName || currentRoomName;
        currentRoomNameTitle.textContent = currentRoomName;

        const existingUsers = data.users || [];
        roomParticipantsCount.textContent = `${existingUsers.length + 1} 位成員在線`;

        for (const user of existingUsers) {
            await createPeerConnection(user.uid, user.nickname, true);
        }
    }

    // ==== 新使用者加入房間 ====
    async function handleUserJoined(user) {
        if (user.uid === myUid) return;
        showToast(`👋 ${user.nickname} 加入了房間`);
        ensureUserVideoTile(user.uid, user.nickname);
    }

    // ==== 使用者離開房間 ====
    function handleUserLeft(uid) {
        if (peers[uid]) {
            showToast(`🏃 ${peers[uid].nickname || '成員'} 離開了房間`);
            if (peers[uid].pc) {
                peers[uid].pc.close();
            }
            if (peers[uid].videoTile) {
                peers[uid].videoTile.remove();
            }
            delete peers[uid];
            adjustGridColumns();
        }
    }

    // ==== 建立 WebRTC 連線 (Mesh P2P) ====
    async function createPeerConnection(targetUid, targetNickname, isInitiator) {
        if (peers[targetUid] && peers[targetUid].pc) {
            return peers[targetUid].pc;
        }

        const pc = new RTCPeerConnection(rtcConfig);
        const tile = ensureUserVideoTile(targetUid, targetNickname);

        peers[targetUid] = {
            pc: pc,
            nickname: targetNickname,
            videoTile: tile,
            videoEl: tile.querySelector('video'),
            avatarEl: tile.querySelector('.avatar-placeholder'),
            micIcon: tile.querySelector('.mic-status-icon')
        };

        if (localStream) {
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });
        }

        pc.ontrack = (event) => {
            const remoteStream = event.streams[0];
            const peerObj = peers[targetUid];
            if (peerObj && peerObj.videoEl) {
                peerObj.videoEl.srcObject = remoteStream;
                setupRemoteAudioAnalysis(remoteStream, targetUid);
            }
        };

        pc.onicecandidate = (event) => {
            if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'signal',
                    targetUid: targetUid,
                    signal: {
                        type: 'candidate',
                        candidate: event.candidate
                    }
                }));
            }
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                handleUserLeft(targetUid);
            }
        };

        if (isInitiator) {
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'signal',
                        targetUid: targetUid,
                        signal: {
                            type: 'offer',
                            sdp: pc.localDescription
                        }
                    }));
                }
            } catch (err) {
                console.error('[Cobin] 建立 Offer 失敗:', err);
            }
        }

        adjustGridColumns();
        return pc;
    }

    // ==== 處理信令 ====
    async function handleSignalMessage(fromUid, fromNickname, signal) {
        if (!signal) return;

        let pc = peers[fromUid]?.pc;
        if (!pc) {
            pc = await createPeerConnection(fromUid, fromNickname, false);
        }

        if (signal.type === 'offer') {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'signal',
                        targetUid: fromUid,
                        signal: {
                            type: 'answer',
                            sdp: pc.localDescription
                        }
                    }));
                }
            } catch (e) {
                console.error('[Cobin] 處理 Offer 失敗:', e);
            }
        } else if (signal.type === 'answer') {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
            } catch (e) {
                console.error('[Cobin] 處理 Answer 失敗:', e);
            }
        } else if (signal.type === 'candidate') {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
            } catch (e) {
                console.error('[Cobin] 加入 Candidate 失敗:', e);
            }
        }
    }

    // ==== 建立遠端視訊 Tile ====
    function ensureUserVideoTile(uid, nickname) {
        let tile = document.getElementById(`tile-${uid}`);
        if (!tile) {
            tile = document.createElement('div');
            tile.className = 'video-tile';
            tile.id = `tile-${uid}`;
            const initial = (nickname || 'U').charAt(0).toUpperCase();

            tile.innerHTML = `
                <video autoplay playsinline></video>
                <div class="avatar-placeholder" id="avatar-${uid}" style="display:none;">
                    <div class="avatar-circle-lg">${initial}</div>
                    <div class="avatar-name-lg">${escapeHtml(nickname)}</div>
                </div>
                <div class="video-tag">
                    <svg class="mic-status-icon" id="mic-icon-${uid}" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                    </svg>
                    <span>${escapeHtml(nickname)}</span>
                </div>
            `;
            videoGrid.appendChild(tile);
            adjustGridColumns();
        }
        return tile;
    }

    // ==== 遠端媒體狀態 ====
    function handleUserMediaState(uid, mic, camera) {
        const peer = peers[uid];
        if (!peer) return;

        if (peer.avatarEl) {
            peer.avatarEl.style.display = camera ? 'none' : 'flex';
        }
        if (peer.micIcon) {
            if (mic) {
                peer.micIcon.classList.remove('muted');
            } else {
                peer.micIcon.classList.add('muted');
            }
        }
    }

    // ==== 控制列：1. 螢幕分享 ====
    window.toggleScreenShare = async function() {
        if (!isScreenSharing) {
            try {
                screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                const screenTrack = screenStream.getVideoTracks()[0];

                for (const uid in peers) {
                    const sender = peers[uid].pc.getSenders().find(s => s.track && s.track.kind === 'video');
                    if (sender) {
                        sender.replaceTrack(screenTrack);
                    }
                }

                localVideo.srcObject = screenStream;
                localVideoTile.classList.add('is-screen');
                isScreenSharing = true;
                btnShareScreen.classList.add('active');

                screenTrack.onended = () => {
                    stopScreenShare();
                };

                showToast('🖥️ 已開啟螢幕分享');
            } catch (err) {
                console.error('[Cobin] 螢幕分享失敗:', err);
            }
        } else {
            stopScreenShare();
        }
    };

    function stopScreenShare() {
        if (!isScreenSharing) return;
        if (screenStream) {
            screenStream.getTracks().forEach(t => t.stop());
            screenStream = null;
        }

        if (localStream) {
            const camTrack = localStream.getVideoTracks()[0];
            for (const uid in peers) {
                const sender = peers[uid].pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender && camTrack) {
                    sender.replaceTrack(camTrack);
                }
            }
            localVideo.srcObject = localStream;
        }

        localVideoTile.classList.remove('is-screen');
        isScreenSharing = false;
        btnShareScreen.classList.remove('active');
        showToast('⏹️ 螢幕分享已結束');
    }

    // ==== 控制列：2. 複製邀請連結 ====
    window.copyInviteLink = function() {
        const url = `${window.location.origin}${window.location.pathname}?room=${currentRoomId || 'room-1'}`;
        navigator.clipboard.writeText(url).then(() => {
            showToast('🔗 已複製房間連結，發給好友即可進入！');
        }).catch(() => {
            showToast('🔗 連結: ' + url);
        });
    };

    // ==== 控制列：3. 鏡頭切換 ====
    window.toggleCamera = function() {
        if (!localStream) return;
        isCameraEnabled = !isCameraEnabled;

        localStream.getVideoTracks().forEach(t => t.enabled = isCameraEnabled);
        updateCameraUI();

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'media-state',
                mic: isMicEnabled,
                camera: isCameraEnabled
            }));
        }
    };

    function updateCameraUI() {
        if (isCameraEnabled) {
            btnCamera.classList.remove('off');
            camIconOn.style.display = 'block';
            camIconOff.style.display = 'none';
            localAvatarPlaceholder.style.display = 'none';
        } else {
            btnCamera.classList.add('off');
            camIconOn.style.display = 'none';
            camIconOff.style.display = 'block';
            localAvatarPlaceholder.style.display = 'flex';
        }
    }

    // ==== 控制列：4. 麥克風切換 ====
    window.toggleMic = function() {
        if (!localStream) return;
        isMicEnabled = !isMicEnabled;

        localStream.getAudioTracks().forEach(t => t.enabled = isMicEnabled);
        updateMicUI();

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'media-state',
                mic: isMicEnabled,
                camera: isCameraEnabled
            }));
        }
    };

    function updateMicUI() {
        if (isMicEnabled) {
            btnMic.classList.remove('off');
            micIconOn.style.display = 'block';
            micIconOff.style.display = 'none';
            localMicIndicator.classList.remove('muted');
        } else {
            btnMic.classList.add('off');
            micIconOn.style.display = 'none';
            micIconOff.style.display = 'block';
            localMicIndicator.classList.add('muted');
        }
    }

    // ==== 控制列：5. 紅色掛斷 / 離開房間 ====
    window.leaveRoom = async function() {
        await leaveRoomInternal();
        showToast('📞 已退出通話');
    };

    async function leaveRoomInternal() {
        if (!currentRoomId) return;

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'leave-room' }));
        }

        cleanupCallState();
    }

    function cleanupCallState() {
        stopScreenShare();

        if (localStream) {
            localStream.getTracks().forEach(t => t.stop());
            localStream = null;
        }

        for (const uid in peers) {
            if (peers[uid].pc) peers[uid].pc.close();
            if (peers[uid].videoTile) peers[uid].videoTile.remove();
            delete peers[uid];
        }

        if (callTimerInterval) {
            clearInterval(callTimerInterval);
            callTimerInterval = null;
        }

        currentRoomId = null;
        currentRoomName = '';

        document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
        stageHeader.style.display = 'none';
        videoGrid.style.display = 'none';
        floatingActionBar.classList.add('hidden');
        lobbyScreen.style.display = 'flex';
    }

    // ==== 視訊網格排版 ====
    function adjustGridColumns() {
        const totalUsers = Object.keys(peers).length + 1;
        if (totalUsers === 1) {
            videoGrid.className = 'video-grid-container single-user';
        } else {
            videoGrid.className = 'video-grid-container';
        }
    }

    // ==== 通話計時器 ====
    function startCallTimer() {
        callStartTimestamp = Date.now();
        if (callTimerInterval) clearInterval(callTimerInterval);

        callTimerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - callStartTimestamp) / 1000);
            const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
            const secs = String(elapsed % 60).padStart(2, '0');
            callDurationTimer.textContent = `${mins}:${secs}`;
        }, 1000);
    }

    // ==== 說話波形分析 ====
    function setupLocalAudioAnalysis(stream) {
        try {
            if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            const buffer = new Uint8Array(analyser.frequencyBinCount);
            function detectSpeaking() {
                if (!localStream) return;
                analyser.getByteFrequencyData(buffer);
                let sum = 0;
                for (let i = 0; i < buffer.length; i++) sum += buffer[i];
                const avg = sum / buffer.length;
                if (avg > 25 && isMicEnabled) {
                    localVideoTile.classList.add('speaking');
                } else {
                    localVideoTile.classList.remove('speaking');
                }
                requestAnimationFrame(detectSpeaking);
            }
            detectSpeaking();
        } catch (e) {}
    }

    function setupRemoteAudioAnalysis(stream, uid) {
        try {
            if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            const buffer = new Uint8Array(analyser.frequencyBinCount);
            function detectRemoteSpeaking() {
                if (!peers[uid]) return;
                analyser.getByteFrequencyData(buffer);
                let sum = 0;
                for (let i = 0; i < buffer.length; i++) sum += buffer[i];
                const avg = sum / buffer.length;
                if (avg > 25 && peers[uid].videoTile) {
                    peers[uid].videoTile.classList.add('speaking');
                } else if (peers[uid]?.videoTile) {
                    peers[uid].videoTile.classList.remove('speaking');
                }
                requestAnimationFrame(detectRemoteSpeaking);
            }
            detectRemoteSpeaking();
        } catch (e) {}
    }

    // ==== 暱稱修改 Modal ====
    window.openNicknameModal = function() {
        nicknameInput.value = myNickname;
        nicknameModal.classList.add('show');
        nicknameInput.focus();
    };

    window.closeNicknameModal = function() {
        nicknameModal.classList.remove('show');
    };

    window.saveNickname = function() {
        const val = nicknameInput.value.trim();
        if (val) {
            myNickname = val;
            try { localStorage.setItem('cobin_nickname', myNickname); } catch (e) {}
            updateMyProfileUI();
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'init',
                    nickname: myNickname
                }));
            }
            showToast('✅ 暱稱修改成功');
        }
        closeNicknameModal();
    };

    nicknameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') saveNickname();
    });

    // ==== Toast 提示 ====
    let toastTimeout = null;
    function showToast(text) {
        toastMsg.textContent = text;
        toastMsg.classList.add('show');
        if (toastTimeout) clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            toastMsg.classList.remove('show');
        }, 2800);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, (s) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[s]));
    }
})();
