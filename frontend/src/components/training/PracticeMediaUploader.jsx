// Shared photo/video capture control. Upload behavior is owned by callers;
// this component remains presentational and keeps the Phase 6 10 MB limit.
import { useRef } from "react";

const DEFAULT_VIDEO_MAX_MB = 10;

export default function PracticeMediaUploader({ photo, onPhotoChange, videoId, videoName, onVideoUpload, uploadingVideo, onVideoClear, allowVideo = true, allowPhoto = true, testid, videoMaxMb = DEFAULT_VIDEO_MAX_MB }) {
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
    if (f.size > videoMaxMb * 1024 * 1024) {
      onVideoUpload(null, `Video too large — keep it under ${videoMaxMb} MB (≈ 10-15 seconds).`);
      return;
    }
    onVideoUpload(f);
  };

  return (
    <div className={`grid gap-3 ${allowVideo && allowPhoto ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"}`} data-testid={testid}>
      {allowPhoto && (
        <div className="rounded-xl border border-shBorder/45 bg-black/10 p-3">
          <label className="text-[9px] font-black uppercase tracking-[0.14em] text-shTextMuted block mb-2">Photo</label>
          {photo ? (
            <div className="relative overflow-hidden rounded-xl border border-shBorder/55 bg-black/25 min-h-[116px]">
              <img src={photo} alt="Practice upload" className="w-full h-36 sm:h-40 object-cover"/>
              <button onClick={() => onPhotoChange("")} type="button" data-testid={testid ? `${testid}-photo-clear` : undefined}
                      className="absolute top-2 right-2 bg-black/75 backdrop-blur text-shText rounded-lg w-8 h-8 grid place-items-center text-[10px] border border-white/10">
                <i className="fas fa-times"/>
              </button>
            </div>
          ) : (
            <button onClick={() => photoRef.current?.click()} type="button" data-testid={testid ? `${testid}-photo-pick` : undefined}
                    className="w-full min-h-[96px] rounded-xl border border-dashed border-shBorder/70 bg-black/10 text-shTextMuted hover:border-shSecondary/40 hover:text-shSecondary transition flex flex-col items-center justify-center gap-2">
              <i className="fas fa-camera text-[17px]"/><span className="text-[11px] font-black">Add photo</span>
            </button>
          )}
        </div>
      )}
      {allowVideo && (
        <div className="rounded-xl border border-shBorder/45 bg-black/10 p-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <label className="text-[9px] font-black uppercase tracking-[0.14em] text-shTextMuted block">Video</label>
            <span className="text-[9px] text-shTextMuted">max {videoMaxMb} MB</span>
          </div>
          {videoId ? (
            <div className="min-h-[96px] rounded-xl border border-shPrimary/30 bg-shPrimary/[0.055] p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-shPrimary/10 border border-shPrimary/25 grid place-items-center shrink-0"><i className="fas fa-video text-shPrimary text-[13px]"/></div>
              <span className="truncate flex-1 text-[12px] text-shText font-bold"><i className="fas fa-check text-shPrimary mr-1.5"/>{videoName || "Attached"}</span>
              <button onClick={onVideoClear} type="button" className="w-8 h-8 rounded-lg border border-shBorder/55 text-shTextMuted hover:text-shDanger grid place-items-center" data-testid={testid ? `${testid}-video-clear` : undefined}><i className="fas fa-times"/></button>
            </div>
          ) : (
            <button onClick={() => videoRef.current?.click()} type="button" disabled={uploadingVideo} data-testid={testid ? `${testid}-video-pick` : undefined}
                    className="w-full min-h-[96px] rounded-xl border border-dashed border-shBorder/70 bg-black/10 text-shTextMuted hover:border-shSecondary/40 hover:text-shSecondary transition flex flex-col items-center justify-center gap-2 disabled:opacity-50">
              <i className={`fas ${uploadingVideo ? "fa-spinner fa-spin" : "fa-video"} text-[17px]`}/><span className="text-[11px] font-black">{uploadingVideo ? "Uploading…" : "Add video"}</span>
            </button>
          )}
        </div>
      )}
      {allowPhoto && <input ref={photoRef} type="file" accept="image/*" onChange={pickPhoto} className="hidden"/>}
      {allowVideo && <input ref={videoRef} type="file" accept="video/*" onChange={pickVideo} className="hidden"/>}
    </div>
  );
}
