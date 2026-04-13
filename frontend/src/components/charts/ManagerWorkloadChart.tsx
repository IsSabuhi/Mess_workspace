import type { EChartsOption } from "echarts";
import { useEffect, useMemo, useRef } from "react";

import { echarts } from "../../lib/echartsCore";

export type WorkloadAssigneeRow = { name: string; total: number; overdue: number };

type Props = {
  rows: WorkloadAssigneeRow[];
  dark: boolean;
};

const VISIBLE_ROWS = 14;

/**
 * Горизонтальные stacked bar: активные задачи по исполнителям (в срок / просрочено).
 * При большом числе людей — ползунок по оси исполнителей.
 */
export default function ManagerWorkloadChart({ rows, dark }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const option = useMemo((): EChartsOption => {
    const text = dark ? "#e2e8f0" : "#334155";
    const axisLine = dark ? "#475569" : "#cbd5e1";
    const splitLine = dark ? "#334155" : "#e2e8f0";

    const sorted = [...rows].sort((a, b) => b.total - a.total);
    const names = sorted.map((r) => r.name);
    const onTrack = sorted.map((r) => Math.max(0, r.total - r.overdue));
    const overdue = sorted.map((r) => r.overdue);

    const many = names.length > VISIBLE_ROWS;
    const showPct = many ? (VISIBLE_ROWS / names.length) * 100 : 100;

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        confine: true,
      },
      legend: {
        bottom: 0,
        textStyle: { color: text, fontSize: 11 },
        itemWidth: 12,
        itemHeight: 8,
        data: ["В срок (без просрочки)", "Просрочено"],
      },
      grid: {
        left: "2%",
        right: many ? 36 : "4%",
        top: 8,
        bottom: 48,
        containLabel: true,
      },
      xAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: { color: text, fontSize: 11 },
        axisLine: { lineStyle: { color: axisLine } },
        splitLine: { lineStyle: { color: splitLine, type: "dashed" } },
      },
      yAxis: {
        type: "category",
        data: names,
        axisLabel: {
          color: text,
          fontSize: 11,
          width: 132,
          overflow: "truncate",
        },
        axisLine: { lineStyle: { color: axisLine } },
      },
      dataZoom: many
        ? [
            {
              type: "slider",
              yAxisIndex: 0,
              width: 18,
              right: 4,
              start: 100 - showPct,
              end: 100,
              brushSelect: false,
              handleSize: 10,
              textStyle: { color: text, fontSize: 10 },
              borderColor: axisLine,
              fillerColor: dark ? "rgba(56, 189, 248, 0.15)" : "rgba(14, 165, 233, 0.12)",
            },
          ]
        : [],
      series: [
        {
          name: "В срок (без просрочки)",
          type: "bar",
          stack: "total",
          emphasis: { focus: "series" },
          data: onTrack,
          itemStyle: { color: dark ? "#34d399" : "#10b981" },
        },
        {
          name: "Просрочено",
          type: "bar",
          stack: "total",
          emphasis: { focus: "series" },
          data: overdue,
          itemStyle: { color: dark ? "#f87171" : "#ef4444" },
        },
      ],
    };
  }, [rows, dark]);

  useEffect(() => {
    const el = ref.current;
    if (!el || rows.length === 0) return;

    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    chart.setOption(option, true);

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [option, rows.length]);

  if (rows.length === 0) return null;

  return <div ref={ref} className="h-[min(32rem,calc(100vh-10rem))] w-full min-h-[220px]" />;
}
