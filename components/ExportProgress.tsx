"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  total: number;
  current: number;
};

export function ExportProgress({ open, total, current }: Props) {
  // We want to visualize blocks building up like a house or a structure.
  // We can represent this as a grid. As `current` approaches `total`, more blocks fill in.
  
  const [blocks, setBlocks] = useState<number[]>([]);

  useEffect(() => {
    // Determine how many visual blocks to show (max 25 for a 5x5 grid, or proportional)
    const MAX_BLOCKS = 36;
    const ratio = total > 0 ? Math.min(current / total, 1) : 0;
    const numBlocksToFill = Math.ceil(ratio * MAX_BLOCKS);
    
    setBlocks(Array.from({ length: numBlocksToFill }).map((_, i) => i));
  }, [current, total]);

  if (!open) return null;

  const MAX_BLOCKS = 36;
  const columns = 6;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 p-5 backdrop-blur-sm transition-opacity">
      <div className="flex w-full max-w-sm flex-col items-center rounded-2xl bg-white p-8 shadow-2xl ring-1 ring-zinc-200">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mb-8 flex h-32 w-32 flex-col-reverse flex-wrap content-start gap-1"
        >
          {Array.from({ length: MAX_BLOCKS }).map((_, i) => {
            const isFilled = blocks.includes(i);
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0.1, scale: 0.8 }}
                animate={{ 
                  opacity: isFilled ? 1 : 0.1, 
                  scale: isFilled ? 1 : 0.8,
                  backgroundColor: isFilled ? "#18181b" : "#e4e4e7" // zinc-900 vs zinc-200
                }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className="h-[18%] w-[15%] rounded-sm"
              />
            );
          })}
        </motion.div>

        <h3 className="flex items-center gap-2 text-lg font-semibold text-zinc-900">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
          Building your data...
        </h3>
        <p className="mt-2 text-sm text-zinc-500">
          Fetching {current} of {total} requested blocks
        </p>
        
        <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
          <motion.div 
            className="h-full bg-zinc-900"
            initial={{ width: 0 }}
            animate={{ width: `${total > 0 ? (current / total) * 100 : 0}%` }}
            transition={{ ease: "easeInOut", duration: 0.2 }}
          />
        </div>
      </div>
    </div>
  );
}
