// MSM Downloader - Background Service Worker
// Intercepts all browser downloads and sends them to the MSM Downloader app

const MSM_SERVER = "http://127.0.0.1:9999";

// File extensions to always let the browser handle (small/non-download files)
const SKIP_EXTENSIONS = ["html", "htm", "php", "asp", "aspx", "xml", "json"];

// File size threshold: skip interception if file is very small (e.g. < 1 KB)
// We can't know size before download starts easily, so we filter by extension

async function isMsmRunning() {
  try {
    const res = await fetch(`${MSM_SERVER}/ping`, {
      method: "GET",
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function sendToMsm(url, filename, referrer) {
  const res = await fetch(`${MSM_SERVER}/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, filename: filename || null, referrer: referrer || null }),
  });
  return res.ok;
}

function shouldSkip(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    const ext = path.split(".").pop();
    if (SKIP_EXTENSIONS.includes(ext)) return true;
    // Skip blob URLs (can't be re-downloaded)
    if (url.startsWith("blob:")) return true;
    // Skip data URIs
    if (url.startsWith("data:")) return true;
  } catch {
    return true;
  }
  return false;
}

// Listen to every new download
chrome.downloads.onCreated.addListener(async (downloadItem) => {
  // Check if extension is enabled
  const { enabled } = await chrome.storage.local.get({ enabled: true });
  if (!enabled) return;

  const url = downloadItem.url || downloadItem.finalUrl;
  if (!url || shouldSkip(url)) return;

  // Check MSM is running
  const running = await isMsmRunning();
  if (!running) {
    // App not running — let browser handle it, show notification
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon48.png",
      title: "MSM Downloader",
      message: "App is not running. Download handled by browser.",
    });
    return;
  }

  // Cancel the browser download
  chrome.downloads.cancel(downloadItem.id, () => {
    chrome.downloads.erase({ id: downloadItem.id });
  });

  // Get filename from download item
  const filename = downloadItem.filename
    ? downloadItem.filename.split("/").pop().split("\\").pop()
    : null;

  // Send to MSM app
  const ok = await sendToMsm(url, filename, downloadItem.referrer);

  if (ok) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon48.png",
      title: "MSM Downloader",
      message: `Added to MSM Downloader:\n${filename || url.split("/").pop() || "file"}`,
    });
  } else {
    // MSM failed — restore browser download
    chrome.downloads.download({ url });
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon48.png",
      title: "MSM Downloader – Error",
      message: "Could not send to app. Download handled by browser.",
    });
  }
});
