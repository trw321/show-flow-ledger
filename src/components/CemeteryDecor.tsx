import { motion } from 'framer-motion';

export function FogDrift({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      animate={{ y: [0, -15, 0], scale: [1, 1.15, 1], opacity: [0.3, 0.6, 0.3] }}
      transition={{ duration: 4, delay, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}

export function BatSilhouette({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <motion.svg
      viewBox="0 0 64 32"
      className={className}
      initial={{ opacity: 0 }}
      animate={{ x: [0, 18, 0, -18, 0], y: [0, -8, 0, 6, 0], opacity: [0, 0.7, 0.7, 0.7, 0] }}
      transition={{ duration: 9, delay, repeat: Infinity, ease: 'easeInOut' }}
    >
      <motion.path
        d="M32 14 C28 2, 14 0, 0 8 C10 10, 16 14, 20 20 C10 18, 4 20, 0 26 C14 24, 22 20, 32 26 C42 20, 50 24, 64 26 C60 20, 54 18, 44 20 C48 14, 54 10, 64 8 C50 0, 36 2, 32 14 Z"
        fill="#0a0a0f"
        animate={{ scaleY: [1, 0.55, 1] }}
        transition={{ duration: 0.6, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformOrigin: '32px 12px' }}
      />
    </motion.svg>
  );
}

export function MoonGlow({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="absolute inset-0 rounded-full bg-[#d8f5c8] blur-[2px]" style={{ boxShadow: '0 0 40px 12px rgba(163,230,53,0.35), 0 0 90px 30px rgba(147,51,234,0.15)' }} />
      <div className="absolute rounded-full bg-[#0a0a12]" style={{ top: '-10%', left: '18%', width: '85%', height: '85%' }} />
    </div>
  );
}

export function TombstoneRow({ className }: { className?: string }) {
  const stones = [
    { w: 34, h: 46, cross: false },
    { w: 44, h: 60, cross: true },
    { w: 30, h: 38, cross: false },
    { w: 38, h: 52, cross: false },
    { w: 26, h: 34, cross: false },
  ];
  return (
    <div className={className}>
      {stones.map((s, i) => (
        <div key={i} className="relative shrink-0" style={{ width: s.w, height: s.h }}>
          <div
            className="absolute bottom-0 w-full bg-[#1c1a24] border border-[#3a3648]/60"
            style={{ height: s.h, borderRadius: `${s.w / 2}px ${s.w / 2}px 4px 4px` }}
          />
          {s.cross && (
            <div className="absolute left-1/2 -translate-x-1/2 -top-3 w-[3px] h-4 bg-[#1c1a24]" />
          )}
        </div>
      ))}
    </div>
  );
}
