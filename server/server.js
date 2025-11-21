const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

// --- 初始化配置 ---
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = 3000;
const SECRET_KEY = 'estatus-secret-key-change-me';

// --- 数据库连接配置 ---
// [修复] 这里必须是纯对象，不能是 new Pool()
const dbConfig = {
  user: 'postgres',       // 你的数据库用户名 (默认 postgres)
  host: 'dwh.yiandrive.com',      // 数据库地址
  database: 'estatus',    // 数据库名 (需提前创建)
  password: 'mysecretpassword',   // 你的数据库密码
  port: 17948,             // 默认端口
};

// 打印调试信息，帮助定位 IP 来源
console.log(">> [DB Config] 准备连接数据库:", {
    host: process.env.PGHOST || dbConfig.host,
    port: process.env.PGPORT || dbConfig.port,
    db: process.env.PGDATABASE || dbConfig.database,
    user: process.env.PGUSER || dbConfig.user
});

// [修复] 使用配置对象创建连接池
const pool = new Pool(dbConfig);

pool.on('error', (err) => {
  console.error('[DB Error] 数据库连接池发生意外错误:', err);
});

// --- 数据库初始化 ---
async function initDB() {
  console.log(">> [Init] 正在初始化表结构...");
  
  // 增加连接测试，如果配置错误在这里就会捕获
  let client;
  try {
    client = await pool.connect();
    console.log(">> [Init] 数据库连接成功！");
    
    await client.query('BEGIN');

    await client.query(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);`);
    await client.query(`CREATE TABLE IF NOT EXISTS servers (id TEXT PRIMARY KEY, name TEXT, type TEXT, loc TEXT, code TEXT, os TEXT, price TEXT, expire_date TEXT, bandwidth_limit TEXT, tags TEXT, buy_link TEXT, display_order INTEGER DEFAULT 0, updated_at INTEGER);`);
    
    await client.query(`CREATE TABLE IF NOT EXISTS monitor_logs (server_id TEXT, created_at INTEGER, cpu REAL, ram REAL, disk REAL, net_in REAL, net_out REAL, traffic_used REAL);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_monitor_server_time ON monitor_logs(server_id, created_at);`);

    await client.query(`CREATE TABLE IF NOT EXISTS ping_logs (server_id TEXT, target_name TEXT, latency INTEGER, created_at INTEGER);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ping_server_time ON ping_logs(server_id, created_at);`);

    const defaultPwd = await client.query("SELECT value FROM settings WHERE key = 'admin_password'");
    if (defaultPwd.rowCount === 0) {
       await client.query("INSERT INTO settings (key, value) VALUES ($1, $2)", ['admin_password', 'admin']);
    }
    const defaultBg = await client.query("SELECT value FROM settings WHERE key = 'background_image'");
    if (defaultBg.rowCount === 0) {
        await client.query("INSERT INTO settings (key, value) VALUES ($1, $2)", ['background_image', 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop']);
    }
    const defaultPing = await client.query("SELECT value FROM settings WHERE key = 'ping_targets'");
    if (defaultPing.rowCount === 0) {
        const targets = JSON.stringify([
            { name: "Google", host: "google.com" },
            { name: "Cloudflare", host: "1.1.1.1" },
            { name: "China Telecom", host: "chinatelecom.com.cn" }
        ]);
        await client.query("INSERT INTO settings (key, value) VALUES ($1, $2)", ['ping_targets', targets]);
    }

    await client.query('COMMIT');
    console.log(">> [Init] 数据库表结构检查完成");
  } catch (e) {
    if (client) await client.query('ROLLBACK');
    console.error(">> [Init Error] 数据库初始化失败:", e.message);
    console.error(">> 请检查你的数据库连接配置是否正确 (server.js 第20行)");
    console.error(">> 错误详情:", e);
    process.exit(1); 
  } finally {
    if (client) client.release();
  }
}

// --- Express 中间件 ---
app.use(cors());
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../client')));

// --- API 路由 ---
app.post('/api/report', async (req, res) => {
    const d = req.body;
    if (!d.id) return res.status(400).send({ error: 'Missing ID' });
    
    const now = Math.floor(Date.now() / 1000);
    
    // [优化] 获取连接 client，如果池已满或错误这里会抛出
    let client;
    try {
        client = await pool.connect();
    } catch (err) {
        console.error("[DB Connect Error] 无法获取数据库连接:", err.message);
        return res.status(500).send({ error: 'Database Connection Failed' });
    }

    const netIn = d.net_in !== undefined ? d.net_in : (d.netIn !== undefined ? d.netIn : 0);
    const netOut = d.net_out !== undefined ? d.net_out : (d.netOut !== undefined ? d.netOut : 0);
    const trafficUsed = d.traffic_used !== undefined ? d.traffic_used : (d.trafficUsed !== undefined ? d.trafficUsed : 0);

    try {
        const existRes = await client.query("SELECT id FROM servers WHERE id = $1", [d.id]);
        if (existRes.rowCount === 0) {
            console.log(`[DB] 新节点注册: ${d.id}`);
            await client.query(`
                INSERT INTO servers (id, name, type, loc, code, os, price, expire_date, bandwidth_limit, tags, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            `, [d.id, d.name, d.type, d.loc, d.code, d.os, d.price || '待配置', d.expire_date || '待配置', d.bandwidth_limit, JSON.stringify(d.tags || []), now]);
        } else {
            await client.query("UPDATE servers SET name=$1, updated_at=$2 WHERE id=$3", [d.name, now, d.id]);
        }

        await client.query(`
            INSERT INTO monitor_logs (server_id, created_at, cpu, ram, disk, net_in, net_out, traffic_used)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [d.id, now, d.cpu, d.ram, d.disk, netIn, netOut, trafficUsed]);

        if (d.pingData && Array.isArray(d.pingData)) {
            const pingPromises = d.pingData.map(p => 
                client.query(`INSERT INTO ping_logs (server_id, target_name, latency, created_at) VALUES ($1, $2, $3, $4)`, 
                [d.id, p.target, p.ms, now])
            );
            await Promise.all(pingPromises);
        }

        res.send({ status: 'ok' });
        // 异步广播
        broadcastLive(d.id);

    } catch (e) {
        console.error(`[API Error] ${e.message}`);
        res.status(500).send({ error: e.message });
    } finally {
        client.release();
    }
});

