// app.js - Cobin Voice & Video (多房間 WebRTC Mesh 即時通話邏輯)

(() => {
    // ==== 基礎變數與狀態 ====
    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // 若在本地環境 (file:// 或 localhost)，強制使用 127.0.0.1 避免 Windows IPv6 ::1 解析失敗
    let host = location.hostname;
    if (!host || host === 'localhost' || host === '') {
        host = '127.0.0.1';
    }
    const wsPort = '8080';
    const wsUrl = `${wsProtocol}//${host}:${wsPort}`;

    let ws = null;
    let myUid = null;
    let myNickname = '用戶 ' + Math.floor(1000 + Math.random() * 9000);
    try {
        const saved = localStorage.getItem('cobin_nickname');
        if (saved) myNickname = saved;
    } catch (e) {}
    let currentRoomId = null;
    let currentRoomName = '';

    // 媒體狀態
    let localStream = null;
    let screenStream = null;
    let isMicEnabled = true;
    let isCameraEnabled = true;
    let isScreenSharing = false;

    // WebRTC PeerConnections: { [targetUid]: { pc, nickname, videoElement, audioAnalyser } }
    const peers = {};

    // 通話計時
    let callTimerInterval = null;
    let callStartTimestamp = 0;

    // 音訊檢測 (Speaking Indicator)
    let audioContext = null;

    // ICE 配置 (Google 公開 STUN 伺服器)
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

    // ==== 初始化使用者介面 ====
    function updateMyProfileUI() {
        myNicknameText.textContent = myNickname;
        myAvatarSm.textContent = myNickname.charAt(0).toUpperCase();
        localAvatarCircle.textContent = myNickname.charAt(0).toUpperCase();
        localAvatarName.textContent = myNickname;
        localTagLabel.textContent = `${myNickname} (我)`;
    }
    updateMyProfileUI();

    // ==== WebSocket 連線 ====
    function initWebSocket() {
        ws = new WebSocket(wsUrl);

        ws.addEventListener('open', () => {
            wsStatusTag.textContent = '🟢 已連線';
            wsStatusTag.style.color = 'var(--accent-green)';
            console.log('WebSocket 連線成功:', wsUrl);
            // 發送初始資訊
            ws.send(JSON.stringify({
                type: 'init',
                nickname: myNickname
            }));

            // 檢查 URL 是否有 room 參數，自動加入
            const urlParams = new URLSearchParams(window.location.search);
            const targetRoom = urlParams.get('room');
            if (targetRoom && ['room-1', 'room-2', 'room-3'].includes(targetRoom)) {
                joinRoom(targetRoom);
            }
        });

        ws.addEventListener('close', () => {
            wsStatusTag.textContent = '🔴 未連線 (重試中)';
            wsStatusTag.style.color = 'var(--accent-red)';
            // 2 秒後自動重連
            setTimeout(initWebSocket, 2000);
        });

        ws.addEventListener('error', (err) => {
            console.error('WebSocket Error:', err);
        });

        ws.addEventListener('message', async (event) => {
            let data;
            try {
                data = JSON.parse(event.data);
            } catch (e) {
                return;
            }

            switch (data.type) {
                case 'init-ack':
                    myUid = data.uid;
                    break;

                case 'rooms-status':
                    renderRoomsStatus(data.rooms);
                    break;

                case 'joined-room':
                    handleJoinedRoom(data);
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
        });
    }

    initWebSocket();

    // ==== 渲染左側房間列表狀態 ====
    function renderRoomsStatus(rooms) {
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

        // 更新頂部人數
        if (currentRoomId && rooms[currentRoomId]) {
            const count = rooms[currentRoomId].users.length;
            roomParticipantsCount.textContent = `${count} 位成員在線`;
        }
    }

    // ==== 加入房間邏輯 ====
    window.joinRoom = async function(roomId) {
        if (currentRoomId === roomId) return; // 已經在該房間

        // 若已在其他房間，先離開
        if (currentRoomId) {
            await leaveRoomInternal();
        }

        currentRoomId = roomId;

        // 醒目切換邊欄 Active 樣式
        document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
        const activeItem = document.getElementById(`room-item-${roomId}`);
        if (activeItem) activeItem.classList.add('active');

        // 取得本地攝影機與麥克風
        try {
            await initLocalMedia();
        } catch (err) {
            console.error('取得媒體權限失敗:', err);
            showToast('⚠️ 無法存取麥克風/鏡頭，請確認瀏覽器權限');
        }

        // 發送加入房間信令
        ws.send(JSON.stringify({
            type: 'join-room',
            roomId: roomId,
            nickname: myNickname,
            micState: isMicEnabled,
            cameraState: isCameraEnabled
        }));
    };

    // ==== 本地媒體初始化 ====
    async function initLocalMedia() {
        if (!localStream) {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
                    audio: true
                });
            } catch (e) {
                // 如果沒有鏡頭或鏡頭失敗，嘗試只開音訊
                localStream = await navigator.mediaDevices.getUserMedia({
                    video: false,
                    audio: true
                });
                isCameraEnabled = false;
            }

            localVideo.srcObject = localStream;
            setupLocalAudioAnalysis(localStream);
        }

        // 套用目前開關設定
        localStream.getAudioTracks().forEach(t => t.enabled = isMicEnabled);
        localStream.getVideoTracks().forEach(t => t.enabled = isCameraEnabled);

        updateCameraUI();
        updateMicUI();
    }

    // ==== 處理已成功加入房間 ====
    async function handleJoinedRoom(data) {
        currentRoomName = data.roomName;
        currentRoomNameTitle.textContent = currentRoomName;

        // 切換主畫面：隱藏大廳，顯示視訊網格與懸浮控制條
        lobbyScreen.style.display = 'none';
        stageHeader.style.display = 'flex';
        videoGrid.style.display = 'grid';
        floatingActionBar.classList.remove('hidden');

        startCallTimer();
        adjustGridColumns();

        // 與同房間已有使用者發起 WebRTC 連線 (Mesh 架構)
        const existingUsers = data.users || [];
        for (const user of existingUsers) {
            await createPeerConnection(user.uid, user.nickname, true);
        }
    }

    // ==== 處理其他使用者加入房間 ====
    async function handleUserJoined(user) {
        if (user.uid === myUid) return;
        showToast(`👋 ${user.nickname} 加入了通話`);
        // 等待對方發起 offer，或在此建立連線佔位 DOM
        ensureUserVideoTile(user.uid, user.nickname);
    }

    // ==== 處理其他使用者離開房間 ====
    function handleUserLeft(uid) {
        if (peers[uid]) {
            showToast(`🏃 ${peers[uid].nickname || '成員'} 離開了通話`);
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

    // ==== 建立 RTCPeerConnection (P2P Mesh) ====
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

        // 加入本地 Tracks
        if (localStream) {
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });
        }

        // 遠端 Track 到達事件
        pc.ontrack = (event) => {
            const remoteStream = event.streams[0];
            const peerObj = peers[targetUid];
            if (peerObj && peerObj.videoEl) {
                peerObj.videoEl.srcObject = remoteStream;
                setupRemoteAudioAnalysis(remoteStream, targetUid);
            }
        };

        // ICE Candidate 收集並透過 WebSocket 發送給目標
        pc.onicecandidate = (event) => {
            if (event.candidate) {
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

        // 連線狀態監聽
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                handleUserLeft(targetUid);
            }
        };

        // 若為主動發起者，建立 Offer
        if (isInitiator) {
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                ws.send(JSON.stringify({
                    type: 'signal',
                    targetUid: targetUid,
                    signal: {
                        type: 'offer',
                        sdp: pc.localDescription
                    }
                }));
            } catch (err) {
                console.error('建立 Offer 失敗:', err);
            }
        }

        adjustGridColumns();
        return pc;
    }

    // ==== 處理信令訊息 (Offer / Answer / Candidate) ====
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
                ws.send(JSON.stringify({
                    type: 'signal',
                    targetUid: fromUid,
                    signal: {
                        type: 'answer',
                        sdp: pc.localDescription
                    }
                }));
            } catch (e) {
                console.error('處理 Offer 失敗:', e);
            }
        } else if (signal.type === 'answer') {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
            } catch (e) {
                console.error('處理 Answer 失敗:', e);
            }
        } else if (signal.type === 'candidate') {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
            } catch (e) {
                console.error('加入 ICE Candidate 失敗:', e);
            }
        }
    }

    // ==== 動態建立 / 取得遠端視訊 Tile ====
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

    // ==== 遠端媒體狀態更新 ====
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

    // ==== 浮動控制列功能 ====

    // 1. 螢幕分享 (toggleScreenShare)
    window.toggleScreenShare = async function() {
        if (!isScreenSharing) {
            try {
                screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                const screenTrack = screenStream.getVideoTracks()[0];

                // 替換所有 peerConnection 中的 video track
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

                // 使用者點選瀏覽器內建「停止共用」時的監聽
                screenTrack.onended = () => {
                    stopScreenShare();
                };

                showToast('🖥️ 已開始分享螢幕');
            } catch (err) {
                console.error('螢幕分享失敗:', err);
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

        // 恢復本地攝影機
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
        showToast('⏹️ 已停止螢幕分享');
    }

    // 2. 邀請成員 / 複製房間連結
    window.copyInviteLink = function() {
        const url = `${window.location.origin}${window.location.pathname}?room=${currentRoomId || 'room-1'}`;
        navigator.clipboard.writeText(url).then(() => {
            showToast('🔗 已複製房間邀請連結，可直接分享給好友！');
        }).catch(() => {
            showToast('🔗 邀請連結: ' + url);
        });
    };

    // 3. 鏡頭切換 (toggleCamera)
    window.toggleCamera = function() {
        if (!localStream) return;
        isCameraEnabled = !isCameraEnabled;

        localStream.getVideoTracks().forEach(t => t.enabled = isCameraEnabled);
        updateCameraUI();

        // 廣播媒體狀態給同房間其他成員
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

    // 4. 麥克風切換 (toggleMic)
    window.toggleMic = function() {
        if (!localStream) return;
        isMicEnabled = !isMicEnabled;

        localStream.getAudioTracks().forEach(t => t.enabled = isMicEnabled);
        updateMicUI();

        // 廣播媒體狀態
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

    // 5. 掛斷 / 離開房間
    window.leaveRoom = async function() {
        await leaveRoomInternal();
        showToast('📞 已結束通話並離開房間');
    };

    async function leaveRoomInternal() {
        if (!currentRoomId) return;

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'leave-room' }));
        }

        cleanupCallState();
    }

    // 清理通話狀態與還原 UI
    function cleanupCallState() {
        stopScreenShare();

        // 停止本地媒體
        if (localStream) {
            localStream.getTracks().forEach(t => t.stop());
            localStream = null;
        }

        // 關閉並清理所有 PeerConnections
        for (const uid in peers) {
            if (peers[uid].pc) peers[uid].pc.close();
            if (peers[uid].videoTile) peers[uid].videoTile.remove();
            delete peers[uid];
        }

        // 停止計時器
        if (callTimerInterval) {
            clearInterval(callTimerInterval);
            callTimerInterval = null;
        }

        currentRoomId = null;
        currentRoomName = '';

        // 重設 UI
        document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
        stageHeader.style.display = 'none';
        videoGrid.style.display = 'none';
        floatingActionBar.classList.add('hidden');
        lobbyScreen.style.display = 'flex';
    }

    // ==== 視訊 Grid 自適應排版 ====
    function adjustGridColumns() {
        const totalUsers = Object.keys(peers).length + 1; // +1 本地
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

    // ==== 說話指示器 (Speaking Indicator) 聲音分析 ====
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
            localStorage.setItem('cobin_nickname', myNickname);
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

    // ==== Toast 提示函式 ====
    let toastTimeout = null;
    function showToast(text) {
        toastMsg.textContent = text;
        toastMsg.classList.add('show');
        if (toastTimeout) clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            toastMsg.classList.remove('show');
        }, 2800);
    }

    // 輔助函式：跳脫 HTML 避免 XSS
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
