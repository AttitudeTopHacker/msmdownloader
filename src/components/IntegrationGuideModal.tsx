import React from "react";
import { X, Download, CheckCircle2, Globe } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

interface IntegrationGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const IntegrationGuideModal: React.FC<IntegrationGuideModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  const handleDownloadZip = async () => {
    const url = "https://github.com/AttitudeTopHacker/msmdownloader/releases/latest/download/msmdownloader-extension.zip";
    try {
      await openUrl(url);
    } catch (e) {
      console.error(e);
    }
  };

  const handleOpenExtensionsPage = async (browser: "chrome" | "firefox") => {
    const url = browser === "chrome" ? "chrome://extensions/" : "about:debugging#/runtime/this-firefox";
    try {
      await openUrl(url);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 font-sans select-none text-neutral-300">
      <div className="relative w-full max-w-lg bg-[#0e0e13] border border-neutral-800/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Top bar glow */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-500"></div>

        {/* Header */}
        <div className="bg-[#14141c] px-5 py-4 border-b border-neutral-900/60 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Globe size={18} className="text-indigo-400 animate-pulse" />
            <span className="text-sm font-bold text-neutral-100 tracking-wide">
              Browser Integration Guide
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-white transition duration-150 p-1 hover:bg-neutral-800/40 rounded-lg"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 text-xs max-h-[70vh] overflow-y-auto scrollbar-thin">
          <p className="text-neutral-400 leading-relaxed">
            Follow these simple steps to connect MSM Downloader with your web browser and intercept all download links automatically.
          </p>

          {/* Steps List */}
          <div className="space-y-4">
            {/* Step 1 */}
            <div className="flex space-x-4 bg-neutral-900/40 border border-neutral-800/40 rounded-xl p-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-600/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-sm">
                1
              </div>
              <div className="space-y-2.5 flex-grow">
                <div>
                  <h4 className="font-bold text-neutral-200">Download Extension Package</h4>
                  <p className="text-[10px] text-neutral-500 mt-0.5 leading-normal">
                    Download the latest version of the MSM browser integration extension bundle.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadZip}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg transition duration-200 flex items-center space-x-1.5 shadow-md shadow-indigo-600/20"
                >
                  <Download size={13} />
                  <span>Download Extension Zip</span>
                </button>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex space-x-4 bg-neutral-900/40 border border-neutral-800/40 rounded-xl p-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-600/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-sm">
                2
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-neutral-200">Extract the Zip File</h4>
                <p className="text-[10px] text-neutral-500 leading-relaxed">
                  Locate the downloaded <code className="text-indigo-400 bg-indigo-950/40 px-1 py-0.5 rounded font-mono">msmdownloader-extension.zip</code> file, right-click it, and extract/unzip it. You will get a folder named <span className="text-neutral-300 font-semibold">"msmdownloader-extension"</span>.
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex space-x-4 bg-neutral-900/40 border border-neutral-800/40 rounded-xl p-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-600/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-sm">
                3
              </div>
              <div className="space-y-2.5 flex-grow">
                <div>
                  <h4 className="font-bold text-neutral-200">Open Browser Extensions Page</h4>
                  <p className="text-[10px] text-neutral-500 mt-0.5 leading-normal">
                    Open the extension manager page in your browser and enable **Developer Mode** (usually a toggle in the top-right corner).
                  </p>
                </div>
                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={() => handleOpenExtensionsPage("chrome")}
                    className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-semibold rounded-lg border border-neutral-700/60 transition duration-200 flex items-center space-x-1"
                  >
                    <span>Chrome / Brave / Edge</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenExtensionsPage("firefox")}
                    className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-semibold rounded-lg border border-neutral-700/60 transition duration-200 flex items-center space-x-1"
                  >
                    <span>Firefox</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Step 4 */}
            <div className="flex space-x-4 bg-neutral-900/40 border border-neutral-800/40 rounded-xl p-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-600/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-sm">
                4
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-neutral-200">Drag and Drop Folder</h4>
                <p className="text-[10px] text-neutral-500 leading-relaxed">
                  Drag the extracted <span className="text-neutral-300 font-semibold">"msmdownloader-extension"</span> folder from your file manager and drop it anywhere onto the browser's Extensions page. Alternatively, click **"Load unpacked"** and select the folder.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2 bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3">
            <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
            <p className="text-[10px] text-emerald-400/80 leading-normal">
              **Configuration Complete**: The extension will connect automatically to the app. Make sure MSM Downloader remains open in the background!
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-[#14141c] px-5 py-3.5 border-t border-neutral-900/80 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-neutral-850 hover:bg-neutral-800 border border-neutral-800 text-neutral-200 font-bold rounded-lg text-xs transition duration-200"
          >
            Got it, Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
