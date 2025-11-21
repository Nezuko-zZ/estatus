const axios = require('axios');

// 模拟节点配置
const NODES = [
    {
        id: 'hk-01', name: 'HK-Premium-CN2', loc: 'Hong Kong', code: 'hk', type: 'KVM', os: 'debian', bandwidth_limit: 1000, price: '$19.90/mo', lat: 22.3193, lng: 114.1694,
        tags: [{text: 'CN2 GIA', color: 'blue'}, {text: 'SSD', color: 'gray'}]
    },
    {
        id: 'us-la', name: 'US-LosAngeles-GIA', loc: 'United States', code: 'us', type: 'Dedicated', os: 'ubuntu', bandwidth_limit: 'unlimited', price: '$59.00/mo', lat: 34.0522, lng: -118.2437,
        tags: [{text: 'GIA', color: 'blue'}, {text: '10Gbps', color: 'purple'}, {text: 'Anti-DDoS', color: 'green'}]
    },
    {
        id: 'jp-tyo', name: 'JP-Tokyo-Softbank', loc: 'Japan', code: 'jp', type: 'KVM', os: 'centos', bandwidth_limit: 2000, price: '$24.50/mo', lat: 35.6762, lng: 139.6503,
        tags: [{text: 'Softbank', color: 'yellow'}, {text: 'Native IP', color: 'green'}]
    },
    {
        id: 'sg-aws', name: 'SG-AWS-Direct', loc: 'Singapore', code: 'sg', type: 'KVM', os: 'amazonlinux', bandwidth_limit: 500, price: '$8.00/mo', lat: 1.3521, lng: 103.8198,
        tags: [{text: 'AWS', color: 'orange'}, {text: 'Streaming', color: 'red'}]
    },
    {
        id: 'de-fra', name: 'DE-Frankfurt-9929', loc: 'Germany', code: 'de', type: 'KVM', os: 'debian', bandwidth_limit: 'unlimited', price: '$12.00/mo', lat: 50.1109, lng: 8.6821,
        tags: [{text: 'CU 9929', color: 'indigo'}, {text: 'HDD', color: 'gray'}]
    },
    {
        id: 'uk-lon', name: 'UK-London-Linenode', loc: 'United Kingdom', code: 'gb', type: 'KVM', os: 'ubuntu', bandwidth_limit: 1000, price: '$10.00/mo', lat: 51.5074, lng: -0.1278,
        tags: [{text: 'BGP', color: 'gray'}, {text: 'Low Ping', color: 'green'}]
    },
    {
        id: 'kr-sel', name: 'KR-Seoul-Oracle', loc: 'South Korea', code: 'kr', type: 'ARM', os: 'oracle', bandwidth_limit: 'unlimited', price: '$0.00/mo', lat: 37.5665, lng: 126.9780,
        tags: [{text: 'Oracle Cloud', color: 'red'}, {text: 'ARM', color: 'orange'}]
    },
    {
        id: 'cn-sha', name: 'CN-Shanghai-BGP', loc: 'China', code: 'cn', type: 'BareMetal', os: 'windows', bandwidth_limit: 5000, price: '¥499.00/mo', lat: 31.2304, lng: 121.4737,
        tags: [{text: 'BGP', color: 'blue'}, {text: 'High Speed', color: 'purple'}, {text: 'No-UDP', color: 'gray'}]
    },
];

const stateCache = {};
const API_URL = 'http://localhost:3000/api/report';

const fluctuate = (base, variance) => Math.max(1, Math.floor(base + (Math.random() - 0.5) * variance));

async function reportData() {
    console.log(`\n--- 上报数据 [${new Date().toLocaleTimeString()}] ---`);
    
    const promises = NODES.map(async (node) => {
        if (!stateCache[node.id]) stateCache[node.id] = { trafficUsed: Math.random() * 100, cpu: Math.random() * 50 };
        const cache = stateCache[node.id];
        
        cache.cpu = Math.min(100, Math.max(0, cache.cpu + (Math.random() - 0.5) * 15));
        const ram = Math.floor(40 + Math.random() * 20);
        
        const netIn = Math.abs(Math.sin(Date.now() / 10000)) * 50 + Math.random() * 10;
        const netOut = Math.abs(Math.cos(Date.now() / 10000)) * 40 + Math.random() * 5;
        
        cache.trafficUsed += (netIn + netOut) / 1024 / 8 * 0.5;

        const isCnOptimized = node.tags.some(t => t.text.includes('CN2') || t.text.includes('BGP'));
        const baseLatency = isCnOptimized ? 30 : 180;
        
        const pingData = [
            { target: '电信', ms: fluctuate(baseLatency, 20) },
            { target: '联通', ms: fluctuate(baseLatency + 10, 20) },
            { target: '移动', ms: fluctuate(baseLatency + 5, 30) },
            { target: 'Google', ms: fluctuate(node.code === 'us' ? 10 : 150, 10) },
            { target: 'Cloudflare', ms: fluctuate(node.code === 'us' ? 5 : 140, 10) }
        ];

        const payload = {
            id: node.id,
            name: node.name,
            type: node.type,
            loc: node.loc,
            code: node.code,
            os: node.os,
            price: node.price,
            expire_date: '2025-12-31',
            bandwidth_limit: node.bandwidth_limit,
            tags: node.tags,
            online: true,
            uptime: '15d 2h',
            cpu: cache.cpu,
            ram: ram,
            disk: 45,
            net_in: netIn,
            net_out: netOut,
            traffic_used: cache.trafficUsed,
            pingData: pingData,
            lat: node.lat,
            lng: node.lng
        };

        try {
            await axios.post(API_URL, payload, { timeout: 2000 });
        } catch (err) {
            console.error(`[✘] ${node.id}: ${err.message}`);
        }
    });

    await Promise.all(promises);
}

setInterval(reportData, 3000);
reportData();