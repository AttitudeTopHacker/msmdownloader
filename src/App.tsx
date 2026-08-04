import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Download,
  Plus,
  Settings,
  Shield,
  Zap,
  Activity,
  HardDrive,
  CheckCircle,
  Clock,
  AlertOctagon,
  FileDown,
} from "lucide-react";

import { Splash } from "./components/Splash";
import { AddDownloadModal } from "./components/AddDownloadModal";
import { DownloadItemRow } from "./components/DownloadItemRow";
import { SettingsModal } from "./components/SettingsModal";
import { CollisionDialog, CollisionData } from "./components/CollisionDialog";
import { formatSpeed } from "./utils/format";

type Tab = "all" | "downloading" | "completed" | "paused" | "failed";

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [downloads, setDownloads] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [globalSpeed, setGlobalSpeed] = useState(0);
  const [collisionData, setCollisionData] = useState<CollisionData | null>(null);

  const [connectionMode, setConnectionMode] = useState<"auto" | "custom">(() => {
    return (localStorage.getItem("msm_connection_mode") as "auto" | "custom") || "auto";
  });
  const [customConnections, setCustomConnections] = useState<number>(() => {
    const val = localStorage.getItem("msm_custom_connections");
    return val ? parseInt(val, 10) : 8;
  });

  const saveSettings = (mode: "auto" | "custom", count: number) => {
    setConnectionMode(mode);
    setCustomConnections(count);
    localStorage.setItem("msm_connection_mode", mode);
    localStorage.setItem("msm_custom_connections", count.toString());
  };

  // Fetch download list from Rust backend
  const fetchDownloads = useCallback(async () => {
    try {
      const list = await invoke<any[]>("get_downloads");
      setDownloads(list);
      
      // Calculate global download speed across all downloading tasks
      const activeSpeed = list
        .filter((item) => item.status === "Downloading")
        .reduce((sum, item) => sum + (item.speed || 0), 0);
      setGlobalSpeed(activeSpeed);
    } catch (e) {
      console.error("Failed to fetch downloads:", e);
    }
  }, []);

  // Set up listeners on mount
  useEffect(() => {
    fetchDownloads();

    let unlistenState: (() => void) | null = null;
    let unlistenProgress: (() => void) | null = null;
    let unlistenCollision: (() => void) | null = null;

    const setupListeners = async () => {
      // Refresh list whenever any download state changes globally
      unlistenState = await listen("download-state-global", () => {
        fetchDownloads();
      });

      // Update global speed aggregate dynamically from active progress stream
      unlistenProgress = await listen<any>("download-progress-global", () => {
        // Debounced or simple refresh
        fetchDownloads();
      });

      // Listen to download collision request event
      unlistenCollision = await listen<CollisionData>("download-collision-request", (event) => {
        setCollisionData(event.payload);
      });
    };

    setupListeners();

    return () => {
      if (unlistenState) unlistenState();
      if (unlistenProgress) unlistenProgress();
      if (unlistenCollision) unlistenCollision();
    };
  }, [fetchDownloads]);

  const handleResolveCollision = async (choice: string, newFilename: string | null) => {
    if (!collisionData) return;
    try {
      await invoke("resolve_download_collision", {
        tempId: collisionData.temp_id,
        choice,
        newFilename,
      });
      setCollisionData(null);
      fetchDownloads();
    } catch (e) {
      console.error("Failed to resolve collision:", e);
      setCollisionData(null);
    }
  };

  // Periodically refresh items to calculate speeds accurately
  useEffect(() => {
    const timer = setInterval(() => {
      fetchDownloads();
    }, 1000);
    return () => clearInterval(timer);
  }, [fetchDownloads]);

  const filteredDownloads = downloads.filter((item) => {
    const status = item.status;
    const isDownloading = status === "Downloading";
    const isCompleted = status === "Completed";
    const isFailed = typeof status === "object" && status !== null && "Failed" in status;
    const isPaused = status === "Paused";

    if (activeTab === "all") return true;
    if (activeTab === "downloading") return isDownloading;
    if (activeTab === "completed") return isCompleted;
    if (activeTab === "paused") return isPaused;
    if (activeTab === "failed") return isFailed;
    return true;
  });

  const getStats = () => {
    const total = downloads.length;
    const downloading = downloads.filter((d) => d.status === "Downloading").length;
    const completed = downloads.filter((d) => d.status === "Completed").length;
    const paused = downloads.filter((d) => d.status === "Paused").length;
    const failed = downloads.filter((d) => typeof d.status === "object" && d.status !== null && "Failed" in d.status).length;
    return { total, downloading, completed, paused, failed };
  };

  const stats = getStats();

  if (showSplash) {
    return <Splash onComplete={() => setShowSplash(false)} />;
  }

  return (
    <div className="flex h-screen bg-[#07070a] text-neutral-200 select-none overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-[#0a0a0f]/90 border-r border-neutral-900/60 flex flex-col justify-between shrink-0">
        <div>
          {/* Logo Brand */}
          <div className="flex items-center space-x-2.5 px-6 py-5 border-b border-neutral-900/40">
            <div className="bg-gradient-to-tr from-indigo-600 to-cyan-500 p-1.5 rounded-lg shadow-md shadow-indigo-600/10">
              <Download className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-extrabold text-sm tracking-wide text-white">
                MSM DOWNLOADER
              </h1>
              <span className="text-[9px] text-neutral-500 font-mono tracking-widest uppercase">
                Ultra Downloader
              </span>
            </div>
          </div>

          {/* Navigation Filters */}
          <nav className="mt-6 px-3 space-y-1">
            <button
              onClick={() => setActiveTab("all")}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold tracking-wide transition duration-200 ${
                activeTab === "all"
                  ? "bg-indigo-600/10 text-indigo-400 border-l-2 border-indigo-500"
                  : "text-neutral-400 hover:bg-neutral-900/40 hover:text-neutral-200"
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <Activity size={15} />
                <span>All Downloads</span>
              </div>
              <span className="text-[10px] font-mono bg-neutral-950 px-2 py-0.5 rounded border border-neutral-900/50">
                {stats.total}
              </span>
            </button>

            <button
              onClick={() => setActiveTab("downloading")}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold tracking-wide transition duration-200 ${
                activeTab === "downloading"
                  ? "bg-indigo-600/10 text-indigo-400 border-l-2 border-indigo-500"
                  : "text-neutral-400 hover:bg-neutral-900/40 hover:text-neutral-200"
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <Zap size={15} />
                <span>Downloading</span>
              </div>
              {stats.downloading > 0 && (
                <span className="text-[10px] font-mono bg-indigo-950/60 text-indigo-400 border border-indigo-900/30 px-2 py-0.5 rounded">
                  {stats.downloading}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab("completed")}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold tracking-wide transition duration-200 ${
                activeTab === "completed"
                  ? "bg-indigo-600/10 text-indigo-400 border-l-2 border-indigo-500"
                  : "text-neutral-400 hover:bg-neutral-900/40 hover:text-neutral-200"
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <CheckCircle size={15} />
                <span>Completed</span>
              </div>
              <span className="text-[10px] font-mono bg-neutral-950 px-2 py-0.5 rounded border border-neutral-900/50">
                {stats.completed}
              </span>
            </button>

            <button
              onClick={() => setActiveTab("paused")}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold tracking-wide transition duration-200 ${
                activeTab === "paused"
                  ? "bg-indigo-600/10 text-indigo-400 border-l-2 border-indigo-500"
                  : "text-neutral-400 hover:bg-neutral-900/40 hover:text-neutral-200"
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <Clock size={15} />
                <span>Paused</span>
              </div>
              <span className="text-[10px] font-mono bg-neutral-950 px-2 py-0.5 rounded border border-neutral-900/50">
                {stats.paused}
              </span>
            </button>

            <button
              onClick={() => setActiveTab("failed")}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold tracking-wide transition duration-200 ${
                activeTab === "failed"
                  ? "bg-indigo-600/10 text-indigo-400 border-l-2 border-indigo-500"
                  : "text-neutral-400 hover:bg-neutral-900/40 hover:text-neutral-200"
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <AlertOctagon size={15} />
                <span>Failed</span>
              </div>
              {stats.failed > 0 && (
                <span className="text-[10px] font-mono bg-red-950/60 text-red-400 border border-red-900/30 px-2 py-0.5 rounded">
                  {stats.failed}
                </span>
              )}
            </button>
          </nav>
        </div>

        {/* Sidebar Footer Info */}
        <div className="p-4 border-t border-neutral-900/40 space-y-3">
          <div className="bg-neutral-950/60 border border-neutral-900/80 rounded-lg p-2.5 flex items-center space-x-2">
            <HardDrive size={15} className="text-neutral-500 shrink-0" />
            <div className="truncate">
              <p className="text-[9px] text-neutral-500 font-semibold tracking-wide uppercase">
                Disk Pipeline
              </p>
              <p className="text-[10px] text-neutral-300 font-bold truncate">
                Zero-Merge Mapped
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px] text-neutral-500 px-1 font-mono">
            <span className="flex items-center space-x-1">
              <Shield size={10} className="text-emerald-500" />
              <span>TLS V1.3</span>
            </span>
            <span>V2.0.0</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#07070a]">
        {/* Top Header */}
        <header className="h-16 border-b border-neutral-900/60 bg-[#0a0a0f]/40 backdrop-blur-md px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-4">
            <h2 className="text-lg font-bold text-white tracking-wide capitalize">
              {activeTab === "all" ? "All Downloads" : activeTab}
            </h2>
            <span className="bg-neutral-900/85 border border-neutral-850/80 text-[10px] font-bold font-mono px-2.5 py-1 rounded-full text-neutral-400 flex items-center space-x-1 select-none">
              <span>Mode: {connectionMode === "auto" ? "Auto" : `Custom (${customConnections} Conn)`}</span>
            </span>
            {globalSpeed > 0 && (
              <span className="bg-indigo-600/10 text-indigo-400 border border-indigo-900/40 text-[10px] font-bold font-mono px-2.5 py-1 rounded-full flex items-center space-x-1 shadow-md shadow-indigo-600/5 animate-pulse">
                <Zap size={10} />
                <span>Speed: {formatSpeed(globalSpeed)}</span>
              </span>
            )}
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowAddModal(true)}
              className="bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-semibold text-xs px-4 py-2 rounded-lg transition-all duration-200 flex items-center space-x-1.5 shadow-lg shadow-indigo-600/10 focus:outline-none"
            >
              <Plus size={14} />
              <span>New Download</span>
            </button>
            <button
              onClick={() => setShowSettingsModal(true)}
              className="p-2 bg-neutral-900 border border-neutral-800/60 hover:bg-neutral-800/80 hover:text-white rounded-lg text-neutral-400 transition duration-200"
              title="Open Settings"
            >
              <Settings size={14} />
            </button>
          </div>
        </header>

        {/* Content list */}
        <div className="flex-1 overflow-y-auto p-6">
          {filteredDownloads.length > 0 ? (
            <div className="space-y-3.5 max-w-4xl mx-auto">
              {filteredDownloads.map((item) => (
                <DownloadItemRow
                  key={item.id}
                  item={item}
                  onRefresh={fetchDownloads}
                />
              ))}
            </div>
          ) : (
            /* Empty State */
            <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto">
              <div className="bg-neutral-950/80 border border-neutral-900 p-6 rounded-2xl mb-4 relative shadow-xl shadow-black/10">
                <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-tr from-indigo-600 to-cyan-500 opacity-10 blur-md"></div>
                <FileDown size={40} className="text-neutral-600 relative z-10" />
              </div>
              <h3 className="text-sm font-bold text-neutral-300">
                No downloads found
              </h3>
              <p className="text-xs text-neutral-500 mt-1 mb-6">
                There are no downloads in this tab. Click below to add a new URL to start your high-speed download.
              </p>
              <button
                onClick={() => setShowAddModal(true)}
                className="bg-neutral-900 hover:bg-neutral-800 text-neutral-200 font-semibold border border-neutral-800/60 text-xs px-4 py-2 rounded-lg transition duration-200 flex items-center space-x-1.5"
              >
                <Plus size={14} />
                <span>New Download</span>
              </button>
            </div>
          )}
        </div>
      </main>

      {/* Add Download Modal */}
      <AddDownloadModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdded={fetchDownloads}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        onSave={saveSettings}
      />

      {collisionData && (
        <CollisionDialog
          data={collisionData}
          onResolve={handleResolveCollision}
        />
      )}
    </div>
  );
}
