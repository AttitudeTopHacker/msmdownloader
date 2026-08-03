import React, { useEffect, useState } from "react";

interface SplashProps {
  onComplete: () => void;
}

export const Splash: React.FC<SplashProps> = ({ onComplete }) => {
  const [fade, setFade] = useState("opacity-100");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Simulate loading progress
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          return 100;
        }
        return prev + 2;
      });
    }, 30);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (progress === 100) {
      const timeout = setTimeout(() => {
        setFade("opacity-0 scale-95 pointer-events-none");
        const exitTimeout = setTimeout(onComplete, 500);
        return () => clearTimeout(exitTimeout);
      }, 600);
      return () => clearTimeout(timeout);
    }
  }, [progress, onComplete]);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#050508] transition-all duration-700 ease-out ${fade}`}
    >
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-gradient-to-tr from-purple-600/10 to-cyan-500/10 rounded-full blur-3xl opacity-75"></div>

      {/* Main Logo Graphic */}
      <div className="relative flex flex-col items-center">
        {/* Animated logo badge */}
        <div className="relative w-24 h-24 mb-6 flex items-center justify-center">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-indigo-600 to-cyan-500 opacity-20 blur-lg animate-pulse"></div>
          <div className="absolute inset-0 rounded-2xl border border-indigo-500/30 bg-neutral-950/80 backdrop-blur-md flex items-center justify-center shadow-2xl">
            <span
              className="text-3xl font-black tracking-tight bg-gradient-to-tr from-indigo-300 via-purple-200 to-cyan-300 bg-clip-text text-transparent select-none animate-[pulse_3s_infinite] hover:scale-110 hover:rotate-3 transition-transform duration-300"
              style={{
                textShadow: "1px 1px 0px #312e81, 2px 2px 0px #4338ca, 3px 3px 0px #06b6d4, 4px 4px 8px rgba(0,0,0,0.6)",
                fontFamily: "system-ui, sans-serif"
              }}
            >
              MSM
            </span>
          </div>
        </div>

        {/* Text Logo */}
        <h1 className="text-3xl font-extrabold tracking-wider bg-gradient-to-r from-white via-indigo-200 to-cyan-300 bg-clip-text text-transparent">
          MSM DOWNLOADER
        </h1>
        <p className="text-xs text-neutral-500 mt-2 font-mono tracking-widest uppercase">
          Engine Version 2.0
        </p>
      </div>

      {/* Progress bar container */}
      <div className="w-64 mt-12 bg-neutral-900 border border-neutral-800/40 h-1.5 rounded-full overflow-hidden relative">
        <div
          className="bg-gradient-to-r from-indigo-500 to-cyan-400 h-full rounded-full transition-all duration-100 ease-out"
          style={{ width: `${progress}%` }}
        ></div>
      </div>

      {/* Footer info */}
      <div className="absolute bottom-8 text-neutral-600 text-[10px] font-mono tracking-wide">
        SECURE CHUNKING ACTIVE • MEMMAP ENABLED
      </div>
    </div>
  );
};
