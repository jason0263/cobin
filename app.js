// app.js – Vanilla JavaScript for chat & WebRTC

(() => {
    const wsUrl = 'ws://localhost:8080'; // matches server.php configuration
    const ws = new WebSocket(wsUrl);

    // UI elements
    const statusEl = document.getElementById('status');
    const messagesEl = document.getElementById('messages');
    const msgInput = document.getElementById('msgInput');
    const sendBtn = document.getElementById('sendBtn');
    const callBtn = document.getElementById('callBtn');
    const shareBtn = document.getElementById('shareBtn');
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');

    // User nickname (prompt on load)
    const nickname = prompt('Enter a nickname for the chat:', 'User' + Math.floor(Math.random() * 1000));

    // ---------- WebSocket handling ----------
    ws.addEventListener('open', () => {
        statusEl.textContent = '🔌 Connected';
        ws.send(JSON.stringify({type: 'init', nickname}));
    });

    ws.addEventListener('close', () => {
        statusEl.textContent = '🔌 Disconnected';
    });

    ws.addEventListener('message', (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch (_) { return; }
        if (data.type === 'chat') {
            addChatMessage(data.from, data.message);
        } else if (data.type === 'signal') {
            handleSignal(data.signal);
        }
    });

    // ---------- Chat UI ----------
    function addChatMessage(author, text) {
        const div = document.createElement('div');
        div.className = 'msg';
        div.innerHTML = `<span class="author">${author}:</span> ${escapeHtml(text)}`;
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function escapeHtml(str) {
        return str.replace(/[&<"'>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c]||c));
    }

    sendBtn.addEventListener('click', sendChat);
    msgInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChat(); });

    function sendChat() {
        const text = msgInput.value.trim();
        if (!text) return;
        ws.send(JSON.stringify({type: 'chat', message: text}));
        msgInput.value = '';
        addChatMessage('Me', text);
    }

    // ---------- WebRTC handling ----------
    const pc = new RTCPeerConnection({
        iceServers: [{urls: 'stun:stun.l.google.com:19302'}]
    });
    let localStream = null; // camera + mic
    let screenStream = null; // optional screen share

    // Add local media tracks on start
    async function initLocalMedia() {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
            localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
            localVideo.srcObject = localStream;
        } catch (err) {
            console.error('getUserMedia error:', err);
        }
    }
    initLocalMedia();

    pc.ontrack = (event) => {
        // Remote stream may contain multiple tracks; we just attach the first stream.
        remoteVideo.srcObject = event.streams[0];
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({type: 'signal', signal: {type: 'candidate', candidate: event.candidate}}));
        }
    };

    // ---------- Call flow ----------
    let isCalling = false;
    callBtn.addEventListener('click', async () => {
        if (isCalling) { // hang up
            pc.getSenders().forEach(s => s.track && s.track.stop());
            pc.close();
            location.reload(); // simple reset
            return;
        }
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            ws.send(JSON.stringify({type: 'signal', signal: {type: 'offer', sdp: pc.localDescription}}));
            callBtn.textContent = 'Hang Up';
            isCalling = true;
        } catch (e) { console.error(e); }
    });

    // ---------- Screen sharing ----------
    shareBtn.addEventListener('click', async () => {
        if (!screenStream) {
            try {
                screenStream = await navigator.mediaDevices.getDisplayMedia({video: true});
                // Replace video track in peer connection
                const screenTrack = screenStream.getVideoTracks()[0];
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) sender.replaceTrack(screenTrack);
                // Show locally
                localVideo.srcObject = screenStream;
                // When user stops sharing, revert to camera
                screenTrack.onended = () => {
                    revertToCamera();
                };
                shareBtn.textContent = 'Stop Sharing';
            } catch (e) { console.error('Screen share error', e); }
        } else {
            // Stop sharing manually
            screenStream.getTracks().forEach(t => t.stop());
            revertToCamera();
        }
    });

    function revertToCamera() {
        screenStream = null;
        if (localStream) {
            const camTrack = localStream.getVideoTracks()[0];
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) sender.replaceTrack(camTrack);
            localVideo.srcObject = localStream;
        }
        shareBtn.textContent = 'Share Screen';
    }

    // ---------- Signalling message handling ----------
    async function handleSignal(signal) {
        if (!signal || signal.from === nickname) return; // ignore own messages
        switch (signal.type) {
            case 'offer':
                if (!isCalling) {
                    // Auto‑answer when we receive an offer
                    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    ws.send(JSON.stringify({type: 'signal', signal: {type: 'answer', sdp: pc.localDescription}}));
                    callBtn.textContent = 'Hang Up';
                    isCalling = true;
                }
                break;
            case 'answer':
                await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
                break;
            case 'candidate':
                try { await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)); } catch (e) { console.error('Error adding ICE candidate', e); }
                break;
            default:
                console.warn('Unknown signal type', signal);
        }
    }
})();
