// Training UI Phase 3 — shared photo/video capture control for the practice
// completion flow. Presentational only: the caller supplies onPhotoPick /
// onVideoPick handlers that do the actual upload (reusing the existing
// homework video-upload endpoint), so this component never talks to the
// network directly and never invents a new storage path.
import { useRef } from "react";

const VIDEO_MAX_MB = 15;

export default function PracticeMediaUploader({ photo, onPhotoChange, videoId, videoName, onVideoUpload, uploadingVideo, onVideoClear, testid }) {
  const photoRef = useRef(null);
  const videoRef = useRef(null);

  const pickPhoto = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => onPhotoChange(reader.result || "");
    reader.readAsDataURL(f);
  };

  const pickVideo = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > VIDEO_MAX_MB * 1024 * 1024) {
      onVideoUpload(null, `Video too large — keep it under ${VIDEO_MAX_MB} MB (≈ 10-15 seconds).`);
      return;
    }
    onVideoUpload(f);
  };

  return (
    <div className="grid grid-cols-2 gap-2" data-testid={testid}>
      <div>
        <label className="text-[10px] font-black uppercase tracking-widest text-shTextMuted block">Photo</label>
        {photo ? (
          <div className="mt-1 relative inline-block">
            <img src={photo} alt="" className="max-h-20 rounded border border-shBorder"/>
            <button onClick={() => onPhotoChange("")} type="button" data-testid={testid ? `${testid}-photo-clear` : undefined}
                    className="absolute top-1 right-1 bg-black/80 text-shText rounded-full w-5 h-5 flex items-center justify-center text-[10px]">
              <i className="fas fa-times"/>
            </button>
          </div>
        ) : (
          <button onClick={() => photoRef.current?.click()} type="button" data-testid={testid ? `${testid}-photo-pick` : undefined}
                  className="mt-1 w-full bg-black/20 border border-shBorder rounded px-3 py-2 text-[12px] text-shTextMuted font-black uppercase tracking-widest hover:border-shSecondary">
            <i className="fas fa-camera mr-1"/>Add photo
          </button>
        )}
      </div>
      <div>
        <label className="text-[10px] font-black uppercase tracking-widest text-shTextMuted block">Video</label>
        {videoId ? (
          <div className="mt-1 bg-shPrimary/10 border border-shPrimary/30 rounded px-2.5 py-2 text-[12px] text-shPrimary font-black uppercase tracking-widest flex items-center justify-between gap-2">
            <span className="truncate"><i className="fas fa-check mr-1"/>{videoName || "Attached"}</span>
            <button onClick={onVideoClear} type="button" className="text-shTextMuted hover:text-shDanger text-[12px]" data-testid={testid ? `${testid}-video-clear` : undefined}>
              <i className="fas fa-times"/>
            </button>
          </div>
        ) : (
          <button onClick={() => videoRef.current?.click()} type="button" disabled={uploadingVideo} data-testid={testid ? `${testid}-video-pick` : undefined}
                  className="mt-1 w-full bg-black/20 border border-shBorder rounded px-3 py-2 text-[12px] text-shTextMuted font-black uppercase tracking-widest hover:border-shSecondary disabled:opacity-50">
            <i className={`fas ${uploadingVideo ? "fa-spinner fa-spin" : "fa-video"} mr-1`}/>{uploadingVideo ? "Uploading…" : "Add video"}
          </button>
        )}
      </div>
      <input ref={photoRef} type="file" accept="image/*" onChange={pickPhoto} className="hidden"/>
      <input ref={videoRef} type="file" accept="video/*" onChange={pickVideo} className="hidden"/>
    </div>
  );
}
