import type { EChartsOption } from "echarts";
import { useEffect, useRef, type RefObject } from "react";

import { echarts } from "./echartsCore";

/** Один экземпляр ECharts на контейнер: данные обновляются через setOption, dispose только при размонтировании. */
export function useEchartsChart(
  elRef: RefObject<HTMLDivElement | null>,
  option: EChartsOption,
  enabled: boolean,
) {
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null);
  const optionRef = useRef(option);
  optionRef.current = option;

  useEffect(() => {
    const el = elRef.current;
    if (!el || !enabled) return;
    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    chart.setOption(optionRef.current, true);
    const ro = new ResizeObserver(() => {
      if (!chart.isDisposed()) chart.resize();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [elRef, enabled]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || chart.isDisposed() || !enabled) return;
    chart.setOption(option, true);
  }, [option, enabled]);
}
