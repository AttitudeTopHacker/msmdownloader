import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Folder, HelpCircle } from "lucide-react";

interface AddDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdded: () => void;
}

export const AddDownloadModal: React.FC<AddDownloadModalProps> = ({
  isOpen,
  onClose,
  onAdded,
}) => {
  const [urls, setUrls] = useState("");
  const [destDir, setDestDir] = useState("");
  const [maxChunks, setMaxChunks] = useState(16);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [globalCustomCount, setGlobalCustomCount] = useState(8);

  // Set default download folder on mount (like standard Downloads folder)
  useEffect(() => {
    const fetchDefaultDir = async () => {
      try {
        setDestDir("/home/salman/Downloads");
      } catch (e) {
        console.error(e);
      }
    };
    fetchDefaultDir();

    const mode = localStorage.getItem("msm_connection_mode") || "auto";
    const count = localStorage.getItem("msm_custom_connections");
    setIsCustomMode(mode === "custom");
    if (count) {
      setGlobalCustomCount(parseInt(count, 10));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleBrowse = async () => {
    try {
      const selected = await invoke<string | null>("select_directory");
      if (selected) {
        setDestDir(selected);
      }
    } catch (e) {
      console.error("Browse folder error:", e);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    
    const urlList = urls
      .split("\n")
      .map((u) => u.trim())
      .filter((u) => u.length > 0);

    if (urlList.length === 0) {
      setError("Please enter at least one URL");
      return;
    }

    if (!destDir) {
      setError("Please select a destination folder");
      return;
    }

    setLoading(true);
    checkAndProcessQueue(urlList);
  };

  const checkAndProcessQueue = async (queue: string[]) => {
    if (queue.length === 0) {
      onAdded();
      onClose();
      setUrls("");
      setLoading(false);
      return;
    }

    const currentUrl = queue[0];
    try {
      const mode = localStorage.getItem("msm_connection_mode") || "auto";
      const customVal = localStorage.getItem("msm_custom_connections");
      const customConnections = mode === "custom" && customVal ? parseInt(customVal, 10) : null;

      await invoke("add_download", {
        url: currentUrl,
        destDir,
        maxChunks,
        customConnections,
        customFilename: null,
      });

      checkAndProcessQueue(queue.slice(1));
    } catch (e: any) {
      const errStr = e.toString();
      if (errStr.includes("COLLISION:")) {
        // Backend handles Prompting via events, so close Add Modal and process rest of queue
        onClose();
        checkAndProcessQueue(queue.slice(1));
      } else {
        setError(errStr);
        setLoading(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      {/* Modal Card */}
      <div className="relative w-full max-w-lg bg-neutral-900 border border-neutral-800/80 rounded-2xl shadow-2xl p-6 overflow-hidden">
        {/* Glow */}
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-indigo-500/10 rounded-full blur-2xl"></div>

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-neutral-800">
          <h2 className="text-xl font-bold text-white tracking-wide">
            Add New Download(s)
          </h2>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-white transition-colors duration-200"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-950/40 border border-red-500/30 text-red-400 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* URLs input */}
          <div className="flex flex-col">
            <label className="text-sm font-semibold text-neutral-300 mb-1 flex items-center justify-between">
              <span>URL (Enter one URL per line for Batch download)</span>
              <span className="text-xs text-neutral-500 font-normal font-mono">
                HTTP/HTTPS
              </span>
            </label>
            <textarea
              className="bg-neutral-950 border border-neutral-800 focus:border-indigo-500 rounded-lg p-3 text-sm text-white placeholder-neutral-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono transition duration-200"
              rows={4}
              placeholder="https://example.com/file.zip&#10;https://example.com/anotherfile.zip"
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              disabled={loading}
            />
          </div>

          {/* Save Directory */}
          <div className="flex flex-col">
            <label className="text-sm font-semibold text-neutral-300 mb-1">
              Save Location
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg p-2.5 text-sm text-neutral-300 placeholder-neutral-600 focus:outline-none focus:border-neutral-700 font-mono"
                placeholder="/path/to/download/folder"
                value={destDir}
                onChange={(e) => setDestDir(e.target.value)}
                disabled={loading}
              />
              <button
                type="button"
                onClick={handleBrowse}
                disabled={loading}
                className="flex items-center space-x-2 bg-neutral-800 hover:bg-neutral-700 text-white px-4 py-2.5 rounded-lg text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-neutral-700"
              >
                <Folder size={16} />
                <span>Browse</span>
              </button>
            </div>
          </div>

          {/* Chunks slider */}
          <div className="flex flex-col">
            {isCustomMode ? (
              <div className="flex flex-col bg-indigo-950/30 border border-indigo-900/40 rounded-lg p-3 space-y-1">
                <span className="text-xs font-bold text-indigo-400">Custom Connection Mode Active</span>
                <p className="text-[10px] text-neutral-400">
                  New downloads will connect with exactly {globalCustomCount} parallel connections as configured in Settings. (Fallback of 1 is enforced if Range is not supported).
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-semibold text-neutral-300 flex items-center space-x-1.5">
                    <span>Parallel Connections</span>
                    <span title="More chunks accelerate download speed by querying ranges simultaneously." className="cursor-help">
                      <HelpCircle size={14} className="text-neutral-500" />
                    </span>
                  </label>
                  <span className="text-xs text-indigo-400 font-mono font-bold bg-indigo-950/50 px-2 py-0.5 border border-indigo-900/50 rounded">
                    {maxChunks} Connections
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={64}
                  step={1}
                  className="w-full accent-indigo-500 bg-neutral-950 h-1.5 rounded-lg cursor-pointer appearance-none border border-neutral-800/40"
                  value={maxChunks}
                  onChange={(e) => setMaxChunks(parseInt(e.target.value))}
                  disabled={loading}
                />
                <div className="flex items-center justify-between text-[10px] text-neutral-600 font-mono mt-1 px-1">
                  <span>1 Thread</span>
                  <span>16 Threads</span>
                  <span>32 Threads</span>
                  <span>64 Threads</span>
                </div>
              </>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-neutral-800 mt-6">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 bg-transparent text-neutral-400 hover:text-white text-sm transition duration-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm px-6 py-2.5 rounded-lg transition-all duration-200 shadow-lg shadow-indigo-600/10 focus:outline-none focus:ring-2 focus:ring-indigo-600 disabled:opacity-50 flex items-center justify-center min-w-[120px]"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                "Add Download"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
