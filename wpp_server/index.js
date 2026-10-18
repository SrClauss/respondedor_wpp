const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// Captura exceções não tratadas para evitar crash do processo
process.on('uncaughtException', (err) => {
    console.error('[WPP ERRO FATAL] Exceção não capturada (processo NÃO encerrado):', err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error('[WPP ERRO FATAL] Promise rejeitada sem tratamento:', reason);
});

let wppStatus = 'desconectado'; // desconectado, gerando, aguardando, conectado
let qrCodeDataUrl = null;
let client = null;

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function matarProcessosChrome() {
    try {
        if (process.platform === 'win32') {
            execSync('taskkill /F /IM chrome.exe /T 2>nul || true');
        } else {
            execSync('pkill -9 -f chrome || true');
        }
    } catch (e) {}
}

function encontrarChromeWindows() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    if (process.platform === 'win32') {
        const caminhos = [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
            // Fallback para o Edge (vem pré-instalado em todo Windows 10/11)
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
        ];
        for (const p of caminhos) {
            if (fs.existsSync(p)) return p;
        }
    }
    return undefined;
}

function limparLocks() {
    matarProcessosChrome();
    const sessionDir = process.env.WPP_SESSION_PATH || path.join(__dirname, 'wpp_session');
    try {
        if (fs.existsSync(sessionDir)) {
            const removeLock = (dir) => {
                const files = fs.readdirSync(dir);
                for (const file of files) {
                    const fullPath = path.join(dir, file);
                    if (file === 'SingletonLock' || file === 'SingletonCookie' || file === 'SingletonSocket' || file === 'DevToolsActivePort') {
                        try { fs.unlinkSync(fullPath); } catch (e) {}
                    } else if (fs.statSync(fullPath).isDirectory()) {
                        removeLock(fullPath);
                    }
                }
            };
            removeLock(sessionDir);
        }
    } catch (e) {
        console.log('Aviso ao limpar locks:', e.message);
    }
}

async function inicializarCliente(forcarLimparSessao = false) {
    if (client) {
        try {
            await client.destroy();
        } catch (e) {}
        client = null;
    }

    limparLocks();

    if (forcarLimparSessao) {
        const sessionPath = path.join(__dirname, 'wpp_session', 'session');
        try {
            if (fs.existsSync(sessionPath)) {
                fs.rmSync(sessionPath, { recursive: true, force: true });
                console.log('[WPP] Sessão anterior removida para novo login.');
            }
        } catch (e) {
            console.error('[WPP] Erro ao remover pasta de sessão:', e.message);
        }
    }

    wppStatus = 'gerando';
    qrCodeDataUrl = null;

    const sessionBasePath = process.env.WPP_SESSION_PATH || './wpp_session';
    const chromePath = encontrarChromeWindows();
    console.log('[WPP] Navegador detectado:', chromePath || 'Nenhum (usando padrao puppeteer)');

    const puppeteerConfig = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-extensions'
        ]
    };

    if (chromePath) {
        puppeteerConfig.executablePath = chromePath;
    }

    client = new Client({
        authStrategy: new LocalAuth({ dataPath: sessionBasePath }),
        puppeteer: puppeteerConfig
    });

    client.on('qr', async (qr) => {
        console.log('QR Code recebido. Gerando imagem...');
        wppStatus = 'aguardando';
        try {
            qrCodeDataUrl = await qrcode.toDataURL(qr);
        } catch (err) {
            console.error('Erro ao gerar qr code:', err);
        }
    });

    client.on('ready', () => {
        console.log('WhatsApp Client is ready!');
        wppStatus = 'conectado';
        qrCodeDataUrl = null;
    });

    client.on('disconnected', (reason) => {
        console.log('WhatsApp Client was disconnected:', reason);
        wppStatus = 'desconectado';
        qrCodeDataUrl = null;
        if (reason === 'LOGOUT') {
            console.log('[WPP] Desconexão por LOGOUT detectada. Limpando sessão e reiniciando...');
            setTimeout(() => {
                inicializarCliente(true).catch(e => console.error(e));
            }, 2000);
        }
    });

    client.on('auth_failure', (msg) => {
        console.error('[WPP] Falha na autenticação:', msg);
        wppStatus = 'desconectado';
        qrCodeDataUrl = null;
        setTimeout(() => {
            inicializarCliente(true).catch(e => console.error(e));
        }, 2000);
    });

    client.on('message_create', tratarMensagemRecebida);

    try {
        await client.initialize();
    } catch (err) {
        console.error('Erro ao inicializar wpp client:', err.message);
        wppStatus = 'desconectado';
    }
}

