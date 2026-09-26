import { useEffect, useRef } from 'react';
import type { WorldEvent } from '@surv/shared';
import { mapSignals, useWorld } from '../store/world';

const SEVERITY_CLASS: Record<WorldEvent['severity'], string> = {
  high: 'ev-high',
  medium: 'ev-medium',
  low: 'ev-low',
  info: 'ev-info',
};

const SEVERITY_MARK: Record<WorldEvent['severity'], string> = {
  high: '▲',
  medium: '●',
  low: '○',
  info: '·',
};

export function EventsBar(): JSX.Element {
  const events = useWorld((st) => st.events);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  const onClick = (ev: WorldEvent) => {
    if (ev.moduleIds && ev.moduleIds.length > 0) {
      mapSignals.flashModules(ev.moduleIds);
    }
  };

  return (
    <div className="events-bar">
      <div className="events-title">编年史</div>
      <div className="events-list" ref={listRef}>
        {events.length === 0 && <div className="events-empty">等待事件……</div>}
        {events.map((ev) => (
          <div
            key={ev.id}
            className={`event-item ${SEVERITY_CLASS[ev.severity]} ${ev.moduleIds?.length ? 'clickable' : ''}`}
            onClick={() => onClick(ev)}
            title={ev.moduleIds?.length ? '点击在地图上高亮相关省份' : undefined}
          >
            <span className="event-mark">{SEVERITY_MARK[ev.severity]}</span>
            <span className="event-time">{new Date(ev.ts).toLocaleTimeString('zh-CN', { hour12: false })}</span>
            <span className="event-msg">{ev.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
