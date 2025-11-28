const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Mobile User Agents
const MOBILE_USER_AGENTS = [
    "Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.101 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 12; SM-S908E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.41 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 15_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Mobile/15E148 Safari/604.1"
];

const BASE_URL = "https://boostgrams.com";
const API_URL = `${BASE_URL}/action/`;

// Store active boost sessions
const activeSessions = new Map();

class BoostSession {
    constructor(url) {
        this.id = uuidv4();
        this.url = url;
        this.success = 0;
        this.failed = 0;
        this.totalViews = 0;
        this.totalLikes = 0;
        this.consecutiveFails = 0;
        this.isRunning = false;
        this.startTime = new Date();
        this.lastUpdate = new Date();
    }

    updateStats(success, views = 100, likes = 100) {
        if (success) {
            this.success++;
            this.totalViews += views;
            this.totalLikes += likes;
            this.consecutiveFails = 0;
        } else {
            this.failed++;
            this.consecutiveFails++;
        }
        this.lastUpdate = new Date();
    }

    getStats() {
        return {
            id: this.id,
            url: this.url,
            success: this.success,
            failed: this.failed,
            totalViews: this.totalViews,
            totalLikes: this.totalLikes,
            consecutiveFails: this.consecutiveFails,
            isRunning: this.isRunning,
            startTime: this.startTime,
            lastUpdate: this.lastUpdate,
            duration: Math.floor((new Date() - this.startTime) / 1000)
        };
    }
}

// Utility functions
function randomIP() {
    return Array.from({length: 4}, () => Math.floor(Math.random() * 256)).join('.');
}

function randomUA() {
    return MOBILE_USER_AGENTS[Math.floor(Math.random() * MOBILE_USER_AGENTS.length)];
}

function generateBypassUrl(url) {
    const rand = Math.random().toString(36).substring(2, 10);
    const time = Date.now();
    return `${url}?ref=boost${rand}${time}&t=${time}`;
}

function cleanUrl(url) {
    try {
        const urlObj = new URL(url);
        return `${urlObj.origin}${urlObj.pathname}`;
    } catch {
        return url;
    }
}

async function resolveShortUrl(shortUrl) {
    try {
        const response = await axios.head(shortUrl, {
            headers: { "User-Agent": randomUA(), "Accept": "*/*" },
            maxRedirects: 0,
            validateStatus: null
        });
        
        const location = response.headers.location;
        if (!location) throw new Error("No redirect");
        
        if (location.includes("tiktok.com/@") && location.includes("/video/")) {
            return location;
        } else {
            return resolveShortUrl(location);
        }
    } catch (error) {
        throw error;
    }
}

async function prepareUrl(inputUrl) {
    if (inputUrl.includes("vt.tiktok.com") || inputUrl.includes("vm.tiktok.com")) {
        try {
            const resolved = await resolveShortUrl(inputUrl);
            return cleanUrl(resolved);
        } catch {
            return cleanUrl(inputUrl);
        }
    }
    return cleanUrl(inputUrl);
}