app.post('/api/login', async (req, res) => {
    const { password } = req.body;
    try {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'admin_password'");
        const storedPwd = result.rows[0]?.value;
        if (password === storedPwd) {
            const token = jwt.sign({ role: 'admin' }, SECRET_KEY, { expiresIn: '7d' });
            res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 3600 * 1000 });
            res.json({ success: true });
        } else { res.status(403).json({ success: false, message: '密码错误' }); }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/config/public', async (req, res) => {
    try {
        const bgRes = await pool.query("SELECT value FROM settings WHERE key = 'background_image'");
        const targetRes = await pool.query("SELECT value FROM settings WHERE key = 'ping_targets'");
        res.json({ background_image: bgRes.rows[0]?.value || '', ping_targets: JSON.parse(targetRes.rows[0]?.value || '[]') });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/server/:id/history', async (req, res) => {
    try {
        let timeFilter = Math.floor(Date.now() / 1000) - 86400;
        const history = await pool.query(`SELECT created_at, cpu, ram, net_in, net_out FROM monitor_logs WHERE server_id = $1 AND created_at > $2 ORDER BY created_at ASC`, [req.params.id, timeFilter]);
        res.json(history.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../client/login.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../client/admin.html')));
app.get('/server/:id', (req, res) => res.sendFile(path.join(__dirname, '../client/detail.html')));

// --- WebSocket ---
wss.on('connection', async (ws) => {
    try {
        const serversRes = await pool.query("SELECT * FROM servers");
        const liveData = {};
        for (const s of serversRes.rows) {
            const latestRes = await pool.query(`SELECT * FROM monitor_logs WHERE server_id = $1 ORDER BY created_at DESC LIMIT 1`, [s.id]);
            // 修复：全量同步时带上最新的 Ping 数据
            const pingRes = await pool.query(`
                SELECT target_name as target, latency as ms 
                FROM ping_logs 
                WHERE server_id = $1 
                AND created_at = (SELECT MAX(created_at) FROM ping_logs WHERE server_id = $1)
            `, [s.id]);
            
            liveData[s.id] = { 
                ...s, 
                ...(latestRes.rows[0] || {}), 
                pingData: pingRes.rows,
                tags: JSON.parse(s.tags || '[]') 
            };
        }
        ws.send(JSON.stringify({ type: 'full_sync', data: liveData }));
    } catch (e) { console.error("[WS Error]", e); }
});

async function broadcastLive(serverId) {
    try {
        const sRes = await pool.query("SELECT * FROM servers WHERE id = $1", [serverId]);
        const latestRes = await pool.query(`SELECT * FROM monitor_logs WHERE server_id = $1 ORDER BY created_at DESC LIMIT 1`, [serverId]);
        if (sRes.rowCount === 0) return;

        // 修复：广播时带上最新的 Ping 数据
        const pingRes = await pool.query(`
            SELECT target_name as target, latency as ms 
            FROM ping_logs 
            WHERE server_id = $1 
            AND created_at = (SELECT MAX(created_at) FROM ping_logs WHERE server_id = $1)
        `, [serverId]);
        
        const data = { 
            ...sRes.rows[0], 
            ...(latestRes.rows[0] || {}), 
            pingData: pingRes.rows,
            tags: JSON.parse(sRes.rows[0].tags || '[]') 
        };
        
        const payload = JSON.stringify({ type: 'update_single', id: serverId, data });
        wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(payload); });
    } catch (e) { console.error("[WS Broadcast Error]", e); }
}

initDB().then(() => {
    server.listen(PORT, () => {
        console.log(`>> estatus Server 启动成功: http://localhost:${PORT}`);
    });
});