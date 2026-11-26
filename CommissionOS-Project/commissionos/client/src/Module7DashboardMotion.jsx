import React, { useEffect, useState } from "react";

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export function AnimatedINRNumber({ value = 0, duration = 1100, prefix = "₹" }) {
  const [displayVal, setDisplayVal] = useState(0);

  useEffect(() => {
    let rafId;
    const startTime = performance.now();
    const target = Number(value) || 0;

    const tick = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(progress);
      setDisplayVal(Math.round(target * eased));

      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      }
    };

    setDisplayVal(0);
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [value, duration]);

  return (
    <span className="tabular-nums transition-colors duration-300">
      {prefix}
      {displayVal.toLocaleString("en-IN")}
    </span>
  );
}

export function BottomUpRangeGraph({
  title = "Commission Range Progression (0 → Target)",
  items = [],
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(timer);
  }, [items]);

  const maxVal = Math.max(...items.map((d) => Number(d.value) || 0), 1);

  return (
    <div className="cos-card-enter bg-[#141414] border border-zinc-800/90 rounded-2xl p-5 text-white mt-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
        <div>
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <p className="text-xs text-zinc-400">
            Animated from baseline 0 upward with smooth transitions
          </p>
        </div>
        <span className="text-xs px-2.5 py-1 rounded-full bg-red-950/70 text-red-400 border border-red-800/50">
          Live Range View
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4 items-end h-56 pt-6 pb-2 border-b border-zinc-800">
        {items.map((item, idx) => {
          const val = Number(item.value) || 0;
          const heightPct = Math.max(8, Math.round((val / maxVal) * 100));

          return (
            <div
              key={item.label || idx}
              className="flex flex-col items-center justify-end h-full group"
            >
              <div className="text-xs font-semibold text-zinc-200 mb-1.5 opacity-90 group-hover:text-red-400 transition-colors">
                ₹{mounted ? val.toLocaleString("en-IN") : 0}
              </div>

              <div className="w-full max-w-[54px] h-40 flex items-end bg-zinc-900/70 rounded-t-xl p-1 border border-zinc-800/80 overflow-hidden">
                <div
                  className="cos-rise-bar w-full rounded-t-lg bg-gradient-to-t from-red-700 via-red-600 to-rose-400"
                  style={{
                    height: mounted ? `${heightPct}%` : "0%",
                    animationDelay: `${idx * 80}ms`,
                    transition: "height 0.9s cubic-bezier(0.22, 1, 0.36, 1)",
                  }}
                  title={`${item.label}: ₹${val.toLocaleString("en-IN")}`}
                />
              </div>

              <span className="mt-2 text-xs text-zinc-400 truncate max-w-full">
                {item.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}