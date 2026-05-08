import type { EChartsOption } from "echarts";
import { useEffect, useMemo, useRef } from "react";

import { echarts } from "../../lib/echartsCore";

type Props = {
  rows: Array<{ label: string; created: number; closed: number }>;
  dark: boolean;
};

export default function ManagerCreatedClosedChart({ rows, dark }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const option = useMemo((): EChartsOption => {
    const text = dark ? "#e2e8f0" : "#334155";
    const axisLine = dark ? "#475569" : "#cbd5e1";
    const splitLine = dark ? "#334155" : "#e2e8f0";
    return {
      backgroundColor: "transparent",
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, confine: true },
      legend: {
        top: 0,
        textStyle: { color: text, fontSize: 11 },
        itemWidth: 12,
        itemHeight: 8,
        data: ["Создано", "Закрыто"],
      },
      grid: { left: "3%", right: "3%", top: 30, bottom: 22, containLabel: true },
      xAxis: {
        type: "category",
        data: rows.map((r) => r.label),
        axisLabel: { color: text, fontSize: 11 },
        axisLine: { lineStyle: { color: axisLine } },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: { color: text, fontSize: 11 },
        axisLine: { lineStyle: { color: axisLine } },
        splitLine: { lineStyle: { color: splitLine, type: "dashed" } },
      },
      series: [
        {
          name: "Создано",
          type: "bar",
          data: rows.map((r) => r.created),
          barMaxWidth: 22,
          itemStyle: { color: dark ? "#60a5fa" : "#3b82f6" },
        },
        {
          name: "Закрыто",
          type: "bar",
          data: rows.map((r) => r.closed),
          barMaxWidth: 22,
          itemStyle: { color: dark ? "#34d399" : "#10b981" },
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
  return <div ref={ref} className="h-56 w-full min-h-[220px]" />;
}
