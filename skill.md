# VSCode Live2D Pet - 開發與架構指引 (Skill.md)

這份文件記錄了 `vscode-live2d-pet` 擴充功能的核心架構、技術細節以及開發/除錯指南。

## 1. 專案架構
- **`src/extension.js`**: 擴充功能的主程式入口。負責註冊 Webview、處理指令 (`toggle`, `selectModel`, `openWebviewDevTools`)，以及將 Live2D 資源注入到 Webview 的 HTML 之中。
- **`resources/live2d/`**: 存放 Live2D 模型與 Runtime 的根目錄。
  - **`runtime/`**: 包含執行 Live2D 所需的核心函式庫 (例如 `pixi.min.js`, `live2dcubismcore.min.js`, `cubism4.min.js`, `L2Dwidget.min.js`)。
  - **模型目錄 (例如 `aersasi_3/`, `haru/`)**: 每個子目錄代表一個模型，包含 `.model.json` (舊版) 或 `.model3.json` (Cubism 3) 以及對應的紋理、動作和物理配置。
- **`package.json`**: 定義了 VS Code 的擴充功能貢獻點 (Contributions)、指令、檢視 (Views) 與捷徑。

## 2. 核心機制

### 2.1 Webview 與 Content Security Policy (CSP)
VS Code 為了安全性，限制 Webview 中執行未經授權的腳本或載入外部資源。
- 必須在 `<head>` 中注入 `<meta http-equiv="Content-Security-Policy">`。
- 所有內聯腳本 (Inline scripts) 與標籤都必須加上安全的隨機 `nonce`。
- 外部資源 (如模型 json、圖片) 必須透過 `webview.asWebviewUri` 轉換為 vscode-webview-resource 格式的網址。

### 2.2 Live2D 版本的相容性
本擴充功能支援兩種 Live2D 版本：
- **Legacy (舊版，例如 `haru`)**: 使用 `L2Dwidget.min.js`，將 JSON 路徑直接傳入即可初始化。
- **Cubism 3/4**: 需要使用 PIXI.js (`pixi-live2d-display`) 和 `live2dcubismcore.min.js`。由於套件依賴檔案系統路徑，我們透過前端的 `fetch` 讀取並重寫 `.model3.json` 裡面的所有相對路徑為 VS Code 授權的 Absolute Asset URL (透過 Blob 創建)。

### 2.3 IPC 通訊 (Webview ↔ Extension)
在 Webview HTML 的 `<script>` 區塊中：
- 使用 `acquireVsCodeApi().postMessage()` 向外送出訊息 (例如日誌、錯誤)。
- 擴充功能端透過 `webviewView.webview.onDidReceiveMessage` 接收並列印在 VS Code 的 "Live2D Pet" 輸出通道 (Output Channel)。

## 3. 常見問題與除錯 (Troubleshooting)

### Q1: 畫面一直卡在 `booting...`
**原因**: 
1. `Content-Security-Policy` 設定太嚴格，導致內嵌的 `<script>` 根本沒有被執行。
2. JS 在開頭因為某些文法檢查或找不到變數就發生了 SyntaxError。
**除錯方法**: 
執行指令 `Live2D Pet: Open Live2D Webview DevTools`，開啟網頁開發者工具的 Console 面板，查看是否有 CSP Block 或是 JS 錯誤。

### Q2: Cubism 3 模型讀取不到紋理或動作破圖
**原因**: `.model3.json` 裡的 `FileReferences` 路徑沒有被正確轉換，或者是 Webview 限制了該路徑的訪問。
**除錯方法**: 檢查 `buildCubismModelUrl` 函數是否涵蓋了該 JSON 結構內所有的特殊屬性(Expressions, Motions, Pose 等)，並確認 `toAbsoluteAssetUrl` 函式有正確補上 `webview.asWebviewUri` 前綴。
