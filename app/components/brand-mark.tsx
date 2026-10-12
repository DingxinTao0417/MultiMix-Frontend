// Product brand mark: the delivered MultiMix badge (public/brand/
// multimix-logo-badge-black.svg). Brand spec §2.2 fixes the logo as black and
// white with no gradient, and §2.4 assigns the badge to <=48px placements,
// which is every in-product use (header switcher, navigation panel, sign-in).
// Workspace and auth screens share this one glyph so it cannot drift again.
export default function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="16 16 160 160"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect data-part="plate" x="16" y="16" width="160" height="160" rx="38" fill="#151515" />
      <g transform="translate(96,96) scale(0.62) translate(-96,-96) translate(11.35,20.86) scale(0.814)">
        <g fill="none" stroke="#FFFFFF" strokeLinecap="round" strokeLinejoin="round">
          <path d="M28 146V50c0-10 12-15 19-8l39 39 39-39c7-7 19-2 19 8v96" strokeWidth={20} />
          <path data-part="forward-arrow" d="M164 63l20 33-20 33" strokeWidth={12} />
        </g>
      </g>
    </svg>
  );
}
