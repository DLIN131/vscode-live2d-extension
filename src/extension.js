const vscode = require('vscode');

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

            webviewView.webview.html = getHtml(webviewView.webview, context.extensionUri);
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
}

function getHtml(webview, extensionUri) {
    const l2dScript = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'resources', 'live2d', 'L2Dwidget.min.js')
    );
    const modelJson = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'resources', 'live2d', 'haru', 'haru01.model.json')
    );

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
