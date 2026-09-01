import { motion } from 'framer-motion';
import { getLampColor, getLampFilamentColor } from '@/lib/lampVisuals';

interface Props {
  /** 0–100, how "hot" the lamp currently is (see lampVisuals for the color ramp). */
  progress: number;
  /** Bulb diameter in px. Defaults to the boot-screen's original size. */
  size?: number;
}

// The bulb + glow + filament visual shared by the one-time boot LoadingScreen
// and the looping LampBulb ambient background — same look, different callers
// drive `progress` differently (a one-shot ramp to 100 vs. a breathing loop).
export default function LampBulb({ progress, size = 140 }: Props) {
  const color = getLampColor(progress);
  const filColor = getLampFilamentColor(progress);
  const glowSize = size * (60 + progress * 3) / 140;
  const glowOpacity = 0.05 + progress * 0.007;
  const scale = size / 140;

  return (
    <div className="relative flex flex-col items-center" style={{ width: size, height: size }}>
      {/* Ambient glow */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: glowSize * 2.5,
          height: glowSize * 2.5,
          left: '50%',
          top: '50%',
          x: '-50%',
          y: '-50%',
          background: `radial-gradient(circle, ${color}30 0%, ${color}10 40%, transparent 70%)`,
          filter: `blur(${(20 + progress * 0.5) * scale}px)`,
        }}
      />

      {/* LED bulb */}
      <motion.div
        className="relative rounded-full border-2"
        style={{
          width: size,
          height: size,
          borderColor: `${color}44`,
          background: `radial-gradient(circle at 45% 40%, ${color}44, ${color}11 70%, transparent)`,
          boxShadow: `0 0 ${(30 + progress * 1.5) * scale}px ${(10 + progress * 0.8) * scale}px ${color}${Math.round(glowOpacity * 255).toString(16).padStart(2, '0')}`,
        }}
        animate={{ scale: [1, 1.015, 1] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      >
        {/* Glass highlight */}
        <div
          className="absolute rounded-full opacity-10"
          style={{ top: '8%', left: '16%', width: '28%', height: '17%', background: `linear-gradient(135deg, white 0%, transparent 100%)` }}
        />

        {/* Filament SVG — detailed coil */}
        <svg viewBox="0 0 140 140" className="absolute inset-0 w-full h-full">
          <line x1="55" y1="120" x2="60" y2="75" stroke={filColor} strokeWidth="1.5" opacity={0.3 + progress * 0.004} />
          <line x1="85" y1="120" x2="80" y2="75" stroke={filColor} strokeWidth="1.5" opacity={0.3 + progress * 0.004} />

          <path
            d="M60 75 C58 65, 62 58, 60 50 C58 42, 64 36, 62 30 C60 24, 66 20, 70 18 C74 20, 80 24, 78 30 C76 36, 82 42, 80 50 C78 58, 82 65, 80 75"
            fill="none"
            stroke={filColor}
            strokeWidth={2.5 + progress * 0.02}
            strokeLinecap="round"
            opacity={0.5 + progress * 0.005}
            filter={progress > 30 ? `drop-shadow(0 0 ${3 + progress * 0.1}px ${filColor})` : undefined}
          />

          <path
            d="M64 70 C63 62, 66 56, 64 48 C63 42, 68 38, 66 32 C65 27, 70 23, 70 22 C70 23, 75 27, 74 32 C72 38, 77 42, 76 48 C74 56, 77 62, 76 70"
            fill="none"
            stroke={filColor}
            strokeWidth={1.5 + progress * 0.015}
            strokeLinecap="round"
            opacity={0.3 + progress * 0.007}
            filter={progress > 20 ? `drop-shadow(0 0 ${5 + progress * 0.15}px ${filColor})` : undefined}
          />

          {progress > 15 && (
            <ellipse
              cx="70"
              cy="46"
              rx={8 + progress * 0.1}
              ry={18 + progress * 0.15}
              fill={filColor}
              opacity={0.05 + progress * 0.003}
              filter={`blur(${4 + progress * 0.1}px)`}
            />
          )}
        </svg>

        {/* Base / screw cap */}
        <div
          className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-b-lg"
          style={{
            width: size * (50 / 140),
            height: size * (20 / 140),
            background: `linear-gradient(180deg, hsl(0,0%,25%) 0%, hsl(0,0%,15%) 100%)`,
            borderTop: `2px solid ${color}33`,
          }}
        />
      </motion.div>
    </div>
  );
}
