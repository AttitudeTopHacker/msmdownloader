import React, { useState } from "react";
import { AlertTriangle, Edit2, Check } from "lucide-react";

export interface CollisionData {
  temp_id: string;
  url: string;
  dest_dir: string;
  file_name: string;
  disk_exists: boolean;
  software_exists: boolean;
  existing_id: string | null;
}

interface CollisionDialogProps {
  data: CollisionData;
  onResolve: (choice: string, newFilename: string | null) => void;
}

export const CollisionDialog: React.FC<CollisionDialogProps> = ({
  data,
  onResolve,
}) => {
  const [choice, setChoice] = useState<string>("numbered");
  const [isRenaming, setIsRenaming] = useState<boolean>(false);
  const [customName, setCustomName] = useState<string>(data.file_name);

  const handleOk = () => {
    const finalName = customName !== data.file_name && customName.trim().length > 0 ? customName.trim() : null;
    onResolve(choice, finalName);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 font-sans select-none text-neutral-300 animate-backdrop-in">
      <div className="relative w-full max-w-md bg-[#13131a] border border-neutral-800/80 rounded-2xl shadow-2xl shadow-black/80 overflow-hidden flex flex-col animate-modal-zoom">
        {/* Header */}
        <div className="bg-[#1a1a24] px-5 py-4 border-b border-neutral-800/60 flex items-center space-x-3 text-amber-400 shrink-0">
          <div className="p-2 bg-amber-500/10 rounded-lg border border-amber-500/20">
            <AlertTriangle size={20} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-neutral-100 tracking-wide">
              File Already Exists!
            </h3>
            <p className="text-[10px] text-neutral-500 font-mono mt-0.5 truncate max-w-[280px]">
              Dir: {data.dest_dir}
            </p>
          </div>
        </div>

        {/* File Name Display / Rename Input */}
        <div className="px-5 py-4 bg-neutral-900/40 border-b border-neutral-800/30 flex flex-col space-y-2">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
              File Name
            </span>
            {!isRenaming && (
              <button
                onClick={() => setIsRenaming(true)}
                className="flex items-center space-x-1 text-[10px] text-indigo-400 hover:text-indigo-300 font-bold transition duration-150"
              >
                <Edit2 size={10} />
                <span>RENAME</span>
              </button>
            )}
          </div>

          {isRenaming ? (
            <div className="flex items-center space-x-2 mt-1">
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-indigo-500 font-mono"
                placeholder="Enter new filename"
                autoFocus
              />
              <button
                onClick={() => setIsRenaming(false)}
                className="p-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition duration-150"
                title="Save Name"
              >
                <Check size={12} />
              </button>
            </div>
          ) : (
            <p className="text-xs text-indigo-300 font-mono font-semibold break-all leading-relaxed pr-2">
              {customName}
            </p>
          )}
        </div>

        {/* Collision Info Alert Panel */}
        <div className="px-5 py-3 text-[10px] leading-relaxed border-b border-neutral-800/30 bg-indigo-950/10 text-neutral-400 space-y-1">
          {data.disk_exists && (
            <p className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              <span>A file with this name physically exists in your downloads folder.</span>
            </p>
          )}
          {data.software_exists && (
            <p className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
              <span>A task with this filename is already present in your download list.</span>
            </p>
          )}
        </div>

        {/* Options List */}
        <div className="p-5 flex flex-col space-y-3">
          {/* Option 1: Numbered name */}
          <label className="flex items-start space-x-3.5 cursor-pointer group text-xs">
            <input
              type="radio"
              name="collision-choice"
              value="numbered"
              checked={choice === "numbered"}
              onChange={() => setChoice("numbered")}
              className="mt-0.5 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-neutral-900 focus:ring-2 bg-neutral-900 border-neutral-800 rounded-full"
            />
            <div className="flex-1">
              <p className="font-semibold text-neutral-200 group-hover:text-white transition duration-150">
                Add with numbered file name
              </p>
              <p className="text-[10px] text-neutral-500 mt-0.5">
                Automatically appends a suffix, e.g. "filename (1).ext"
              </p>
            </div>
          </label>

          {/* Option 2: Overwrite file */}
          <label
            className={`flex items-start space-x-3.5 cursor-pointer group text-xs ${
              !data.disk_exists ? "opacity-40 cursor-not-allowed" : ""
            }`}
          >
            <input
              type="radio"
              name="collision-choice"
              value="overwrite"
              disabled={!data.disk_exists}
              checked={choice === "overwrite"}
              onChange={() => setChoice("overwrite")}
              className="mt-0.5 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-neutral-900 focus:ring-2 bg-neutral-900 border-neutral-800 rounded-full"
            />
            <div className="flex-1">
              <p className="font-semibold text-neutral-200 group-hover:text-white transition duration-150">
                Overwrite existing file
              </p>
              <p className="text-[10px] text-neutral-500 mt-0.5">
                Replace the physical file on your disk.
              </p>
            </div>
          </label>

          {/* Option 3: Overwrite & remove old link */}
          <label
            className={`flex items-start space-x-3.5 cursor-pointer group text-xs ${
              !data.disk_exists && !data.software_exists ? "opacity-40 cursor-not-allowed" : ""
            }`}
          >
            <input
              type="radio"
              name="collision-choice"
              value="overwrite_remove_old"
              disabled={!data.disk_exists && !data.software_exists}
              checked={choice === "overwrite_remove_old"}
              onChange={() => setChoice("overwrite_remove_old")}
              className="mt-0.5 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-neutral-900 focus:ring-2 bg-neutral-900 border-neutral-800 rounded-full"
            />
            <div className="flex-1">
              <p className="font-semibold text-neutral-200 group-hover:text-white transition duration-150">
                Overwrite existing file and remove old download link
              </p>
              <p className="text-[10px] text-neutral-500 mt-0.5">
                Replaces the file and deletes the duplicate download link from software.
              </p>
            </div>
          </label>

          {/* Option 4: Update link */}
          <label
            className={`flex items-start space-x-3.5 cursor-pointer group text-xs ${
              !data.software_exists ? "opacity-40 cursor-not-allowed" : ""
            }`}
          >
            <input
              type="radio"
              name="collision-choice"
              value="update_link"
              disabled={!data.software_exists}
              checked={choice === "update_link"}
              onChange={() => setChoice("update_link")}
              className="mt-0.5 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-neutral-900 focus:ring-2 bg-neutral-900 border-neutral-800 rounded-full"
            />
            <div className="flex-1">
              <p className="font-semibold text-neutral-200 group-hover:text-white transition duration-150">
                Update existing download link
              </p>
              <p className="text-[10px] text-neutral-500 mt-0.5">
                Keep the same item in lists but update it with the new URL and restart.
              </p>
            </div>
          </label>

          {/* Option 5: Cancel */}
          <label className="flex items-start space-x-3.5 cursor-pointer group text-xs">
            <input
              type="radio"
              name="collision-choice"
              value="cancel"
              checked={choice === "cancel"}
              onChange={() => setChoice("cancel")}
              className="mt-0.5 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-neutral-900 focus:ring-2 bg-neutral-900 border-neutral-800 rounded-full"
            />
            <div className="flex-1">
              <p className="font-semibold text-neutral-200 group-hover:text-white transition duration-150">
                Cancel download
              </p>
              <p className="text-[10px] text-neutral-500 mt-0.5">
                Do not add or start this download task.
              </p>
            </div>
          </label>
        </div>

        {/* Footer Actions */}
        <div className="bg-[#121218] px-5 py-3.5 border-t border-neutral-800/80 flex items-center justify-end space-x-2 shrink-0">
          <button
            type="button"
            onClick={() => onResolve("cancel", null)}
            className="px-4 py-2 bg-neutral-900 border border-[#22222a] hover:bg-neutral-800 text-neutral-400 hover:text-white rounded-lg text-xs font-semibold transition duration-150 focus:outline-none"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleOk}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-xs transition duration-150 shadow-lg shadow-indigo-600/20 focus:outline-none focus:ring-2 focus:ring-indigo-600"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};
