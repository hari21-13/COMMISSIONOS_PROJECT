import React, { useEffect, useState } from "react";
import { AnimatedINRNumber } from "./Module7DashboardMotion";

const DEFAULT_REPORT_DATA = [
  { month: "Jun", sales: 1450000, commission: 87000 },
  { month: "Jul", sales: 1720000, commission: 103200 },
  { month: "Aug", sales: 1980000, commission: 118800 },
  { month: "Sep", sales: 1850000, commission: 111000 },
  { month: "Oct", sales: 2110000, commission: 126600 },
  { month: "Nov", sales: 2500000, commission: 150000 },
];

export default function Module12ReportsAnalytics({ data = DEFAULT_REPORT_DATA }) {
  const [filterMode, setFilterMode] = useState("both"); // "both" | "sales" | "commission"
  const [animateBars, setAnimateBars] = useState(false);

  useEffect(() => {
    setAnimateBars(false);
    const id = requestAnimationFrame(() => setAnimateBars(true));
    return () => cancelAnimationFrame(id);
  }, [filterMode, data]);

  const maxSales = Math.max(...data.map((d) => d.sales), 1);
  const maxComm = Math.max(...data.map((d) => d.commission), 1);

  const totalSales = data.reduce((acc, d) => acc + d.sales, 0);
  const totalCommission = data.reduce((acc, d) => acc + d.commission, 0);

  // SVG coordinates for animated trend line (0..600 width, 0..200 height)
  const svgW = 600;
  const svgH = 200;
  const padX = 36;
  const padY = 24;
  const usableW = svgW - padX * 2;
  const usableH = svgH - padY * 2;

  const linePoints = data.map((d, i) => {
    const x =
      data.length === 1
        ? svgW / 2
        : padX + (i / (data.length - 1)) * usableW;
    const metricVal = filterMode === "commission" ? d.commission : d.sales;
    const metricMax = filterMode === "commission" ? maxComm : maxSales;
    const y = padY + usableH - (metricVal / metricMax) * usableH;
    return { x, y, label: d.month, val: metricVal };
  });

  const polylineStr = linePoints.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className="space-y-6 text-white">
      {/* Header + Filter Controls */}
      <div className="cos-card-enter bg-gradient-to-r from-[#1c1012] via-[#141414] to-[#141414] border border-red-900/40 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-xs uppercase tracking-wider text-red-400 font-semibold">
            Module 12 • Executive Reporting
          </span>
          <h2 className="text-xl font-bold mt-0.5">
            Reports & Analytics — Trend & Bar Insights
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Interactive line & bar visualizations with bottom-up and progressive animations
          </p>
        </div>

        <div className="flex items-center gap-2 bg-zinc-900/90 p-1 rounded-xl border border-zinc-800">
          {[
            { id: "both", label: "All Reports" },
            { id: "sales", label: "Sales Trend" },
            { id: "commission", label: "Commission" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterMode(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                filterMode === tab.id
                  ? "bg-red-600 text-white shadow-md shadow-red-900/40"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Top KPI Summary Strip with Animated Counters */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="cos-card-enter bg-[#141414] border border-zinc-800 rounded-2xl p-5">
          <div className="text-xs uppercase tracking-wider text-zinc-400">
            Cumulative Period Sales
          </div>
          <div className="text-2xl font-bold text-white mt-1">
            <AnimatedINRNumber value={totalSales} duration={1050} />
          </div>
          <div className="text-xs text-emerald-400 mt-1">
            Across {data.length} reporting cycles
          </div>
        </div>

        <div className="cos-card-enter bg-[#141414] border border-zinc-800 rounded-2xl p-5">
          <div className="text-xs uppercase tracking-wider text-zinc-400">
            Cumulative Commission Accrued
          </div>
          <div className="text-2xl font-bold text-red-400 mt-1">
            <AnimatedINRNumber value={totalCommission} duration={1150} />
          </div>
          <div className="text-xs text-zinc-400 mt-1">
            Calculated & verified incentive ledger
          </div>
        </div>
      </div>

      {/* Charts Grid: Line Graph Report + Vertical Bar Graph */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. Animated Line Graph */}
        <div className="cos-card-enter bg-[#141414] border border-zinc-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white">
              {filterMode === "commission"
                ? "Commission Trajectory (Line Graph)"
                : "Revenue Trajectory (Line Graph)"}
            </h3>
            <span className="text-xs text-red-400 font-medium">Animated Line</span>
          </div>

          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${svgW} ${svgH}`}
              className="w-full h-52 overflow-visible"
            >
              {/* Horizontal guide lines */}
              {[0.25, 0.5, 0.75, 1].map((ratio) => {
                const y = padY + usableH * (1 - ratio);
                return (
                  <line
                    key={ratio}
                    x1={padX}
                    y1={y}
                    x2={svgW - padX}
                    y2={y}
                    stroke="#27272a"
                    strokeDasharray="4 4"
                    strokeWidth="1"
                  />
                );
              })}

              {/* Animated Polyline */}
              <polyline
                key={`${filterMode}-${data.length}`}
                fill="none"
                stroke="#ef4444"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="cos-line-draw"
                points={polylineStr}
              />

              {/* Data Nodes & X-Labels */}
              {linePoints.map((pt) => (
                <g key={pt.label}>
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r="5"
                    fill="#dc2626"
                    stroke="#ffffff"
                    strokeWidth="2"
                    className="transition-transform duration-200 hover:scale-125"
                  />
                  <text
                    x={pt.x}
                    y={svgH - 4}
                    textAnchor="middle"
                    fill="#a1a1aa"
                    fontSize="11"
                  >
                    {pt.label}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        </div>

        {/* 2. Animated Bottom-to-Top Bar Graph */}
        <div className="cos-card-enter bg-[#141414] border border-zinc-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white">
              Comparison Report (Vertical Bar Graph)
            </h3>
            <span className="text-xs text-rose-400 font-medium">Bottom → Top</span>
          </div>

          <div className="grid grid-cols-6 gap-2.5 items-end h-52 pt-6 pb-2 border-b border-zinc-800">
            {data.map((row, idx) => {
              const activeVal =
                filterMode === "sales" ? row.sales : row.commission;
              const activeMax =
                filterMode === "sales" ? maxSales : maxComm;
              const pct = Math.max(10, Math.round((activeVal / activeMax) * 100));

              return (
                <div
                  key={row.month}
                  className="flex flex-col items-center justify-end h-full"
                >
                  <span className="text-[11px] text-zinc-300 font-medium mb-1">
                    ₹{Math.round(activeVal / 1000)}k
                  </span>
                  <div className="w-full max-w-[38px] h-36 flex items-end bg-zinc-900/80 rounded-t-lg p-0.5 border border-zinc-800">
                    <div
                      className="cos-rise-bar w-full rounded-t-md bg-gradient-to-t from-red-800 via-red-600 to-amber-500"
                      style={{
                        height: animateBars ? `${pct}%` : "0%",
                        animationDelay: `${idx * 75}ms`,
                        transition: "height 0.85s cubic-bezier(0.22, 1, 0.36, 1)",
                      }}
                      title={`${row.month}: ₹${activeVal.toLocaleString("en-IN")}`}
                    />
                  </div>
                  <span className="mt-1.5 text-xs text-zinc-400">{row.month}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Clean Tabular Breakdown */}
      <div className="cos-card-enter bg-[#141414] border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-800 bg-zinc-900/60">
          <h3 className="text-sm font-semibold text-white">
            Monthly Report Summary Table
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Eligible Sales</th>
                <th className="px-4 py-3">Commission</th>
                <th className="px-4 py-3">Effective Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {data.map((row) => {
                const rate = row.sales
                  ? ((row.commission / row.sales) * 100).toFixed(1)
                  : "0.0";
                return (
                  <tr
                    key={row.month}
                    className="hover:bg-zinc-900/50 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-white">
                      {row.month}
                    </td>
                    <td className="px-4 py-3 text-zinc-200">
                      ₹{row.sales.toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-3 font-semibold text-red-400">
                      ₹{row.commission.toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-3 text-emerald-400">{rate}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}