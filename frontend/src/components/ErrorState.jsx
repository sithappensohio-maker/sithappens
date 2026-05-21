// Reusable error state with the "dog ate my homework" illustration. Use this
// in place of plain error cards/banners whenever we need to tell the user
// something broke — keeps the bad-news moments friendly + on-brand.
//
// Props:
//   title:    main headline (defaults to "The dog ate our homework")
//   message:  supporting copy (string or React node)
//   detail:   raw error string (optional — shown in a small mono block)
//   action:   optional { label, onClick }
//   compact:  if true, smaller padding + inline style for use mid-page
//
// Example:
//   <ErrorState message="Couldn't load bookings." detail={err.message}
//               action={{label:"Try again", onClick: reload}} />

import DogAteHomework from "./DogAteHomework";

const FUNNY_TITLES = [
  "The dog ate our homework",
  "Buddy chewed the page",
  "Looks like Rex got the file",
  "Caught Daisy with the homework",
  "Something got fetched a little too hard",
];

function randomTitle() {
  return FUNNY_TITLES[Math.floor(Math.random() * FUNNY_TITLES.length)];
}

export default function ErrorState({
  title,
  message = "We'll be right back. Try again in a moment.",
  detail = "",
  action = null,
  compact = false,
}) {
  const headline = title || randomTitle();
  return (
    <div
      className={`flex flex-col items-center text-center ${
        compact ? "p-4 gap-2" : "p-8 gap-4"
      }`}
      data-testid="error-state"
    >
      <DogAteHomework size={compact ? "sm" : "md"} />
      <h3 className={`font-black text-white uppercase italic tracking-tight ${compact ? "text-base" : "text-xl"}`}>
        {headline}
      </h3>
      <p className={`text-gray-400 font-black uppercase tracking-widest ${compact ? "text-[14px]" : "text-[14px]"} max-w-md`}>
        {message}
      </p>
      {detail && (
        <pre className="text-[14px] text-red-400 bg-bgBase border border-bgHover rounded p-2 mt-2 max-w-md w-full text-left whitespace-pre-wrap break-all">
          {detail}
        </pre>
      )}
      {action && (
        <button
          onClick={action.onClick}
          data-testid="error-state-action"
          className="mt-2 bg-shGreen text-bgHeader px-6 py-2.5 rounded font-black text-[15px] uppercase tracking-widest shadow-lg"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
