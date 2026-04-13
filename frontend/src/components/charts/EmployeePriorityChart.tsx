import type { EChartsOption } from "echarts";
import { useEffect, useMemo, useRef } from "react";

import { echarts } from "../../lib/echartsCore";

const ORDER = ["urgent", "high", "normal", "low"] as const;
const LABELS: Record<(typeof ORDER)[number], string> = {
  urgent: "Срочный",
  high: "Высокий",
  normal: "Обычный",
  low: "Низкий",
};
const COLORS_LIGHT = ["#dc2626", "#ea580c", "#0ea5e9", "#94a3b8"];
const COLORS_DARK = ["#f87171", "#fb923c", "#38bdf8", "#94a3b8"];

type Props = {
  counts: Record<string, number>;
  dark: boolean;
};

/**
 * Кольцевая диаграмма: распределение активных задач сотрудника по приоритету.
 */
export default function EmployeePriorityChart({ counts, dark }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const { pieData, total } = useMemo(() => {
    const data: { name: string; value: number; itemStyle: { color: string } }[] = [];
    let sum = 0;
    const colors = dark ? COLORS_DARK : COLORS_LIGHT;
    ORDER.forEach((key, i) => {
      const v = counts[key] ?? 0;
      if (v <= 0) return;
      sum += v;
      data.push({
        name: LABELS[key],
        value: v,
        itemStyle: { color: colors[i] },
      });
    });
    return { pieData: data, total: sum };
  }, [counts]);

  const option = useMemo((): EChartsOption => {
    const text = dark ? "#e2e8f0" : "#334155";
    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        confine: true,
        formatter: (p: unknown) => {
          const x = p as { name: string; value: number; percent: number };
          return `${x.name}<br/>${x.value} шт. (${x.percent}%)`;
        },
      },
      legend: {
        bottom: 0,
        textStyle: { color: text, fontSize: 11 },
        itemWidth: 10,
        itemHeight: 10,
      },
      series: [
        {
          name: "Приоритет",
          type: "pie",
          radius: ["42%", "68%"],
          center: ["50%", "44%"],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 4, borderColor: dark ? "#0f172a" : "#fff", borderWidth: 2 },
          label: {
            color: text,
            fontSize: 11,
            formatter: "{b}\n{d}%",
          },
          labelLine: { lineStyle: { color: text } },
          data: pieData,
        },
      ],
    };
  }, [pieData, dark]);

  useEffect(() => {
    const el = ref.current;
    if (!el || total === 0) return;

    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    chart.setOption(option, true);

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [option, total]);

  if (total === 0) return null;

  return <div ref={ref} className="h-64 w-full min-h-[220px]" />;
}
