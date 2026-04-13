const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const EXTENSION_CONFIG_ID = 'vscode-live2d-pet';
const MODEL_CONFIG_KEY = 'selectedModel';

function isCubism3Model(modelPath) {
    return typeof modelPath === 'string' && modelPath.toLowerCase().endsWith('.model3.json');
}

function activate(context) {
    const output = vscode.window.createOutputChannel('Live2D Pet');
    output.show(true);
    output.appendLine('[activate] Live2D Pet extension starting...');

    let panel = null;

    const provider = {
        resolveWebviewView(webviewView) {
            output.appendLine('[resolveWebviewView] Webview view resolved.');
            panel = webviewView;

            webviewView.webview.options = {
                enableScripts: true,
                localResourceRoots: [context.extensionUri]
            };

            webviewView.webview.html = getHtml(webviewView.webview, context.extensionUri, output);
            output.appendLine('[resolveWebviewView] Webview HTML set.');

            setTimeout(() => {
                try {
                    webviewView.webview.postMessage({ command: 'ping', ts: Date.now() });
                    output.appendLine('[resolveWebviewView] Sent ping to webview.');
                } catch (err) {
                    output.appendLine(`[resolveWebviewView] Failed to postMessage: ${err?.message || err}`);
                }
            }, 200);

            webviewView.webview.onDidReceiveMessage(msg => {
                output.appendLine(`[webview -> extension] ${JSON.stringify(msg)}`);
                if (msg.command === 'webviewLog') {
                    output.appendLine(`[webview log] ${msg.message || ''}`);
                }
                if (msg.command === 'webviewError') {
                    output.appendLine(`[webview error] ${msg.message || 'unknown error'}`);
                    if (msg.stack) {
                        output.appendLine(String(msg.stack));
                    }
                }
                if (msg.command === 'speak') {
                    vscode.window.showInformationMessage(msg.text);
                }
            });
        }
    };

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('live2dView', provider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );
    output.appendLine('[activate] WebviewViewProvider registered: live2dView');

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-live2d-pet.toggle', () => {
            output.appendLine('[command] toggle');
            panel?.webview.postMessage({ command: 'toggle' });
        })
    );
    output.appendLine('[activate] Command registered: vscode-live2d-pet.toggle');

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-live2d-pet.openWebviewDevTools', async () => {
            output.appendLine('[command] openWebviewDevTools');
            try {
                await vscode.commands.executeCommand('workbench.action.webview.openDeveloperTools');
                output.appendLine('[command] webview devtools opened');
            } catch (err) {
                output.appendLine(`[command] failed to open webview devtools: ${err?.message || err}`);
            }
        })
    );
    output.appendLine('[activate] Command registered: vscode-live2d-pet.openWebviewDevTools');

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-live2d-pet.selectModel', async () => {
            output.appendLine('[command] selectModel');
            const modelEntries = getModelEntries(context.extensionUri, output);
            if (modelEntries.length === 0) {
                vscode.window.showWarningMessage('No Live2D model json found under resources/live2d.');
                return;
            }

            const currentModel = getConfiguredModelPath(modelEntries);
            const picks = modelEntries.map(entry => ({
                label: entry.path,
                description: entry.path === currentModel
                    ? 'Current'
                    : (isCubism3Model(entry.path) ? 'Cubism 3' : 'Legacy model')
            }));

            const picked = await vscode.window.showQuickPick(picks, {
                title: 'Select Live2D Model',
                placeHolder: 'Choose a model json file under resources/live2d'
            });

            if (!picked) {
                return;
            }

            await vscode.workspace.getConfiguration(EXTENSION_CONFIG_ID).update(
                MODEL_CONFIG_KEY,
                picked.label,
                vscode.ConfigurationTarget.Global
            );
            output.appendLine(`[command] selected model: ${picked.label}`);

            if (panel) {
                panel.webview.html = getHtml(panel.webview, context.extensionUri, output);
                output.appendLine('[command] webview refreshed with selected model');
            }

            vscode.window.showInformationMessage(`Live2D model switched to: ${picked.label}`);
        })
    );
    output.appendLine('[activate] Command registered: vscode-live2d-pet.selectModel');
}

function getConfiguredModelPath(modelEntries) {
    const configured = vscode.workspace.getConfiguration(EXTENSION_CONFIG_ID).get(MODEL_CONFIG_KEY);
    if (typeof configured === 'string' && modelEntries.some(entry => entry.path === configured)) {
        return configured;
    }

    return modelEntries[0]?.path || '';
}

