/**
 * Network's add button: a little antlered serpent, no one in particular, with
 * a pink + on it. Drawn here so it's the app's own. It wiggles when tapped
 * (not for anyone who has asked their phone for less motion).
 */
export function NetworkCritter({ size = 46 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="critter overflow-visible">
      <defs>
        <linearGradient id="critter-body" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#1fb98a" />
          <stop offset="1" stopColor="#6ff5c4" />
        </linearGradient>
      </defs>
      {/* The body: one S-curve from the tail up to the neck. */}
      <path d="M12 56 C 3 50, 12 40, 23 44 S 40 51, 40 38 S 32 27, 37 22" fill="none" stroke="#0b4a39" strokeWidth="10" strokeLinecap="round" />
      <path d="M12 56 C 3 50, 12 40, 23 44 S 40 51, 40 38 S 32 27, 37 22" fill="none" stroke="url(#critter-body)" strokeWidth="7" strokeLinecap="round" />
      {/* Spots down its back. */}
      <circle cx="16" cy="45.5" r="1.3" fill="#c9ffe9" />
      <circle cx="30" cy="47" r="1.3" fill="#c9ffe9" />
      <circle cx="38.5" cy="40" r="1.3" fill="#c9ffe9" />
      {/* Antlers. */}
      <path d="M38.5 14 L35 5.5 M36.6 9.5 L31.5 7.5 M43.5 13 L46 4.5 M44.7 8.6 L49.5 6.8" stroke="#ffcf2e" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      {/* The head, the snout, an eye with a glint, a pink cheek. */}
      <ellipse cx="42" cy="19.5" rx="9" ry="7.5" fill="url(#critter-body)" stroke="#0b4a39" strokeWidth="1.5" />
      <ellipse cx="49.5" cy="21.5" rx="4.2" ry="3.2" fill="#8ff8d2" stroke="#0b4a39" strokeWidth="1.2" />
      <circle cx="43" cy="17.5" r="2.1" fill="#0b1a2a" />
      <circle cx="43.7" cy="16.8" r="0.7" fill="#fff" />
      <circle cx="46.2" cy="23" r="1.6" fill="#f565c0" opacity="0.75" />
      {/* The +: what tapping it does. */}
      <g>
        <circle cx="52" cy="50" r="9.5" fill="#f565c0" stroke="#ffe3f6" strokeWidth="2" />
        <path d="M52 45 V55 M47 50 H57" stroke="#2a0820" strokeWidth="3" strokeLinecap="round" />
      </g>
    </svg>
  );
}

// Pines across the scene, as [x, height] for each layer: placed by hand, so it's the same forest every time.
const BACK = [[10, 70], [42, 85], [70, 66], [100, 92], [132, 74], [160, 88], [192, 70], [222, 95], [252, 76], [284, 90], [312, 68], [344, 86], [372, 72], [398, 84]];
const MID = [[-4, 96], [30, 118], [64, 100], [96, 124], [134, 104], [176, 120], [214, 98], [250, 126], [290, 106], [326, 122], [366, 100], [402, 118]];
const FRONT = [[14, 132], [58, 150], [112, 128], [168, 146], [236, 134], [300, 152], [356, 130], [404, 146]];
const FIREFLIES = [[62, 150], [118, 120], [168, 170], [226, 140], [276, 116], [330, 160], [90, 182], [250, 186], [360, 132]];

/** One pine: three stacked triangles on a trunk, its tip `height` above the ground. */
function pine(x: number, height: number, ground: number, width: number) {
  const top = ground - height;
  const tiers = [0, 0.3, 0.58].map(t => {
    const y = top + height * t;
    const w = width * (0.55 + t * 0.9);
    return `M${x} ${y} L${x - w / 2} ${y + height * 0.42} L${x + w / 2} ${y + height * 0.42} Z`;
  });
  return tiers.join(' ');
}

/** A night forest in greens, with a moon and fireflies: behind Network's map before anyone's on it. */
export function ForestScene() {
  const ground = 220;
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 220" preserveAspectRatio="xMidYMax slice" aria-hidden>
      <defs>
        <linearGradient id="forest-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#03120d" />
          <stop offset="0.65" stopColor="#0b2d21" />
          <stop offset="1" stopColor="#123d2b" />
        </linearGradient>
        <radialGradient id="forest-moon" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#f2ffd8" />
          <stop offset="0.6" stopColor="#d9f7b0" stopOpacity="0.9" />
          <stop offset="1" stopColor="#d9f7b0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="220" fill="url(#forest-sky)" />
      {/* Up in the corner, clear of the words over the scene. */}
      <circle cx="334" cy="20" r="22" fill="url(#forest-moon)" opacity="0.35" />
      <circle cx="334" cy="20" r="10" fill="#eaffcf" opacity="0.85" />
      <path d={BACK.map(([x, h]) => pine(x, h, ground - 20, h * 0.5)).join(' ')} fill="#0f3d2d" />
      <path d={MID.map(([x, h]) => pine(x, h, ground - 6, h * 0.52)).join(' ')} fill="#16583d" />
      <path d={FRONT.map(([x, h]) => pine(x, h, ground + 8, h * 0.5)).join(' ')} fill="#1f7a4d" />
      <rect y={ground - 10} width="400" height="10" fill="#0a2619" />
      {FIREFLIES.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.8" fill="#fff27a" className="firefly" style={{ animationDelay: `${(i * 0.37) % 2.4}s` }} />
      ))}
    </svg>
  );
}
