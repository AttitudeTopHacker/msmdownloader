import React, { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { X, Play, Pause, AlertTriangle, Copy, Check } from "lucide-react";
import { formatBytes, formatSpeed, formatEta } from "../utils/format";

interface ChunkInfo {
  id: number;
  start: number;
  end: number;
  current: number;
  speed: number;
}

interface ProgressPayload {
  id: string;
  file_name: string;
  file_path: string;
  downloaded: number;
  total_size: number;
  status: any;
  speed: number;
  eta: number;
  chunks: ChunkInfo[];
}

interface DownloadDetailsModalProps {
  isOpen: boolean;
  item: any; // initial item
  onClose: () => void;
  onRefresh: () => void;
}

export const DownloadDetailsModal: React.FC<DownloadDetailsModalProps> = ({
  isOpen,
  item,
  onClose,
  onRefresh,
}) => {
  const [downloaded, setDownloaded] = useState(item.downloaded);
  const [totalSize, setTotalSize] = useState(item.total_size);
  const [speed, setSpeed] = useState(item.speed);
  const [eta, setEta] = useState(item.eta);
  const [status, setStatus] = useState(item.status);
  const [chunks, setChunks] = useState<ChunkInfo[]>(item.chunks || []);
  const [fileName, setFileName] = useState(item.file_name);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_filePath, setFilePath] = useState(item.file_path);
  const [activeTab, setActiveTab] = useState<"status" | "limiter" | "completion">("status");
  const [resumable, setResumable] = useState<boolean>(item.resumable !== false);
  const [showPauseWarning, setShowPauseWarning] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyUrl = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(item.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy URL:", err);
    }
  };

  // Window coordinates and sizes
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [size, setSize] = useState({ width: 576, height: 500 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0 });
  const [startSize, setStartSize] = useState({ w: 0, h: 0 });

  const itemId = item.id;

  // Center window on mount or open
  useEffect(() => {
    if (isOpen) {
      const defaultWidth = 576;
      const defaultHeight = 520;
      const x = (window.innerWidth - defaultWidth) / 2;
      const y = (window.innerHeight - defaultHeight) / 2;
      setPosition({ x, y });
      setSize({ width: defaultWidth, height: defaultHeight });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    // Sync initial item details
    setDownloaded(item.downloaded);
    setTotalSize(item.total_size);
    setStatus(item.status);
    setChunks(item.chunks || []);
    setSpeed(item.speed || 0);
    setEta(item.eta || -1);
    setFileName(item.file_name);
    setFilePath(item.file_path);
    setResumable(item.resumable !== false);

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
            typeof newStatus === "object"
          ) {
            setSpeed(0);
            setEta(-1);
            onRefresh();
          }
        }
      );
    };

    setupListeners();

    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenState) unlistenState();
    };
  }, [isOpen, itemId, item, onRefresh]);

  // Window drag and resize listener effects
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;
        setPosition({
          x: Math.max(0, Math.min(window.innerWidth - size.width, startPos.x + dx)),
          y: Math.max(0, Math.min(window.innerHeight - 50, startPos.y + dy)),
        });
      }

      if (isResizing) {
        const dw = e.clientX - resizeStart.x;
        const dh = e.clientY - resizeStart.y;
        setSize({
          width: Math.max(480, Math.min(window.innerWidth - position.x, startSize.w + dw)),
          height: Math.max(380, Math.min(window.innerHeight - position.y, startSize.h + dh)),
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    if (isDragging || isResizing) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, isResizing, dragStart, startPos, resizeStart, startSize, position.x, position.y, size.width]);

  if (!isOpen) return null;

  const handleMouseDownHeader = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button")) return; // skip on buttons

    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setStartPos({ x: position.x, y: position.y });
    e.preventDefault();
  };

  const handleMouseDownResize = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsResizing(true);
    setResizeStart({ x: e.clientX, y: e.clientY });
    setStartSize({ w: size.width, h: size.height });
    e.preventDefault();
    e.stopPropagation();
  };

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

  const isDownloading = status === "Downloading";
  const isCompleted = status === "Completed";
  const isFailed = typeof status === "object" && status !== null && "Failed" in status;
  const isPaused = status === "Paused";

  const getStatusString = () => {
    if (isDownloading) return "Receiving data...";
    if (isCompleted) return "Completed";
    if (isPaused) return "Paused";
    if (isFailed) return `Error: ${status.Failed}`;
    return "Queued";
  };

  const percentage = totalSize > 0 ? ((downloaded / totalSize) * 100).toFixed(2) : "0.00";
  const hasResumeCapability = resumable;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/35 backdrop-blur-[1px] pointer-events-auto">
      {/* Absolute draggable & resizable window container */}
      <div
        style={{
          position: "absolute",
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: `${size.width}px`,
          height: `${size.height}px`,
        }}
        className="bg-[#14141a] border border-neutral-800 rounded-lg shadow-2xl overflow-hidden flex flex-col select-none"
      >
        {/* Draggable Title Bar */}
        <div
          onMouseDown={handleMouseDownHeader}
          className="bg-[#1b1b22] px-4 py-2 border-b border-neutral-800 flex items-center justify-between cursor-move select-none"
        >
          <span className="text-xs font-bold text-neutral-100 tracking-wide truncate max-w-[80%]">
            {percentage}% Download status - {fileName}
          </span>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-white transition duration-150 focus:outline-none"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab Header (IDM Styled) */}
        <div className="flex border-b border-neutral-800/80 bg-[#16161c] px-4 pt-1 shrink-0">
          <button
            onClick={() => setActiveTab("status")}
            className={`px-4 py-1.5 text-xs font-semibold rounded-t border-t border-x transition-colors duration-150 ${
              activeTab === "status"
                ? "bg-[#14141a] border-neutral-800 text-indigo-400 -mb-[1px]"
                : "border-transparent bg-transparent text-neutral-500 hover:text-neutral-300"
            }`}
          >
            Download status
          </button>
          <button
            onClick={() => setActiveTab("limiter")}
            className={`px-4 py-1.5 text-xs font-semibold rounded-t border-t border-x transition-colors duration-150 ${
              activeTab === "limiter"
                ? "bg-[#14141a] border-neutral-800 text-indigo-400 -mb-[1px]"
                : "border-transparent bg-transparent text-neutral-500 hover:text-neutral-300"
            }`}
          >
            Speed Limiter
          </button>
          <button
            onClick={() => setActiveTab("completion")}
            className={`px-4 py-1.5 text-xs font-semibold rounded-t border-t border-x transition-colors duration-150 ${
              activeTab === "completion"
                ? "bg-[#14141a] border-neutral-800 text-indigo-400 -mb-[1px]"
                : "border-transparent bg-transparent text-neutral-500 hover:text-neutral-300"
            }`}
          >
            Options on completion
          </button>
        </div>

        {/* Tab Body (Flex-1 and scrollable) */}
        <div className="p-4 flex-1 space-y-4 text-xs overflow-y-auto min-h-0">
          {activeTab === "status" && (
            <>
              {/* Fields Table */}
              <div className="grid grid-cols-4 gap-y-2 border border-neutral-800/60 p-3 bg-neutral-950/20 rounded-md shrink-0">
                <span className="text-neutral-500 font-semibold">URL:</span>
                <span className="col-span-3 flex items-center justify-between text-neutral-200 font-mono truncate" title={item.url}>
                  <span className="truncate pr-2">{item.url}</span>
                  <button
                    onClick={handleCopyUrl}
                    className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white transition duration-150 shrink-0 focus:outline-none"
                    title="Copy URL"
                  >
                    {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                  </button>
                </span>

                <span className="text-neutral-500 font-semibold">Status:</span>
                <span className="col-span-3 text-neutral-200 font-bold flex items-center space-x-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${isDownloading ? "bg-indigo-500 animate-ping" : isCompleted ? "bg-emerald-500" : "bg-neutral-600"}`}></span>
                  <span>{getStatusString()}</span>
                </span>

                <span className="text-neutral-500 font-semibold">File size:</span>
                <span className="col-span-3 text-neutral-200 font-mono">
                  {totalSize > 0 ? formatBytes(totalSize) : "Unknown"}
                </span>

                <span className="text-neutral-500 font-semibold">Downloaded:</span>
                <span className="col-span-3 text-neutral-200 font-mono">
                  {formatBytes(downloaded)} ({percentage} %)
                </span>

                <span className="text-neutral-500 font-semibold">Transfer rate:</span>
                <span className="col-span-3 text-indigo-400 font-bold font-mono">
                  {isDownloading ? formatSpeed(speed) : "0 B/s"}
                </span>

                <span className="text-neutral-500 font-semibold">Time left:</span>
                <span className="col-span-3 text-neutral-200 font-mono">
                  {isDownloading ? formatEta(eta) : "--"}
                </span>

                <span className="text-neutral-500 font-semibold">Resume capability:</span>
                <span className="col-span-3 font-semibold">
                  {hasResumeCapability ? (
                    <span className="text-emerald-500">Yes</span>
                  ) : (
                    <span className="text-red-400">No (Fallback mode)</span>
                  )}
                </span>
              </div>

              {/* Overall Progress Bar with Sliding Shimmer (IDM Style) */}
              <div className="space-y-1 shrink-0">
                <div className="relative w-full bg-neutral-950 border border-neutral-800/80 rounded-md h-5 overflow-hidden p-[1px]">
                  <div
                    className={`h-full transition-all duration-500 ease-out relative overflow-hidden rounded-md ${
                      isCompleted
                        ? "bg-gradient-to-r from-emerald-500 to-teal-400"
                        : isFailed
                        ? "bg-red-500"
                        : isPaused
                        ? "bg-neutral-600"
                        : "bg-gradient-to-r from-indigo-500 to-cyan-400 shadow-[0_0_12px_rgba(99,102,241,0.4)]"
                    }`}
                    style={{ width: `${percentage}%` }}
                  >
                    {isDownloading && (
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/35 to-transparent -translate-x-full animate-shimmer" style={{ animationDuration: '1.2s' }} />
                    )}
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono font-bold text-white tracking-wide mix-blend-difference">
                    {percentage}%
                  </div>
                </div>
              </div>

              {/* Segmented connections bar */}
              <div className="space-y-1.5 shrink-0">
                <p className="text-[10px] text-neutral-400 font-bold uppercase tracking-wider">
                  Start positions and download progress by connections:
                </p>
                <div className="flex h-6 w-full bg-neutral-950 border border-neutral-800 rounded overflow-hidden p-[2px] gap-[1px]">
                  {!resumable ? (
                    <div className="w-full h-full bg-amber-500/10 flex items-center justify-center text-[10px] text-amber-500 font-semibold font-mono tracking-wider">
                      SINGLE CONNECTION MODE (NON-RESUMABLE)
                    </div>
                  ) : chunks.length > 0 ? (
                    chunks.map((chunk) => {
                      const total = chunk.end - chunk.start;
                      const progress = chunk.current - chunk.start;
                      const pct = total > 0 ? (progress / total) * 100 : 0;
                      const isChunkActive = isDownloading && chunk.current <= chunk.end && chunk.speed > 0;
                      return (
                        <div key={chunk.id} className="flex-1 bg-neutral-900/60 h-full relative overflow-hidden">
                          <div
                            className="bg-indigo-600/90 h-full absolute left-0 top-0 transition-all duration-300"
                            style={{ width: `${pct}%` }}
                          ></div>
                          {isChunkActive && pct > 0 && pct < 100 && (
                            <div
                              className="w-1.5 h-full bg-cyan-400 absolute transition-all duration-300 shadow-[0_0_6px_rgba(34,211,238,0.8)] animate-pulse"
                              style={{ left: `calc(${pct}% - 2px)` }}
                            ></div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] text-neutral-600 italic">
                      No connections mapped yet
                    </div>
                  )}
                </div>
              </div>

              {/* Connections Detail Table (Takes remainder height) */}
              <div className="space-y-1.5 flex-1 flex flex-col min-h-0">
                <p className="text-[10px] text-neutral-400 font-bold uppercase tracking-wider shrink-0">
                  Active connection threads detail:
                </p>
                <div className="border border-neutral-800 rounded-md overflow-hidden bg-neutral-950/20 flex-1 overflow-y-auto">
                  <table className="w-full text-left border-collapse font-mono text-[10px]">
                    <thead>
                      <tr className="bg-neutral-900/80 border-b border-neutral-800 text-neutral-400 sticky top-0 z-10">
                        <th className="px-3 py-1.5 font-bold">N.</th>
                        <th className="px-3 py-1.5 font-bold">Downloaded</th>
                        <th className="px-3 py-1.5 font-bold">Info / Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800/40">
                      {chunks.length > 0 ? (
                        chunks.map((chunk, index) => {
                          const progress = chunk.current - chunk.start;
                          const isCompleted = chunk.current > chunk.end;
                          const isRunning = isDownloading && !isCompleted;
                          return (
                            <tr
                              key={chunk.id}
                              className={`hover:bg-neutral-900/30 transition duration-150 ${
                                isCompleted ? "text-emerald-500/80" : isRunning ? "text-indigo-400" : "text-neutral-500"
                              }`}
                            >
                              <td className="px-3 py-1.5">{index + 1}</td>
                              <td className="px-3 py-1.5">{formatBytes(progress)}</td>
                              <td className="px-3 py-1.5">
                                {isCompleted
                                  ? "Completed"
                                  : isRunning
                                  ? `Receiving data... (${formatSpeed(speed / chunks.length)})`
                                  : isPaused
                                  ? "Paused"
                                  : "Waiting..."}
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={3} className="px-3 py-4 text-center text-neutral-600 italic">
                            Waiting for download to begin...
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {activeTab === "limiter" && (
            <div className="flex flex-col items-center justify-center p-8 text-center space-y-3">
              <AlertTriangle className="text-indigo-400 w-10 h-10" />
              <h4 className="text-sm font-bold text-neutral-200">Speed Limiter (Pro feature)</h4>
              <p className="text-neutral-500 max-w-sm text-xs">
                Restrict maximum download speeds to reserve internet bandwidth for web browsing and gaming. This is currently disabled.
              </p>
            </div>
          )}

          {activeTab === "completion" && (
            <div className="flex flex-col items-center justify-center p-8 text-center space-y-3">
              <AlertTriangle className="text-indigo-400 w-10 h-10" />
              <h4 className="text-sm font-bold text-neutral-200">On Completion Options</h4>
              <p className="text-neutral-500 max-w-sm text-xs">
                Configure auto-actions (like shutdown computer, close app, or open file) when the download terminates successfully.
              </p>
            </div>
          )}
        </div>

        {/* Action Footer */}
        <div className="bg-[#16161c] px-4 py-3 border-t border-neutral-800/80 flex items-center justify-end space-x-2 shrink-0">
          {isDownloading ? (
            <button
              onClick={() => handlePause()}
              className="flex items-center space-x-1.5 px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded text-xs transition duration-150 focus:outline-none"
            >
              <Pause size={12} />
              <span>Pause</span>
            </button>
          ) : isCompleted ? (
            <span className="text-xs text-emerald-500 font-semibold px-4 py-1.5">
              Completed successfully
            </span>
          ) : (
            <button
              onClick={handleResume}
              className="flex items-center space-x-1.5 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs transition duration-150 focus:outline-none"
            >
              <Play size={12} />
              <span>Resume</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-300 rounded text-xs transition duration-150 focus:outline-none"
          >
            Hide details
          </button>
        </div>

        {/* Corner Resize Grip Handle */}
        <div
          onMouseDown={handleMouseDownResize}
          className="absolute bottom-0 right-0 w-3.5 h-3.5 cursor-se-resize flex items-end justify-end p-[1px] select-none z-20 hover:text-indigo-400 text-neutral-600"
          title="Drag to resize"
        >
          <svg width="6" height="6" viewBox="0 0 6 6" fill="currentColor">
            <line x1="5" y1="0" x2="0" y2="5" stroke="currentColor" strokeWidth="1.2" />
            <line x1="5" y1="2" x2="2" y2="5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </div>
      </div>

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
    </div>
  );
};
