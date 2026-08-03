# MSM Downloader 🚀
A premium, multi-threaded high-speed downloader application built with Tauri, Rust, and React, featuring an automatic adaptive connection engine, rich dark-mode visuals, and native browser integration.

---

## 🌟 Features
* **Adaptive Multi-Threading**: Automatically adjusts parallel connections (up to 32 connections) based on server speed and file sizing.
* **Manual Connection Mode**: Allows setting custom thread counts via Settings.
* **Native Browser Interception**: Integrates directly with Chrome, Edge, Brave, Opera, and Firefox.
* **Modern Interface**: Resizable and movable panels, glassmorphism design, real-time speed/ETA meters, and separate segment progress tracking.
* **Resumability Guard**: Detects if servers support range requests; if they don't, it automatically handles fallback downloading, informs the user, and safely cleans up partial files on cancel/errors.

---

## 🌐 Browser Extension Setup (Chrome, Edge, Brave, Opera)
To send downloads automatically from your browser to MSM Downloader:

1. Open your browser and navigate to **Extensions** settings:
   - **Chrome**: `chrome://extensions/`
   - **Edge**: `edge://extensions/`
   - **Brave**: `brave://extensions/`
2. Turn **ON** **Developer mode** (usually a toggle in the top-right corner).
3. Click **Load unpacked** (top-left button).
4. Select the `browser-extension` folder located inside this project directory:
   - `/home/salman/StudioProjects/msmproject/browser-extension`
5. The extension is now active! Clicking any download in your browser will intercept it and add it to MSM Downloader automatically.

### 🦊 Firefox Setup
1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**
3. Select the `manifest.json` file inside the `browser-extension` folder.

---

## 🛠️ Local Development

### Run the App:
Sourcing cargo environment (if required):
```bash
. "$HOME/.cargo/env"
```

Start the development server:
```bash
npm run tauri dev
```
