// Cute "dog ate my homework" illustration — a stylized husky face with a torn
// piece of paper in its mouth. Used whenever we surface an error to the user,
// so even bad news has a little personality. Uses brand CSS vars so it
// recolors with the admin's chosen theme.
//
// Props:
//   size:  "sm" | "md" | "lg" (default "md")
//   className: extra wrapper classes

export default function DogAteHomework({ size = "md", className = "" }) {
  const dims = { sm: 64, md: 120, lg: 200 }[size] || 120;
  return (
    <div className={`inline-block ${className}`} aria-hidden>
      <svg
        viewBox="0 0 200 200"
        width={dims}
        height={dims}
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: "block" }}
      >
        {/* Paper sticking out behind the head (back layer) */}
        <g transform="translate(115 100) rotate(18)">
          <rect x="0" y="0" width="55" height="70" rx="2"
                fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1.5" />
          {/* Torn jagged top edge */}
          <path d="M0,0 L8,6 L14,1 L22,8 L30,3 L38,9 L46,2 L55,7 L55,0 Z"
                fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1.5" strokeLinejoin="round" />
          {/* Ink lines on the paper */}
          <line x1="6"  y1="22" x2="48" y2="22" stroke="#94a3b8" strokeWidth="1.5" />
          <line x1="6"  y1="32" x2="44" y2="32" stroke="#94a3b8" strokeWidth="1.5" />
          <line x1="6"  y1="42" x2="48" y2="42" stroke="#94a3b8" strokeWidth="1.5" />
          <line x1="6"  y1="52" x2="38" y2="52" stroke="#94a3b8" strokeWidth="1.5" />
        </g>

        {/* Head — main rounded silhouette */}
        <ellipse cx="90" cy="105" rx="62" ry="55" fill="#475569" />
        {/* White muzzle / chest blaze */}
        <path d="M50,115 Q90,165 130,115 Q130,140 90,150 Q50,140 50,115 Z" fill="#e2e8f0" />
        <ellipse cx="90" cy="148" rx="22" ry="12" fill="#cbd5e1" />

        {/* Ears — pointy husky-style */}
        <path d="M40,75  L30,40  L60,65  Z" fill="#334155" />
        <path d="M140,75 L150,40 L120,65 Z" fill="#334155" />
        <path d="M44,72  L38,52  L56,66  Z" fill="#f472b6" opacity="0.55" />
        <path d="M136,72 L142,52 L124,66 Z" fill="#f472b6" opacity="0.55" />

        {/* Eyes — closed/embarrassed (^ ^) */}
        <path d="M62,95  q8,-10 16,0" stroke="#0f172a" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        <path d="M102,95 q8,-10 16,0" stroke="#0f172a" strokeWidth="3.5" fill="none" strokeLinecap="round" />

        {/* Eyebrows raised (guilty look) */}
        <path d="M60,82  q8,-3 16,0" stroke="#0f172a" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M104,82 q8,-3 16,0" stroke="#0f172a" strokeWidth="2" fill="none" strokeLinecap="round" />

        {/* Nose */}
        <ellipse cx="90" cy="118" rx="9" ry="7" fill="#0f172a" />
        <ellipse cx="87" cy="115" rx="2" ry="1.5" fill="#f8fafc" opacity="0.6" />

        {/* Paper edge poking out of mouth (front layer — between teeth) */}
        <g transform="translate(72 128) rotate(-5)">
          <rect x="0" y="0" width="36" height="10" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1" />
          {/* Tear marks on the edge sticking out */}
          <path d="M0,10 L4,7 L8,10 L12,7 L16,10 L20,7 L24,10 L28,7 L32,10 L36,7 L36,10 Z"
                fill="#cbd5e1" />
        </g>
      </svg>
    </div>
  );
}
