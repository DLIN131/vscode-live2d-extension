const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const EXTENSION_CONFIG_ID = 'vscode-live2d-pet';
const MODEL_CONFIG_KEY = 'selectedModel';

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
                description: entry.path === currentModel ? 'Current' : ''
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

function getHtml(webview, extensionUri, output) {
    const l2dScript = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'resources', 'live2d', 'L2Dwidget.min.js')
    );
    const modelEntries = getModelEntries(extensionUri, output);
    const selectedModelPath = getConfiguredModelPath(modelEntries);
    const modelJson = selectedModelPath
        ? webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'live2d', ...selectedModelPath.split('/')))
        : '';

    if (!selectedModelPath) {
        output.appendLine('[models] no model file found; webview will show warning');
    } else {
        output.appendLine(`[models] using model: ${selectedModelPath}`);
    }

    return /*html*/`<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body,html{margin:0;padding:0;height:100%;overflow:hidden;background:transparent;}
        #waifu{position:absolute;bottom:0;right:0;pointer-events:auto;}
    </style>
</head>
<body>
    <div id="boot" style="position:fixed;left:6px;top:6px;background:rgba(0,0,0,0.6);color:#fff;padding:4px 6px;font-size:11px;border-radius:4px;z-index:9999;">
        booting...
    </div>
    <div id="waifu"></div>

    <script src="${l2dScript}"></script>
    <script>
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
                } else {
                    console.warn('vscode api not available', payload);
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
        try {
            if (!"${modelJson}") {
                reportError('No model json found under resources/live2d.');
                if (bootEl) bootEl.textContent = 'No model found';
                throw new Error('No model found');
            }

            if (typeof L2Dwidget === 'undefined') {
                reportError('L2Dwidget is not defined. Script failed to load.');
            } else {
                console.info('L2Dwidget loaded, initializing...');
                if (bootEl) bootEl.textContent = 'L2Dwidget loaded';
                L2Dwidget.init({
                    model: {
                        jsonPath: "${modelJson}"
                    },
                    display: { position:"right", width:260, height:360, hOffset:40, vOffset:-30 },
                    mobile: { show:true },
                    react: { opacityDefault:0.9 }
                });

                setTimeout(() => {
                    const hasCanvas = !!document.querySelector('canvas');
                    if (!hasCanvas) {
                        reportError('Live2D canvas not found after init.');
                    } else {
                        reportLog('Live2D canvas found.');
                        if (bootEl) bootEl.textContent = 'Live2D ready';
                    }
                }, 1000);
            }
        } catch (err) {
            reportError(err?.message || 'Failed to init L2Dwidget', err?.stack);
        }

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
}

exports.activate = activate;
exports.deactivate = () => {};
