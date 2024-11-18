'use client';

import React, { useEffect, useRef, useState } from 'react';

const KurentoHelloWorld = () => {
    const [message, setMessage] = useState('Not connected');
    const videoRef = useRef<HTMLVideoElement>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const webRtcPeerRef = useRef<any>(null);

    useEffect(() => {
        // Connect to the Kurento server on port 8443 instead of 3000
        const ws = new WebSocket('wss://localhost:8443/helloworld');
        wsRef.current = ws;

        ws.onopen = () => {
            console.log('WebSocket connection established');
            setMessage('WebSocket connected - Click Start Video');
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            setMessage('WebSocket connection error');
        };

        ws.onclose = () => {
            console.log('WebSocket connection closed');
            setMessage('WebSocket connection closed');
        };

        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);

            switch (message.id) {
                case 'startResponse':
                    webRtcPeerRef.current?.processAnswer(message.sdpAnswer);
                    break;

                case 'error':
                    setMessage(`Error: ${message.message}`);
                    break;

                case 'iceCandidate':
                    webRtcPeerRef.current?.addIceCandidate(message.candidate);
                    break;

                default:
                    console.warn('Unrecognized message', message);
            }
        };

        // Cleanup on component unmount
        return () => {
            if (webRtcPeerRef.current) {
                webRtcPeerRef.current.dispose();
            }
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, []);

    const onIceCandidate = (candidate: RTCIceCandidate) => {
        const message = {
            id: 'onIceCandidate',
            candidate: candidate
        };
        wsRef.current?.send(JSON.stringify(message));
    };

    const startVideo = async () => {
        if (!videoRef.current) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: {
                    width: 640,
                    height: 480,
                    frameRate: 30
                }
            });

            // Create RTCPeerConnection
            const configuration = {
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
            };
            const pc = new RTCPeerConnection(configuration);
            webRtcPeerRef.current = pc;

            // Add tracks to peer connection
            stream.getTracks().forEach(track => {
                pc.addTrack(track, stream);
            });

            // Set local video
            videoRef.current.srcObject = stream;

            // Handle ICE candidates
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    onIceCandidate(event.candidate);
                }
            };

            // Handle incoming stream
            pc.ontrack = (event) => {
                if (videoRef.current) {
                    videoRef.current.srcObject = event.streams[0];
                }
            };

            // Create and send offer
            const offer = await pc.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            await pc.setLocalDescription(offer);

            const message = {
                id: 'start',
                sdpOffer: offer.sdp
            };
            wsRef.current?.send(JSON.stringify(message));
            setMessage('Starting video call...');

        } catch (error) {
            console.error('Error accessing media devices:', error);
            setMessage('Error accessing camera/microphone');
        }
    };

    const stopVideo = () => {
        if (webRtcPeerRef.current) {
            const message = {
                id: 'stop'
            };
            wsRef.current?.send(JSON.stringify(message));
            webRtcPeerRef.current.close();
            webRtcPeerRef.current = null;
            
            if (videoRef.current && videoRef.current.srcObject) {
                const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
                tracks.forEach(track => track.stop());
                videoRef.current.srcObject = null;
            }
            setMessage('Video stopped');
        }
    };

    return (
        <div className="flex flex-col items-center gap-4 p-4">
            <h1 className="text-xl font-bold">{message}</h1>
            <video 
                ref={videoRef} 
                autoPlay 
                playsInline
                className="w-[640px] h-[480px] bg-black"
            />
            <div className="flex gap-4">
                <button 
                    onClick={startVideo}
                    className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                    Start Video
                </button>
                <button 
                    onClick={stopVideo}
                    className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
                >
                    Stop Video
                </button>
            </div>
        </div>
    );
};

export default KurentoHelloWorld;