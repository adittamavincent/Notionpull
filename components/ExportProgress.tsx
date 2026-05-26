"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

type Props = {
  open: boolean;
  total: number;
  current: number;
  status?: string;
};

export function ExportProgress({ open, total, current, status }: Props) {
  const [displayCurrent, setDisplayCurrent] = useState(0);

  // Smooth out the progress jumps
  useEffect(() => {
    if (!open) {
      setDisplayCurrent(0);
      return;
    }

    const interval = setInterval(() => {
      setDisplayCurrent((prev) => {
        // If we've reached the end (current === total), converge to 100% VERY quickly for satisfaction
        if (current >= total && total > 0) {
          if (prev >= total) return total;
          const diff = total - prev;
          // Sped up convergence: either 10% of remaining or a minimum step to ensure we hit 100 fast
          const satisfactionStep = Math.max(2, diff * 0.4); 
          return Math.min(prev + satisfactionStep, total);
        }

        // If we're behind the latest confirmed progress, catch up quickly
        if (prev < current) {
          const diff = current - prev;
          const step = Math.max(0.5, diff * 0.15); 
          return Math.min(prev + step, total);
        }
        
        // If we're resting at a confirmed point, creep forward slowly
        // to simulate activity (perceived progress / ETA feel)
        // Capped so we don't finish before the actual data arrives
        const isLastStretch = current >= total - 1;
        if (!isLastStretch) {
           // Slow creep: about 1% of a node every 50ms (2% per second)
           return Math.min(prev + 0.15, total - 0.5);
        }
        
        return prev;
      });
    }, 50);

    return () => clearInterval(interval);
  }, [current, total, open]);

  const [blocks, setBlocks] = useState<number[]>([]);

  useEffect(() => {
    // High-res grid for smooth filling (10x10)
    const MAX_BLOCKS = 100;
    const ratio = total > 0 ? Math.min(displayCurrent / total, 1) : 0;
    const numBlocksToFill = Math.ceil(ratio * MAX_BLOCKS);
    
    const filledIndices: number[] = [];
    for (let i = 0; i < MAX_BLOCKS; i++) {
        // 10x10 grid
        const row = Math.floor(i / 10);
        const col = i % 10;
        const fillingOrder = (9 - row) * 10 + col;
        if (fillingOrder < numBlocksToFill) {
            filledIndices.push(i);
        }
    }
    setBlocks(filledIndices);
  }, [displayCurrent, total]);

  if (!open) return null;

  const MAX_BLOCKS = 100;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 p-5 backdrop-blur-sm transition-opacity">
      <div className="flex w-full max-w-sm flex-col items-center rounded-2xl bg-white p-8 shadow-2xl ring-1 ring-zinc-200">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mb-8 grid h-40 w-40 grid-cols-10 place-content-center gap-1"
        >
          {Array.from({ length: MAX_BLOCKS }).map((_, i) => {
            const isFilled = blocks.includes(i);
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0.05, scale: 0.8 }}
                animate={{ 
                  opacity: isFilled ? 1 : 0.05, 
                  scale: isFilled ? 1 : 0.8,
                  backgroundColor: isFilled ? "#451a03" : "#71717a" 
                }}
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
                className="h-2.5 w-2.5 rounded-[1px]"
              />
            );
          })}
        </motion.div>

        <h3 className="flex items-center gap-2 text-lg font-bold tracking-tight text-zinc-900">
          <RefreshCw className="h-5 w-5 animate-spin text-amber-900" />
          Brewing...
        </h3>

        {status && (
          <motion.p 
            key={status}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-1 text-center text-xs font-medium text-zinc-400"
          >
            {status}
          </motion.p>
        )}
        
        <div className="mt-8 h-1 w-full overflow-hidden rounded-full bg-zinc-100/50">
          <motion.div 
            className="h-full bg-amber-950/80"
            initial={{ width: 0 }}
            animate={{ width: `${total > 0 ? (displayCurrent / total) * 100 : 0}%` }}
            transition={{ ease: "linear", duration: 0.1 }}
          />
        </div>
      </div>
    </div>
  );
}
