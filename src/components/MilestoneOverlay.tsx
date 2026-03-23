import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Trophy, Star, PartyPopper } from 'lucide-react';

interface MilestoneOverlayProps {
  weeklyHours: number;
  weeklyEarnings: number;
}

interface Milestone {
  id: string;
  icon: typeof Sparkles;
  title: string;
  subtitle: string;
  gradient: string;
}

const MILESTONES_KEY = 'av-milestones-seen';

function getSeenMilestones(): string[] {
  try {
    return JSON.parse(localStorage.getItem(MILESTONES_KEY) || '[]');
  } catch { return []; }
}

function markSeen(id: string) {
  const seen = getSeenMilestones();
  if (!seen.includes(id)) {
    localStorage.setItem(MILESTONES_KEY, JSON.stringify([...seen, id]));
  }
}

export default function MilestoneOverlay({ weeklyHours, weeklyEarnings }: MilestoneOverlayProps) {
  const [activeMilestone, setActiveMilestone] = useState<Milestone | null>(null);

  useEffect(() => {
    const seen = getSeenMilestones();
    const weekKey = new Date().toISOString().slice(0, 10); // reset weekly

    const milestones: Milestone[] = [];

    if (weeklyHours >= 40) {
      milestones.push({
        id: `40h-${weekKey}`,
        icon: Trophy,
        title: '40 Hours Hit! 🎉',
        subtitle: "Full week crushed. You've earned your rest!",
        gradient: 'from-yellow-400 via-lime-400 to-primary',
      });
    }

    if (weeklyEarnings >= 1000) {
      milestones.push({
        id: `1k-${weekKey}`,
        icon: PartyPopper,
        title: '$1,000+ Week! 💰',
        subtitle: 'Big money moves. Treat yourself!',
        gradient: 'from-emerald-400 via-teal-400 to-cyan-500',
      });
    }

    if (weeklyEarnings >= 2000) {
      milestones.push({
        id: `2k-${weekKey}`,
        icon: Star,
        title: '$2,000+ Week! ⭐',
        subtitle: 'Legendary earnings. Go celebrate!',
        gradient: 'from-violet-400 via-purple-400 to-fuchsia-500',
      });
    }

    if (weeklyHours >= 50) {
      milestones.push({
        id: `50h-${weekKey}`,
        icon: Sparkles,
        title: '50+ Hour Warrior! 💪',
        subtitle: 'Overtime king. Time to unwind.',
        gradient: 'from-blue-400 via-indigo-400 to-violet-500',
      });
    }

    const unseen = milestones.filter(m => !seen.includes(m.id));
    if (unseen.length > 0) {
      setActiveMilestone(unseen[0]);
    }
  }, [weeklyHours, weeklyEarnings]);

  const dismiss = () => {
    if (activeMilestone) {
      markSeen(activeMilestone.id);
      setActiveMilestone(null);
    }
  };

  return (
    <AnimatePresence>
      {activeMilestone && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
          onClick={dismiss}
        >
          <motion.div
            initial={{ scale: 0.5, y: 40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.8, y: 20, opacity: 0 }}
            transition={{ type: 'spring', damping: 15, stiffness: 200 }}
            className="relative max-w-sm w-full"
            onClick={e => e.stopPropagation()}
          >
            {/* Floating particles */}
            {[...Array(8)].map((_, i) => (
              <motion.div
                key={i}
                className={`absolute w-2 h-2 rounded-full bg-gradient-to-r ${activeMilestone.gradient}`}
                initial={{
                  x: 0,
                  y: 0,
                  scale: 0,
                  opacity: 0,
                }}
                animate={{
                  x: (Math.random() - 0.5) * 200,
                  y: (Math.random() - 0.5) * 200,
                  scale: [0, 1.5, 0],
                  opacity: [0, 1, 0],
                }}
                transition={{
                  duration: 2,
                  delay: i * 0.1,
                  repeat: Infinity,
                  repeatDelay: 1,
                }}
                style={{ left: '50%', top: '50%' }}
              />
            ))}

            <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-8 text-center shadow-2xl">
              <div className={`absolute inset-0 bg-gradient-to-br ${activeMilestone.gradient} opacity-10`} />
              
              <motion.div
                animate={{ rotate: [0, -10, 10, -5, 5, 0] }}
                transition={{ duration: 0.6, delay: 0.3 }}
              >
                <activeMilestone.icon className="mx-auto h-16 w-16 text-accent" />
              </motion.div>

              <motion.h2
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="mt-4 text-2xl font-bold text-mono text-foreground"
              >
                {activeMilestone.title}
              </motion.h2>

              <motion.p
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.35 }}
                className="mt-2 text-muted-foreground"
              >
                {activeMilestone.subtitle}
              </motion.p>

              <motion.button
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5 }}
                onClick={dismiss}
                className={`mt-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-r ${activeMilestone.gradient} px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg`}
              >
                <Sparkles size={14} />
                Nice!
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
