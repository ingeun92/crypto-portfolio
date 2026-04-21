"use client";

import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HistoryPoint } from "@/lib/types";
import { fmtKrw } from "@/lib/format";

export function TrendChart({ data, gain }: { data: HistoryPoint[]; gain: boolean }) {
  const stroke = gain ? "#1E5E3B" : "#7A2424";
  return (
    <div className="h-60">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="taken_date"
            tick={{ fill: "#8B8679", fontSize: 10 }}
            axisLine={{ stroke: "#E5E2D6" }}
            tickLine={false}
            minTickGap={40}
            tickFormatter={(v) => {
              const d = new Date(v);
              return `${d.getMonth() + 1}/${d.getDate()}`;
            }}
          />
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip
            cursor={{ stroke: "#1A1918", strokeDasharray: "2 2", strokeWidth: 1 }}
            contentStyle={{
              background: "#FAFAF5",
              border: "1px solid #1A1918",
              borderRadius: 0,
              fontSize: 12,
              padding: "8px 12px",
            }}
            labelStyle={{
              color: "#8B8679",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              marginBottom: 4,
            }}
            labelFormatter={(v) => String(v)}
            formatter={(v: any) => [fmtKrw(Number(v)), "Total"]}
          />
          <Line
            type="monotone"
            dataKey="total_krw"
            stroke={stroke}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3, fill: stroke, stroke: "#FAFAF5", strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
