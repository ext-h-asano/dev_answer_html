let localVideo, remoteVideo;
let localId, remoteId;
let sc, pc, queue;
let dataChannel; // データチャンネルの参照
// タッチ開始位置を保存する変数
let startX, startY;
// スワイプと判定する最小距離（ピクセル）
const SWIPE_THRESHOLD = 50;

const sslPort = 8443;


const peerConnectionConfig = {
	iceServers: [
		// GoogleのパブリックSTUNサーバーを指定しているが自前のSTUNサーバーに変更可
		{urls: 'stun:stun.l.google.com:19302'},
		{urls: 'stun:stun1.l.google.com:19302'},
		{urls: 'stun:stun2.l.google.com:19302'},
		// TURNサーバーがあれば指定する
		//{urls: 'turn:turn_server', username:'', credential:''}
	]
};

window.onload = function() {
	// localVideo = document.getElementById('localVideo');
	remoteVideo = document.getElementById('remoteVideo');

	// Local IDとRemote IDは別々の値を入力する
	// Remote IDと対向のLocal IDが一致するとビデオ通話を開始する
	// while (!localId) {
	// 	localId = window.prompt('Local ID', '');
	// }
	// while (!remoteId) {
	// 	remoteId = window.prompt('Remote ID', '');
	// }
	localId = 'aaapython'
	remoteId = 'bbbpython'
	startVideo(localId, remoteId);

	// 画面クリック時にメッセージを送信
	// document.body.addEventListener('click', function() {
	// 	const message = window.prompt('Enter message to send', '');
	// 	if (message) {
	// 		sendMessage(message);
	// 	}
	// });
	const audiodevice = navigator.mediaDevices.enumerateDevices()
	console.log(audiodevice)

	}

function startVideo(localId, remoteId) {
	console.log('[startVideo] localId:', localId, ', remoteId:', remoteId);
	if (navigator.mediaDevices.getUserMedia) {
		if (window.stream) {
			// 既存のストリームを破棄
			try {
				window.stream.getTracks().forEach(track => {
					track.stop();
				});
				console.log('[startVideo] Existing stream stopped.');
			} catch(error) {
				console.error('[startVideo] Error stopping stream:', error);
			}
			window.stream = null;
		}
		// カメラとマイクの開始
		const constraints = {
			audio: true,
			video: true
		};
		console.log('[startVideo] Requesting user media with constraints:', constraints);
		navigator.mediaDevices.getUserMedia(constraints).then(stream => {
			console.log('[startVideo] User media obtained.');
			window.stream = stream;
			// localVideo.srcObject = stream;
			startServerConnection(localId, remoteId);
		}).catch(e => {
			console.error('[startVideo] Camera start error:', e);
			alert('Camera start error.\n\n' + e.name + ': ' + e.message);
		});
	} else {
		alert('Your browser does not support getUserMedia API');
	}
}

function stopVideo() {
	console.log('[stopVideo] Stopping video.');
	if (remoteVideo.srcObject) {
		try {
			remoteVideo.srcObject.getTracks().forEach(track => {
				track.stop();
				console.log('[stopVideo] Track stopped:', track);
			});
		} catch(error) {
			console.error('[stopVideo] Error stopping tracks:', error);
		}
		remoteVideo.srcObject = null;
		console.log('[stopVideo] Remote video stopped.');
	}
}

function startServerConnection(localId, remoteId) {
	console.log('[startServerConnection] Starting server connection. localId:', localId, ', remoteId:', remoteId);
	if (sc) {
		console.log('[startServerConnection] Closing existing server connection.');
		sc.close();
	}
	// サーバー接続の開始
	sc = new WebSocket('wss://' + 'signaling.android-vpn.com' + ':' + sslPort + '/');
	sc.onmessage = gotMessageFromServer;
	sc.onopen = function(event) {
		console.log('[startServerConnection] WebSocket connection opened.');
		// サーバーに接続情報を通知
		this.send(JSON.stringify({open: {local: localId, remote: remoteId}}));
	};

	sc.onclose = function(event) {
		console.log('[startServerConnection] WebSocket connection closed. Reconnecting in 5 seconds...');
		clearInterval(this._pingTimer);
		setTimeout(conn => {
			if (sc === conn) {
				// 一定時間経過後にサーバーへ再接続
				startServerConnection(localId, remoteId);
			}
		}, 5000, this);
	}

	sc._pingTimer = setInterval(() => {
		// 接続確認
		console.log('[startServerConnection] Sending ping to server.');
		sc.send(JSON.stringify({ping: 1}));
	}, 30000);
}

