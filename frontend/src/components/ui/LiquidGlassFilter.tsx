/**
 * The refraction half of the glass surfaces.
 *
 * CSS blur softens what is behind an element; it never bends it. A real pane
 * is a lens — it displaces what you see through it — and that displacement is
 * the whole difference between frosted glass and liquid glass.
 *
 * CSS has no refraction primitive, so this does it with an SVG filter:
 * feTurbulence generates a smooth noise field, and feDisplacementMap uses that
 * field to push each backdrop pixel sideways by an amount read from the noise.
 * The result is a gentle, organic warp rather than a uniform smear.
 *
 * Rendered once at the app root. The filter is referenced from globals.css as
 * `backdrop-filter: ... url(#liquid-glass)`, which only Chromium honours today
 * — Safari and Firefox drop that declaration and fall back to the plain blur
 * declared immediately before it, so they get frosted glass and no breakage.
 */
export default function LiquidGlassFilter() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      style={{ position: "absolute", width: 0, height: 0, pointerEvents: "none" }}
    >
      <defs>
        {/* Panels: large, slow waves — the surface should feel thick, not busy. */}
        <filter id="liquid-glass" x="-12%" y="-12%" width="124%" height="124%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.006 0.009"
            numOctaves="2"
            seed="7"
            result="noise"
          />
          {/* Unsmoothed turbulence displaces pixel-to-pixel and reads as grain.
              Blurring the map first is what turns it into flowing distortion. */}
          <feGaussianBlur in="noise" stdDeviation="6" result="smooth" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="smooth"
            scale="22"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        {/* Stat tiles: smaller surfaces, so tighter waves and a shorter throw,
            otherwise the same warp swamps a tile the size of two words. */}
        <filter id="liquid-glass-sm" x="-12%" y="-12%" width="124%" height="124%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.012 0.016"
            numOctaves="2"
            seed="3"
            result="noise"
          />
          <feGaussianBlur in="noise" stdDeviation="4" result="smooth" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="smooth"
            scale="12"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}
