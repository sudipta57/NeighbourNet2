import React from 'react';
import { Message } from '../../lib/types';
import { useMetrics } from '../../hooks/useMetrics';
import { PieChart, Pie, Cell, AreaChart, Area, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Label } from 'recharts';

interface Props {
  messages: Message[];
}

const colorMap: Record<string, string> = {
  CRITICAL: 'var(--color-critical)',
  HIGH: 'var(--color-high)',
  MEDIUM: 'var(--color-medium)',
  LOW: 'var(--color-low)'
};

const DonutCenterLabel = ({ viewBox, total }: { viewBox?: { cx?: number, cy?: number }; total: number }) => {
  const cx = viewBox?.cx ?? 50;
  const cy = viewBox?.cy ?? 50;
  return (
    <>
      <text
        x={cx}
        y={cy - 2}
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize={18}
        fontWeight={700}
        fill="var(--color-text-primary)"
      >
        {total}
      </text>
      <text
        x={cx}
        y={cy + 10}
        textAnchor="middle"
        fontFamily="var(--font-sans)"
        fontSize={8}
        letterSpacing={1}
        fill="var(--color-text-secondary)"
      >
        TOTAL
      </text>
    </>
  )
}

export default function LiveMetricsPanel({ messages }: Props) {
  const { donutData, sparklineData, acknowledgedCount, pendingCount } = useMetrics(messages);

  const ackData = [{ name: 'Status', acknowledged: acknowledgedCount, pending: pendingCount }];

  return (
    <div className="skeu-panel flex-1 flex flex-col p-4 w-full h-full">
      <h2 style={{ fontFamily: 'var(--font-sans)', fontSize: '16px', fontWeight: 'bold', color: 'var(--color-text-primary)', marginBottom: '16px' }}>
        📊 Operation Metrics
      </h2>

      <div className="flex flex-row justify-between mb-4">
        {/* Triage Donut */}
        <div className="flex flex-col items-center">
          <div 
            className="relative flex items-center justify-center bg-[var(--color-panel-border)]"
            style={{
              width: '100px', height: '100px', borderRadius: '50%',
              boxShadow: 'inset 0 2px 6px rgba(80,60,40,0.2)',
              overflow: 'hidden'
            }}
          >
            <PieChart width={100} height={100}>
              <Pie
                data={donutData.length > 0 ? donutData : [{ name: 'EMPTY', value: 1 }]}
                cx="50%" cy="50%"
                innerRadius={35}
                outerRadius={50}
                dataKey="value"
                stroke="none"
              >
                {donutData.length > 0 ? (
                  donutData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={colorMap[entry.name] || 'var(--color-inactive)'} />
                  ))
                ) : (
                  <Cell fill="var(--color-inactive)" />
                )}
                <Label
                  content={<DonutCenterLabel total={messages.length} />}
                  position="center"
                />
              </Pie>
            </PieChart>
          </div>
          <div className="donut-legend">
            {donutData.map(d => (
              <span key={d.name} className="legend-item">
                <span className="legend-dot" style={{ background: colorMap[d.name] }} />
                <span className="legend-name">{d.name}</span>
                <span className="legend-count">{d.value}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Hop Latency Readout — derived from messages if backend doesn't provide histogram */}
        <div className="flex gap-2">
          <div 
            className="flex flex-col items-center justify-center rounded px-3 py-2"
            style={{ backgroundColor: 'var(--color-text-primary)' }}
          >
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: '10px', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>P50</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', color: 'var(--color-positive)' }}>—</span>
          </div>
          <div 
            className="flex flex-col items-center justify-center rounded px-3 py-2"
            style={{ backgroundColor: 'var(--color-text-primary)' }}
          >
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: '10px', color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>P95</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', color: 'var(--color-high)' }}>—</span>
          </div>
        </div>
      </div>

      {/* Sparkline — messages received per 5-min window */}
      <div className="w-full mt-2 h-16">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={sparklineData} margin={{ top: 0, left: 0, right: 0, bottom: 0 }}>
            <Area 
              type="monotone" 
              dataKey="arrival" 
              stroke="var(--color-accent-blue)" 
              fillOpacity={0.4}
              strokeWidth={2}
              fill="var(--color-accent-blue)" 
            />
            <XAxis 
              dataKey="time" 
              hide={false}
              axisLine={false}
              tickLine={false}
              tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--color-text-secondary)' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Ack vs Pending Bar */}
      <div className="w-full mt-4 flex-1">
        <div 
          className="w-full h-8 rounded relative overflow-hidden"
          style={{
            backgroundColor: 'var(--color-panel-border)',
            boxShadow: 'inset 0 2px 4px rgba(80,60,40,0.15)'
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={ackData} margin={{ top: 0, bottom: 0, left: 0, right: 0 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" hide />
              <Bar dataKey="acknowledged" stackId="a" fill="var(--color-positive)" radius={[0, 0, 0, 0]} />
              <Bar dataKey="pending" stackId="a" fill="var(--color-critical)" radius={[0, 0, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex justify-between mt-1 px-1">
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: '10px', color: 'var(--color-positive)' }}>Ack: {acknowledgedCount}</span>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: '10px', color: 'var(--color-critical)' }}>Pending: {pendingCount}</span>
        </div>
      </div>

    </div>
  );
}
