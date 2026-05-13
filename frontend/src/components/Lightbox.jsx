import { useEffect } from "react";

export default function Lightbox({ photos, index, onClose, onIndex }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index < photos.length - 1) onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, photos.length, onClose, onIndex]);

  if (!photos?.length) return null;

  return (
    <div className="fixed inset-0 bg-black/95 z-[60] flex items-center justify-center" onClick={onClose} data-testid="lightbox">
      <button onClick={(e)=>{e.stopPropagation(); onClose();}} className="absolute top-4 right-6 text-white/70 hover:text-white text-3xl"><i className="fas fa-times" /></button>
      {index > 0 && (
        <button onClick={(e)=>{e.stopPropagation(); onIndex(index-1);}}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-white/60 hover:text-white text-3xl" data-testid="lightbox-prev"><i className="fas fa-chevron-left" /></button>
      )}
      <img src={photos[index]} alt="" className="max-h-[90vh] max-w-[92vw] rounded shadow-2xl" onClick={(e)=>e.stopPropagation()} />
      {index < photos.length - 1 && (
        <button onClick={(e)=>{e.stopPropagation(); onIndex(index+1);}}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white/60 hover:text-white text-3xl" data-testid="lightbox-next"><i className="fas fa-chevron-right" /></button>
      )}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/60 text-[13px] font-black uppercase tracking-widest">{index+1} / {photos.length}</div>
    </div>
  );
}
