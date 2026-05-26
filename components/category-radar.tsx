"use client";

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";

export type RadarRow = { category: string; a: number; b?: number };

export function CategoryRadar({
  rows,
  aLabel,
  bLabel,
}: {
  rows: RadarRow[];
  aLabel: string;
  bLabel?: string;
}) {
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={rows} outerRadius="80%">
          <PolarGrid stroke="hsl(var(--border))" />
          <PolarAngleAxis dataKey="category" tick={{ fontSize: 11 }} />
          <PolarRadiusAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <Radar
            name={aLabel}
            dataKey="a"
            stroke="hsl(var(--accent))"
            fill="hsl(var(--accent))"
            fillOpacity={0.35}
          />
          {bLabel ? (
            <Radar
              name={bLabel}
              dataKey="b"
              stroke="hsl(var(--primary))"
              fill="hsl(var(--primary))"
              fillOpacity={0.2}
            />
          ) : null}
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: "1px solid hsl(var(--border))",
              background: "hsl(var(--card))",
            }}
          />
          {bLabel ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
