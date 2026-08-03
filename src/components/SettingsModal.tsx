import React, { useState, useEffect } from "react";
import { X, Settings2, Sliders, Zap, Globe } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (mode: "auto" | "custom", count: number) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onSave,
}) => {
  const [mode, setMode] = useState<"auto" | "custom">("auto");
  const [count, setCount] = useState<number>(8);

  useEffect(() => {
    if (isOpen) {
      const savedMode = (localStorage.getItem("msm_connection_mode") as "auto" | "custom") || "auto";
      const savedCount = localStorage.getItem("msm_custom_connections");
      setMode(savedMode);
      setCount(savedCount ? parseInt(savedCount, 10) : 8);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(mode, count);
    onClose();
  };

  const handleOpenExtension = async (browser: "chrome" | "firefox") => {
    let url = "";
    if (browser === "chrome") {
      url = "https://github.com/AttitudeTopHacker/msmdownloader#browser-extension-setup-chrome-edge-brave-opera";
    } else {
      url = "https://github.com/AttitudeTopHacker/msmdownloader#firefox-setup";
    }
    try {
      await openUrl(url);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 font-sans select-none text-neutral-300">
      <div className="relative w-full max-w-md bg-[#14141a] border border-neutral-800 rounded-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-[#1b1b22] px-4 py-3 border-b border-neutral-800 flex items-center justify-between">
          <span className="text-xs font-bold text-neutral-100 tracking-wide flex items-center space-x-2">
            <Settings2 size={14} className="text-indigo-400" />
            <span>Settings</span>
          </span>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-white transition duration-150"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 text-xs max-h-[65vh] overflow-y-auto scrollbar-thin">
          {/* Mode Selector */}
          <div className="space-y-2">
            <label className="text-neutral-400 font-bold uppercase tracking-wider text-[10px]">
              Connection Mode
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("auto")}
                className={`p-3 rounded-lg border flex flex-col items-center justify-center space-y-1.5 transition-all duration-200 ${
                  mode === "auto"
                    ? "bg-indigo-600/10 border-indigo-500 text-indigo-400 shadow-md shadow-indigo-500/5"
                    : "bg-neutral-900/60 border-neutral-800 hover:border-neutral-700 text-neutral-400"
                }`}
              >
                <Zap size={16} />
                <span className="font-bold">Auto Mode</span>
                <span className="text-[9px] text-neutral-500 text-center">
                  Dynamic size division & adaptive connections
                </span>
              </button>

              <button
                type="button"
                onClick={() => setMode("custom")}
                className={`p-3 rounded-lg border flex flex-col items-center justify-center space-y-1.5 transition-all duration-200 ${
                  mode === "custom"
                    ? "bg-indigo-600/10 border-indigo-500 text-indigo-400 shadow-md shadow-indigo-500/5"
                    : "bg-neutral-900/60 border-neutral-800 hover:border-neutral-700 text-neutral-400"
                }`}
              >
                <Sliders size={16} />
                <span className="font-bold">Custom Mode</span>
                <span className="text-[9px] text-neutral-500 text-center">
                  Fixed connections override for advanced download tuning
                </span>
              </button>
            </div>
          </div>

          {/* Connection Slider */}
          <div
            className={`space-y-3 transition-opacity duration-200 ${
              mode === "custom" ? "opacity-100" : "opacity-40 pointer-events-none"
            }`}
          >
            <div className="flex justify-between items-end">
              <label className="text-neutral-400 font-bold uppercase tracking-wider text-[10px]">
                Connection Threads Limit
              </label>
              <span className="text-xs font-mono font-bold text-indigo-400 bg-indigo-600/10 border border-indigo-500/20 px-2.5 py-0.5 rounded">
                {count} threads
              </span>
            </div>

            <div className="space-y-2">
              <input
                type="range"
                min="1"
                max="32"
                value={count}
                onChange={(e) => setCount(parseInt(e.target.value, 10))}
                disabled={mode !== "custom"}
                className="w-full h-1.5 bg-neutral-900 rounded-lg appearance-none cursor-pointer accent-indigo-500 focus:outline-none"
              />
              <div className="flex justify-between text-[9px] text-neutral-600 font-mono">
                <span>1 (Min)</span>
                <span>8</span>
                <span>16</span>
                <span>24</span>
                <span>32 (Max)</span>
              </div>
            </div>
            
            <p className="text-[9px] text-neutral-500 italic bg-neutral-950/40 p-2 border border-neutral-900 rounded">
              Note: If a server does not support Range requests, it will automatically fall back to 1 connection regardless of this custom setting.
            </p>
          </div>

          {/* Divider */}
          <div className="h-px bg-neutral-800/60 my-2"></div>

          {/* Browser Integration */}
          <div className="space-y-3">
            <label className="text-neutral-400 font-bold uppercase tracking-wider text-[10px]">
              Browser Integration
            </label>
            <p className="text-[10px] text-neutral-500 leading-normal">
              Install the extension to intercept downloads from your browsers automatically and sync with MSM Downloader.
            </p>
            <div className="flex flex-col space-y-2 pt-1">
              <button
                type="button"
                onClick={() => handleOpenExtension("chrome")}
                className="w-full px-3 py-2.5 bg-neutral-900 border border-neutral-800/80 hover:border-indigo-500/30 hover:bg-neutral-800/50 rounded-lg flex items-center justify-between text-[11px] font-semibold text-neutral-300 transition duration-200"
              >
                <div className="flex items-center space-x-2.5">
                  <svg className="w-4 h-4 text-amber-500" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.38 0 0 5.38 0 12s5.38 12 12 12 12-5.38 12-12S18.62 0 12 0zm0 2.2c1.9 0 3.65.6 5.1 1.6L12.3 12.3c-.1 0-.2.1-.3.1-2.2 0-4-1.8-4-4 0-1.8 1.2-3.3 2.8-3.8l-1-2C6.7 3.3 4.1 5.9 3 9.3l3.6 1.8c.8-3.8 4.2-6.7 8.4-6.7c3.1 0 5.8 1.6 7.3 4.1L12.3 21.8c-5.4 0-9.8-4.4-9.8-9.8S6.9 2.2 12 2.2z"/>
                  </svg>
                  <span>Google Chrome / Brave / Edge / Opera</span>
                </div>
                <span className="text-[9px] text-indigo-400 font-bold bg-indigo-950/60 px-2 py-0.5 border border-indigo-900/40 rounded flex items-center space-x-1">
                  <Globe size={10} />
                  <span>Get Extension</span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleOpenExtension("firefox")}
                className="w-full px-3 py-2.5 bg-neutral-900 border border-neutral-800/80 hover:border-indigo-500/30 hover:bg-neutral-800/50 rounded-lg flex items-center justify-between text-[11px] font-semibold text-neutral-300 transition duration-200"
              >
                <div className="flex items-center space-x-2.5">
                  <svg className="w-4 h-4 text-orange-500" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.38 0 0 5.38 0 12s5.38 12 12 12 12-5.38 12-12S18.62 0 12 0zm4.5 5.8c1.3.8 2.1 2.3 2.1 4.1 0 2.9-2.3 5.2-5.2 5.2S8.2 12.8 8.2 9.9c0-1.4.6-2.7 1.5-3.6C8 7.3 7 9.1 7 11.2c0 3.3 2.7 6 6 6s6-2.7 6-6c0-2.3-1.1-4.3-2.5-5.4z"/>
                  </svg>
                  <span>Mozilla Firefox</span>
                </div>
                <span className="text-[9px] text-indigo-400 font-bold bg-indigo-950/60 px-2 py-0.5 border border-indigo-900/40 rounded flex items-center space-x-1">
                  <Globe size={10} />
                  <span>Get Extension</span>
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-[#16161c] px-4 py-3 border-t border-neutral-800/80 flex items-center justify-end space-x-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-neutral-900 border border-[#262630] hover:bg-neutral-800 text-neutral-300 rounded text-xs transition duration-150"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded text-xs transition duration-150 shadow-lg shadow-indigo-600/25"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};