async function tratarMensagemRecebida(msg) {
    if (!msg.isStatus && !msg.fromMe) {
        console.log(`Mensagem recebida de ${msg.from}: ${msg.body} (hasMedia: ${msg.hasMedia})`);
        
        let mediaUrl = null;
        if (msg.hasMedia) {
            try {
                await new Promise(r => setTimeout(r, 1500));
                
                let media = null;
                for (let attempt = 1; attempt <= 4; attempt++) {
                    try {
                        const targetMsg = (msg.id && msg.id._serialized) 
                            ? (await client.getMessageById(msg.id._serialized).catch(() => null)) || msg 
                            : msg;
                        
                        media = await targetMsg.downloadMedia();
                        if (media && media.data) break;
                    } catch (e) {
                        console.log(`[WPP Mídia] Tentativa ${attempt} falhou: ${e.message}. Tentando novamente...`);
                        if (attempt === 4) throw e;
                        await new Promise(r => setTimeout(r, 2000));
                    }
                }

                if (media) {
                    const downloadsDir = path.join(__dirname, '../downloads');
                    if (!fs.existsSync(downloadsDir)) {
                        fs.mkdirSync(downloadsDir, { recursive: true });
                    }
                    
                    let filename = media.filename || msg._data?.filename || `arquivo_${Date.now()}`;
                    if (!path.extname(filename)) {
                        const ext = media.mimetype ? media.mimetype.split('/')[1]?.split(';')[0] || 'bin' : 'bin';
                        filename = `${filename}.${ext}`;
                    } else {
                        filename = `${path.basename(filename, path.extname(filename))}_${Date.now()}${path.extname(filename)}`;
                    }

                    const filePath = path.join(downloadsDir, filename);
                    fs.writeFileSync(filePath, media.data, { encoding: 'base64' });
                    console.log(`[WPP Mídia] ARQUIVO BAIXADO E SALVO COM SUCESSO EM: ${filePath}`);
                    mediaUrl = `/downloads/${filename}`;
                }
            } catch (err) {
                console.error('[WPP Mídia] Erro ao baixar arquivo da mensagem:', err && err.stack ? err.stack : err);
            }
        }

        try {
            await axios.post('http://127.0.0.1:8080/webhook/wpp', {
                from: msg.from,
                body: msg.body,
                media_url: mediaUrl,
                timestamp: msg.timestamp
            });
        } catch (error) {
            console.error('Erro ao enviar webhook para o Rust:', error.message);
        }
    }
}

app.get('/api/wpp/status', (req, res) => {
    res.json({
        status: wppStatus,
        qr: qrCodeDataUrl
    });
});

app.post('/api/wpp/connect', async (req, res) => {
    if (wppStatus !== 'conectado' && wppStatus !== 'aguardando') {
        inicializarCliente(false).catch(err => {
            console.error('Erro ao inicializar wpp client:', err);
            wppStatus = 'desconectado';
        });
    }
    res.json({ status: wppStatus, qr: qrCodeDataUrl });
});

app.post('/api/wpp/disconnect', async (req, res) => {
    if (client) {
        try {
            await client.logout();
            await client.destroy();
        } catch (e) {
            console.error(e);
        }
        client = null;
    }
    limparLocks();
    const sessionPath = path.join(__dirname, 'wpp_session', 'session');
    try {
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }
    } catch (e) {}
    wppStatus = 'desconectado';
    qrCodeDataUrl = null;
    res.json({ status: wppStatus });
});

