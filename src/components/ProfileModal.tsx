import React, { useState, useEffect } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { X, User, Phone, Mail, Image, LogOut, Save, Upload } from "lucide-react";

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: { email: string; name: string; profile_pic: string; mobile?: string };
  onUpdate: (updatedUser: { email: string; name: string; profile_pic: string; mobile?: string }) => void;
  onLogout: () => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  user,
  onUpdate,
  onLogout,
}) => {
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [profilePic, setProfilePic] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName(user.name || "");
      setMobile(user.mobile || "");
      setProfilePic(user.profile_pic || "");
      setError("");
      setSuccess("");
      
      // Load current profile from DB if connected
      const fetchDbProfile = async () => {
        try {
          const dbProfile = await invoke<any>("get_user_profile", { email: user.email });
          if (dbProfile) {
            setName(dbProfile.name || "");
            setMobile(dbProfile.mobile || "");
            setProfilePic(dbProfile.profile_pic || "");
            
            // Sync local storage if db is more up to date
            onUpdate({
              email: user.email,
              name: dbProfile.name || "",
              profile_pic: dbProfile.profile_pic || "",
              mobile: dbProfile.mobile || "",
            });
          }
        } catch (e) {
          console.warn("Failed to load profile from Supabase (using offline cache):", e);
        }
      };
      
      fetchDbProfile();
    }
  }, [isOpen, user]);

  if (!isOpen) return null;

  const handleBrowseLocalFile = async () => {
    try {
      const selectedPath = await invoke<string | null>("select_image_file");
      if (selectedPath) {
        // Convert to file src url
        const webviewUrl = convertFileSrc(selectedPath);
        setProfilePic(webviewUrl);
      }
    } catch (e) {
      console.error("Failed to select local profile picture:", e);
      setError("Failed to open file picker.");
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);

    try {
      const trimmedName = name.trim();
      const trimmedMobile = mobile.trim();
      
      if (!trimmedName) {
        throw new Error("Name cannot be empty.");
      }

      // 1. Sync to Supabase in Rust backend
      await invoke("save_user_profile", {
        email: user.email,
        name: trimmedName,
        mobile: trimmedMobile,
        profilePic: profilePic,
      });

      // 2. Update frontend state and localStorage
      onUpdate({
        email: user.email,
        name: trimmedName,
        profile_pic: profilePic,
        mobile: trimmedMobile,
      });

      setSuccess("Profile saved successfully!");
      setTimeout(() => {
        setSuccess("");
      }, 3000);
    } catch (e: any) {
      console.error(e);
      setError(e.message || e.toString());
    } finally {
      setSaving(false);
    }
  };

  const handleLogoutClick = async () => {
    try {
      await invoke("set_active_user_session", { email: null });
      onLogout();
      onClose();
    } catch (e: any) {
      console.error(e);
      setError("Logout failed: " + e.toString());
    }
  };

  // Avatar initials generator
  const getInitials = (n: string) => {
    const parts = n.split(" ");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return n.slice(0, 2).toUpperCase();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 font-sans select-none text-neutral-300">
      <div className="relative w-full max-w-md bg-[#14141a] border border-neutral-800 rounded-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Glow top border */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500"></div>

        {/* Header */}
        <div className="bg-[#1b1b22] px-4 py-3 border-b border-neutral-800 flex items-center justify-between">
          <span className="text-xs font-bold text-neutral-100 tracking-wide flex items-center space-x-2">
            <User size={14} className="text-indigo-400" />
            <span>Profile Management</span>
          </span>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-white transition duration-150"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} className="p-6 space-y-4 text-xs">
          {error && (
            <div className="p-3 bg-red-950/40 border border-red-500/30 text-red-400 rounded-lg">
              {error}
            </div>
          )}
          {success && (
            <div className="p-3 bg-emerald-950/40 border border-emerald-500/30 text-emerald-400 rounded-lg">
              {success}
            </div>
          )}

          {/* Profile Picture Circle */}
          <div className="flex flex-col items-center space-y-2 pb-2">
            <div className="relative group">
              {profilePic ? (
                <img
                  src={profilePic}
                  alt="Profile"
                  className="w-16 h-16 rounded-full object-cover border-2 border-indigo-500/30 group-hover:border-indigo-500 transition-colors"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center text-lg font-bold text-white border-2 border-indigo-500/30">
                  {getInitials(name || user.name || user.email)}
                </div>
              )}
            </div>
            <span className="text-[10px] text-neutral-500">Profile Picture</span>
          </div>

          {/* Email (Read Only) */}
          <div className="space-y-1">
            <label className="text-[9px] font-bold text-neutral-500 uppercase tracking-wider flex items-center space-x-1">
              <Mail size={10} />
              <span>Email Address (Not Editable)</span>
            </label>
            <input
              type="email"
              value={user.email}
              readOnly
              className="w-full bg-[#1b1b22] border border-neutral-800 text-neutral-500 rounded-lg p-2.5 outline-none cursor-not-allowed font-mono"
            />
          </div>

          {/* Name */}
          <div className="space-y-1">
            <label className="text-[9px] font-bold text-neutral-400 uppercase tracking-wider flex items-center space-x-1">
              <User size={10} />
              <span>Full Name</span>
            </label>
            <input
              type="text"
              placeholder="Enter name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 focus:border-indigo-500 rounded-lg p-2.5 text-neutral-200 outline-none transition"
              required
            />
          </div>

          {/* Mobile */}
          <div className="space-y-1">
            <label className="text-[9px] font-bold text-neutral-400 uppercase tracking-wider flex items-center space-x-1">
              <Phone size={10} />
              <span>Mobile Number</span>
            </label>
            <input
              type="text"
              placeholder="e.g. +91 9876543210"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 focus:border-indigo-500 rounded-lg p-2.5 text-neutral-200 outline-none transition"
            />
          </div>

          {/* Profile Pic Source */}
          <div className="space-y-1.5">
            <label className="text-[9px] font-bold text-neutral-400 uppercase tracking-wider flex items-center space-x-1">
              <Image size={10} />
              <span>Profile Picture Path / URL</span>
            </label>
            <div className="flex space-x-2">
              <input
                type="text"
                placeholder="Paste image URL here"
                value={profilePic}
                onChange={(e) => setProfilePic(e.target.value)}
                className="flex-1 bg-neutral-900 border border-neutral-800 focus:border-indigo-500 rounded-lg p-2.5 text-neutral-200 outline-none transition font-mono text-[10px]"
              />
              <button
                type="button"
                onClick={handleBrowseLocalFile}
                className="px-3 py-2 bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-300 font-semibold rounded-lg flex items-center space-x-1.5 transition"
                title="Select image file from computer"
              >
                <Upload size={12} />
                <span>Browse</span>
              </button>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-neutral-800/80 flex items-center justify-between">
            <button
              type="button"
              onClick={handleLogoutClick}
              className="px-3 py-2 bg-red-650/10 border border-red-900/40 hover:bg-red-600 hover:text-white text-red-400 font-semibold rounded-lg flex items-center space-x-1.5 transition duration-150"
            >
              <LogOut size={12} />
              <span>Log Out</span>
            </button>

            <div className="flex space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-neutral-900 border border-[#262630] hover:bg-neutral-800 text-neutral-300 rounded text-xs transition"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded text-xs flex items-center space-x-1.5 shadow-lg shadow-indigo-600/25 transition"
              >
                <Save size={12} />
                <span>{saving ? "Saving..." : "Save Settings"}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