async function boost(url, sessionId) {
    const ip = randomIP();
    const ua = randomUA();
    const session = activeSessions.get(sessionId);
    
    let cookieJar = {};

    function cookiesToHeader() {
        return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
    }

    function mergeCookies(response) {
        const cookies = response.headers['set-cookie'];
        if (!cookies) return;
        
        cookies.forEach(cookie => {
            const [pair] = cookie.split(';');
            const [key, value] = pair.split('=');
            if (key) cookieJar[key.trim()] = value || '';
        });
    }

    function getHeaders(isPage, ip, ua) {
        const headers = {
            "User-Agent": ua,
            "Accept-Language": "en-US,en;q=0.9",
            "X-Forwarded-For": ip,
            "X-Real-IP": ip,
            "Cookie": cookiesToHeader(),
            "Accept": isPage 
                ? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
                : "application/json, */*;q=0.1"
        };
        
        if (!isPage) {
            headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
            headers["X-Requested-With"] = "XMLHttpRequest";
        }
        
        return headers;
    }

    function buildBody(url, token = "") {
        const params = new URLSearchParams();
        params.append("ns_action", "freetool_start");
        params.append("freetool[id]", "22");
        params.append("freetool[token]", token);
        params.append("freetool[process_item]", url);
        params.append("freetool[quantity]", "100");
        return params.toString();
    }

    async function initSession(ip, ua) {
        cookieJar = {};
        await axios.get(BASE_URL, { 
            headers: getHeaders(true, ip, ua), 
            timeout: 15000 
        });
        await axios.get(`${BASE_URL}/free-tiktok-views/`, { 
            headers: getHeaders(true, ip, ua), 
            timeout: 15000 
        });
    }

    try {
        // Stop if session is no longer running
        if (!session || !session.isRunning) {
            return { success: false, error: "Session stopped" };
        }

        const bypassUrl = generateBypassUrl(url);
        await initSession(ip, ua);

        // Step 1
        const step1 = await axios.post(API_URL, buildBody(bypassUrl), {
            headers: getHeaders(false, ip, ua),
            timeout: 20000,
            validateStatus: () => true
        });

        mergeCookies(step1);

        const token = step1.data?.freetool_process_token;
        if (!token) return { success: false, stage: "token" };

        // Step 2
        const step2 = await axios.post(API_URL, buildBody(bypassUrl, token), {
            headers: getHeaders(false, ip, ua),
            timeout: 20000,
            validateStatus: () => true
        });

        return (step2.data?.statu || step2.data?.success)
            ? { success: true, views: 100, likes: 100 }
            : { success: false, stage: "execute" };
            
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Routes
app.get('/', (req, res) => {
    res.json({
        message: 'TikTok Boost API - MADE BY TOOLIPOP',
        version: '2.0',
        endpoints: {
            '/start': 'GET - Start boosting session',
            '/status/:sessionId': 'GET - Get session status',
            '/stop/:sessionId': 'GET - Stop session',
            '/sessions': 'GET - List all active sessions'
        }
    });
});

// Start boosting session
app.get('/start', async (req, res) => {
    try {
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'TikTok URL is required'
            });
        }

        // Prepare URL
        const targetUrl = await prepareUrl(url);
        
        // Create new session
        const session = new BoostSession(targetUrl);
        session.isRunning = true;
        activeSessions.set(session.id, session);

        // Start boosting in background
        startBoostingLoop(session.id, targetUrl);

        res.json({
            success: true,
            message: 'Boosting session started',
            sessionId: session.id,
            targetUrl: targetUrl,
            stats: session.getStats()
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get session status
app.get('/status/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = activeSessions.get(sessionId);
    
    if (!session) {
        return res.status(404).json({
            success: false,
            error: 'Session not found'
        });
    }

    res.json({
        success: true,
        ...session.getStats()
    });
});

// Stop session
app.get('/stop/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = activeSessions.get(sessionId);
    
    if (!session) {
        return res.status(404).json({
            success: false,
            error: 'Session not found'
        });
    }

    session.isRunning = false;
    activeSessions.delete(sessionId);

    res.json({
        success: true,
        message: 'Session stopped',
        finalStats: session.getStats()
    });
});

// List all sessions
app.get('/sessions', (req, res) => {
    const sessions = Array.from(activeSessions.values()).map(session => 
        session.getStats()
    );
    
    res.json({
        success: true,
        totalSessions: sessions.length,
        sessions: sessions
    });
});

// Background boosting loop
async function startBoostingLoop(sessionId, targetUrl) {
    const session = activeSessions.get(sessionId);
    if (!session) return;

    console.log(`🚀 Starting boost loop for session: ${sessionId}`);

    while (session.isRunning) {
        try {
            const result = await boost(targetUrl, sessionId);
            session.updateStats(result.success, result.views, result.likes);

            if (result.success) {
                console.log(`✅ Boost #${session.success} - ${session.totalViews} views - ${session.totalLikes} likes`);
            } else {
                console.log(`❌ Failed: ${result.stage || result.error} - Consecutive: ${session.consecutiveFails}`);
                
                if (session.consecutiveFails >= 5) {
                    console.log('⚠ Cooling down for 5 seconds...');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    session.consecutiveFails = 0;
                }
            }

            // Small delay between boosts
            await new Promise(resolve => setTimeout(resolve, 2000));
            
        } catch (error) {
            console.error('Error in boost loop:', error);
            session.updateStats(false);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    
    console.log(`🛑 Boost loop stopped for session: ${sessionId}`);
}

// Clean up old sessions (older than 24 hours)
setInterval(() => {
    const now = new Date();
    let cleaned = 0;
    
    for (const [sessionId, session] of activeSessions.entries()) {
        if (now - session.lastUpdate > 24 * 60 * 60 * 1000) { // 24 hours
            activeSessions.delete(sessionId);
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log(`🧹 Cleaned up ${cleaned} old sessions`);
    }
}, 60 * 60 * 1000); // Check every hour

// Start server
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════╗
║           TIKTOK BOOST API SERVICE            ║
║              MADE BY TOOLIPOP                 ║
╚═══════════════════════════════════════════════╝
🚀 Server running on port ${PORT}
📱 API Ready for TikTok boosting!
    `);
});