app.post('/api/wpp/send', async (req, res) => {
    const { to, message } = req.body;
    if (wppStatus !== 'conectado') {
        return res.status(400).json({ error: 'WhatsApp não está conectado' });
    }
    try {
        const cleanedNumber = to.replace(/\D/g, '');
        const targetId = `${cleanedNumber}@c.us`;

        console.log(`[WPP] Enviando mensagem para ${targetId}...`);
        await client.sendMessage(targetId, message);
        console.log(`[WPP] Mensagem enviada com sucesso para ${targetId}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/wpp/download_chat_media', async (req, res) => {
    const { to } = req.body;
    if (wppStatus !== 'conectado') {
        return res.status(400).json({ error: 'WhatsApp não está conectado' });
    }
    
    try {
        const cleanedNumber = to.replace(/\D/g, '');
        console.log(`[WPP Mídia Lote] Buscando mídias no chat para o número ${cleanedNumber}...`);
        
        // Usa getChatById diretamente para evitar crash do getChats() no Puppeteer
        let chat = null;
        const chatIds = [`${cleanedNumber}@c.us`, `${cleanedNumber}@lid`];
        
        for (const chatId of chatIds) {
            try {
                chat = await client.getChatById(chatId);
                if (chat) {
                    console.log(`[WPP Mídia Lote] Chat encontrado via ID: ${chatId}`);
                    break;
                }
            } catch (e) {
                console.log(`[WPP Mídia Lote] Chat não encontrado com ID ${chatId}, tentando próximo...`);
            }
        }
        
        if (!chat) {
            console.error(`[WPP Mídia Lote] Chat não encontrado para ${cleanedNumber}`);
            return res.status(404).json({ error: 'chat_nao_encontrado' });
        }

        const messages = await chat.fetchMessages({ limit: 50 });
        console.log(`[WPP Mídia Lote] ${messages.length} mensagens encontradas no chat.`);
        
        let downloadedCount = 0;
        const savedFiles = [];
        const downloadsDir = path.join(__dirname, '../downloads');
        if (!fs.existsSync(downloadsDir)) {
            fs.mkdirSync(downloadsDir, { recursive: true });
        }

        for (const msg of messages) {
            // Baixa mídias de mensagens recebidas (não enviadas por nós)
            if (msg.hasMedia && !msg.fromMe) {
                try {
                    let media = null;
                    for (let attempt = 1; attempt <= 4; attempt++) {
                        try {
                            // Tenta recarregar a mensagem pelo ID para dados mais frescos
                            const freshMsg = (msg.id && msg.id._serialized) 
                                ? (await client.getMessageById(msg.id._serialized).catch(() => null)) || msg 
                                : msg;
                            media = await freshMsg.downloadMedia();
                            if (media && media.data) {
                                console.log(`[WPP Mídia Lote] Mídia baixada na tentativa ${attempt}`);
                                break;
                            }
                        } catch (e) {
                            console.log(`[WPP Mídia Lote] Tentativa ${attempt} falhou: ${e.message}`);
                            if (attempt < 4) await new Promise(r => setTimeout(r, 2000));
                        }
                    }

                    if (media && media.data) {
                        let filename = media.filename || msg._data?.filename || `arquivo_${Date.now()}_${downloadedCount}`;
                        if (!path.extname(filename)) {
                            const ext = media.mimetype ? media.mimetype.split('/')[1]?.split(';')[0] || 'bin' : 'bin';
                            filename = `${filename}.${ext}`;
                        } else {
                            filename = `${path.basename(filename, path.extname(filename))}_${Date.now()}${path.extname(filename)}`;
                        }

                        const filePath = path.join(downloadsDir, filename);
                        fs.writeFileSync(filePath, media.data, { encoding: 'base64' });
                        console.log(`[WPP Mídia Lote] ARQUIVO SALVO EM LOTE: ${filePath}`);
                        savedFiles.push(`/downloads/${filename}`);
                        downloadedCount++;
                    }
                } catch (err) {
                    console.error('[WPP Mídia Lote] Erro ao baixar mídia individual:', err.message);
                }
            }
            
            // Também verifica se o corpo da mensagem contém URLs de arquivos (links enviados pelo robô receptor)
            if (!msg.fromMe && !msg.hasMedia && msg.body) {
                const urlRegex = /https?:\/\/[^\s]+\.(pdf|doc|docx|xls|xlsx|csv|zip|rar|png|jpg|jpeg|gif|mp4|mp3|ogg|webp|txt)/gi;
                const urls = msg.body.match(urlRegex);
                if (urls && urls.length > 0) {
                    for (const url of urls) {
                        try {
                            console.log(`[WPP Mídia Lote] Baixando arquivo via URL: ${url}`);
                            const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
                            const urlPath = new URL(url).pathname;
                            let filename = path.basename(urlPath) || `url_arquivo_${Date.now()}`;
                            filename = `${path.basename(filename, path.extname(filename))}_${Date.now()}${path.extname(filename) || '.bin'}`;
                            
                            const filePath = path.join(downloadsDir, filename);
                            fs.writeFileSync(filePath, Buffer.from(response.data));
                            console.log(`[WPP Mídia Lote] ARQUIVO DE URL SALVO: ${filePath}`);
                            savedFiles.push(`/downloads/${filename}`);
                            downloadedCount++;
                        } catch (urlErr) {
                            console.error(`[WPP Mídia Lote] Erro ao baixar URL ${url}:`, urlErr.message);
                        }
                    }
                }
            }
        }

        console.log(`[WPP Mídia Lote] Download concluído: ${downloadedCount} arquivo(s) salvos.`);
        res.json({ success: true, count: downloadedCount, files: savedFiles });
    } catch (error) {
        console.error('Erro ao baixar mídias do chat:', error.message || error);
        res.status(500).json({ error: error.message || 'Erro desconhecido' });
    }
});

const PORT = process.env.WPP_PORT || 3001;
app.listen(PORT, () => {
    console.log(`Servidor WPP rodando na porta ${PORT}`);
    console.log('Iniciando cliente WPP automaticamente...');
    inicializarCliente(false).catch(err => {
        console.error('Erro ao inicializar wpp client:', err);
        wppStatus = 'desconectado';
    });
});
