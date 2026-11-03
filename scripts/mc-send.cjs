// Send a chat message to a Mindcraft agent through the MindServer socket.
// Usage: node scripts/mc-send.cjs "<message>" [port]
'use strict';
const path = require('path');
const { io } = require(path.join(__dirname, '..', 'node_modules', 'socket.io-client'));

const message = process.argv[2];
const port = Number(process.argv[3] || 8080);
if (!message) {
    console.error('Usage: node scripts/mc-send.cjs "<message>" [port]');
    process.exit(2);
}

const socket = io(`http://localhost:${port}`);
const timer = setTimeout(() => {
    console.error(`mc-send: no connection to port ${port} - is the bot running?`);
    process.exit(1);
}, 5000);

socket.on('connect', () => {
    clearTimeout(timer);
    socket.emit('send-message', 'philbug', { from: 'ADMIN', message });
    console.log(`mc-send: sent: ${message}`);
    setTimeout(() => process.exit(0), 1000);
});

socket.on('connect_error', (err) => {
    clearTimeout(timer);
    console.error(`mc-send: connection failed: ${err.message}`);
    process.exit(1);
});
