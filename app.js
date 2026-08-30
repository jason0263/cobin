// app.js - Cobin Voice & Video (多房間 WebRTC 即時通話完整前端邏輯)

(() => {
    console.log('[Cobin] app.js 已載入');

    // ==== 動態解析 WebSocket 信令位址 ====
    // 支援：本地開發 (127.0.0.1:8080)、雲端部署 (Nginx /ws 反向代理)、自訂 ?ws= 參數
    const urlParams = new URLSearchParams(window.location.search);
    const customWs = urlParams.get('ws');

    let wsUrl = '';
    if (customWs) {
        wsUrl = customWs.startsWith('ws') ? customWs : `ws://${customWs}`;
    } else if (location.protocol === 'file:' || location.hostname === '' || location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        wsUrl = 'ws://127.0.0.1:8080';
    } else if (location.protocol === 'https:') {
        wsUrl = `wss://${location.host}/ws`;
    } else {
        wsUrl = `ws://${location.host}/ws`;
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

    // 媒體狀態 (預設關閉鏡頭、開啟麥克風)
    let localStream = null;
    let screenStream = null;
    let isMicEnabled = true;
    let isCameraEnabled = false;
    let isScreenSharing = false;

    // WebRTC PeerConnections: { [targetUid]: { pc, nickname, videoTile, videoEl, avatarEl, micIcon, pendingCandidates } }
    const peers = {};

    // 通話計時
    let callTimerInterval = null;
    let callStartTimestamp = 0;

    // 音訊檢測 (Speaking Indicator)
    let audioContext = null;

    // 大屏幕 Spotlight 控制
    let spotlightUid = null;

    // ICE 配置 (全球多節點 STUN 伺服器池，支援移動網路與跨網穿透)
    const rtcConfig = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
        ],
        iceCandidatePoolSize: 10
    };

    // ==== DOM 元素快取 ====
    const wsStatusTag = document.getElementById('wsStatusTag');
    const globalStatusText = document.getElementById('globalStatusText');
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
    const localScreenBadge = document.getElementById('localScreenBadge');

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
        if (myNicknameText) myNicknameText.textContent = myNickname;
        if (myAvatarSm) myAvatarSm.textContent = myNickname.charAt(0).toUpperCase();
        if (localAvatarCircle) localAvatarCircle.textContent = myNickname.charAt(0).toUpperCase();
        if (localAvatarName) localAvatarName.textContent = myNickname;
        if (localTagLabel) localTagLabel.textContent = `${myNickname} (我)`;
    }
    updateMyProfileUI();

    // ==== WebSocket 連線核心 ====
    function initWebSocket() {
        console.log(`[Cobin] 嘗試連線至信令伺服器: ${wsUrl}`);

        try {
            ws = new WebSocket(wsUrl);
        } catch (err) {
            console.error('[Cobin] WebSocket 創建失敗:', err);
            setTimeout(initWebSocket, 2000);
            return;
        }

        ws.onopen = () => {
            console.log(`[Cobin] ✅ WebSocket 成功連線 (${wsUrl})`);
            if (wsStatusTag) {
                wsStatusTag.textContent = '🟢 已連線';
                wsStatusTag.style.color = 'var(--accent-green)';
            }
            if (globalStatusText) {
                globalStatusText.textContent = '🟢 伺服器在線';
                globalStatusText.parentElement.style.borderColor = 'rgba(35, 165, 90, 0.4)';
                globalStatusText.parentElement.style.color = 'var(--accent-green)';
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
            if (globalStatusText) {
                globalStatusText.textContent = '🔴 連線中斷 (重試中)';
                globalStatusText.parentElement.style.borderColor = 'rgba(242, 63, 67, 0.4)';
                globalStatusText.parentElement.style.color = 'var(--accent-red)';
            }
            setTimeout(initWebSocket, 2000);
        };

        ws.onerror = (err) => {
            console.error('[Cobin] WebSocket 發生錯誤:', err);
        };

        ws.onmessage = (event) => {
            let data;
            try {
                data = JSON.parse(event.data);
            } catch (e) {
                console.error('[Cobin] 訊息 JSON 解析失敗:', event.data);
                return;
            }

            console.log('[Cobin] 收到伺服器訊息:', data.type, data);

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
                    handleUserMediaState(data.uid, data.mic, data.camera, data.isScreen);
                    break;

                case 'left-room':
                    cleanupCallState();
                    break;
            }
        };
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
            if (roomParticipantsCount) {
                roomParticipantsCount.textContent = `${count} 位成員在線`;
            }
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
        if (currentRoomNameTitle) currentRoomNameTitle.textContent = currentRoomName;

        // 1. 切換 UI
        document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
        const activeItem = document.getElementById(`room-item-${roomId}`);
        if (activeItem) activeItem.classList.add('active');

        if (lobbyScreen) lobbyScreen.style.display = 'none';
        if (stageHeader) stageHeader.style.display = 'flex';
        if (videoGrid) videoGrid.style.display = 'flex';
        if (floatingActionBar) floatingActionBar.classList.remove('hidden');
        startCallTimer();
        updateStageLayout();

        // 📱 啟動手機後台通話守護引擎 (確保退到主畫面/切換App/玩遊戲時語音不中斷)
        startBackgroundAudioKeeper();

        // 2. 獲取本地媒體 (鏡頭與麥克風)
        try {
            await initLocalMedia();
        } catch (err) {
            console.warn('[Cobin] 媒體請求失敗:', err);
            showToast('⚠️ 請允許存取麥克風以進行語音通話');
        }

        // 3. 發送加入房間信令
        if (ws && ws.readyState === WebSocket.OPEN) {
            sendJoinRoomSignal(roomId);
        } else {
            pendingRoomId = roomId;
            showToast('🔄 伺服器連線中，連上後將自動進入房間...');
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

    // ==== 📱 手機端音訊全域解鎖器 (解決 iOS / Android 揚聲器靜音與自動播放政策) ====
    function unlockMobileAudio() {
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume().catch(() => {});
        }
        document.querySelectorAll('audio, video').forEach(el => {
            if (el.srcObject && el.paused) {
                el.play().catch(() => {});
            }
        });
    }
    window.addEventListener('click', unlockMobileAudio, { passive: true });
    window.addEventListener('touchstart', unlockMobileAudio, { passive: true });

    // ==== 初始化本地媒體 (預設純麥克風，保護隱私且秒進房間) ====
    async function initLocalMedia() {
        if (!localStream) {
            const audioConstraints = {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            };

            try {
                localStream = await navigator.mediaDevices.getUserMedia({
                    video: false,
                    audio: audioConstraints
                });
            } catch (e) {
                console.error('[Cobin] 存取麥克風失敗:', e);
                showToast('⚠️ 請允許存取麥克風以進行語音通話');
            }

            if (localStream && localVideo) {
                setupLocalAudioAnalysis(localStream);
            }
        }

        if (localStream) {
            localStream.getAudioTracks().forEach(t => t.enabled = isMicEnabled);
        }

        updateCameraUI();
        updateMicUI();
    }

    // ==== 伺服器確認加入房間 (作為發起方建立連線) ====
    async function handleJoinedRoomSuccess(data) {
        currentRoomName = data.roomName || currentRoomName;
        if (currentRoomNameTitle) currentRoomNameTitle.textContent = currentRoomName;

        const existingUsers = data.users || [];
        if (roomParticipantsCount) {
            roomParticipantsCount.textContent = `${existingUsers.length + 1} 位成員在線`;
        }

        // 確保本地媒體已獲取
        if (!localStream) {
            await initLocalMedia();
        }

        for (const user of existingUsers) {
            await createPeerConnection(user.uid, user.nickname, true);
        }
    }

    // ==== 🎵 語音房進出提示音系統 (Web Audio API 即時合成音效，一個高音一個低音) ====
    function playToneSound(type) {
        try {
            const ctx = audioContext || new (window.AudioContext || window.webkitAudioContext)();
            if (ctx.state === 'suspended') {
                ctx.resume().catch(() => {});
            }

            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.connect(gain);
            gain.connect(ctx.destination);

            if (type === 'join') {
                // 🔔 進房高音提示 (輕快雙音階: 587Hz -> 880Hz, 叮咚~)
                osc.type = 'sine';
                osc.frequency.setValueAtTime(587.33, now); // D5
                osc.frequency.setValueAtTime(880.00, now + 0.12); // A5

                gain.gain.setValueAtTime(0.001, now);
                gain.gain.linearRampToValueAtTime(0.20, now + 0.03);
                gain.gain.linearRampToValueAtTime(0.15, now + 0.12);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.40);

                osc.start(now);
                osc.stop(now + 0.42);
            } else if (type === 'leave') {
                // 🚪 退房低音提示 (柔和下降階: 659Hz -> 392Hz, 咚冬~)
                osc.type = 'sine';
                osc.frequency.setValueAtTime(659.25, now); // E5
                osc.frequency.setValueAtTime(392.00, now + 0.12); // G4

                gain.gain.setValueAtTime(0.001, now);
                gain.gain.linearRampToValueAtTime(0.18, now + 0.03);
                gain.gain.linearRampToValueAtTime(0.12, now + 0.12);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

                osc.start(now);
                osc.stop(now + 0.48);
            }
        } catch (e) {
            console.warn('[Cobin] 提示音播放失敗:', e);
        }
    }

    // ==== 新使用者加入房間 (舊成員立即預先建立 PeerConnection 並注入本地音訊) ====
    async function handleUserJoined(user) {
        if (user.uid === myUid) return;
        showToast(`👋 ${user.nickname} 加入了房間`);
        playToneSound('join'); // 🔔 播放高音進房提示音
        ensureUserVideoTile(user.uid, user.nickname);

        if (!localStream) {
            await initLocalMedia();
        }

        // 舊成員立即建立 PeerConnection 注入本地麥克風 Track，確保 Answer 生成 sendrecv 雙向音訊
        await createPeerConnection(user.uid, user.nickname, false);
    }

    // ==== 使用者離開房間 ====
    function handleUserLeft(uid) {
        if (peers[uid]) {
            showToast(`🏃 ${peers[uid].nickname || '成員'} 離開了房間`);
            playToneSound('leave'); // 🚪 播放低音退房提示音
            if (peers[uid].pc) {
                peers[uid].pc.close();
            }
            if (peers[uid].videoTile) {
                peers[uid].videoTile.remove();
            }
            const audioEl = document.getElementById(`audio-${uid}`);
            if (audioEl) audioEl.remove();

            delete peers[uid];
            if (spotlightUid === uid) {
                spotlightUid = null;
            }
            updateStageLayout();
        }
    }

    // ==== 建立 WebRTC 連線 (Mesh P2P) ====
    async function createPeerConnection(targetUid, targetNickname, isInitiator) {
        if (peers[targetUid] && peers[targetUid].pc) {
            return peers[targetUid].pc;
        }

        const pc = new RTCPeerConnection(rtcConfig);
        const tile = ensureUserVideoTile(targetUid, targetNickname);
        const videoEl = tile.querySelector('video');

        // 預先註冊 video 與 audio 的 sendrecv 收發器 (保證 WebRTC 始終具備視訊通道，螢幕分享 0 秒即時推送)
        try {
            pc.addTransceiver('audio', { direction: 'sendrecv' });
            pc.addTransceiver('video', { direction: 'sendrecv' });
        } catch (e) {}

        // 建立獨立隱藏的 <audio> 播放器 (雙保險保證手機揚聲器 100% 播放)
        let audioEl = document.getElementById(`audio-${targetUid}`);
        if (!audioEl) {
            audioEl = document.createElement('audio');
            audioEl.id = `audio-${targetUid}`;
            audioEl.autoplay = true;
            audioEl.playsInline = true;
            audioEl.setAttribute('playsinline', '');
            audioEl.setAttribute('webkit-playsinline', '');
            audioEl.style.display = 'none';
            document.body.appendChild(audioEl);
        }

        peers[targetUid] = {
            pc: pc,
            nickname: targetNickname,
            videoTile: tile,
            videoEl: videoEl,
            audioEl: audioEl,
            avatarEl: tile.querySelector('.avatar-placeholder'),
            micIcon: tile.querySelector('.mic-status-icon'),
            pendingCandidates: []
        };

        // 加入本地軌道 (若已存在對應發送器則使用 replaceTrack)
        if (localStream) {
            localStream.getTracks().forEach(track => {
                const senders = pc.getSenders();
                const sender = senders.find(s => s.track && s.track.kind === track.kind);
                if (sender) {
                    sender.replaceTrack(track);
                } else {
                    try { pc.addTrack(track, localStream); } catch (e) {}
                }
            });
        }

        // 接收遠端軌道 (雙通道純淨軌道分離，徹底解決手機黑屏與播放受限)
        pc.ontrack = (event) => {
            console.log(`[Cobin] 收到遠端軌道 (${targetNickname || targetUid}): ${event.track.kind}`);
            const peerObj = peers[targetUid];
            if (!peerObj) return;

            if (event.track.kind === 'video') {
                // 1. 純視訊軌道綁定至 <video> 標籤 (純畫面，100% 繞過手機音訊封鎖與黑屏)
                const videoStream = new MediaStream([event.track]);
                if (peerObj.videoEl) {
                    peerObj.videoEl.muted = true;
                    peerObj.videoEl.playsInline = true;
                    peerObj.videoEl.setAttribute('playsinline', '');
                    peerObj.videoEl.setAttribute('webkit-playsinline', '');
                    peerObj.videoEl.srcObject = videoStream;
                    peerObj.videoEl.play().catch(err => {
                        console.warn('[Cobin] 視訊播放重試:', err);
                    });
                }
                if (peerObj.avatarEl) {
                    peerObj.avatarEl.style.display = 'none';
                }
            } else if (event.track.kind === 'audio') {
                // 2. 純音訊軌道綁定至獨立 <audio> 標籤 (100% 確保揚聲器與耳機響亮清晰)
                const audioStream = new MediaStream([event.track]);
                if (peerObj.audioEl) {
                    peerObj.audioEl.muted = false;
                    peerObj.audioEl.volume = 1.0;
                    peerObj.audioEl.srcObject = audioStream;
                    peerObj.audioEl.play().catch(err => {
                        console.warn('[Cobin] 音訊播放等待點擊解鎖:', err);
                    });
                }
                setupRemoteAudioAnalysis(audioStream, targetUid);
            }
        };

        pc.onicecandidate = (event) => {
            if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'signal',
                    targetUid: targetUid,
                    signal: {
                        type: 'candidate',
                        candidate: event.candidate.candidate,
                        sdpMid: event.candidate.sdpMid,
                        sdpMLineIndex: event.candidate.sdpMLineIndex
                    }
                }));
            }
        };

        pc.onconnectionstatechange = () => {
            console.log(`[Cobin] P2P 連線狀態 (${targetNickname || targetUid}): ${pc.connectionState}`);
            if (pc.connectionState === 'connected') {
                showToast(`🟢 已與 ${targetNickname || '成員'} 建立即時通話！`);
            } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                handleUserLeft(targetUid);
            }
        };

        if (isInitiator) {
            // 立即發起握手
            initiateHandshake(targetUid);
            // 800ms 自動確保留存握手 (確保即使首次信令延遲也能 100% 打通)
            setTimeout(() => {
                if (peers[targetUid]?.pc && peers[targetUid].pc.connectionState !== 'connected') {
                    console.log(`[Cobin] 觸發連線自動握手確認 (${targetNickname || targetUid})`);
                    initiateHandshake(targetUid);
                }
            }, 800);
        }

        updateStageLayout();
        return pc;
    }

    // ==== 核心：發起 WebRTC 握手 Offer ====
    async function initiateHandshake(targetUid) {
        const peerObj = peers[targetUid];
        if (!peerObj || !peerObj.pc) return;
        const pc = peerObj.pc;

        // 確保本地麥克風與相機軌道已完全注入
        if (localStream) {
            localStream.getTracks().forEach(track => {
                const senders = pc.getSenders();
                const exists = senders.some(s => s.track && (s.track.id === track.id || s.track.kind === track.kind));
                if (!exists) {
                    try { pc.addTrack(track, localStream); } catch (e) {}
                }
            });
        }

        try {
            const offer = await pc.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            await pc.setLocalDescription(offer);

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'signal',
                    targetUid: targetUid,
                    signal: {
                        type: 'offer',
                        sdp: pc.localDescription.sdp
                    }
                }));
            }
        } catch (err) {
            console.warn('[Cobin] 發起 Offer 握手重試:', err);
        }
    }

    // ==== 萬能容錯 SDP 與 ICE Candidate 解析器 ====
    function parseSessionDescription(signal, expectedType) {
        if (!signal) return null;
        let sdpStr = '';
        let typeStr = signal.type || expectedType;

        if (typeof signal === 'string') {
            sdpStr = signal;
        } else if (typeof signal.sdp === 'string') {
            sdpStr = signal.sdp;
        } else if (signal.sdp && typeof signal.sdp.sdp === 'string') {
            sdpStr = signal.sdp.sdp;
            typeStr = signal.sdp.type || typeStr;
        }

        if (!sdpStr) return null;

        return new RTCSessionDescription({
            type: typeStr,
            sdp: sdpStr
        });
    }

    function parseIceCandidate(candData) {
        if (!candData) return null;
        try {
            if (typeof candData === 'string') {
                return new RTCIceCandidate({ candidate: candData });
            }
            const candidateStr = candData.candidate || (candData.candidate && candData.candidate.candidate) || '';
            const sdpMid = candData.sdpMid !== undefined ? candData.sdpMid : (candData.candidate && candData.candidate.sdpMid);
            const sdpMLineIndex = candData.sdpMLineIndex !== undefined ? candData.sdpMLineIndex : (candData.candidate && candData.candidate.sdpMLineIndex);

            return new RTCIceCandidate({
                candidate: candidateStr,
                sdpMid: sdpMid,
                sdpMLineIndex: sdpMLineIndex !== null && sdpMLineIndex !== undefined ? Number(sdpMLineIndex) : null
            });
        } catch (e) {
            return null;
        }
    }

    // ==== 處理信令 (含 ICE Candidate 隊列防止掉包) ====
    async function handleSignalMessage(fromUid, fromNickname, signal) {
        if (!signal) return;

        let peerObj = peers[fromUid];
        if (!peerObj || !peerObj.pc) {
            await createPeerConnection(fromUid, fromNickname, false);
            peerObj = peers[fromUid];
        }

        const pc = peerObj?.pc;
        if (!pc) return;

        if (signal.type === 'offer') {
            try {
                // 確保在建立 Answer 之前，本地麥克風軌道已全數注入 pc，保證 Answer 為 sendrecv 雙向音訊
                if (!localStream) {
                    await initLocalMedia();
                }
                if (localStream) {
                    localStream.getTracks().forEach(track => {
                        const senders = pc.getSenders();
                        const exists = senders.some(s => s.track && (s.track.id === track.id || s.track.kind === track.kind));
                        if (!exists) {
                            try { pc.addTrack(track, localStream); } catch (e) {}
                        }
                    });
                }

                const rtcDesc = parseSessionDescription(signal, 'offer');
                if (rtcDesc) {
                    await pc.setRemoteDescription(rtcDesc);

                    if (peerObj.pendingCandidates && peerObj.pendingCandidates.length > 0) {
                        for (const rawCand of peerObj.pendingCandidates) {
                            const cand = parseIceCandidate(rawCand);
                            if (cand) {
                                try { await pc.addIceCandidate(cand); } catch (e) {}
                            }
                        }
                        peerObj.pendingCandidates = [];
                    }

                    const answer = await pc.createAnswer({
                        offerToReceiveAudio: true,
                        offerToReceiveVideo: true
                    });
                    await pc.setLocalDescription(answer);

                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'signal',
                            targetUid: fromUid,
                            signal: {
                                type: 'answer',
                                sdp: pc.localDescription.sdp
                            }
                        }));
                    }
                }
            } catch (e) {
                console.error('[Cobin] 處理 Offer 失敗:', e);
            }
        } else if (signal.type === 'answer') {
            try {
                const rtcDesc = parseSessionDescription(signal, 'answer');
                if (rtcDesc) {
                    await pc.setRemoteDescription(rtcDesc);

                    if (peerObj.pendingCandidates && peerObj.pendingCandidates.length > 0) {
                        for (const rawCand of peerObj.pendingCandidates) {
                            const cand = parseIceCandidate(rawCand);
                            if (cand) {
                                try { await pc.addIceCandidate(cand); } catch (e) {}
                            }
                        }
                        peerObj.pendingCandidates = [];
                    }
                }
            } catch (e) {
                console.error('[Cobin] 處理 Answer 失敗:', e);
            }
        } else if (signal.type === 'candidate') {
            const cand = parseIceCandidate(signal.candidate || signal);
            if (cand) {
                if (pc.remoteDescription && pc.remoteDescription.type) {
                    try {
                        await pc.addIceCandidate(cand);
                    } catch (e) {}
                } else {
                    if (!peerObj.pendingCandidates) peerObj.pendingCandidates = [];
                    peerObj.pendingCandidates.push(signal.candidate || signal);
                }
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
            tile.onclick = () => window.handleTileClick(uid);
            tile.ondblclick = () => window.toggleTileFullscreen(`tile-${uid}`);
            const initial = (nickname || 'U').charAt(0).toUpperCase();

            tile.innerHTML = `
                <div class="tile-actions-bar">
                    <button class="tile-btn btn-exit-fullscreen" onclick="toggleTileFullscreen('tile-${uid}', event)">
                        ✕ 退出全螢幕
                    </button>
                    <button class="tile-btn" title="放大至大屏幕" onclick="toggleSpotlight('${uid}', event)">
                        <svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
                        <span>聚焦</span>
                    </button>
                    <button class="tile-btn" title="劇院全螢幕" onclick="toggleTileFullscreen('tile-${uid}', event)">
                        <svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
                        <span>全螢幕</span>
                    </button>
                </div>
                <video autoplay muted playsinline webkit-playsinline></video>
                <div class="avatar-placeholder" id="avatar-${uid}" style="display:flex;">
                    <div class="avatar-circle-lg">${initial}</div>
                    <div class="avatar-name-lg">${escapeHtml(nickname)}</div>
                </div>
                <div class="video-tag">
                    <svg class="mic-status-icon" id="mic-icon-${uid}" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                    </svg>
                    <span>${escapeHtml(nickname)}</span>
                    <span class="screen-badge" id="screen-badge-${uid}" style="display:none;">螢幕分享</span>
                </div>
            `;
            if (videoGrid) videoGrid.appendChild(tile);
            updateStageLayout();
        }
        return tile;
    }

    // ==== 遠端媒體狀態 ====
    function handleUserMediaState(uid, mic, camera, isScreen) {
        const peer = peers[uid];
        if (!peer) return;

        if (peer.avatarEl) {
            peer.avatarEl.style.display = (camera || isScreen) ? 'none' : 'flex';
        }
        if (peer.micIcon) {
            if (mic) {
                peer.micIcon.classList.remove('muted');
            } else {
                peer.micIcon.classList.add('muted');
            }
        }

        const tile = document.getElementById(`tile-${uid}`);
        const screenBadge = document.getElementById(`screen-badge-${uid}`);

        if (isScreen) {
            if (tile) tile.classList.add('is-screen');
            if (screenBadge) screenBadge.style.display = 'inline-block';
            spotlightUid = uid;
            updateStageLayout();
            showToast(`🖥️ ${peer.nickname || '成員'} 正在分享螢幕 (已放大至大屏幕)`);
        } else {
            if (tile) tile.classList.remove('is-screen');
            if (screenBadge) screenBadge.style.display = 'none';
            if (spotlightUid === uid) {
                spotlightUid = null;
                updateStageLayout();
            }
        }
    }

    // ==== 🌟 大屏幕 Spotlight 與放大控制 ====
    window.toggleSpotlight = function(uid, event) {
        if (event) event.stopPropagation();
        if (spotlightUid === uid) {
            spotlightUid = null;
        } else {
            spotlightUid = uid;
        }
        updateStageLayout();
    };

    window.handleTileClick = function(uid) {
        if (spotlightUid !== uid) {
            spotlightUid = uid;
            updateStageLayout();
        }
    };

    // ==== 🎬 真正 100% 滿版劇院全螢幕模式 (手機 / 電腦無縫適配) ====
    window.toggleTileFullscreen = function(tileId, event) {
        if (event) event.stopPropagation();
        const elem = document.getElementById(tileId);
        if (!elem) return;

        const isCurrentlyFullscreen = elem.classList.contains('cinema-fullscreen');

        if (isCurrentlyFullscreen) {
            // 退出全螢幕
            elem.classList.remove('cinema-fullscreen');
            if (document.fullscreenElement && document.exitFullscreen) {
                document.exitFullscreen().catch(() => {});
            }
            showToast('已退出全螢幕');
        } else {
            // 進入全螢幕 (先清除其他視訊的全螢幕)
            document.querySelectorAll('.video-tile').forEach(t => t.classList.remove('cinema-fullscreen'));
            elem.classList.add('cinema-fullscreen');

            // 嘗試原生瀏覽器全螢幕
            if (elem.requestFullscreen) {
                elem.requestFullscreen().catch(() => {});
            } else if (elem.webkitRequestFullscreen) {
                elem.webkitRequestFullscreen().catch(() => {});
            }

            // iOS Safari 原生視訊全螢幕支援
            const video = elem.querySelector('video');
            if (video && video.webkitEnterFullscreen && /iPhone|iPad|iPod/i.test(navigator.userAgent)) {
                try { video.webkitEnterFullscreen(); } catch (e) {}
            }

            showToast('🎬 已進入劇院全螢幕 (點擊右上角退出)');
        }
    };

    // 鍵盤 ESC 退出全螢幕
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.video-tile.cinema-fullscreen').forEach(t => {
                t.classList.remove('cinema-fullscreen');
            });
        }
    });

    function updateStageLayout() {
        if (!videoGrid) return;

        const allTiles = [
            { uid: 'local', el: localVideoTile },
            ...Object.keys(peers).map(uid => ({ uid, el: document.getElementById(`tile-${uid}`) }))
        ].filter(t => t.el !== null);

        if (spotlightUid) {
            videoGrid.classList.add('spotlight-mode');
            allTiles.forEach(t => {
                if (t.uid === spotlightUid) {
                    t.el.classList.add('is-spotlight');
                } else {
                    t.el.classList.remove('is-spotlight');
                }
            });
        } else {
            videoGrid.classList.remove('spotlight-mode');
            allTiles.forEach(t => {
                t.el.classList.remove('is-spotlight');
            });
            adjustGridColumns();
        }
    }

    // 實時混音器變數 (用於將「螢幕系統聲音」與「自己說話麥克風」混合為雙軌發送)
    let mixedAudioCtx = null;
    let mixedAudioDestination = null;
    let micSourceNode = null;
    let screenAudioSourceNode = null;

    // ==== 控制列：1. 螢幕分享 (支援高清視訊 + 系統/分頁聲音混音分享) ====
    window.toggleScreenShare = async function() {
        if (!isScreenSharing) {
            try {
                if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                    showToast('⚠️ 您的瀏覽器或設備不支援螢幕分享');
                    return;
                }

                // 請求螢幕視訊 + 系統/分頁聲音 (瀏覽器彈窗可勾選分享音訊)
                screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        cursor: 'always',
                        width: { ideal: 1920, max: 1920 },
                        height: { ideal: 1080, max: 1080 },
                        frameRate: { ideal: 30, max: 30 }
                    },
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false,
                        suppressLocalAudioPlayback: false
                    }
                });

                const screenTrack = screenStream.getVideoTracks()[0];
                if (!screenTrack) return;

                // 檢查是否帶有螢幕音訊軌道 (例如分享 YouTube/遊戲/分頁聲音)
                const screenAudioTrack = screenStream.getAudioTracks()[0];
                let outgoingAudioTrack = localStream ? localStream.getAudioTracks()[0] : null;

                if (screenAudioTrack && localStream && localStream.getAudioTracks().length > 0) {
                    // 啟用即時混音器：麥克風 + 螢幕系統聲音
                    try {
                        mixedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
                        mixedAudioDestination = mixedAudioCtx.createMediaStreamDestination();

                        const micTrack = localStream.getAudioTracks()[0];
                        const micStream = new MediaStream([micTrack]);
                        micSourceNode = mixedAudioCtx.createMediaStreamSource(micStream);
                        micSourceNode.connect(mixedAudioDestination);

                        const screenAudioOnlyStream = new MediaStream([screenAudioTrack]);
                        screenAudioSourceNode = mixedAudioCtx.createMediaStreamSource(screenAudioOnlyStream);
                        screenAudioSourceNode.connect(mixedAudioDestination);

                        outgoingAudioTrack = mixedAudioDestination.stream.getAudioTracks()[0];
                        console.log('[Cobin] 🎵 成功啟用「麥克風 + 螢幕聲音」實時混音輸出！');
                    } catch (mixErr) {
                        console.warn('[Cobin] 混音初始化失敗，使用螢幕音訊:', mixErr);
                        outgoingAudioTrack = screenAudioTrack;
                    }
                } else if (screenAudioTrack) {
                    outgoingAudioTrack = screenAudioTrack;
                }

                // 替換所有 WebRTC 連線中的視訊與音訊軌道
                for (const uid in peers) {
                    const pc = peers[uid].pc;
                    if (!pc) continue;
                    try {
                        const senders = pc.getSenders();
                        const videoSender = senders.find(s => s.track && s.track.kind === 'video') || senders.find(s => !s.track);
                        if (videoSender) {
                            await videoSender.replaceTrack(screenTrack);
                        } else {
                            pc.addTrack(screenTrack, screenStream);
                            const offer = await pc.createOffer({
                                offerToReceiveAudio: true,
                                offerToReceiveVideo: true
                            });
                            await pc.setLocalDescription(offer);
                            if (ws && ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({
                                    type: 'signal',
                                    targetUid: uid,
                                    signal: {
                                        type: 'offer',
                                        sdp: pc.localDescription.sdp
                                    }
                                }));
                            }
                        }

                        if (outgoingAudioTrack) {
                            const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
                            if (audioSender) {
                                await audioSender.replaceTrack(outgoingAudioTrack);
                            }
                        }
                    } catch (e) {
                        console.warn('[Cobin] 替換螢幕軌道警告:', e);
                    }
                }

                if (localVideo) {
                    localVideo.srcObject = screenStream;
                    localVideo.play().catch(() => {});
                }
                if (localAvatarPlaceholder) localAvatarPlaceholder.style.display = 'none';
                if (localVideoTile) localVideoTile.classList.add('is-screen');
                if (localScreenBadge) localScreenBadge.style.display = 'inline-block';
                isScreenSharing = true;
                if (btnShareScreen) btnShareScreen.classList.add('active');

                // 本地螢幕分享自動放大至大屏幕
                spotlightUid = 'local';
                updateStageLayout();

                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'media-state',
                        mic: isMicEnabled,
                        camera: isCameraEnabled,
                        isScreen: true
                    }));
                }

                screenTrack.onended = () => {
                    stopScreenShare();
                };

                showToast('🖥️ 已開啟螢幕分享 (大屏幕展示中)');
            } catch (err) {
                console.error('[Cobin] 螢幕分享失敗/使用者取消:', err);
            }
        } else {
            stopScreenShare();
        }
    };

    async function stopScreenShare() {
        if (!isScreenSharing) return;

        if (screenStream) {
            screenStream.getTracks().forEach(t => t.stop());
            screenStream = null;
        }

        // 恢復本地鏡頭視訊軌道
        const camTrack = localStream ? localStream.getVideoTracks()[0] : null;
        for (const uid in peers) {
            const pc = peers[uid].pc;
            if (!pc) continue;
            try {
                const senders = pc.getSenders();
                const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                if (videoSender) {
                    await videoSender.replaceTrack(camTrack || null);
                }
            } catch (e) {}
        }

        if (localVideo) {
            if (localStream && isCameraEnabled) {
                localVideo.srcObject = localStream;
                localVideo.play().catch(() => {});
            } else {
                localVideo.srcObject = null;
            }
        }

        if (localVideoTile) localVideoTile.classList.remove('is-screen');
        if (localScreenBadge) localScreenBadge.style.display = 'none';
        if (!isCameraEnabled && localAvatarPlaceholder) {
            localAvatarPlaceholder.style.display = 'flex';
        }
        isScreenSharing = false;
        if (btnShareScreen) btnShareScreen.classList.remove('active');

        if (spotlightUid === 'local') {
            spotlightUid = null;
            updateStageLayout();
        }

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'media-state',
                mic: isMicEnabled,
                camera: isCameraEnabled,
                isScreen: false
            }));
        }

        showToast('⏹️ 螢幕分享已結束');
    }

    // ==== 控制列：2. 複製邀請連結 ====
    window.copyInviteLink = function() {
        const url = new URL(window.location.href);
        if (currentRoomId) {
            url.searchParams.set('room', currentRoomId);
        }
        const inviteUrl = url.toString();

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(inviteUrl).then(() => {
                showToast(`📋 已複製 ${currentRoomName || '房間'} 邀請連結！`);
            }).catch(() => {
                promptCopyFallback(inviteUrl);
            });
        } else {
            promptCopyFallback(inviteUrl);
        }
    };

    function promptCopyFallback(text) {
        window.prompt('請複製此通話連結發送給好友：', text);
    }

    // ==== 控制列：3. 鏡頭切換 (預設關閉，點擊時動態請求開啟) ====
    window.toggleCamera = async function() {
        if (!localStream) {
            await initLocalMedia();
        }

        const currentCamTrack = localStream ? localStream.getVideoTracks()[0] : null;

        if (!isCameraEnabled) {
            // 開啟鏡頭
            try {
                if (!currentCamTrack) {
                    const camStream = await navigator.mediaDevices.getUserMedia({
                        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
                        audio: false
                    });
                    const newCamTrack = camStream.getVideoTracks()[0];
                    if (newCamTrack) {
                        localStream.addTrack(newCamTrack);
                        for (const uid in peers) {
                            const pc = peers[uid].pc;
                            if (!pc) continue;
                            const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                            if (videoSender) {
                                videoSender.replaceTrack(newCamTrack);
                            } else {
                                pc.addTrack(newCamTrack, localStream);
                            }
                        }
                    }
                } else {
                    currentCamTrack.enabled = true;
                }

                if (localVideo) {
                    localVideo.srcObject = localStream;
                    localVideo.play().catch(() => {});
                }
                isCameraEnabled = true;
                showToast('📷 已開啟鏡頭');
            } catch (err) {
                console.warn('[Cobin] 開啟鏡頭失敗:', err);
                showToast('⚠️ 無法存取鏡頭設備');
                return;
            }
        } else {
            // 關閉鏡頭
            if (currentCamTrack) {
                currentCamTrack.enabled = false;
            }
            if (localVideo && !isScreenSharing) {
                localVideo.srcObject = null;
            }
            isCameraEnabled = false;
            showToast('📷 已關閉鏡頭');
        }

        updateCameraUI();

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'media-state',
                mic: isMicEnabled,
                camera: isCameraEnabled,
                isScreen: isScreenSharing
            }));
        }
    };

    function updateCameraUI() {
        if (isCameraEnabled) {
            if (btnCamera) btnCamera.classList.remove('off');
            if (camIconOn) camIconOn.style.display = 'block';
            if (camIconOff) camIconOff.style.display = 'none';
            if (localAvatarPlaceholder) localAvatarPlaceholder.style.display = 'none';
        } else {
            if (btnCamera) btnCamera.classList.add('off');
            if (camIconOn) camIconOn.style.display = 'none';
            if (camIconOff) camIconOff.style.display = 'block';
            if (localAvatarPlaceholder) localAvatarPlaceholder.style.display = 'flex';
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
                camera: isCameraEnabled,
                isScreen: isScreenSharing
            }));
        }
    };

    function updateMicUI() {
        if (isMicEnabled) {
            if (btnMic) btnMic.classList.remove('off');
            if (micIconOn) micIconOn.style.display = 'block';
            if (micIconOff) micIconOff.style.display = 'none';
            if (localMicIndicator) localMicIndicator.classList.remove('muted');
        } else {
            if (btnMic) btnMic.classList.add('off');
            if (micIconOn) micIconOn.style.display = 'none';
            if (micIconOff) micIconOff.style.display = 'block';
            if (localMicIndicator) localMicIndicator.classList.add('muted');
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

    // ==== 📱 手機後台語音守護系統 PRO (特別針對 Samsung One UI / 各大 Android 深度睡眠強化) ====
    let silentAudioKeeper = null;
    let wakeLockSentinel = null;
    let bgOscillatorNode = null;
    let bgGainNode = null;
    let keepAliveWorker = null;

    function startBackgroundAudioKeeper() {
        // 1. Web Worker 獨立背景線程 (徹底擊破 Samsung / Android 對主線程計時器的休眠凍結)
        try {
            if (!keepAliveWorker) {
                const blob = new Blob([`
                    let interval = null;
                    self.onmessage = function(e) {
                        if (e.data === 'start') {
                            if (interval) clearInterval(interval);
                            interval = setInterval(() => {
                                self.postMessage('heartbeat');
                            }, 800);
                        } else if (e.data === 'stop') {
                            if (interval) clearInterval(interval);
                            interval = null;
                        }
                    };
                `], { type: 'application/javascript' });
                const workerUrl = URL.createObjectURL(blob);
                keepAliveWorker = new Worker(workerUrl);
                keepAliveWorker.onmessage = function() {
                    if (currentRoomId) {
                        if (audioContext && audioContext.state === 'suspended') {
                            audioContext.resume().catch(() => {});
                        }
                        if (silentAudioKeeper && silentAudioKeeper.paused) {
                            silentAudioKeeper.play().catch(() => {});
                        }
                    }
                };
                keepAliveWorker.postMessage('start');
            }
        } catch (e) {
            console.warn('[Cobin] Web Worker 保活不可用:', e);
        }

        // 2. Web Audio API 底層音訊管道長效保活 (生成極致微弱 25Hz 音頻，維持系統音訊會話活躍)
        try {
            const ctx = audioContext || new (window.AudioContext || window.webkitAudioContext)();
            if (ctx.state === 'suspended') {
                ctx.resume().catch(() => {});
            }
            if (!bgOscillatorNode && ctx) {
                bgOscillatorNode = ctx.createOscillator();
                bgGainNode = ctx.createGain();
                bgOscillatorNode.type = 'sine';
                bgOscillatorNode.frequency.setValueAtTime(25, ctx.currentTime); // 25Hz 超低音
                bgGainNode.gain.setValueAtTime(0.002, ctx.currentTime); // 極小音量
                bgOscillatorNode.connect(bgGainNode);
                bgGainNode.connect(ctx.destination);
                bgOscillatorNode.start();
            }
        } catch (e) {}

        // 3. HTML5 Audio 標籤循環保活 (第二重保險)
        if (!silentAudioKeeper) {
            try {
                silentAudioKeeper = new Audio();
                silentAudioKeeper.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';
                silentAudioKeeper.loop = true;
                silentAudioKeeper.volume = 0.01;
                silentAudioKeeper.play().catch(() => {});
            } catch (e) {}
        }

        // 4. 註冊系統通知列與鎖定畫面 MediaSession 通話控制
        if ('mediaSession' in navigator) {
            try {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: `🎙️ ${currentRoomName || 'Cobin 語音房間'} (通話中)`,
                    artist: 'Cobin Voice & Video',
                    album: '即時通話中 (點擊掛斷可退出)'
                });
                navigator.mediaSession.playbackState = 'playing';
                navigator.mediaSession.setActionHandler('hangup', () => {
                    window.leaveRoom();
                });
                navigator.mediaSession.setActionHandler('pause', () => {
                    window.toggleMic();
                });
                navigator.mediaSession.setActionHandler('play', () => {
                    window.toggleMic();
                });
            } catch (e) {}
        }

        // 5. 請求螢幕常亮 Wake Lock (防止自動休眠斷開)
        if ('wakeLock' in navigator && !wakeLockSentinel) {
            navigator.wakeLock.request('screen').then(lock => {
                wakeLockSentinel = lock;
            }).catch(() => {});
        }
    }

    function stopBackgroundAudioKeeper() {
        if (keepAliveWorker) {
            try {
                keepAliveWorker.postMessage('stop');
                keepAliveWorker.terminate();
            } catch (e) {}
            keepAliveWorker = null;
        }

        if (bgOscillatorNode) {
            try {
                bgOscillatorNode.stop();
                bgOscillatorNode.disconnect();
            } catch (e) {}
            bgOscillatorNode = null;
            bgGainNode = null;
        }

        if (silentAudioKeeper) {
            try {
                silentAudioKeeper.pause();
                silentAudioKeeper.src = '';
            } catch (e) {}
            silentAudioKeeper = null;
        }

        if ('mediaSession' in navigator) {
            try {
                navigator.mediaSession.playbackState = 'none';
            } catch (e) {}
        }

        if (wakeLockSentinel) {
            try {
                wakeLockSentinel.release().catch(() => {});
            } catch (e) {}
            wakeLockSentinel = null;
        }
    }

    // 當手機退到後台或切換 App 時，確保音訊會話持續活躍
    document.addEventListener('visibilitychange', () => {
        if (currentRoomId) {
            console.log(`[Cobin] 頁面可見性變化: ${document.hidden ? '📱 後台運行中' : '👀 回到前台'}`);
            if (audioContext && audioContext.state === 'suspended') {
                audioContext.resume().catch(() => {});
            }
            if (silentAudioKeeper && silentAudioKeeper.paused) {
                silentAudioKeeper.play().catch(() => {});
            }
        }
    });

    function cleanupCallState() {
        stopScreenShare();
        stopBackgroundAudioKeeper();

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
        spotlightUid = null;

        document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
        if (stageHeader) stageHeader.style.display = 'none';
        if (videoGrid) videoGrid.style.display = 'none';
        if (floatingActionBar) floatingActionBar.classList.add('hidden');
        if (lobbyScreen) lobbyScreen.style.display = 'flex';
    }

    // ==== 視訊網格排版 ====
    function adjustGridColumns() {
        if (!videoGrid) return;
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
            if (callDurationTimer) callDurationTimer.textContent = `${mins}:${secs}`;
        }, 1000);
    }

    // ==== 說話波形分析 (Speaking Indicator) ====
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
                    if (localVideoTile) localVideoTile.classList.add('speaking');
                } else {
                    if (localVideoTile) localVideoTile.classList.remove('speaking');
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
        if (nicknameInput) {
            nicknameInput.value = myNickname;
            nicknameInput.focus();
        }
        if (nicknameModal) nicknameModal.classList.add('show');
    };

    window.closeNicknameModal = function() {
        if (nicknameModal) nicknameModal.classList.remove('show');
    };

    window.saveNickname = function() {
        if (!nicknameInput) return;
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

    if (nicknameInput) {
        nicknameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') saveNickname();
        });
    }

    // ==== 自動加入 URL 指定的房間 (如果有 ?room=xxx) ====
    const initialRoom = urlParams.get('room');
    if (initialRoom && roomNameMap[initialRoom]) {
        setTimeout(() => {
            if (window.joinRoom) window.joinRoom(initialRoom);
        }, 600);
    }

    // ==== Toast 提示 ====
    let toastTimeout = null;
    function showToast(text) {
        if (!toastMsg) return;
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
