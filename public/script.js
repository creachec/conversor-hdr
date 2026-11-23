document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const previewArea = document.getElementById('preview-area');
    const batchCount = document.getElementById('batch-count');
    const batchTotalSize = document.getElementById('batch-total-size');
    const fileList = document.getElementById('file-list');
    const addMoreBtn = document.getElementById('add-more-btn');
    const startBtn = document.getElementById('start-btn');
    const startCount = document.getElementById('start-count');
    const removeAllBtn = document.getElementById('remove-all-btn');
    const speedRange = document.getElementById('speed-range');
    const speedValue = document.getElementById('speed-value');

    const optionGpu = null; // GPU mode removed
    const optionCpu = null;
    const modeGpu = null;
    const modeCpu = null;
    
    const statusArea = document.getElementById('status-area');
    const currentProcessingFile = document.getElementById('current-processing-file');
    const progressStatusText = document.getElementById('progress-status-text');
    const progressPercentageText = document.getElementById('progress-percentage-text');
    const overallProgressFill = document.getElementById('overall-progress-fill');
    const consoleLog = document.getElementById('console-log');
    const stopBtn = document.getElementById('stop-btn');

    const resultArea = document.getElementById('result-area');
    const resultSummary = document.getElementById('result-summary');
    const resultsFileList = document.getElementById('results-file-list');
    const downloadZipBtn = document.getElementById('download-zip-btn');
    const newConvertBtn = document.getElementById('new-convert-btn');

    let selectedFiles = []; // Array of File objects
    let convertedResults = []; // Array of { originalName, filename, downloadUrl, success: boolean }
    let currentEventSource = null;
    let isConversionCancelled = false;

    // Update speed badge value
    speedRange.addEventListener('input', () => {
        speedValue.textContent = speedRange.value;
    });

    // (Engine selector removed — CPU only)

    // Drag & Drop event listeners
    dropZone.addEventListener('click', () => fileInput.click());
    addMoreBtn.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) {
            handleFilesSelection(Array.from(e.dataTransfer.files));
        }
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            handleFilesSelection(Array.from(fileInput.files));
        }
        fileInput.value = ''; // Reset input to allow re-selecting same files if removed
    });

    function handleFilesSelection(files) {
        const jxrFiles = files.filter(f => f.name.toLowerCase().endsWith('.jxr'));
        
        if (jxrFiles.length === 0) {
            alert('Nenhum arquivo .jxr válido foi selecionado.');
            return;
        }

        if (files.length > jxrFiles.length) {
            alert(`Apenas arquivos com extensão .jxr são permitidos. ${files.length - jxrFiles.length} arquivo(s) ignorado(s).`);
        }

        // Avoid adding duplicate files based on name + size
        jxrFiles.forEach(file => {
            const exists = selectedFiles.some(f => f.name === file.name && f.size === file.size);
            if (!exists) {
                selectedFiles.push(file);
            }
        });

        renderBatchUI();
    }

    function renderBatchUI() {
        if (selectedFiles.length === 0) {
            resetUI();
            return;
        }

        dropZone.classList.add('hidden');
        previewArea.classList.remove('hidden');

        batchCount.textContent = `${selectedFiles.length} arquivo${selectedFiles.length > 1 ? 's' : ''} selecionado${selectedFiles.length > 1 ? 's' : ''}`;
        startCount.textContent = selectedFiles.length;

        const totalBytes = selectedFiles.reduce((acc, f) => acc + f.size, 0);
        batchTotalSize.textContent = (totalBytes / (1024 * 1024)).toFixed(2) + ' MB';

        fileList.innerHTML = '';
        selectedFiles.forEach((file, index) => {
            const item = document.createElement('div');
            item.className = 'file-item';
            item.innerHTML = `
                <div class="file-item-left">
                    <span class="file-item-icon">📄</span>
                    <div class="file-item-details">
                        <span class="file-item-name" title="${file.name}">${file.name}</span>
                        <span class="file-item-size">${(file.size / (1024 * 1024)).toFixed(2)} MB</span>
                    </div>
                </div>
                <div class="file-item-right">
                    <span class="status-badge badge-pending" id="badge-${index}">Pendente</span>
                    <button class="btn-remove-item" data-index="${index}" title="Remover">✕</button>
                </div>
            `;
            fileList.appendChild(item);
        });

        // Attach remove buttons listeners
        document.querySelectorAll('.btn-remove-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.target.getAttribute('data-index'), 10);
                selectedFiles.splice(index, 1);
                renderBatchUI();
            });
        });
    }

    removeAllBtn.addEventListener('click', resetUI);

    // Stop conversion handler
    stopBtn.addEventListener('click', () => {
        if (confirm('Deseja realmente interromper a conversão?')) {
            isConversionCancelled = true;
            if (currentEventSource) {
                currentEventSource.close();
                currentEventSource = null;
            }
            addLog('\n🛑 CONVERSÃO INTERROMPIDA PELO USUÁRIO.', true);
            currentProcessingFile.textContent = 'Conversão interrompida pelo usuário.';
            
            setTimeout(() => {
                showFinalResults(convertedResults.filter(r => r.success).length, selectedFiles.length);
            }, 1000);
        }
    });

    startBtn.addEventListener('click', async () => {
        if (selectedFiles.length === 0) return;

        isConversionCancelled = false;
        previewArea.classList.add('hidden');
        statusArea.classList.remove('hidden');
        consoleLog.innerHTML = '';
        convertedResults = [];

        const useGpu = false;
        addLog(`Iniciando lote com ${selectedFiles.length} arquivo(s)...`);
        addLog(`Modo: ⚡ CPU Multithreading AVX2 → AVIF HDR`);

        // Stage 1: Upload batch to server
        addLog('Fazendo upload dos arquivos para o servidor...');
        const formData = new FormData();
        selectedFiles.forEach(file => formData.append('images', file));

        let jobs = [];
        try {
            const uploadRes = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            if (!uploadRes.ok) throw new Error('Falha no upload dos arquivos.');
            
            const data = await uploadRes.json();
            jobs = data.jobs || [];
            addLog(`Upload concluído! ${jobs.length} job(s) criado(s).`);
        } catch (err) {
            addLog('ERRO DE UPLOAD: ' + err.message, true);
            alert('Erro no upload: ' + err.message);
            return;
        }

        // Stage 2: Process jobs sequentially via SSE
        const total = jobs.length;
        let completedCount = 0;

        updateProgress(0, total);

        for (let i = 0; i < total; i++) {
            if (isConversionCancelled) break;

            const job = jobs[i];
            currentProcessingFile.textContent = `Convertendo: ${job.fileName} (${i + 1} de ${total})`;
            addLog(`\n--- [${i + 1}/${total}] Convertendo ${job.fileName} ---`);

            const success = await processSingleJob(job, useGpu);
            if (isConversionCancelled) break;

            completedCount++;
            updateProgress(completedCount, total);
        }

        // Stage 3: Display final results if not manually stopped
        if (!isConversionCancelled) {
            showFinalResults(completedCount, total);
        }
    });

    function processSingleJob(job, useGpu) {
        return new Promise((resolve) => {
            const speed = speedRange.value;
            const eventSource = new EventSource(`/api/convert-stream/${job.jobId}?speed=${speed}`);
            currentEventSource = eventSource;

            eventSource.addEventListener('log', (e) => {
                if (isConversionCancelled) return;
                const data = JSON.parse(e.data);
                addLog(data.message, data.isError);
            });

            eventSource.addEventListener('error', (e) => {
                if (isConversionCancelled) {
                    eventSource.close();
                    currentEventSource = null;
                    resolve(false);
                    return;
                }
                let msg = 'Erro na transmissão SSE';
                try {
                    const data = JSON.parse(e.data);
                    msg = data.message || msg;
                } catch (_) {}
                
                addLog(`[ERRO] ${job.fileName}: ${msg}`, true);
                eventSource.close();
                currentEventSource = null;
                convertedResults.push({
                    originalName: job.fileName,
                    success: false,
                    error: msg
                });
                resolve(false);
            });

            eventSource.addEventListener('done', (e) => {
                if (isConversionCancelled) {
                    eventSource.close();
                    currentEventSource = null;
                    resolve(false);
                    return;
                }
                const data = JSON.parse(e.data);
                addLog(`[OK] ${job.fileName}: ${data.message}`);
                eventSource.close();
                currentEventSource = null;
                convertedResults.push({
                    originalName: job.fileName,
                    filename: data.filename,
                    downloadUrl: data.downloadUrl,
                    success: true
                });
                resolve(true);
            });
        });
    }

    function updateProgress(current, total) {
        const percent = total > 0 ? Math.round((current / total) * 100) : 0;
        progressStatusText.textContent = `Processados ${current} de ${total} arquivos`;
        progressPercentageText.textContent = `${percent}%`;
        overallProgressFill.style.width = `${percent}%`;
    }

    function showFinalResults(successCount, totalCount) {
        statusArea.classList.add('hidden');
        resultArea.classList.remove('hidden');

        resultSummary.textContent = `${successCount} de ${totalCount} arquivo(s) convertidos com sucesso com preservação de metadados HDR.`;

        resultsFileList.innerHTML = '';
        const successfulFiles = convertedResults.filter(r => r.success);

        convertedResults.forEach(res => {
            const item = document.createElement('div');
            item.className = 'file-item';
            
            const ext = res.filename ? res.filename.split('.').pop() : 'avif';
            const targetName = res.originalName.replace(/\.jxr$/i, `.${ext}`);

            if (res.success) {
                item.innerHTML = `
                    <div class="file-item-left">
                        <span class="file-item-icon">🖼️</span>
                        <div class="file-item-details">
                            <span class="file-item-name" title="${targetName}">${targetName}</span>
                            <span class="file-item-size" style="color: var(--success);">Pronto para uso (${ext.toUpperCase()} HDR)</span>
                        </div>
                    </div>
                    <div class="file-item-right">
                        <a href="${res.downloadUrl}" class="btn-download-item" download="${targetName}">⬇️ Baixar ${ext.toUpperCase()}</a>
                    </div>
                `;
            } else {
                item.innerHTML = `
                    <div class="file-item-left">
                        <span class="file-item-icon">⚠️</span>
                        <div class="file-item-details">
                            <span class="file-item-name" title="${res.originalName}">${res.originalName}</span>
                            <span class="file-item-size" style="color: var(--danger);">${res.error || 'Erro ou cancelado'}</span>
                        </div>
                    </div>
                    <div class="file-item-right">
                        <span class="status-badge badge-error">Interrompido</span>
                    </div>
                `;
            }
            resultsFileList.appendChild(item);
        });

        // Hide ZIP button if no successful conversions
        if (successfulFiles.length === 0) {
            downloadZipBtn.classList.add('hidden');
        } else {
            downloadZipBtn.classList.remove('hidden');
            downloadZipBtn.textContent = `📦 Baixar Todos em ZIP (${successfulFiles.length})`;
        }
    }

    downloadZipBtn.addEventListener('click', async () => {
        const successfulFiles = convertedResults.filter(r => r.success);
        if (successfulFiles.length === 0) return;

        downloadZipBtn.disabled = true;
        downloadZipBtn.textContent = 'Gerando ZIP...';

        try {
            const res = await fetch('/api/download-zip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    files: successfulFiles.map(f => ({
                        filename: f.filename,
                        originalName: f.originalName
                    }))
                })
            });

            if (!res.ok) throw new Error('Falha ao gerar arquivo ZIP.');

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'converted_hdr_images.zip';
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            alert('Erro ao baixar ZIP: ' + err.message);
        } finally {
            downloadZipBtn.disabled = false;
            downloadZipBtn.textContent = `📦 Baixar Todos em ZIP (${successfulFiles.length})`;
        }
    });

    function addLog(msg, isError = false) {
        const p = document.createElement('p');
        if (isError) {
            p.style.color = '#ff0044';
        }
        p.textContent = `> ${msg}`;
        consoleLog.appendChild(p);
        consoleLog.scrollTop = consoleLog.scrollHeight;
    }

    function resetUI() {
        if (currentEventSource) {
            currentEventSource.close();
            currentEventSource = null;
        }
        selectedFiles = [];
        convertedResults = [];
        isConversionCancelled = false;
        fileInput.value = '';
        dropZone.classList.remove('hidden');
        previewArea.classList.add('hidden');
        statusArea.classList.add('hidden');
        resultArea.classList.add('hidden');
        consoleLog.innerHTML = '';
        overallProgressFill.style.width = '0%';
    }

    newConvertBtn.addEventListener('click', resetUI);
});
