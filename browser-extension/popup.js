
document.addEventListener("DOMContentLoaded", async () => {
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const statusCard = document.getElementById("statusCard");
  const enableToggle = document.getElementById("enableToggle");
  const folderInput = document.getElementById("folderInput");
  const skipExtsInput = document.getElementById("skipExts");
  const saveBtn = document.getElementById("saveBtn");
  const resetAlertsRow = document.getElementById("resetAlertsRow");
  const resetAlertsBtn = document.getElementById("resetAlertsBtn");

  const MSM_SERVER = "http://127.0.0.1:9999";

  // Check if MSM App is running
  async function checkAppStatus() {
    try {
      const res = await fetch(`${MSM_SERVER}/ping`, {
        method: "GET",
        signal: AbortSignal.timeout(1000)
      });
      if (res.ok) {
        const data = await res.json();
        statusCard.className = "status-card status-connected";
        statusDot.className = "status-dot dot-connected";
        statusText.textContent = "MSM App Connected";
        if (data.download_dir) {
          folderInput.value = data.download_dir;
        }
      } else {
        throw new Error();
      }
    } catch (e) {
      statusCard.className = "status-card status-disconnected";
      statusDot.className = "status-dot dot-disconnected";
      statusText.textContent = "MSM App Disconnected (Open the App)";
      folderInput.value = "";
    }
  }

  // Check warning preferences and show reset row if muted or snoozed
  async function updateAlertsResetUI() {
    const { warning_preference } = await getConnectionState();
    if (warning_preference === WarningPreference.MUTED || warning_preference === WarningPreference.SNOOZED) {
      resetAlertsRow.style.display = "flex";
    } else {
      resetAlertsRow.style.display = "none";
    }
  }

  // Load current configuration
  chrome.storage.local.get({ enabled: true, skipExts: "html,htm,xml,json,php,asp,aspx" }, (settings) => {
    enableToggle.checked = settings.enabled;
    skipExtsInput.value = settings.skipExts;
  });

  // Check status and preferences immediately
  await checkAppStatus();
  await updateAlertsResetUI();

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

  // Reset Warnings Handler
  resetAlertsBtn.addEventListener("click", async () => {
    await resetWarningPreference();
    await updateAlertsResetUI();
    resetAlertsBtn.textContent = "Warnings Reset!";
    resetAlertsBtn.style.background = "#10b981";
    resetAlertsBtn.style.color = "#fff";
    setTimeout(() => {
      resetAlertsBtn.textContent = "Reset Warnings";
      resetAlertsBtn.style.background = "";
      resetAlertsBtn.style.color = "";
    }, 1500);
  });
});
