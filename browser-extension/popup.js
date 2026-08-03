document.addEventListener("DOMContentLoaded", async () => {
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const statusCard = document.getElementById("statusCard");
  const enableToggle = document.getElementById("enableToggle");
  const folderInput = document.getElementById("folderInput");
  const skipExtsInput = document.getElementById("skipExts");
  const saveBtn = document.getElementById("saveBtn");

  const MSM_SERVER = "http://127.0.0.1:9999";

  // Check if MSM App is running
  async function checkAppStatus() {
    try {
      const res = await fetch(`${MSM_SERVER}/ping`, {
        method: "GET",
        signal: AbortSignal.timeout(1000)
      });
      if (res.ok) {
        statusCard.className = "status-card status-connected";
        statusDot.className = "status-dot dot-connected";
        statusText.textContent = "MSM App Connected";
      } else {
        throw new Error();
      }
    } catch (e) {
      statusCard.className = "status-card status-disconnected";
      statusDot.className = "status-dot dot-disconnected";
      statusText.textContent = "MSM App Disconnected (Open the App)";
    }
  }

  // Load current configuration
  chrome.storage.local.get({ enabled: true, skipExts: "html,htm,xml,json,php,asp,aspx" }, (settings) => {
    enableToggle.checked = settings.enabled;
    skipExtsInput.value = settings.skipExts;
  });

  // Check status immediately
  await checkAppStatus();

  // Save Settings
  saveBtn.addEventListener("click", () => {
    const enabled = enableToggle.checked;
    const skipExts = skipExtsInput.value.trim().toLowerCase();

    chrome.storage.local.set({ enabled, skipExts }, () => {
      saveBtn.textContent = "Settings Saved!";
      saveBtn.style.background = "#10b981";
      setTimeout(() => {
        saveBtn.textContent = "Save Settings";
        saveBtn.style.background = "";
      }, 1500);
    });
  });
});
