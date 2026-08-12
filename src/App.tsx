import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Login } from "./components/Login";
import { ProfileModal } from "./components/ProfileModal";
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
import { formatSpeed, formatBytes } from "./utils/format";
import { DownloadDetailsModal } from "./components/DownloadDetailsModal";

type Tab = "all" | "downloading" | "completed" | "paused" | "failed";

export default function App() {
  // Query parameters check for separate details window routing
  const queryParams = new URLSearchParams(window.location.search);
  const isDetailsWindow = queryParams.get("window") === "details";
  const detailsDownloadId = queryParams.get("id");

  const [detailsItem, setDetailsItem] = useState<any | null>(null);

  useEffect(() => {
    if (isDetailsWindow && detailsDownloadId) {
      const loadItem = async () => {
        try {
          const list = await invoke<any[]>("get_downloads");
          const found = list.find((d) => d.id === detailsDownloadId);
          if (found) {
            setDetailsItem(found);
          }
        } catch (e) {
          console.error("Failed to load details download item:", e);
        }
      };
      loadItem();
      const interval = setInterval(loadItem, 5000);
      return () => clearInterval(interval);
    }
  }, [isDetailsWindow, detailsDownloadId]);

  const [showSplash, setShowSplash] = useState(true);
  const [user, setUser] = useState<{ email: string; name: string; profile_pic: string; mobile?: string } | null>(() => {
    const saved = localStorage.getItem("msm_user_session");
    return saved ? JSON.parse(saved) : null;
  });
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [downloads, setDownloads] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [globalSpeed, setGlobalSpeed] = useState(0);
  const [collisionData, setCollisionData] = useState<CollisionData | null>(null);

  const [downloadDir, setDownloadDir] = useState(() => {
    return localStorage.getItem("msm_download_dir") || "/home/salman/Downloads";
  });
  const [diskInfo, setDiskInfo] = useState<{
    name: string;
    mount_point: string;
    total_space: number;
    available_space: number;
  } | null>(null);

  const fetchDiskInfo = useCallback(async (dirPath: string) => {
    try {
      const info = await invoke<any>("get_disk_info", { dir: dirPath });
      setDiskInfo(info);
    } catch (e) {
      console.error("Failed to get disk info:", e);
      setDiskInfo(null);
    }
  }, []);

  useEffect(() => {
    fetchDiskInfo(downloadDir);

    const handleDirChange = () => {
      const updated = localStorage.getItem("msm_download_dir") || "/home/salman/Downloads";
      setDownloadDir(updated);
      fetchDiskInfo(updated);
    };

    window.addEventListener("msm_download_dir_changed", handleDirChange);
    
    const interval = setInterval(() => {
      fetchDiskInfo(localStorage.getItem("msm_download_dir") || "/home/salman/Downloads");
    }, 10000);

    return () => {
      window.removeEventListener("msm_download_dir_changed", handleDirChange);
      clearInterval(interval);
    };
  }, [downloadDir, fetchDiskInfo]);

  // Synchronize dynamic extension download directory with Rust backend
  useEffect(() => {
    invoke("set_extension_download_dir", { dir: downloadDir }).catch(console.error);
  }, [downloadDir]);

  // Synchronize active user session with Rust backend
  useEffect(() => {
    invoke("set_active_user_session", { email: user ? user.email : null }).catch(console.error);
  }, [user]);

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

  if (isDetailsWindow) {
    if (!detailsItem) {
      return (
        <div className="min-h-screen bg-[#0c0c0e] flex flex-col items-center justify-center text-xs text-neutral-400 font-sans">
          Loading download details...
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-[#0c0c0e] relative overflow-hidden font-sans">
        <DownloadDetailsModal
          isOpen={true}
          item={detailsItem}
          onClose={async () => {
            try {
              const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
              await getCurrentWebviewWindow().close();
            } catch (err) {
              console.error(err);
            }
          }}
          onRefresh={async () => {
            try {
              const list = await invoke<any[]>("get_downloads");
              const found = list.find((d) => d.id === detailsDownloadId);
              if (found) setDetailsItem(found);
            } catch (e) {
              console.error(e);
            }
          }}
        />
      </div>
    );
  }

  if (showSplash) {
    return <Splash onComplete={() => setShowSplash(false)} />;
  }

  if (!user) {
    return <Login onLoginSuccess={(session) => {
      setUser(session);
      localStorage.setItem("msm_user_session", JSON.stringify(session));
    }} />;
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

          {/* User Profile Card */}
          <div 
            onClick={() => setIsProfileOpen(true)}
            className="mx-3 mt-4 p-3 bg-neutral-950/40 hover:bg-neutral-900/50 border border-neutral-900/80 hover:border-neutral-800 rounded-xl flex items-center space-x-3 cursor-pointer transition duration-200 group"
          >
            {user.profile_pic ? (
              <img 
                src={user.profile_pic} 
                alt="Avatar" 
                className="w-9 h-9 rounded-full object-cover border border-neutral-850 group-hover:border-indigo-500/50 transition"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center text-xs font-bold text-white border border-neutral-850">
                {user.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="truncate flex-1">
              <p className="text-[11px] font-bold text-neutral-200 group-hover:text-white transition truncate">
                {user.name}
              </p>
              <p className="text-[9px] text-neutral-500 truncate font-mono">
                {user.email}
              </p>
            </div>
          </div>

          {/* Navigation Filters */}
          <nav className="mt-4 px-3 space-y-1">
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
          <div className="bg-neutral-950/60 border border-neutral-900/80 rounded-lg p-2.5 space-y-2 select-none">
            <div className="flex items-center space-x-2">
              <HardDrive size={15} className="text-indigo-400 shrink-0" />
              <div className="truncate flex-1">
                <p className="text-[9px] text-neutral-500 font-semibold tracking-wide uppercase">
                  Disk Pipeline
                </p>
                <p className="text-[10px] text-neutral-200 font-bold truncate" title={diskInfo ? `${diskInfo.name} (${diskInfo.mount_point})` : "Zero-Merge Mapped"}>
                  {diskInfo ? `${diskInfo.name} (${diskInfo.mount_point})` : "Zero-Merge Mapped"}
                </p>
              </div>
            </div>
            {diskInfo && (
              <div className="space-y-1">
                <div className="flex justify-between text-[9px] text-neutral-400 font-mono">
                  <span>{formatBytes(diskInfo.available_space)} Free</span>
                  <span>{formatBytes(diskInfo.total_space)} Total</span>
                </div>
                <div className="w-full bg-neutral-900 rounded-full h-1 overflow-hidden">
                  <div
                    style={{ width: `${Math.min(100, Math.max(0, ((diskInfo.total_space - diskInfo.available_space) / diskInfo.total_space) * 100))}%` }}
                    className="bg-indigo-500 h-full rounded-full transition-all duration-500"
                  ></div>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between text-[10px] px-1 font-mono">
            <span className="flex items-center space-x-1">
              <Shield size={10} className="text-emerald-500" />
              <span className="text-emerald-400 font-bold">MSM.MOVIN</span>
            </span>
            <span className="text-neutral-400 font-bold">MSM ORG</span>
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

      <ProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        user={user}
        onUpdate={(updated) => {
          setUser(updated);
          localStorage.setItem("msm_user_session", JSON.stringify(updated));
        }}
        onLogout={() => {
          setUser(null);
          localStorage.removeItem("msm_user_session");
        }}
      />
    </div>
  );
}