function startPeerConnection(sdpType) {
	console.log('[startPeerConnection] Starting peer connection. sdpType:', sdpType);
	stopPeerConnection();
	queue = new Array();
	pc = new RTCPeerConnection(peerConnectionConfig);

    // データチャンネルが開設された時のログ出力
    pc.ondatachannel = function(event) {
        console.log('[startPeerConnection] Data channel opened:', event.channel.label);
        event.channel.onopen = () => console.log('[startPeerConnection] Data channel state is open.');
        event.channel.onclose = () => console.log('[startPeerConnection] Data channel state is closed.');
        event.channel.onerror = (error) => console.log('[startPeerConnection] Data channel error:', error);
		event.channel.onmessage = (event) => {
            console.log('[startPeerConnection] Received message:', event.data);
        };
        dataChannel = event.channel; // データチャンネルの参照を保持
    };

	// コネクション状態の変更を監視
	pc.onconnectionstatechange = function() {
		console.log('[startPeerConnection] Connection State:', pc.connectionState);
		if (pc.connectionState === 'connected') {
			console.log('[startPeerConnection] Peer connection established successfully.');
		} else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
			console.log('[startPeerConnection] Peer connection failed or disconnected.');
		}
	};

	pc.onicecandidate = function(event) {
		if (event.candidate) {
			console.log('[startPeerConnection] ICE candidate generated:', event.candidate);
			// ICE送信
			sc.send(JSON.stringify({ice: event.candidate, remote: remoteId}));
		}
	};
	if (window.stream) {
		console.log('[startPeerConnection] Adding local tracks to peer connection.');
		// Local側のストリームを設定
		window.stream.getTracks().forEach(track => pc.addTrack(track, window.stream));
	}
	pc.ontrack = function(event) {
		// Remote側のストリームを設定
		console.log('[startPeerConnection] Received remote track.');
		if (event.streams && event.streams[0]) {
			remoteVideo.srcObject = event.streams[0];
			console.log('[startPeerConnection] Set remote video stream.');
		} else {
			remoteVideo.srcObject = new MediaStream(event.track);
			console.log('[startPeerConnection] Set remote video track to new MediaStream.');
		}
	};
	if (sdpType === 'offer') {
		//データチャンネルの作成
		//createDataChannel();
		console.log('[startPeerConnection] Creating offer.');
		// Offerの作成
		pc.createOffer().then(setDescription).catch(errorHandler);
	}
}

function stopPeerConnection() {
	console.log('[stopPeerConnection] Stopping peer connection.');
	if (pc) {
		pc.close();
		pc = null;
		console.log('[stopPeerConnection] Peer connection closed.');
	}
}

