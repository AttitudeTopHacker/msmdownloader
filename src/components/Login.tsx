import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { LogIn, Globe, ShieldCheck, User } from "lucide-react";

interface LoginProps {
  onLoginSuccess: (session: { email: string; name: string; profile_pic: string; access_token?: string }) => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Listen for the redirect callback event from Tauri local HTTP server
    let unlistenAuth: (() => void) | null = null;

    const setupListener = async () => {
      unlistenAuth = await listen<any>("auth-session-received", (event) => {
        console.log("Auth session received:", event.payload);
        const { email, name, profile_pic, access_token } = event.payload;
        onLoginSuccess({ email, name, profile_pic, access_token });
      });
    };

    setupListener();

    return () => {
      if (unlistenAuth) unlistenAuth();
    };
  }, [onLoginSuccess]);

  const handleGoogleLogin = async () => {
    setError("");
    setLoading(true);
    try {
      // Supabase Google Auth URL
      const supabaseAuthUrl =
        "https://iqwrdwnyxfrdpzxjjhda.supabase.co/auth/v1/authorize?provider=google&redirect_to=http://127.0.0.1:9999/auth-callback&queryParams=prompt%3Dselect_account";
      
      // Open in default browser
      await openUrl(supabaseAuthUrl);
    } catch (e: any) {
      console.error(e);
      setError("Failed to open login page. Make sure the app is fully running.");
      setLoading(false);
    }
  };

  const handleLocalLogin = async () => {
    setError("");
    setLoading(true);
    try {
      const localEmail = "local_user";
      await invoke("set_active_user_session", { email: localEmail });
      
      onLoginSuccess({
        email: localEmail,
        name: "Guest User",
        profile_pic: "",
      });
    } catch (e: any) {
      setError(e.toString());
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#09090d] font-sans select-none overflow-hidden">
      {/* Background glowing gradients */}
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none animate-pulse"></div>
      <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none animate-pulse"></div>

      <div className="relative w-full max-w-md mx-4 p-8 bg-[#121217]/80 border border-neutral-800/80 rounded-2xl shadow-2xl backdrop-blur-md overflow-hidden flex flex-col items-center">
        {/* Glow Line Top */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-indigo-500 to-transparent"></div>

        {/* Logo Badge */}
        <div className="relative flex items-center justify-center w-16 h-16 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-2xl shadow-lg shadow-indigo-600/25 mb-6">
          <ShieldCheck className="text-white w-9 h-9" />
          <div className="absolute inset-0 border border-white/20 rounded-2xl"></div>
        </div>

        {/* Titles */}
        <h1 className="text-2xl font-bold text-white tracking-wide text-center">
          MSM Downloader
        </h1>
        <p className="text-xs text-neutral-400 mt-1.5 mb-8 text-center max-w-[280px]">
          Synchronize your downloads using Google Sign-In, or continue offline in Local Mode.
        </p>

        {error && (
          <div className="w-full mb-4 p-3 bg-red-950/40 border border-red-500/30 text-red-400 rounded-lg text-xs leading-normal">
            {error}
          </div>
        )}

        <div className="w-full space-y-3.5">
          {/* Google OAuth Login Button */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-xs transition duration-200 shadow-lg shadow-indigo-600/20 flex items-center justify-center space-x-2.5 active:scale-[0.98] cursor-pointer animate-pulse"
          >
            <LogIn size={16} />
            <span>{loading ? "Opening Login..." : "Login with Google"}</span>
          </button>

          {/* Continue without Login */}
          <button
            type="button"
            onClick={handleLocalLogin}
            disabled={loading}
            className="w-full py-3 px-4 bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-300 font-semibold rounded-xl text-xs transition duration-200 flex items-center justify-center space-x-2.5 active:scale-[0.98] cursor-pointer"
          >
            <User size={15} className="text-neutral-400" />
            <span>Continue as Guest</span>
          </button>
        </div>

        {/* Footer info */}
        <div className="mt-8 text-[10px] text-neutral-500 flex items-center space-x-1.5">
          <Globe size={12} className="text-neutral-600" />
          <span>Local server running on port 9999</span>
        </div>
      </div>
    </div>
  );
};
