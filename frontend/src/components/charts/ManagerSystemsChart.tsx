import type { EChartsOption } from "echarts";
import { useEffect, useMemo, useRef } from "react";

import { echarts } from "../../lib/echartsCore";

export type ManagerSystemRow = { name: string; total: number; overdue: number };

type Props = {
  rows: ManagerSystemRow[];
  dark: boolean;
};

const VISIBLE_ROWS = 12;

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
    const many = names.length > VISIBLE_ROWS;
    const showPct = many ? (VISIBLE_ROWS / names.length) * 100 : 100;

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        confine: true,
        formatter: (params: unknown) => {
          const rowsSafe = Array.isArray(params) ? (params as Array<{ axisValue: string; value: number; seriesName: string }>) : [];
          const axisValue = rowsSafe[0]?.axisValue ?? "";
          const inTime = rowsSafe.find((x) => x.seriesName === "В срок")?.value ?? 0;
          const overdueCount = rowsSafe.find((x) => x.seriesName === "Просрочено")?.value ?? 0;
          const total = inTime + overdueCount;
          const overduePct = total > 0 ? Math.round((overdueCount / total) * 100) : 0;
          return [
            `<b>${axisValue}</b>`,
            `Всего задач: ${total}`,
            `В срок: ${inTime}`,
            `Просрочено: ${overdueCount} (${overduePct}%)`,
          ].join("<br/>");
        },
      },
      legend: {
        bottom: 0,
        textStyle: { color: text, fontSize: 11 },
        itemWidth: 12,
        itemHeight: 8,
        data: ["В срок", "Просрочено"],
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
          width: 150,
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
              start: 0,
              end: showPct,
              brushSelect: false,
              handleSize: 10,
              textStyle: { color: text, fontSize: 10 },
              borderColor: axisLine,
              fillerColor: dark ? "rgba(14, 165, 233, 0.15)" : "rgba(14, 165, 233, 0.12)",
            },
          ]
        : [],
      series: [
        {
          name: "В срок",
          type: "bar",
          stack: "total",
          emphasis: { focus: "series" },
          data: onTrack,
          barMaxWidth: 22,
          itemStyle: { color: dark ? "#38bdf8" : "#0ea5e9" },
        },
        {
          name: "Просрочено",
          type: "bar",
          stack: "total",
          emphasis: { focus: "series" },
          data: overdue,
          barMaxWidth: 22,
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
