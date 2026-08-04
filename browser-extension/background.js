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
  try {
    const res = await fetch(`${MSM_SERVER}/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, filename: filename || null, referrer: referrer || null }),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    console.error("sendToMsm error:", e);
  }
  return null;
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
  let filename = downloadItem.filename
    ? downloadItem.filename.split("/").pop().split("\\").pop()
    : null;

  // Clean the display filename to show professional information
  let displayInfo = filename || "";
  if (displayInfo.includes("?")) {
    displayInfo = displayInfo.split("?")[0];
  }
  try {
    displayInfo = decodeURIComponent(displayInfo);
  } catch {}

  // If it's empty, too long, or is a hexadecimal hash, use hostname instead
  const isHexHash = /^[a-fA-F0-9]+$/.test(displayInfo);
  if (!displayInfo || displayInfo.length > 50 || isHexHash) {
    try {
      displayInfo = `Source: ${new URL(url).hostname}`;
    } catch {
      displayInfo = "New Download Task";
    }
  }

  // Send to MSM app
  const response = await sendToMsm(url, filename, downloadItem.referrer);

  if (response && response.success) {
    let msg = `Successfully added download task:\n${displayInfo}`;
    if (response.message && response.message.startsWith("COLLISION:")) {
      msg = `Duplicate detected!\nCheck MSM Downloader window to resolve.`;
    }
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon48.png",
      title: "MSM Downloader",
      message: msg,
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
