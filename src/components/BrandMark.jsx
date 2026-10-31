import React from 'react';

/**
 * The Film Club Lens aperture mark.
 *
 * Drawn inline so it stays crisp at any size and inherits `currentColor` from the
 * surface it sits on (the gradient badge is provided by `.brand-mark`). The same
 * geometry is rasterised for the favicon and PWA icons by `npm run brand:assets`,
 * so the in-app mark and the browser icon can never drift apart.
 */
function irisPath(radius) {
  const points = [];
  for (let index = 0; index < 6; index += 1) {
    const angle = (Math.PI / 180) * (60 * index);
    points.push(`${(32 + radius * Math.cos(angle)).toFixed(2)} ${(32 + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${points.join(' L')} Z`;
}

// Below ~24 px the hairline strokes anti-alias away, so the mark thickens — the
// same adjustment `scripts/brand-assets.mjs` applies to the 16 px favicon.
const SMALL = { ring: 16.6, ringWidth: 4.6, iris: irisPath(8.6), irisWidth: 4, core: 4 };
const LARGE = { ring: 16.4, ringWidth: 3.6, iris: irisPath(8.1), irisWidth: 3.2, core: 3.5 };

export function BrandMark({ size = 20, title, className = '' }) {
  const mark = size < 24 ? SMALL : LARGE;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <circle cx="32" cy="32" r={mark.ring} fill="none" stroke="currentColor" strokeWidth={mark.ringWidth} />
      <path d={mark.iris} fill="none" stroke="currentColor" strokeWidth={mark.irisWidth} strokeLinejoin="round" />
      <circle cx="32" cy="32" r={mark.core} fill="#42d9d0" />
    </svg>
  );
}

export default BrandMark;
