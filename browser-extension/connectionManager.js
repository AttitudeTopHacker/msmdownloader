// connectionManager.js
// Handles connection state, notifications cooldown, and preferences per profile.

const SNOOZE_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const DOWNLOAD_URL = "https://github.com/AttitudeTopHacker/msmdownloader/releases";

const ConnectionState = {
  CONNECTED: "CONNECTED",
  DISCONNECTED: "DISCONNECTED",
};

const WarningPreference = {
  NORMAL: "NORMAL",   // Shows alert on startup/recheck if disconnected
  SNOOZED: "SNOOZED", // Snoozed for 24 hours
  MUTED: "MUTED",     // "Don't ask again" - permanently muted
};

async function getConnectionState() {
  const data = await chrome.storage.local.get({
    connection_status: ConnectionState.DISCONNECTED,
    warning_preference: WarningPreference.NORMAL,
    snooze_until: 0
  });
  
  // Auto-expire snooze if time has passed
  if (data.warning_preference === WarningPreference.SNOOZED && Date.now() > data.snooze_until) {
    data.warning_preference = WarningPreference.NORMAL;
    await chrome.storage.local.set({ warning_preference: WarningPreference.NORMAL });
  }
  
  return data;
}

async function setConnectionStatus(status) {
  await chrome.storage.local.set({ connection_status: status });
  updateExtensionBadge(status);
}

async function snoozeWarning() {
  const snoozeUntil = Date.now() + SNOOZE_COOLDOWN_MS;
  await chrome.storage.local.set({
    warning_preference: WarningPreference.SNOOZED,
    snooze_until: snoozeUntil
  });
  updateExtensionBadge(ConnectionState.DISCONNECTED, WarningPreference.SNOOZED);
}

async function muteWarning() {
  await chrome.storage.local.set({
    warning_preference: WarningPreference.MUTED
  });
  updateExtensionBadge(ConnectionState.DISCONNECTED, WarningPreference.MUTED);
}

async function resetWarningPreference() {
  await chrome.storage.local.set({
    warning_preference: WarningPreference.NORMAL,
    snooze_until: 0
  });
  // Refresh badge based on current connection status
  const { connection_status } = await chrome.storage.local.get({ connection_status: ConnectionState.DISCONNECTED });
  updateExtensionBadge(connection_status, WarningPreference.NORMAL);
}

function updateExtensionBadge(status, pref) {
  if (!pref) {
    chrome.storage.local.get({ warning_preference: WarningPreference.NORMAL }, (res) => {
      applyBadge(status, res.warning_preference);
    });
  } else {
    applyBadge(status, pref);
  }
}

function applyBadge(status, pref) {
  if (status === ConnectionState.CONNECTED) {
    // Connected: No badge text (clean state)
    chrome.action.setBadgeText({ text: "" });
  } else {
    // Disconnected
    chrome.action.setBadgeText({ text: "OFF" });
    if (pref === WarningPreference.MUTED || pref === WarningPreference.SNOOZED) {
      // Muted or Snoozed: Gray badge
      chrome.action.setBadgeBackgroundColor({ color: "#6b7280" }); // Gray
    } else {
      // Normal disconnected: Red badge
      chrome.action.setBadgeBackgroundColor({ color: "#ef4444" }); // Red
    }
  }
}
