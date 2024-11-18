import path from 'path';
import fs from 'fs';
import https from 'https';
import express from 'express';
import { WebSocketServer } from 'ws';
import minimist from 'minimist';
import kurento from 'kurento-client';
import { fileURLToPath } from 'url';

// WebRTC-related configuration
const argv = minimist(process.argv.slice(2), {
    default: {
        ws_uri: 'ws://localhost:8888/kurento',
    },
});

// Get the directory name from the import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// SSL/TLS certificates
const options = {
    key: fs.readFileSync(path.join(__dirname, './cert/localhost/localhost.decrypted.key')),
    cert: fs.readFileSync(path.join(__dirname, './cert/localhost/localhost.crt')),
};

// Express server setup
const app = express();

// Create HTTPS server
const httpsServer = https.createServer(options, app);

// Enable CORS for Next.js frontend
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'http://localhost:3000');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// WebRTC session handling and Kurento integration
const sessions = {};
const candidatesQueue = {};
let kurentoClient = null;

const getKurentoClient = (callback) => {
    if (kurentoClient !== null) {
        return callback(null, kurentoClient);
    }

    kurento(argv.ws_uri, (error, _kurentoClient) => {
        if (error) {
            return callback(`Could not find media server at address ${argv.ws_uri}. Exiting with error ${error}`);
        }
        kurentoClient = _kurentoClient;
        callback(null, kurentoClient);
    });
};

const start = (sessionId, ws, sdpOffer, callback) => {
    if (!sessionId) {
        return callback('Cannot use undefined sessionId');
    }

    getKurentoClient((error, kurentoClient) => {
        if (error) {
            return callback(error);
        }

        kurentoClient.create('MediaPipeline', (error, pipeline) => {
            if (error) {
                return callback(error);
            }

            createMediaElements(pipeline, ws, (error, webRtcEndpoint) => {
                if (error) {
                    pipeline.release();
                    return callback(error);
                }

                if (candidatesQueue[sessionId]) {
                    while (candidatesQueue[sessionId].length) {
                        const candidate = candidatesQueue[sessionId].shift();
                        webRtcEndpoint.addIceCandidate(candidate);
                    }
                }

                connectMediaElements(webRtcEndpoint, (error) => {
                    if (error) {
                        pipeline.release();
                        return callback(error);
                    }

                    webRtcEndpoint.on('IceCandidateFound', (event) => {
                        const candidate = kurento.getComplexType('IceCandidate')(event.candidate);
                        ws.send(JSON.stringify({
                            id: 'iceCandidate',
                            candidate,
                        }));
                    });

                    webRtcEndpoint.processOffer(sdpOffer, (error, sdpAnswer) => {
                        if (error) {
                            pipeline.release();
                            return callback(error);
                        }

                        sessions[sessionId] = {
                            pipeline,
                            webRtcEndpoint,
                        };
                        return callback(null, sdpAnswer);
                    });

                    webRtcEndpoint.gatherCandidates((error) => {
                        if (error) {
                            return callback(error);
                        }
                    });
                });
            });
        });
    });
};

const createMediaElements = (pipeline, ws, callback) => {
    pipeline.create('WebRtcEndpoint', (error, webRtcEndpoint) => {
        if (error) {
            return callback(error);
        }
        return callback(null, webRtcEndpoint);
    });
};

const connectMediaElements = (webRtcEndpoint, callback) => {
    webRtcEndpoint.connect(webRtcEndpoint, (error) => {
        if (error) {
            return callback(error);
        }
        return callback(null);
    });
};

const stop = (sessionId) => {
    if (sessions[sessionId]) {
        const { pipeline } = sessions[sessionId];
        console.info('Releasing pipeline');
        pipeline.release();

        delete sessions[sessionId];
        delete candidatesQueue[sessionId];
    }
};

const onIceCandidate = (sessionId, _candidate) => {
    const candidate = kurento.getComplexType('IceCandidate')(_candidate);

    if (sessions[sessionId]) {
        console.info('Sending candidate');
        const { webRtcEndpoint } = sessions[sessionId];
        webRtcEndpoint.addIceCandidate(candidate);
    } else {
        console.info('Queueing candidate');
        if (!candidatesQueue[sessionId]) {
            candidatesQueue[sessionId] = [];
        }
        candidatesQueue[sessionId].push(candidate);
    }
};

// WebSocket server for WebRTC
const wss = new WebSocketServer({
    server: httpsServer,
    path: '/helloworld',
});

wss.on('connection', (ws) => {
    const sessionId = Math.random().toString(36).substring(7);
    console.log(`Connection received with sessionId ${sessionId}`);

    ws.on('message', (_message) => {
        const message = JSON.parse(_message);

        switch (message.id) {
            case 'start':
                start(sessionId, ws, message.sdpOffer, (error, sdpAnswer) => {
                    if (error) {
                        return ws.send(JSON.stringify({
                            id: 'error',
                            message: error,
                        }));
                    }
                    ws.send(JSON.stringify({
                        id: 'startResponse',
                        sdpAnswer,
                    }));
                });
                break;

            case 'stop':
                stop(sessionId);
                break;

            case 'onIceCandidate':
                onIceCandidate(sessionId, message.candidate);
                break;

            default:
                ws.send(JSON.stringify({
                    id: 'error',
                    message: `Invalid message ${message}`,
                }));
                break;
        }
    });

    ws.on('error', (error) => {
        console.log(`Connection ${sessionId} error: ${error}`);
        stop(sessionId);
    });

    ws.on('close', () => {
        console.log(`Connection ${sessionId} closed`);
        stop(sessionId);
    });
});

// Start HTTPS server on port 8443 instead of 3000
const PORT = 8443;
httpsServer.listen(PORT, () => {
    console.log(`Kurento Loopback Server is listening on https://localhost:${PORT}`);
    console.log('WebSocket endpoint: wss://localhost:8443/helloworld');
});