function getModelEntries(extensionUri, output) {
    const live2dDir = path.join(extensionUri.fsPath, 'resources', 'live2d');
    if (!fs.existsSync(live2dDir)) {
        return [];
    }

    const results = [];
    walkFiles(live2dDir, absPath => {
        const lower = absPath.toLowerCase();
        const isModelJson = lower.endsWith('.model.json') || lower.endsWith('.model3.json');
        if (!isModelJson) {
            return;
        }

        const relativeFromLive2d = path.relative(live2dDir, absPath).replace(/\\/g, '/');
        results.push({
            path: relativeFromLive2d,
            absPath
        });
    });

    results.sort((a, b) => a.path.localeCompare(b.path));
    output.appendLine(`[models] discovered ${results.length} model json file(s)`);
    return results;
}

function walkFiles(dir, onFile) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkFiles(fullPath, onFile);
            continue;
        }

        if (entry.isFile()) {
            onFile(fullPath);
        }
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function getHtml(webview, extensionUri, output) {
    const l2dScript = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'resources', 'live2d', 'L2Dwidget.min.js')
    );
    const pixiScript = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'resources', 'live2d', 'runtime', 'pixi.min.js')
    );
    const cubismCoreScript = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'resources', 'live2d', 'runtime', 'live2dcubismcore.min.js')
    );
    const cubism4Script = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'resources', 'live2d', 'runtime', 'cubism4.min.js')
    );
    const modelEntries = getModelEntries(extensionUri, output);
    const selectedModelPath = getConfiguredModelPath(modelEntries);
    const selectedModelIsCubism3 = isCubism3Model(selectedModelPath);
    const selectedModelDirSegments = selectedModelPath ? selectedModelPath.split('/').slice(0, -1) : [];
    const modelJson = selectedModelPath
        ? webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'live2d', ...selectedModelPath.split('/')))
        : '';
    const modelBaseUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'resources', 'live2d', ...selectedModelDirSegments)
    );

    const nonce = getNonce();

    if (!selectedModelPath) {
        output.appendLine('[models] no model file found; webview will show warning');
    } else if (selectedModelIsCubism3) {
        output.appendLine(`[models] using Cubism 3 model: ${selectedModelPath}`);
    } else {
        output.appendLine(`[models] using legacy model: ${selectedModelPath}`);
    }

    const html = /*html*/`<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;">
    <style nonce="${nonce}">
        body,html{margin:0;padding:0;height:100%;overflow:hidden;background:transparent;}
        #waifu{position:absolute;bottom:0;right:0;pointer-events:auto;}
    </style>
</head>
<body>
    <div id="boot" style="position:fixed;left:6px;top:6px;background:rgba(0,0,0,0.6);color:#fff;padding:4px 6px;font-size:11px;border-radius:4px;z-index:9999;">
        booting...
    </div>
    <div id="waifu"></div>

    ${selectedModelIsCubism3 ? '' : `<script nonce="${nonce}" src="${l2dScript}"></script>`}
    <script nonce="${nonce}">
        const selectedModelPath = ${JSON.stringify(selectedModelPath)};
        const selectedModelIsCubism3 = ${JSON.stringify(selectedModelIsCubism3)};
        const modelJsonPath = ${JSON.stringify(String(modelJson))};
        const modelBasePath = ${JSON.stringify(String(modelBaseUri))};
        const pixiScriptPath = ${JSON.stringify(String(pixiScript))};
        const cubismCoreScriptPath = ${JSON.stringify(String(cubismCoreScript))};
        const cubism4ScriptPath = ${JSON.stringify(String(cubism4Script))};

        let vscodeApi = null;
        try {
            if (typeof acquireVsCodeApi === 'function') {
                vscodeApi = acquireVsCodeApi();
            }
        } catch (err) {
            // ignore
        }

        const bootEl = document.getElementById('boot');
        if (bootEl) bootEl.textContent = 'script started';

        function postMessage(payload) {
            try {
                if (vscodeApi) {
                    vscodeApi.postMessage(payload);
                }
            } catch {
                // ignore
            }
        }

        function reportError(message, stack) {
            postMessage({ command: 'webviewError', message, stack });
        }

        function reportLog(message) {
            postMessage({ command: 'webviewLog', message });
        }

        function safeStringify(value) {
            try {
                if (value instanceof Error) {
                    return value.stack || value.message || String(value);
                }
                if (value && typeof value === 'object') {
                    if (typeof value.message === 'string' || typeof value.stack === 'string') {
                        return (value.message || '') + (value.stack ? '\\n' + value.stack : '');
                    }
                }
                if (typeof value === 'string') return value;
                return JSON.stringify(value);
            } catch {
                return String(value);
            }
        }

        function wrapConsole(level) {
            const original = console[level];
            console[level] = (...args) => {
                try {
                    const message = args.map(safeStringify).join(' ');
                    const payload = '[console.' + level + '] ' + message;
                    if (level === 'error' || level === 'warn') {
                        postMessage({ command: 'webviewError', message: payload });
                    } else {
                        postMessage({ command: 'webviewLog', message: payload });
                    }
                } catch {
                    // ignore bridge errors
                }
                if (typeof original === 'function') {
                    original.apply(console, args);
                }
            };
        }

        window.onerror = (message, source, lineno, colno, error) => {
            reportError(String(message), error?.stack);
        };
        window.addEventListener('error', event => {
            const target = event?.target;
            const url = target?.src || target?.href;
            if (url) {
                reportError('Resource failed to load: ' + url);
            }
        }, true);
        window.addEventListener('unhandledrejection', event => {
            const reason = event?.reason;
            reportError(
                reason?.message ? String(reason.message) : 'Unhandled promise rejection',
                reason?.stack
            );
        });

        wrapConsole('error');
        wrapConsole('warn');
        wrapConsole('info');
        wrapConsole('log');

        reportLog('Webview script started.');

        let visible = true;

        function loadScript(url) {
            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.nonce = "${nonce}";
                script.src = url;
                script.async = true;
                script.onload = () => resolve();
                script.onerror = () => reject(new Error('Failed to load script: ' + url));
                document.head.appendChild(script);
            });
        }

        function toAbsoluteAssetUrl(relPath) {
            if (!relPath || typeof relPath !== 'string') {
                return relPath;
            }
            if (relPath.startsWith('http://') || relPath.startsWith('https://')) {
                return relPath;
            }
            const base = modelBasePath.endsWith('/') ? modelBasePath : (modelBasePath + '/');
            return new URL(relPath, base).toString();
        }

        async function buildCubismModelUrl() {
            const modelResp = await fetch(modelJsonPath);
            if (!modelResp.ok) {
                throw new Error('Failed to fetch model3 json: ' + modelResp.status);
            }
            const settings = await modelResp.json();
            const refs = settings?.FileReferences;
            if (!refs || typeof refs !== 'object') {
                throw new Error('Invalid model3 json: missing FileReferences');
            }

            if (typeof refs.Moc === 'string') {
                refs.Moc = toAbsoluteAssetUrl(refs.Moc);
            }
            if (typeof refs.Physics === 'string') {
                refs.Physics = toAbsoluteAssetUrl(refs.Physics);
            }
            if (typeof refs.Pose === 'string') {
                refs.Pose = toAbsoluteAssetUrl(refs.Pose);
            }
            if (typeof refs.DisplayInfo === 'string') {
                refs.DisplayInfo = toAbsoluteAssetUrl(refs.DisplayInfo);
            }
            if (typeof refs.UserData === 'string') {
                refs.UserData = toAbsoluteAssetUrl(refs.UserData);
            }
            if (Array.isArray(refs.Textures)) {
                refs.Textures = refs.Textures.map(texture => toAbsoluteAssetUrl(texture));
            }
            if (Array.isArray(refs.Expressions)) {
                refs.Expressions = refs.Expressions.map(exp => {
                    if (exp && typeof exp.File === 'string') {
                        return { ...exp, File: toAbsoluteAssetUrl(exp.File) };
                    }
                    return exp;
                });
            }
            if (refs.Motions && typeof refs.Motions === 'object') {
                for (const key of Object.keys(refs.Motions)) {
                    const motionArr = refs.Motions[key];
                    if (!Array.isArray(motionArr)) {
                        continue;
                    }
                    refs.Motions[key] = motionArr.map(motion => {
                        if (motion && typeof motion.File === 'string') {
                            return { ...motion, File: toAbsoluteAssetUrl(motion.File) };
                        }
                        return motion;
                    });
                }
            }

            const blob = new Blob([JSON.stringify(settings)], { type: 'application/json' });
            return URL.createObjectURL(blob);
        }

        async function initLegacyModel() {
            if (typeof L2Dwidget === 'undefined') {
                throw new Error('L2Dwidget is not defined. Script failed to load.');
            }

            reportLog('Initializing legacy Live2D widget...');
            if (bootEl) bootEl.textContent = 'L2Dwidget loaded';
            L2Dwidget.init({
                model: {
                    jsonPath: modelJsonPath
                },
                display: { position:"right", width:260, height:360, hOffset:40, vOffset:-30 },
                mobile: { show:true },
                react: { opacityDefault:0.9 }
            });

            setTimeout(() => {
                const hasCanvas = !!document.querySelector('canvas');
                if (!hasCanvas) {
                    reportError('Live2D canvas not found after legacy init.');
                } else {
                    reportLog('Legacy Live2D canvas found.');
                    if (bootEl) bootEl.textContent = 'Live2D ready';
                }
            }, 1000);
        }

        async function initCubism3Model() {
            reportLog('Initializing Cubism 3 renderer...');
            if (bootEl) bootEl.textContent = 'Loading Cubism3 runtime';

            try {
                await loadScript(pixiScriptPath);
                await loadScript(cubismCoreScriptPath);
                await loadScript(cubism4ScriptPath);
            } catch (err) {
                reportError('Failed to load Cubism 3 runtime scripts', err.stack);
                throw err;
            }

            if (!window.PIXI || !window.PIXI.live2d || !window.PIXI.live2d.Live2DModel) {
                throw new Error('PIXI Live2D runtime is unavailable after script load.');
            }

            const waifuEl = document.getElementById('waifu');
            if (!waifuEl) {
                throw new Error('Missing #waifu container.');
            }

            waifuEl.innerHTML = '';
            waifuEl.style.width = '320px';
            waifuEl.style.height = '460px';

            const app = new window.PIXI.Application({
                width: 320,
                height: 460,
                transparent: true,
                antialias: true
            });
            waifuEl.appendChild(app.view);

            reportLog('Building model blob URL...');
            const rewrittenModelUrl = await buildCubismModelUrl();
            reportLog('Loading model from blob URL...');
            
            const model = await window.PIXI.live2d.Live2DModel.from(rewrittenModelUrl);
            app.stage.addChild(model);

            function relayoutModel() {
                const baseScale = Math.min(
                    app.renderer.width / model.width,
                    app.renderer.height / model.height
                ) * 0.9;
                model.scale.set(baseScale);
                if (model.anchor && typeof model.anchor.set === 'function') {
                    model.anchor.set(0.5, 1);
                }
                model.x = app.renderer.width / 2;
                model.y = app.renderer.height;
            }

            relayoutModel();

            // Setup interactions
            model.interactive = true;
            // Provide a default hit area if none is defined (the whole model bounds)
            
            // 1. Mouse tracking (Eyes/Head follow mouse)
            app.view.addEventListener('pointermove', (e) => {
                if (typeof model.focus === 'function') {
                    model.focus(e.clientX, e.clientY);
                }
            });

            // 2. Click interaction (Play random motion)
            model.on('pointerdown', (e) => {
                try {
                    const motions = model.internalModel.settings.motions || model.internalModel.settings.Motions;
                    if (!motions) return;
                    
                    const availableGroups = Object.keys(motions);
                    if (availableGroups.length === 0) return;

                    // Exclude idle motions from random pool if possible
                    let interactionGroups = availableGroups.filter(g => !g.toLowerCase().includes('idle'));
                    if (interactionGroups.length === 0) {
                        interactionGroups = availableGroups;
                    }

                    const targetGroup = interactionGroups[Math.floor(Math.random() * interactionGroups.length)];
                    reportLog('Playing motion group: ' + targetGroup);
                    model.motion(targetGroup);
                } catch (err) {
                    reportError('Motion error: ' + err.message);
                }
            });

            // 3. Ensure Idle motion plays
            try {
                const motions = model.internalModel.settings.motions || model.internalModel.settings.Motions;
                let idleGroup = 'idle';
                if (motions) {
                    const keys = Object.keys(motions);
                    const foundIdle = keys.find(k => k.toLowerCase() === 'idle') || keys.find(k => k.toLowerCase().includes('idle'));
                    if (foundIdle) {
                        idleGroup = foundIdle;
                    }
                }
                
                if (model.internalModel.motionManager) {
                    model.internalModel.motionManager.idleMotionGroup = idleGroup;
                }
                
                // Jump-start the idle motion if it isn't playing
                setTimeout(() => {
                    model.motion(idleGroup);
                }, 500);
            } catch (ignore) {}

            if (bootEl) bootEl.textContent = 'Cubism3 ready';
            reportLog('Cubism 3 model loaded successfully.');
        }

        (async () => {
            try {
                if (!modelJsonPath) {
                    reportError('No model json found under resources/live2d.');
                    if (bootEl) bootEl.textContent = 'No model found';
                    return;
                }

                if (selectedModelIsCubism3) {
                    await initCubism3Model();
                } else {
                    await initLegacyModel();
                }
            } catch (err) {
                reportError(err?.message || 'Failed to initialize Live2D model', err?.stack);
                if (bootEl) bootEl.textContent = 'Load failed';
            }
        })();

        window.addEventListener('message', e => {
            if (e.data.command === 'ping') {
                reportLog('Received ping.');
            }
            if (e.data.command === 'toggle') {
                visible = !visible;
                document.getElementById('waifu').style.display = visible ? 'block' : 'none';
            }
        });
    </script>
</body>
</html>`;

    fs.writeFileSync(path.join(extensionUri.fsPath, 'scratch_debug.html'), html);
    return html;
}

exports.activate = activate;
exports.deactivate = () => {};
