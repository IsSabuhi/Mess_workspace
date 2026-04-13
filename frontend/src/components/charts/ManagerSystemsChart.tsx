import type { EChartsOption } from "echarts";
import { useEffect, useMemo, useRef } from "react";

import { echarts } from "../../lib/echartsCore";

export type ManagerSystemRow = { name: string; total: number; overdue: number };

type Props = {
  rows: ManagerSystemRow[];
  dark: boolean;
};

/**
 * Горизонтальные складывающиеся столбцы: активные «в срок» vs просроченные по производственным системам.
 */
export default function ManagerSystemsChart({ rows, dark }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const option = useMemo((): EChartsOption => {
    const text = dark ? "#e2e8f0" : "#334155";
    const axisLine = dark ? "#475569" : "#cbd5e1";
    const splitLine = dark ? "#334155" : "#e2e8f0";

    const sorted = [...rows].sort((a, b) => b.total - a.total);
    const names = sorted.map((r) => r.name);
    const onTrack = sorted.map((r) => Math.max(0, r.total - r.overdue));
    const overdue = sorted.map((r) => r.overdue);

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
        right: "4%",
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
          width: 120,
          overflow: "truncate",
        },
        axisLine: { lineStyle: { color: axisLine } },
      },
      series: [
        {
          name: "В срок (без просрочки)",
          type: "bar",
          stack: "total",
          emphasis: { focus: "series" },
          data: onTrack,
          itemStyle: { color: dark ? "#38bdf8" : "#0ea5e9" },
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

  return <div ref={ref} className="h-[min(28rem,calc(100vh-12rem))] w-full min-h-[200px]" />;
}
