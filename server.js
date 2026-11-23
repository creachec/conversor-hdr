const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const path = require('path');
const fs = require('fs');
const archiverModule = require('archiver');

const createZipArchive = (options) => {
    if (typeof archiverModule === 'function') return archiverModule('zip', options);
    if (typeof archiverModule.create === 'function') return archiverModule.create('zip', options);
    if (archiverModule.ZipArchive) return new archiverModule.ZipArchive(options);
    throw new Error('Módulo archiver incompatível.');
};

const app = express();
const port = Number(process.env.PORT || 3000);
const uploadsPath = path.join(__dirname, 'uploads');
const convertedPath = path.join(__dirname, 'converted');
const converterPath = process.env.JXR_TO_AVIF || path.join(__dirname, 'bin', 'jxr_to_avif.exe');
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

app.use((req, res, next) => {
    const host = req.get('Host');
    const origin = req.get('Origin');
    const site = req.get('Sec-Fetch-Site');
    if (!hosts.has(host) || (origin && origin !== `http://${host}`) || ['same-site', 'cross-site'].includes(site)) {
        return res.status(403).send('Abra o conversor no endereço local indicado no terminal.');
    }
    next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const upload = multer({
    dest: uploadsPath,
    limits: { files: 100, fileSize: 128 * 1024 * 1024 },
    fileFilter: (req, file, done) => done(null, /\.jxr$/i.test(file.originalname))
});

fs.mkdirSync(uploadsPath, { recursive: true });
fs.mkdirSync(convertedPath, { recursive: true });

const jobs = new Map();
const convertedFile = /^[0-9a-f-]{36}\.avif$/i;

// Stage 1: Upload (single or batch)
app.post('/api/upload', upload.array('images', 100), (req, res) => {
    const files = req.files || (req.file ? [req.file] : []);
    if (files.length === 0) return res.status(400).send('Selecione pelo menos um arquivo JXR.');

    const createdJobs = files.map(file => {
        const jobId = randomUUID();
        jobs.set(jobId, {
            inputPath: file.path,
            originalName: file.originalname,
            size: file.size
        });
        return { jobId, fileName: file.originalname, size: file.size };
    });

    res.json({ jobs: createdJobs });
});

// Stage 2: Streaming Conversion via SSE (CPU — jxr_to_avif)
app.get('/api/convert-stream/:jobId', (req, res) => {
    const { jobId } = req.params;
    const requestedSpeed = Number.parseInt(req.query.speed, 10);
    const speed = Number.isNaN(requestedSpeed) ? 6 : Math.max(0, Math.min(9, requestedSpeed));
    const job = jobs.get(jobId);

    if (!job) return res.status(404).send('Job não encontrado.');
    if (job.running) return res.status(409).send('A conversão já está em andamento.');
    job.running = true;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (event, data) => {
        if (!res.writableEnded) {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        }
    };

    const outputFilename = `${jobId}.avif`;
    const outputPath = path.join(convertedPath, outputFilename);

    let killedByClient = false;
    let isCompleted = false;

    sendEvent('log', { message: `Iniciando conversão de ${job.originalName}...` });
    sendEvent('log', { message: `⚡ CPU Multithreading AVX2 | Speed/Qualidade: ${speed}` });

    // Syntax: jxr_to_avif [--speed n] input.jxr [output.avif]
    const child = spawn(converterPath, ['--speed', String(speed), job.inputPath, outputPath]);

    res.on('close', () => {
        if (!isCompleted && !child.killed) {
            killedByClient = true;
            console.log(`Job ${jobId} cancelado pelo cliente.`);
            try { child.kill('SIGKILL'); } catch (_) {}
            if (fs.existsSync(job.inputPath)) try { fs.unlinkSync(job.inputPath); } catch (_) {}
            if (fs.existsSync(outputPath)) try { fs.unlinkSync(outputPath); } catch (_) {}
            jobs.delete(jobId);
        }
    });

    child.stdout.on('data', d => {
        const msg = d.toString().trim();
        if (msg) sendEvent('log', { message: msg });
    });

    child.stderr.on('data', d => {
        const msg = d.toString().trim();
        if (msg) sendEvent('log', { message: msg });
    });

    child.on('error', err => {
        isCompleted = true;
        console.error('Falha ao iniciar jxr_to_avif:', err.code);
        sendEvent('error', { message: 'Instale o jxr_to_avif ou configure o caminho JXR_TO_AVIF.' });
        res.end();
    });

    child.on('close', code => {
        isCompleted = true;
        if (killedByClient) return;

        if (fs.existsSync(job.inputPath)) try { fs.unlinkSync(job.inputPath); } catch (_) {}
        jobs.delete(jobId);

        if (code === 0) {
            const targetName = (job.originalName || 'converted.jxr').replace(/\.jxr$/i, '.avif');
            sendEvent('done', {
                filename: outputFilename,
                downloadUrl: `/api/download/${outputFilename}?name=${encodeURIComponent(targetName)}`,
                message: 'Conversão finalizada com sucesso!'
            });
        } else {
            sendEvent('error', { message: `Erro na conversão (código ${code})` });
        }
        res.end();
    });
});

// Download individual file
app.get('/api/download/:filename', (req, res) => {
    if (!convertedFile.test(req.params.filename)) return res.sendStatus(404);
    const filePath = path.join(convertedPath, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('Arquivo não encontrado.');
    const downloadName = req.query.name || 'converted_hdr.avif';
    res.download(filePath, downloadName);
});

// Download all as ZIP
app.post('/api/download-zip', (req, res) => {
    const files = req.body?.files;
    if (!Array.isArray(files) || !files.length || files.length > 100) {
        return res.status(400).send('Nenhum arquivo especificado.');
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="converted_hdr_images.zip"');

    const archive = createZipArchive({ zlib: { level: 6 } });

    archive.on('error', err => {
        console.error('Erro no archiver:', err);
        if (!res.headersSent) res.status(500).send({ error: err.message });
    });

    archive.pipe(res);

    for (const item of files) {
        if (typeof item?.filename !== 'string' || !convertedFile.test(item.filename)) continue;
        const filePath = path.join(convertedPath, item.filename);
        if (fs.existsSync(filePath)) {
            const original = typeof item.originalName === 'string' ? item.originalName : item.filename;
            const nameInZip = path.win32.basename(original).replace(/\.jxr$/i, '.avif');
            archive.file(filePath, { name: nameInZip });
        }
    }

    archive.finalize();
});

app.listen(port, '127.0.0.1', () => {
    console.log(`Servidor rodando em http://127.0.0.1:${port}`);
});
