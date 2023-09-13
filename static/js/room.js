var socket;

window.onload = _=>{
    socket = io.connect('http://' + document.domain + ':' + location.port);

    socket.emit('join_room', { 'username': username, 'room': room_id });

    socket.on('join_room', function(data) {
        showMessage(`${data.from_user} joined room`);
    });
    socket.on('leave_room', function(data) {
        showMessage(`${data.from_user} leave room`);
    });
    socket.on('message', function(data) {
        showMessage(`${data.from_user}: ${data.message}`);
    });

    socket.on('stream', function(data) {
        var chunk = data.stream;
        var fromUser = data.from_user;

        if (data.type == "video"){
            photo.setAttribute('src', chunk);
        }
        else if (data.type == "audio"){
            var blob = new Blob([chunk], { type: 'audio/webm' });
            var audioUrl = URL.createObjectURL(blob);
            let audioObj = new Audio(audioUrl);
            audioObj.play()
        }
    });

    document.getElementById('startVideo').onclick = startVideoChat;
    document.getElementById('stopVideo').onclick = stopVideoChat;
    document.getElementById('startVoice').onclick = startVoiceChat;
    document.getElementById('stopVoice').onclick = stopVoiceChat;

    document.querySelector("#chat input").addEventListener("keypress", function(event) {
        if (event.keyCode === 13) {
            send_message()
        }
    });

    let localVideo = document.querySelector("#videoElement");
    let canvas = document.querySelector("#canvasElement");
    let ctx = canvas.getContext('2d');
    var photo = document.getElementById('photo');
    var localVideoStream;

    function startVideoChat() {
        // navigator.mediaDevices.getUserMedia({ video: {width: 1280, height: 720} })
        navigator.mediaDevices.getUserMedia({ video: true })
            .then(function (stream) {
                let settings = stream.getVideoTracks()[0].getSettings()
                let quality = {
                    "fps": settings.frameRate,
                    "height": settings.height,
                    "width": settings.width,
                }

                localVideo.srcObject = stream;
                localVideoStream = stream;

                let [targetWidth, targetHeight]= resizeWithRatio(quality.width, quality.height, 480, 360)

                canvas.width = targetWidth
                canvas.height = targetHeight

                mediaRecorderInterval = setInterval(_=>{
                    ctx.drawImage(localVideo, 0, 0, targetWidth, targetHeight);
                    let dataURL = canvas.toDataURL('image/jpeg', 0.9);
                    socket.emit('segment', { 'username': username, 'room': room_id, 'type': 'video', 'stream': dataURL});
                // }, 1000/quality.fps)
                }, 40)
            })
    }

    var audioRecorder;
    var audioMediaStream;
    var audioContext;
    var localAudioStream;

    function startVoiceChat() {
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(function (stream) {
                localAudioStream = stream;

                // https://gist.github.com/meziantou/edb7217fddfbb70e899e
                audioContext = new AudioContext();
                audioMediaStream = audioContext.createMediaStreamSource(stream);

                var bufferSize = 8192;
                var numberOfInputChannels = 1;
                var numberOfOutputChannels = 1;
                if (audioContext.createScriptProcessor) {
                    audioRecorder = audioContext.createScriptProcessor(bufferSize, numberOfInputChannels, numberOfOutputChannels);
                } else {
                    audioRecorder = audioContext.createJavaScriptNode(bufferSize, numberOfInputChannels, numberOfOutputChannels);
                }
                audioRecorder.onaudioprocess = function (e) {
                    var sampleRate = e.inputBuffer.sampleRate;
                    let interleaved = new Float32Array(e.inputBuffer.getChannelData(0));
                    
                    var buffer = new ArrayBuffer(44 + interleaved.length * 2);
                    var view = new DataView(buffer);

                    // RIFF chunk descriptor
                    writeUTFBytes(view, 0, 'RIFF');
                    view.setUint32(4, 44 + interleaved.length * 2, true);
                    writeUTFBytes(view, 8, 'WAVE');
                    // FMT sub-chunk
                    writeUTFBytes(view, 12, 'fmt ');
                    view.setUint32(16, 16, true); // chunkSize
                    view.setUint16(20, 1, true); // wFormatTag
                    view.setUint16(22, 1, true); // wChannels: mono (1channel) / stereo (2 channels)
                    view.setUint32(24, sampleRate, true); // dwSamplesPerSec
                    view.setUint32(28, sampleRate * 2, true); // dwAvgBytesPerSec *2 for 16 bit mono / *4 for 16 bit stereo
                    view.setUint16(32, 4, true); // wBlockAlign
                    view.setUint16(34, 16, true); // wBitsPerSample
                    // data sub-chunk
                    writeUTFBytes(view, 36, 'data');
                    view.setUint32(40, interleaved.length * 2, true);

                    // write the PCM samples
                    var index = 44;
                    var volume = 1;
                    for (var i = 0; i < interleaved.length; i++) {
                        view.setInt16(index, interleaved[i] * (0x7FFF * volume), true);
                        index += 2;
                    }

                    let blob = new Blob([view], { type: 'audio/wav' });
                    socket.emit('segment', { 'username': username, 'room': room_id, 'type': 'audio', 'stream': blob });
                }
                audioMediaStream.connect(audioRecorder);
                audioRecorder.connect(audioContext.destination);
            })
    }


    var mediaRecorderInterval;
    function stopVideoChat() {
        if (mediaRecorderInterval){
            clearInterval(mediaRecorderInterval)
        }
        if (localVideoStream) {
            localVideoStream.getTracks().forEach(function (track) {
                track.stop();
            });

            localVideo.srcObject = null;
            photo.removeAttribute('src');
        }
    }

    var voiceRecorderInterval;
    function stopVoiceChat() {
        audioRecorder.disconnect(audioContext.destination);
        audioMediaStream.disconnect(audioRecorder);

        if (localAudioStream) {
            localAudioStream.getTracks().forEach(function (track) {
                track.stop();
            });
        }
    }
}

function showMessage(message){
    let chat = document.querySelector("#chat")
    let scrollAfter = false;
    if (chat.scrollTop + chat.clientHeight + 10 >= chat.scrollHeight){
        scrollAfter = true;
    }
    let li = document.createElement('li')
    li.innerHTML = message
    document.querySelector("#messages").appendChild(li)
    if (scrollAfter){
        chat.scrollTop = chat.scrollHeight;
    }
}
function send_message(){
    let input = document.querySelector("#chat input")
    if (input.value.trim() != ''){
        socket.emit('send_message', { 'username': username, 'room': room_id, 'message': input.value });
        input.value = ""
    }
}

function resizeWithRatio(width, height, max_W, max_H){
    if (width > height) {
        if (width > max_W) {
            height *= max_W / width;
            width = max_W;
        }
    } else {
        if (height > max_H) {
            width *= max_H / height;
            height = max_H;
        }
    }
    return [parseInt(width), parseInt(height)];
}

function writeUTFBytes(view, offset, string) {
    for (var i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}