export function HeroIllustration({ className = '' }: { className?: string }): JSX.Element {
  return (
    <svg
      className={`hero-art ${className}`}
      viewBox="0 0 560 250"
      role="img"
      aria-label="A purple folder with a house inside, connected to a desktop computer by a warm ribbon"
    >
      <defs>
        <linearGradient id="folderFill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--illus-folder-light)" />
          <stop offset="100%" stopColor="var(--illus-folder)" />
        </linearGradient>
        <linearGradient id="ribbonFill" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--illus-ribbon-light)" />
          <stop offset="55%" stopColor="var(--illus-ribbon)" />
          <stop offset="100%" stopColor="var(--illus-ribbon-deep)" />
        </linearGradient>
        <linearGradient id="screenFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--illus-cream)" />
          <stop offset="100%" stopColor="var(--illus-cream-deep)" />
        </linearGradient>
      </defs>

      <path
        d="M20 196C118 249 300 262 522 176l20 30C322 293 118 277 8 222Z"
        fill="url(#ribbonFill)"
        stroke="var(--illus-outline)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="M35 203c104 42 274 48 478-24"
        fill="none"
        stroke="var(--illus-ribbon-shine)"
        strokeWidth="7"
        strokeLinecap="round"
        opacity="0.55"
      />

      <g stroke="var(--illus-outline)" strokeWidth="3" strokeLinejoin="round">
        <path
          d="M46 78l7 16 16 7-16 7-7 16-7-16-16-7 16-7Z"
          fill="var(--illus-sparkle)"
        />
        <path
          d="M482 48l5 12 12 5-12 5-5 12-5-12-12-5 12-5Z"
          fill="var(--illus-sparkle-soft)"
        />
        <path
          d="M512 128l4 9 9 4-9 4-4 9-4-9-9-4 9-4Z"
          fill="var(--illus-sparkle)"
        />
        <path
          d="M368 54l4 9 9 4-9 4-4 9-4-9-9-4 9-4Z"
          fill="var(--illus-sparkle-soft)"
        />
      </g>

      <g stroke="var(--illus-outline)" strokeWidth="3" strokeLinejoin="round">
        <path
          d="M156 150c0-8 6-14 14-14h58l12-14h70c8 0 14 6 14 14v28H156Z"
          fill="var(--illus-folder-deep)"
        />
        <path
          d="M178 173 206 112h83l30 61Z"
          fill="var(--illus-folder)"
          stroke="none"
          opacity="0.45"
        />

        <g>
          <path d="M201 112l47-48 48 48Z" fill="var(--illus-roof)" />
          <path
            d="M214 109h68v56c0 4-3 7-7 7h-54c-4 0-7-3-7-7Z"
            fill="var(--illus-cream)"
          />
          <path d="M197 112l51-47 51 47" fill="none" strokeLinecap="round" />
          <rect
            x="260"
            y="121"
            width="14"
            height="15"
            rx="2"
            fill="var(--illus-window)"
            strokeWidth="2"
          />
          <rect
            x="239"
            y="143"
            width="16"
            height="23"
            rx="2"
            fill="var(--illus-door)"
            strokeWidth="2"
          />
          <path d="M238 123h-12v12h12" fill="none" strokeWidth="2.5" />
        </g>

        <path
          d="M156 174c0-9 7-16 16-16h136c9 0 16 7 16 16v48c0 9-7 16-16 16H172c-9 0-16-7-16-16Z"
          fill="url(#folderFill)"
        />
        <path
          d="M157 190c53 12 115 13 166 2"
          fill="none"
          stroke="var(--illus-folder-shine)"
          strokeWidth="5"
          strokeLinecap="round"
          opacity="0.7"
        />
        <rect
          x="207"
          y="201"
          width="70"
          height="27"
          rx="9"
          fill="var(--illus-label)"
          strokeWidth="2.5"
        />
        <path d="M223 215h38" stroke="var(--illus-label-line)" strokeWidth="2.5" strokeLinecap="round" />
        <path
          d="M172 236c32 4 88 5 120 0"
          fill="none"
          stroke="var(--illus-folder-deep)"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.5"
        />
      </g>

      <g stroke="var(--illus-outline)" strokeWidth="3" strokeLinejoin="round">
        <rect
          x="398"
          y="93"
          width="118"
          height="102"
          rx="15"
          fill="var(--illus-folder-deep)"
        />
        <rect
          x="408"
          y="103"
          width="98"
          height="78"
          rx="9"
          fill="url(#screenFill)"
        />
        <path
          d="M414 172c15-9 24-24 31-42"
          fill="none"
          stroke="var(--illus-screen-accent)"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path
          d="M414 143h15M414 154h22"
          fill="none"
          stroke="var(--illus-screen-accent)"
          strokeWidth="4"
          strokeLinecap="round"
          opacity="0.55"
        />
        <path
          d="M446 158l7 8 14-20"
          fill="none"
          stroke="var(--illus-screen-accent)"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path
          d="M447 194h20v22h-20Z"
          fill="var(--illus-folder-deep)"
        />
        <rect
          x="417"
          y="215"
          width="79"
          height="13"
          rx="6"
          fill="var(--illus-folder)"
        />
      </g>

      <path
        d="M492 216c3 5 6 8 11 10-5 2-8 5-11 10-2-5-5-8-10-10 5-2 8-5 10-10Z"
        fill="var(--illus-sparkle)"
        stroke="var(--illus-outline)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="343" cy="238" r="5" fill="var(--illus-dot)" opacity="0.8" />
      <circle cx="383" cy="222" r="3" fill="var(--illus-dot)" opacity="0.45" />
    </svg>
  )
}

export function FolderBadgeArt(): JSX.Element {
  return (
    <svg viewBox="0 0 120 96" role="img" aria-label="A folder with a house inside">
      <defs>
        <linearGradient id="miniFolder" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--illus-folder-light)" />
          <stop offset="100%" stopColor="var(--illus-folder)" />
        </linearGradient>
      </defs>
      <path
        d="M14 40h50l9-10h30c5 0 9 4 9 9v40c0 5-4 9-9 9H23c-5 0-9-4-9-9Z"
        fill="var(--illus-folder-deep)"
        stroke="var(--illus-outline)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="M40 39l20-20 21 20Z"
        fill="var(--illus-roof)"
        stroke="var(--illus-outline)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M46 38h29v20H46Z"
        fill="var(--illus-cream)"
        stroke="var(--illus-outline)"
        strokeWidth="2.5"
      />
      <path
        d="M14 52c22 5 61 6 98 1v30c0 4-3 7-7 7H21c-4 0-7-3-7-7Z"
        fill="url(#miniFolder)"
        stroke="var(--illus-outline)"
        strokeWidth="3"
      />
      <rect
        x="43"
        y="64"
        width="34"
        height="13"
        rx="4"
        fill="var(--illus-label)"
        stroke="var(--illus-outline)"
        strokeWidth="2"
      />
    </svg>
  )
}