function gotMessageFromServer(message) {
	console.log('[gotMessageFromServer] Received message from server:', message.data);
	const signal = JSON.parse(message.data);
	if (signal.start) {
		console.log('[gotMessageFromServer] Received start signal. Starting peer connection.');
		// サーバーからの「start」を受けてPeer接続を開始する
		startPeerConnection(signal.start);
		return;
	}
	if (signal.close) {
		console.log('[gotMessageFromServer] Received close signal. Stopping video and peer connection.');
		// 接続先の終了通知
		stopVideo();
		stopPeerConnection();
		return;
	}
	if (signal.ping) {
		console.log('[gotMessageFromServer] Received ping. Sending pong.');
		sc.send(JSON.stringify({pong: 1}));
		return;
	}
	if (!pc) {
		console.log('[gotMessageFromServer] No peer connection available to handle the message.');
		return;
	}
	// 以降はWebRTCのシグナリング処理
	if (signal.sdp) {
		console.log('[gotMessageFromServer] Received SDP:', signal.sdp);
		// SDP受信
		if (signal.sdp.type === 'offer') {
			pc.setRemoteDescription(signal.sdp).then(() => {
				console.log('[gotMessageFromServer] Remote SDP set successfully. Creating answer.');
				// Answerの作成
				pc.createAnswer().then(setDescription).catch(errorHandler);
			}).catch(errorHandler);
		} else if (signal.sdp.type === 'answer') {
			pc.setRemoteDescription(signal.sdp).catch(errorHandler);
			console.log('[gotMessageFromServer] Remote answer set successfully.');
		}
	}
	if (signal.ice) {
		console.log('[gotMessageFromServer] Received ICE candidate:', signal.ice);
		// ICE受信
		if (pc.remoteDescription) {
			pc.addIceCandidate(new RTCIceCandidate(signal.ice)).catch(errorHandler);
			console.log('[gotMessageFromServer] ICE candidate added successfully.');
		} else {
			console.log('[gotMessageFromServer] Remote description not set. Queueing ICE candidate.');
			// SDPが未処理のためキューに贈める
			queue.push(message);
			return;
		}
	}
	if (queue.length > 0 && pc.remoteDescription) {
		console.log('[gotMessageFromServer] Processing queued messages.');
		// キューのメッセージを再処理
		gotMessageFromServer(queue.shift());
	}
}

function setDescription(description) {
	console.log('[setDescription] Setting local description:', description);
	pc.setLocalDescription(description).then(() => {
		console.log('[setDescription] Local description set successfully. Sending SDP to server.');
		// SDP送信
		sc.send(JSON.stringify({sdp: pc.localDescription, remote: remoteId}));
	}).catch(errorHandler);
}

// データチャンネルを作成する関数
function createDataChannel() {
	console.log('[createDataChannel] Creating data channel.');
    dataChannel = pc.createDataChannel('myDataChannel');
    dataChannel.onopen = () => console.log('[createDataChannel] Local data channel state is open.');
    dataChannel.onclose = () => console.log('[createDataChannel] Local data channel state is closed.');
    dataChannel.onerror = (error) => console.log('[createDataChannel] Local data channel error:', error);
    dataChannel.onmessage = (event) => {
        console.log('[createDataChannel] Received message:', event.data);
    };
}

// メッセージをデータチャンネル経由で送信する関数
function sendMessage(message) {
	console.log('[sendMessage] Attempting to send message:', message);
    if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(message);
        console.log('[sendMessage] Sent message:', message);
    } else {
        console.log('[sendMessage] Data channel is not open. Cannot send message.');
    }
}


// // タッチ開始時の処理
// document.addEventListener('touchstart', function(e) {
//     startX = e.touches[0].clientX;
//     startY = e.touches[0].clientY;
//     console.log('タッチ開始:', startX, startY);
// });

// // タッチ終了時の処理
// document.addEventListener('touchend', function(e) {
//     let endX = e.changedTouches[0].clientX;
//     let endY = e.changedTouches[0].clientY;
    
//     let deltaX = endX - startX;
//     let deltaY = endY - startY;
    
//     if (Math.abs(deltaX) > SWIPE_THRESHOLD || Math.abs(deltaY) > SWIPE_THRESHOLD) {
//         // スワイプと判定
//         let direction = Math.abs(deltaX) > Math.abs(deltaY) 
//             ? (deltaX > 0 ? '右' : '左')
//             : (deltaY > 0 ? '下' : '上');
//         console.log('スワイプ検知:', direction);
//         console.log('スワイプ開始座標:', startX, startY);
//         console.log('スワイプ終了座標:', endX, endY);
//         console.log('スワイプ距離 X:', deltaX, 'Y:', deltaY);
// 		let swipe = {type: "swipe", startX: startX, startY: startY, endX: endX, endY: endY}
// 		let jsonSwipe = JSON.stringify(swipe)
// 		scDataChannel.send(jsonSwipe)
//     } else {
//         // タップと判定
//         console.log('タップ検知:', endX, endY);
// 		let touch = {type: "touch", x: endX, y: endY}
// 		let jsonTouch = JSON.stringify(touch)
// 		scDataChannel.send(jsonTouch)
//     }
// });

function errorHandler(error) {
	console.error('[errorHandler] Signaling error:', error);
	alert('Signaling error.\n\n' + error.name + ': ' + error.message);
}