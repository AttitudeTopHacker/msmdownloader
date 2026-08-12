import React, { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir, openPath } from "@tauri-apps/plugin-opener";
import {
  Play,
  Pause,
  Trash2,
  FolderOpen,
  FileText,
  FileVideo,
  FileAudio,
  FileArchive,
  FileImage,
  AlertTriangle,
  CheckCircle,
  Info,
  ListX,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import { formatBytes, formatSpeed, formatEta } from "../utils/format";
import { DownloadDetailsModal } from "./DownloadDetailsModal";


export interface ChunkInfo {
  id: number;
  start: number;
  end: number;
  current: number;
  speed: number;
}

export interface ProgressPayload {
  id: string;
  file_name: string;
  file_path: string;
  downloaded: number;
  total_size: number;
  status: any; // DownloadStatus
  speed: number;
  eta: number;
  chunks: ChunkInfo[];
}

interface DownloadItemRowProps {
  item: any; // DownloadItem
  onRefresh: () => void;
}

export const DownloadItemRow: React.FC<DownloadItemRowProps> = ({
  item,
  onRefresh,
}) => {
  const [downloaded, setDownloaded] = useState(item.downloaded);
  const [totalSize, setTotalSize] = useState(item.total_size);
  const [speed, setSpeed] = useState(item.speed);
  const [eta, setEta] = useState(item.eta);
  const [status, setStatus] = useState(item.status);
  const [chunks, setChunks] = useState<ChunkInfo[]>(item.chunks || []);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [fileName, setFileName] = useState(item.file_name);
  const [filePath, setFilePath] = useState(item.file_path);
  const [showDeleteMenu, setShowDeleteMenu] = useState(false);
  const [resumable, setResumable] = useState<boolean>(item.resumable !== false);
  const [showPauseWarning, setShowPauseWarning] = useState(false);

  const handleOpenDetails = async () => {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const windowLabel = `details-${item.id}`;
      
      const existing = await WebviewWindow.getByLabel(windowLabel);
      if (existing) {
        await existing.setFocus();
        return;
      }

      new WebviewWindow(windowLabel, {
        url: `index.html?window=details&id=${item.id}`,
        title: `Download status - ${fileName}`,
        width: 590,
        height: 540,
        resizable: true,
        decorations: true,
        focus: true,
      });
    } catch (e) {
      console.error("Failed to open Tauri window, falling back to overlay:", e);
      setIsDetailsOpen(true);
    }
  };


  const itemId = item.id;

  // Listen to progress updates
  useEffect(() => {
    let unlistenProgress: (() => void) | null = null;
    let unlistenState: (() => void) | null = null;

    const setupListeners = async () => {
      // 1. Progress listener
      unlistenProgress = await listen<ProgressPayload>(
        `download-progress:${itemId}`,
        (event) => {
          const payload = event.payload;
          setDownloaded(payload.downloaded);
          setTotalSize(payload.total_size);
          setSpeed(payload.speed);
          setEta(payload.eta);
          setChunks(payload.chunks || []);
          if (payload.file_name) setFileName(payload.file_name);
          if (payload.file_path) setFilePath(payload.file_path);
        }
      );

      // 2. State listener
      unlistenState = await listen<any>(
        `download-state:${itemId}`,
        (event) => {
          const newStatus = event.payload;
          setStatus(newStatus);
          if (
            newStatus === "Completed" ||
            newStatus === "Paused" ||
            typeof newStatus === "object" // Failed(String)
          ) {
            setSpeed(0);
            setEta(-1);
            onRefresh(); // Refresh the list
          }
        }
      );
    };

    setupListeners();

    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenState) unlistenState();
    };
  }, [itemId, onRefresh]);

  // Sync initial prop changes
  useEffect(() => {
    setDownloaded(item.downloaded);
    setTotalSize(item.total_size);
    setStatus(item.status);
    setChunks(item.chunks || []);
    setFileName(item.file_name);
    setFilePath(item.file_path);
    setResumable(item.resumable !== false);
  }, [item]);

  const handlePause = async (force: boolean = false) => {
    if (!resumable && force !== true) {
      setShowPauseWarning(true);
      return;
    }
    setShowPauseWarning(false);
    try {
      await invoke("pause_download", { id: item.id });
      setStatus("Paused");
      setSpeed(0);
      setEta(-1);
      onRefresh();
    } catch (e) {
      console.error(e);
    }
  };

  const handleResume = async () => {
    try {
      setStatus("Downloading");
      const mode = localStorage.getItem("msm_connection_mode") || "auto";
      const customVal = localStorage.getItem("msm_custom_connections");
      const customConnections = mode === "custom" && customVal ? parseInt(customVal, 10) : null;

      await invoke("resume_download", { id: item.id, customConnections });
      onRefresh();
    } catch (e) {
      console.error(e);
    }
  };

  // Remove from list only (keep file on disk)
  const handleRemove = async () => {
    setShowDeleteMenu(false);
    try {
      await invoke("delete_download", { id: item.id, deleteFile: false });
      onRefresh();
    } catch (e) {
      console.error(e);
    }
  };

  // Delete from list AND from disk
  const handleDeleteFile = async () => {
    setShowDeleteMenu(false);
    try {
      await invoke("delete_download", { id: item.id, deleteFile: true });
      onRefresh();
    } catch (e) {
      console.error(e);
    }
  };

  const handleOpenFolder = async () => {
    try {
      await revealItemInDir(filePath);
    } catch (e) {
      console.warn("revealItemInDir failed, trying fallback to open parent directory:", e);
      try {
        const lastSlash = filePath.lastIndexOf("/");
        const lastBackslash = filePath.lastIndexOf("\\");
        const idx = Math.max(lastSlash, lastBackslash);
        if (idx !== -1) {
          const parentDir = filePath.substring(0, idx);
          await openPath(parentDir);
        } else {
          await openPath(filePath);
        }
      } catch (err) {
        console.error("Fallback openPath failed:", err);
      }
    }
  };

  // Select file icon based on extension
  const getFileIcon = (fileName: string) => {
    const ext = fileName.split(".").pop()?.toLowerCase();
    const style = "w-6 h-6 text-neutral-400";
    if (!ext) return <FileText className={style} />;

    if (["mp4", "mkv", "avi", "mov", "flv"].includes(ext)) {
      return <FileVideo className="w-6 h-6 text-pink-400" />;
    }
    if (["mp3", "wav", "flac", "ogg", "m4a"].includes(ext)) {
      return <FileAudio className="w-6 h-6 text-cyan-400" />;
    }
    if (["zip", "rar", "tar", "gz", "7z"].includes(ext)) {
      return <FileArchive className="w-6 h-6 text-yellow-500" />;
    }
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
      return <FileImage className="w-6 h-6 text-emerald-400" />;
    }
    if (ext === "pdf") {
      return <FileText className="w-6 h-6 text-red-500" />;
    }
    return <FileText className={style} />;
  };

  const isDownloading = status === "Downloading";
  const isCompleted = status === "Completed";
  const isFailed = typeof status === "object" && status !== null && "Failed" in status;
  const isPaused = status === "Paused";
  const isNonResumablePaused = isPaused && !resumable;

  const getStatusText = () => {
    if (isDownloading) return "Downloading";
    if (isCompleted) return "Completed";
    if (isNonResumablePaused) return "Stopped (not resumable)";
    if (isPaused) return "Paused";
    if (isFailed) return `Error: ${status.Failed}`;
    return "Queued";
  };

  const getPercentage = () => {
    if (isCompleted) return 100;
    if (totalSize === 0) return 0;
    return Math.min(100, Math.round((downloaded / totalSize) * 100));
  };

  const percentage = getPercentage();

  return (
    <div
      onDoubleClick={handleOpenDetails}
      className="bg-neutral-900/60 border border-neutral-800/40 hover:border-indigo-500/20 hover:bg-neutral-900/80 rounded-xl p-4 transition-all duration-300 shadow-lg shadow-black/5 flex flex-col space-y-3 cursor-pointer animate-list-item"
      title="Double-click to view connection details"
    >
      {/* Upper Panel */}
      <div className="flex items-center justify-between">
        {/* File Info */}
        <div className="flex items-center space-x-3 truncate flex-1 mr-4">
          <div className="bg-neutral-950/80 p-2.5 rounded-lg border border-neutral-800/60 shadow-inner">
            {getFileIcon(fileName)}
          </div>
          <div className="truncate flex-1">
            <h3
              className="text-sm font-semibold text-neutral-100 truncate cursor-pointer hover:text-indigo-400 transition-colors duration-150"
              title={fileName}
            >
              {fileName}
            </h3>
            <p className="text-[10px] text-neutral-500 font-mono mt-0.5 truncate">
              {filePath}
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center space-x-1.5 shrink-0">
          {isDownloading ? (
            <button
              onClick={() => handlePause()}
              className="p-2 bg-neutral-800 hover:bg-neutral-700 hover:text-amber-400 text-neutral-300 rounded-lg text-xs transition duration-200"
              title="Pause"
            >
              <Pause size={14} />
            </button>
          ) : isCompleted ? (
            <button
              onClick={handleOpenFolder}
              className="p-2 bg-neutral-800 hover:bg-neutral-700 hover:text-indigo-400 text-neutral-300 rounded-lg text-xs transition duration-200"
              title="Show in Folder"
            >
              <FolderOpen size={14} />
            </button>
          ) : isNonResumablePaused ? (
            // Non-resumable: show Restart button (will re-download from 0)
            <button
              onClick={handleResume}
              className="p-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded-lg text-xs transition duration-200 border border-amber-500/20"
              title="Restart download from beginning (server doesn't support resume)"
            >
              <RefreshCw size={14} />
            </button>
          ) : (
            <button
              onClick={handleResume}
              className="p-2 bg-neutral-800 hover:bg-neutral-700 hover:text-indigo-400 text-neutral-300 rounded-lg text-xs transition duration-200"
              title="Resume"
            >
              <Play size={14} />
            </button>
          )}

          <button
            onClick={() => setIsDetailsOpen(true)}
            className="p-2 bg-neutral-800 hover:bg-neutral-700 hover:text-indigo-400 text-neutral-300 rounded-lg text-xs transition duration-200"
            title="View Details"
          >
            <Info size={14} />
          </button>

          {/* Delete dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowDeleteMenu((v) => !v)}
              className={`p-2 rounded-lg text-xs transition duration-200 ${
                showDeleteMenu
                  ? "bg-red-500/15 text-red-400 border border-red-500/30"
                  : "bg-neutral-800 hover:bg-neutral-700 hover:text-red-400 text-neutral-300"
              }`}
              title="Remove / Delete"
            >
              <Trash2 size={14} />
            </button>

            {showDeleteMenu && (
              <>
                {/* Backdrop to close on outside click */}
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setShowDeleteMenu(false)}
                />
                {/* Dropdown panel */}
                <div className="absolute right-0 top-full mt-1.5 z-40 w-52 bg-[#18181f] border border-neutral-800 rounded-lg shadow-2xl shadow-black/40 overflow-hidden text-xs">
                  <div className="px-3 py-2 border-b border-neutral-800/80 text-[10px] text-neutral-500 font-bold uppercase tracking-wider">
                    Choose action
                  </div>

                  {/* Remove from list only */}
                  <button
                    onClick={handleRemove}
                    className="w-full flex items-center space-x-3 px-3 py-2.5 hover:bg-neutral-800/80 text-neutral-300 hover:text-white transition duration-150 text-left"
                  >
                    <span className="p-1.5 rounded bg-neutral-700/60 text-neutral-400">
                      <ListX size={12} />
                    </span>
                    <div>
                      <p className="font-semibold">Remove</p>
                      <p className="text-[9px] text-neutral-500 mt-0.5">
                        Remove from list only. File stays on disk.
                      </p>
                    </div>
                  </button>

                  {/* Delete from list + disk */}
                  <button
                    onClick={handleDeleteFile}
                    className="w-full flex items-center space-x-3 px-3 py-2.5 hover:bg-red-500/10 text-neutral-300 hover:text-red-400 transition duration-150 text-left border-t border-neutral-800/60"
                  >
                    <span className="p-1.5 rounded bg-red-500/10 text-red-500">
                      <Trash2 size={12} />
                    </span>
                    <div>
                      <p className="font-semibold text-red-400">Delete File</p>
                      <p className="text-[9px] text-neutral-500 mt-0.5">
                        Remove from list AND delete file from disk.
                      </p>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Progress Section */}
      <div className="space-y-1">
        <div className="flex justify-between items-end text-xs font-semibold">
          {/* Left metrics */}
          <div className="flex items-center space-x-2 text-neutral-400 font-mono">
            {isDownloading && (
              <>
                <span className="text-indigo-400 font-bold">{formatSpeed(speed)}</span>
                <span className="text-neutral-700">•</span>
                <span>ETA {formatEta(eta)}</span>
                <span className="text-neutral-700">•</span>
              </>
            )}
            <span>
              {formatBytes(downloaded)}
              {totalSize > 0 && ` / ${formatBytes(totalSize)}`}
            </span>
          </div>

          {/* Right percentage/status */}
          <div className="flex items-center space-x-2 font-mono">
            {isCompleted && (
              <span className="text-emerald-500 flex items-center space-x-1">
                <CheckCircle size={12} />
                <span>Completed</span>
              </span>
            )}
            {isFailed && (
              <span
                className="text-red-400 flex items-center space-x-1 cursor-help"
                title={getStatusText()}
              >
                <AlertTriangle size={12} />
                <span>Failed</span>
              </span>
            )}
            {isNonResumablePaused ? (
              <span className="text-amber-400 flex items-center space-x-1" title="Server does not support resuming — will restart from beginning">
                <WifiOff size={11} />
                <span>Not Resumable</span>
              </span>
            ) : isPaused ? (
              <span className="text-neutral-500">Paused</span>
            ) : null}
            {isDownloading && (
              <span className="text-indigo-400 font-extrabold">{percentage}%</span>
            )}
          </div>
        </div>

        {/* Unified progress bar */}
        <div className="w-full bg-neutral-950 h-1.5 rounded-full overflow-hidden border border-neutral-900/60">
          <div
            className={`h-full rounded-full transition-all duration-300 ease-out ${
              isCompleted
                ? "bg-gradient-to-r from-emerald-500 to-teal-400"
                : isFailed
                ? "bg-red-500"
                : isNonResumablePaused
                ? "bg-amber-500/60"
                : isPaused
                ? "bg-neutral-600"
                : "bg-gradient-to-r from-indigo-500 to-cyan-400 shadow-[0_0_8px_rgba(99,102,241,0.5)]"
            }`}
            style={{ width: `${percentage}%` }}
          ></div>
        </div>
      </div>

      {/* Non-resumable warning banner */}
      {isNonResumablePaused && (
        <div className="flex items-start space-x-2 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2 mt-1">
          <WifiOff size={12} className="text-amber-400 mt-0.5 shrink-0" />
          <p className="text-[10px] text-amber-400/80 leading-relaxed">
            This server <span className="font-bold">does not support resuming</span>. The partial download was discarded.
            Click <RefreshCw size={9} className="inline" /> to restart the download from the beginning.
          </p>
        </div>
      )}

      {/* Multi-thread Chunks Progress visualization */}
      {isDownloading && chunks.length > 0 && (
        <div className="flex flex-col space-y-1 mt-1 border-t border-neutral-800/40 pt-2">
          <div className="flex justify-between text-[9px] text-neutral-500 font-mono tracking-wider">
            <span>DYNAMIC SEGMENTS ({chunks.length})</span>
            <span>ZERO-MERGE PIPELINE</span>
          </div>
          <div className="flex h-[5px] w-full bg-neutral-950 rounded-sm overflow-hidden gap-[1px] border border-neutral-900/30">
            {chunks.map((chunk) => {
              const chunkTotal = chunk.end - chunk.start;
              const chunkProgress = chunk.current - chunk.start;
              const chunkPct = chunkTotal > 0 ? (chunkProgress / chunkTotal) * 100 : 0;
              return (
                <div
                  key={chunk.id}
                  className="flex-1 bg-neutral-900/40 h-full relative overflow-hidden"
                  title={`Segment ${chunk.id}: ${Math.round(chunkPct)}%`}
                >
                  <div
                    className="bg-indigo-500 h-full transition-all duration-200"
                    style={{ width: `${chunkPct}%` }}
                  ></div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showPauseWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 font-sans select-none text-neutral-300">
          <div className="relative w-full max-w-sm bg-[#14141a] border border-amber-500/20 rounded-xl shadow-2xl overflow-hidden flex flex-col">
            <div className="bg-[#1b1b22] px-4 py-3 border-b border-neutral-800 flex items-center space-x-2 text-amber-400 font-bold shrink-0">
              <AlertTriangle size={16} />
              <span className="text-xs font-bold text-neutral-100 tracking-wide">
                Warning: Non-Resumable Download
              </span>
            </div>

            <div className="p-4 space-y-2 text-xs leading-relaxed text-neutral-300">
              <p>
                This download <span className="text-amber-400 font-semibold">cannot be resumed</span> because the server does not support range requests.
              </p>
              <p className="text-neutral-400">
                If you pause, the download progress will be completely lost and the partial file will be deleted. You will have to start downloading from the beginning.
              </p>
            </div>

            <div className="bg-[#16161c] px-4 py-3 border-t border-neutral-800/80 flex items-center justify-end space-x-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowPauseWarning(false)}
                className="px-4 py-2 bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-400 rounded-lg text-xs font-semibold transition duration-150"
              >
                Cancel / Keep Downloading
              </button>
              <button
                type="button"
                onClick={() => handlePause(true)}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg text-xs transition duration-150 shadow-lg shadow-amber-600/20"
              >
                Pause & Discard
              </button>
            </div>
          </div>
        </div>
      )}

      <DownloadDetailsModal
        isOpen={isDetailsOpen}
        item={item}
        onClose={() => setIsDetailsOpen(false)}
        onRefresh={onRefresh}
      />
    </div>
  );
};
