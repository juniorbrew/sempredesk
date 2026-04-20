'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CalendarDays, Plus, Link2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import {
  format, startOfMonth, endOfMonth, startOfWeek, addDays,
  addMonths, addWeeks, subMonths, subWeeks,
  isSameMonth, isSameDay, isToday, parseISO,
  getHours, getMinutes, startOfDay,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { api } from '@/lib/api';
import { useAuthStore, hasPermission } from '@/store/auth.store';

type ViewMode = 'month' | 'week' | 'day' | 'list';

const EVENT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  meeting:       { bg: '#DBEAFE', text: '#1D4ED8', border: '#3B82F6' },
  internal:      { bg: '#EDE9FE', text: '#6D28D9', border: '#8B5CF6' },
  client_return: { bg: '#D1FAE5', text: '#065F46', border: '#10B981' },
  sla_reminder:  { bg: '#FEF3C7', text: '#92400E', border: '#F59E0B' },
  sync_google:   { bg: '#FEE2E2', text: '#991B1B', border: '#EF4444' },
  sync_outlook:  { bg: '#DBEAFE', text: '#1E40AF', border: '#2563EB' },
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  internal: 'Interno', client_return: 'Retorno', sla_reminder: 'Lembrete SLA',
  meeting: 'Reunião', sync_google: 'Google', sync_outlook: 'Outlook',
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Agendado', confirmed: 'Confirmado', cancelled: 'Cancelado',
  completed: 'Concluído', rescheduled: 'Reagendado',
};

const DOW_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const HOUR_HEIGHT = 56;
const START_HOUR = 7;
const END_HOUR = 22;
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => i + START_HOUR);

function getEventColor(eventType: string) {
  return EVENT_COLORS[eventType] || { bg: '#F1F5F9', text: '#334155', border: '#94A3B8' };
}

function getMonthGridDays(date: Date): Date[] {
  const start = startOfWeek(startOfMonth(date), { weekStartsOn: 0 });
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) days.push(addDays(start, i));
  return days;
}

function getWeekDays(date: Date): Date[] {
  const start = startOfWeek(date, { weekStartsOn: 0 });
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function eventsForDay(events: any[], day: Date) {
  return events.filter(ev => {
    try { return isSameDay(parseISO(ev.startsAt), day); } catch { return false; }
  });
}

export default function AgendaPage() {
  const { user } = useAuthStore();
  const router = useRouter();

  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [miniMonth, setMiniMonth] = useState(new Date());
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const getVisibleRange = useCallback(() => {
    if (viewMode === 'month') {
      const start = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 0 });
      return { from: start, to: addDays(start, 41) };
    }
    if (viewMode === 'week') {
      const start = startOfWeek(currentDate, { weekStartsOn: 0 });
      return { from: start, to: addDays(start, 6) };
    }
    if (viewMode === 'day') {
      return { from: startOfDay(currentDate), to: startOfDay(currentDate) };
    }
    return { from: startOfMonth(currentDate), to: endOfMonth(currentDate) };
  }, [viewMode, currentDate]);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const { from, to } = getVisibleRange();
      const raw: any = await api.getCalendarEvents({
        perPage: 200,
        startFrom: from.toISOString(),
        startTo: to.toISOString(),
      });
      const list = raw?.data || raw?.items || (Array.isArray(raw) ? raw : []);
      setEvents(list);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [getVisibleRange]);

  useEffect(() => { loadEvents(); }, [loadEvents]);
  useEffect(() => { setMiniMonth(currentDate); }, [currentDate]);

  function navigate(dir: 1 | -1) {
    setCurrentDate(d => {
      if (viewMode === 'month') return dir === 1 ? addMonths(d, 1) : subMonths(d, 1);
      if (viewMode === 'week')  return dir === 1 ? addWeeks(d, 1)  : subWeeks(d, 1);
      return addDays(d, dir);
    });
  }

  function periodTitle() {
    if (viewMode === 'month') return format(currentDate, 'MMMM yyyy', { locale: ptBR });
    if (viewMode === 'week') {
      const s = startOfWeek(currentDate, { weekStartsOn: 0 });
      const e = addDays(s, 6);
      if (s.getMonth() === e.getMonth())
        return `${format(s, 'd')}–${format(e, 'd')} de ${format(s, 'MMMM yyyy', { locale: ptBR })}`;
      return `${format(s, 'd MMM', { locale: ptBR })} – ${format(e, 'd MMM yyyy', { locale: ptBR })}`;
    }
    if (viewMode === 'day') return format(currentDate, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });
    return format(currentDate, 'MMMM yyyy', { locale: ptBR });
  }

  if (!hasPermission(user, 'agenda.view')) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}>Acesso negado.</div>;
  }

  // ── MONTH VIEW ──────────────────────────────────────────────────────────────
  function renderMonth() {
    const days = getMonthGridDays(currentDate);
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', borderBottom: '1px solid #E2E8F0', flexShrink: 0 }}>
          {DOW_SHORT.map(d => (
            <div key={d} style={{ padding: '8px 0', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{d}</div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gridTemplateRows: 'repeat(6,1fr)', flex: 1, overflow: 'hidden' }}>
          {days.map((day, idx) => {
            const dayEvents = eventsForDay(events, day);
            const inMonth = isSameMonth(day, currentDate);
            const todayFlag = isToday(day);
            const visible = dayEvents.slice(0, 3);
            const extra = dayEvents.length - 3;
            return (
              <div
                key={idx}
                onClick={() => { setCurrentDate(day); setViewMode('day'); }}
                style={{
                  borderRight: (idx + 1) % 7 === 0 ? 'none' : '1px solid #F1F5F9',
                  borderBottom: idx < 35 ? '1px solid #F1F5F9' : 'none',
                  padding: '4px 5px', cursor: 'pointer', overflow: 'hidden', minHeight: 0,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 2 }}>
                  <span style={{
                    width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: todayFlag ? 700 : 500,
                    background: todayFlag ? '#3B82F6' : 'transparent',
                    color: todayFlag ? '#fff' : inMonth ? '#0F172A' : '#CBD5E1',
                  }}>{format(day, 'd')}</span>
                </div>
                {visible.map(ev => {
                  const c = getEventColor(ev.eventType);
                  const cancelled = ev.status === 'cancelled';
                  return (
                    <div
                      key={ev.id}
                      onClick={e => { e.stopPropagation(); router.push(`/dashboard/agenda/${ev.id}`); }}
                      title={ev.title}
                      style={{
                        fontSize: 10, fontWeight: 600, padding: '1px 4px', borderRadius: 3, marginBottom: 2,
                        background: c.bg, color: c.text, borderLeft: `2px solid ${c.border}`,
                        overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                        textDecoration: cancelled ? 'line-through' : 'none', opacity: cancelled ? 0.6 : 1, cursor: 'pointer',
                      }}
                    >
                      {!ev.allDay && <span style={{ opacity: 0.7 }}>{format(parseISO(ev.startsAt), 'HH:mm')} </span>}
                      {ev.title}
                    </div>
                  );
                })}
                {extra > 0 && <div style={{ fontSize: 10, color: '#6366F1', fontWeight: 600, paddingLeft: 3 }}>+{extra} mais</div>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── WEEK VIEW ───────────────────────────────────────────────────────────────
  function renderWeek() {
    const days = getWeekDays(currentDate);
    const allDay = days.flatMap(d => eventsForDay(events, d).filter(e => e.allDay));
    const timed  = events.filter(e => !e.allDay);
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '52px repeat(7,1fr)', borderBottom: '1px solid #E2E8F0', flexShrink: 0 }}>
          <div />
          {days.map((day, i) => {
            const todayFlag = isToday(day);
            return (
              <div key={i} style={{ textAlign: 'center', padding: '6px 4px', borderLeft: '1px solid #F1F5F9' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{DOW_SHORT[i]}</div>
                <div
                  onClick={() => { setCurrentDate(day); setViewMode('day'); }}
                  style={{
                    width: 26, height: 26, borderRadius: '50%', margin: '2px auto 0',
                    background: todayFlag ? '#3B82F6' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700,
                    color: todayFlag ? '#fff' : isSameDay(day, currentDate) ? '#3B82F6' : '#0F172A',
                    cursor: 'pointer',
                  }}
                >{format(day, 'd')}</div>
              </div>
            );
          })}
        </div>
        {/* All-day strip */}
        {allDay.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '52px repeat(7,1fr)', borderBottom: '1px solid #E2E8F0', flexShrink: 0 }}>
            <div style={{ fontSize: 9, color: '#94A3B8', padding: '4px 6px', textAlign: 'right', paddingTop: 6 }}>dia todo</div>
            {days.map((day, i) => (
              <div key={i} style={{ borderLeft: '1px solid #F1F5F9', padding: '3px 3px', minHeight: 26 }}>
                {eventsForDay(allDay, day).map(ev => {
                  const c = getEventColor(ev.eventType);
                  return (
                    <div key={ev.id} onClick={() => router.push(`/dashboard/agenda/${ev.id}`)}
                      style={{ fontSize: 10, fontWeight: 600, padding: '1px 4px', borderRadius: 3, marginBottom: 2, background: c.bg, color: c.text, cursor: 'pointer', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      {ev.title}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        {/* Time grid */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '52px repeat(7,1fr)' }}>
            {/* Hour labels */}
            <div>
              {HOURS.map(h => (
                <div key={h} style={{ height: HOUR_HEIGHT, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: 8, paddingTop: 3, fontSize: 10, color: '#94A3B8', fontWeight: 600, boxSizing: 'border-box' }}>
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>
            {/* Day columns */}
            {days.map((day, colIdx) => {
              const dayTimed = eventsForDay(timed, day);
              return (
                <div key={colIdx} style={{ borderLeft: '1px solid #F1F5F9', position: 'relative', height: HOURS.length * HOUR_HEIGHT }}>
                  {HOURS.map((_, hi) => (
                    <div key={hi} style={{ position: 'absolute', top: hi * HOUR_HEIGHT, left: 0, right: 0, borderTop: '1px solid #F8FAFC' }} />
                  ))}
                  {isToday(day) && (() => {
                    const now = new Date();
                    const top = (getHours(now) + getMinutes(now) / 60 - START_HOUR) * HOUR_HEIGHT;
                    if (top < 0 || top > HOURS.length * HOUR_HEIGHT) return null;
                    return (
                      <div style={{ position: 'absolute', top, left: 0, right: 0, zIndex: 10, pointerEvents: 'none' }}>
                        <div style={{ height: 2, background: '#EF4444' }} />
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#EF4444', position: 'absolute', left: -4, top: -3 }} />
                      </div>
                    );
                  })()}
                  {dayTimed.map(ev => {
                    const start = parseISO(ev.startsAt);
                    const startH = getHours(start) + getMinutes(start) / 60;
                    const endH   = ev.endsAt ? getHours(parseISO(ev.endsAt)) + getMinutes(parseISO(ev.endsAt)) / 60 : startH + 1;
                    const top    = Math.max(0, (startH - START_HOUR) * HOUR_HEIGHT);
                    const height = Math.max(18, (endH - startH) * HOUR_HEIGHT - 2);
                    const c      = getEventColor(ev.eventType);
                    const cancelled = ev.status === 'cancelled';
                    return (
                      <div key={ev.id} onClick={() => router.push(`/dashboard/agenda/${ev.id}`)}
                        style={{
                          position: 'absolute', top, left: 2, right: 2, height,
                          background: c.bg, borderLeft: `3px solid ${c.border}`, borderRadius: 4,
                          padding: '2px 4px', fontSize: 10, fontWeight: 600, color: c.text,
                          cursor: 'pointer', overflow: 'hidden',
                          opacity: cancelled ? 0.5 : 1, textDecoration: cancelled ? 'line-through' : 'none',
                          zIndex: 2, boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                        }}>
                        <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{ev.title}</div>
                        {height > 28 && <div style={{ fontSize: 9, opacity: 0.75 }}>{format(start, 'HH:mm')}{ev.endsAt ? ` – ${format(parseISO(ev.endsAt), 'HH:mm')}` : ''}</div>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── DAY VIEW ────────────────────────────────────────────────────────────────
  function renderDay() {
    const dayTimed  = eventsForDay(events, currentDate).filter(e => !e.allDay);
    const dayAllDay = eventsForDay(events, currentDate).filter(e => e.allDay);
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '52px 1fr', borderBottom: '1px solid #E2E8F0', flexShrink: 0, padding: '8px 0' }}>
          <div />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{format(currentDate, 'EEEE', { locale: ptBR })}</div>
            <div style={{
              width: 36, height: 36, borderRadius: '50%', margin: '4px auto 0',
              background: isToday(currentDate) ? '#3B82F6' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20, fontWeight: 700, color: isToday(currentDate) ? '#fff' : '#0F172A',
            }}>{format(currentDate, 'd')}</div>
          </div>
        </div>
        {dayAllDay.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '52px 1fr', borderBottom: '1px solid #E2E8F0', flexShrink: 0, padding: '4px 0' }}>
            <div style={{ fontSize: 9, color: '#94A3B8', textAlign: 'right', paddingRight: 8, paddingTop: 6 }}>dia todo</div>
            <div style={{ padding: '2px 8px' }}>
              {dayAllDay.map(ev => {
                const c = getEventColor(ev.eventType);
                return <div key={ev.id} onClick={() => router.push(`/dashboard/agenda/${ev.id}`)} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4, marginBottom: 2, background: c.bg, color: c.text, cursor: 'pointer' }}>{ev.title}</div>;
              })}
            </div>
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '52px 1fr' }}>
            <div>
              {HOURS.map(h => (
                <div key={h} style={{ height: HOUR_HEIGHT, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: 8, paddingTop: 3, fontSize: 10, color: '#94A3B8', fontWeight: 600, boxSizing: 'border-box' }}>
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>
            <div style={{ position: 'relative', height: HOURS.length * HOUR_HEIGHT, borderLeft: '1px solid #F1F5F9' }}>
              {HOURS.map((_, hi) => (
                <div key={hi} style={{ position: 'absolute', top: hi * HOUR_HEIGHT, left: 0, right: 0, borderTop: '1px solid #F8FAFC' }} />
              ))}
              {isToday(currentDate) && (() => {
                const now = new Date();
                const top = (getHours(now) + getMinutes(now) / 60 - START_HOUR) * HOUR_HEIGHT;
                if (top < 0 || top > HOURS.length * HOUR_HEIGHT) return null;
                return (
                  <div style={{ position: 'absolute', top, left: 0, right: 0, zIndex: 10, pointerEvents: 'none' }}>
                    <div style={{ height: 2, background: '#EF4444' }} />
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#EF4444', position: 'absolute', left: -4, top: -3 }} />
                  </div>
                );
              })()}
              {dayTimed.map(ev => {
                const start = parseISO(ev.startsAt);
                const startH = getHours(start) + getMinutes(start) / 60;
                const endH   = ev.endsAt ? getHours(parseISO(ev.endsAt)) + getMinutes(parseISO(ev.endsAt)) / 60 : startH + 1;
                const top    = Math.max(0, (startH - START_HOUR) * HOUR_HEIGHT);
                const height = Math.max(22, (endH - startH) * HOUR_HEIGHT - 2);
                const c      = getEventColor(ev.eventType);
                const cancelled = ev.status === 'cancelled';
                return (
                  <div key={ev.id} onClick={() => router.push(`/dashboard/agenda/${ev.id}`)}
                    style={{
                      position: 'absolute', top, left: 6, right: 6, height,
                      background: c.bg, borderLeft: `3px solid ${c.border}`, borderRadius: 5,
                      padding: '4px 8px', cursor: 'pointer', overflow: 'hidden',
                      opacity: cancelled ? 0.5 : 1, zIndex: 2, boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                    }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: c.text, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textDecoration: cancelled ? 'line-through' : 'none' }}>{ev.title}</div>
                    {height > 30 && <div style={{ fontSize: 10, color: c.text, opacity: 0.75 }}>{format(start, 'HH:mm')}{ev.endsAt ? ` – ${format(parseISO(ev.endsAt), 'HH:mm')}` : ''}</div>}
                    {height > 46 && ev.location && <div style={{ fontSize: 10, color: c.text, opacity: 0.65 }}>📍 {ev.location}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── LIST VIEW ───────────────────────────────────────────────────────────────
  function renderList() {
    const filtered = events
      .filter(ev => !statusFilter || ev.status === statusFilter)
      .filter(ev => !typeFilter || ev.eventType === typeFilter)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

    const groups: Record<string, any[]> = {};
    filtered.forEach(ev => {
      const key = format(parseISO(ev.startsAt), 'yyyy-MM-dd');
      if (!groups[key]) groups[key] = [];
      groups[key].push(ev);
    });

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 8, padding: '12px 16px', borderBottom: '1px solid #F1F5F9', flexShrink: 0 }}>
          <select style={{ padding: '6px 10px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 12, color: '#0F172A', background: '#fff' }}
            value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">Todos os status</option>
            {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select style={{ padding: '6px 10px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 12, color: '#0F172A', background: '#fff' }}
            value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="">Todos os tipos</option>
            {Object.entries(EVENT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 24px' }}>
          {Object.keys(groups).length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: 40, color: '#94A3B8', fontSize: 14 }}>Nenhum evento neste período</div>
          )}
          {Object.entries(groups).map(([dateKey, dayEvents]) => {
            const day = parseISO(dateKey);
            return (
              <div key={dateKey} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0 6px' }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    background: isToday(day) ? '#3B82F6' : '#F1F5F9',
                    color: isToday(day) ? '#fff' : '#64748B',
                  }}>
                    <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1 }}>{format(day, 'd')}</span>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', textTransform: 'capitalize' }}>{format(day, 'EEEE', { locale: ptBR })}</div>
                    <div style={{ fontSize: 11, color: '#94A3B8' }}>{format(day, "dd 'de' MMMM", { locale: ptBR })}</div>
                  </div>
                  <div style={{ flex: 1, height: 1, background: '#F1F5F9', marginLeft: 4 }} />
                </div>
                {dayEvents.map(ev => {
                  const c = getEventColor(ev.eventType);
                  const cancelled = ev.status === 'cancelled';
                  const start = parseISO(ev.startsAt);
                  return (
                    <div key={ev.id} onClick={() => router.push(`/dashboard/agenda/${ev.id}`)}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 12,
                        padding: '10px 14px', borderRadius: 8, marginBottom: 4,
                        border: '1px solid #F1F5F9', background: '#fff', cursor: 'pointer',
                        borderLeft: `4px solid ${c.border}`, transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
                      onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                    >
                      <div style={{ width: 42, textAlign: 'center', flexShrink: 0 }}>
                        {ev.allDay
                          ? <span style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600 }}>dia todo</span>
                          : <span style={{ fontSize: 12, fontWeight: 700, color: c.text }}>{format(start, 'HH:mm')}</span>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', textDecoration: cancelled ? 'line-through' : 'none', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{ev.title}</div>
                        <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                          {EVENT_TYPE_LABELS[ev.eventType] || ev.eventType}
                          {ev.location && ` · 📍 ${ev.location}`}
                          {ev.assignedUser?.name && ` · 👤 ${ev.assignedUser.name}`}
                        </div>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: c.bg, color: c.text, whiteSpace: 'nowrap' }}>
                        {STATUS_LABELS[ev.status] || ev.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── MINI CALENDAR (sidebar) ─────────────────────────────────────────────────
  function renderMiniCalendar() {
    const days = getMonthGridDays(miniMonth);
    return (
      <div style={{ padding: '0 6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <button onClick={() => setMiniMonth(d => subMonths(d, 1))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 4, borderRadius: 6, display: 'flex', alignItems: 'center' }}><ChevronLeft size={13} /></button>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#0F172A', textTransform: 'capitalize' }}>{format(miniMonth, 'MMM yyyy', { locale: ptBR })}</span>
          <button onClick={() => setMiniMonth(d => addMonths(d, 1))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 4, borderRadius: 6, display: 'flex', alignItems: 'center' }}><ChevronRight size={13} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', marginBottom: 2 }}>
          {['D','S','T','Q','Q','S','S'].map((d, i) => (
            <div key={i} style={{ textAlign: 'center', fontSize: 9, fontWeight: 700, color: '#94A3B8', padding: '2px 0' }}>{d}</div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
          {days.map((day, idx) => {
            const inMonth  = isSameMonth(day, miniMonth);
            const todayFlag = isToday(day);
            const selected  = isSameDay(day, currentDate);
            const hasEvent  = eventsForDay(events, day).length > 0;
            return (
              <div key={idx} onClick={() => { setCurrentDate(day); setMiniMonth(day); if (viewMode === 'month') setViewMode('day'); }}
                style={{ textAlign: 'center', padding: '2px 0', cursor: 'pointer' }}>
                <span style={{
                  width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto',
                  fontSize: 10, fontWeight: selected || todayFlag ? 700 : 400,
                  background: selected ? '#6366F1' : todayFlag ? '#3B82F6' : 'transparent',
                  color: selected || todayFlag ? '#fff' : inMonth ? '#0F172A' : '#CBD5E1',
                }}>{format(day, 'd')}</span>
                {hasEvent && !selected && !todayFlag && (
                  <div style={{ width: 3, height: 3, borderRadius: '50%', background: '#6366F1', margin: '-2px auto 0' }} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const VIEW_BUTTONS: { key: ViewMode; label: string }[] = [
    { key: 'day', label: 'Dia' },
    { key: 'week', label: 'Semana' },
    { key: 'month', label: 'Mês' },
    { key: 'list', label: 'Lista' },
  ];

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', overflow: 'hidden' }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#1D4ED8,#3B82F6)', boxShadow: '0 4px 12px rgba(59,130,246,0.3)' }}>
            <CalendarDays size={17} color="#fff" />
          </div>
          <button onClick={() => { setCurrentDate(new Date()); setMiniMonth(new Date()); }}
            style={{ padding: '6px 14px', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', color: '#0F172A', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Hoje
          </button>
          <button onClick={() => navigate(-1)} style={{ width: 30, height: 30, borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B' }}>
            <ChevronLeft size={15} />
          </button>
          <button onClick={() => navigate(1)} style={{ width: 30, height: 30, borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B' }}>
            <ChevronRight size={15} />
          </button>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: '#0F172A', margin: 0, textTransform: 'capitalize' }}>{periodTitle()}</h1>
          {loading && (
            <div style={{ width: 13, height: 13, border: '2px solid #E2E8F0', borderTopColor: '#6366F1', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', background: '#F1F5F9', borderRadius: 10, padding: 3, gap: 2 }}>
            {VIEW_BUTTONS.map(v => (
              <button key={v.key} onClick={() => setViewMode(v.key)}
                style={{
                  padding: '5px 13px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  background: viewMode === v.key ? '#fff' : 'transparent',
                  color: viewMode === v.key ? '#6366F1' : '#64748B',
                  boxShadow: viewMode === v.key ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s',
                }}>{v.label}</button>
            ))}
          </div>
          <Link href="/dashboard/agenda/integracoes"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', color: '#64748B', fontSize: 12, fontWeight: 500, textDecoration: 'none' }}>
            <Link2 size={12} /> Integrações
          </Link>
          {hasPermission(user, 'agenda.create') && (
            <Link href="/dashboard/agenda/novo"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 8, background: 'linear-gradient(135deg,#4F46E5,#6366F1)', color: '#fff', fontSize: 12, fontWeight: 600, textDecoration: 'none', boxShadow: '0 2px 8px rgba(99,102,241,0.35)' }}>
              <Plus size={13} /> Novo Evento
            </Link>
          )}
        </div>
      </div>

      {/* Body: sidebar + main */}
      <div style={{ flex: 1, display: 'flex', gap: 12, overflow: 'hidden' }}>

        {/* Sidebar */}
        <div style={{ width: 186, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: '12px 4px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            {renderMiniCalendar()}
          </div>
          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: '12px 14px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Legenda</div>
            {[
              { key: 'meeting',       label: 'Reunião' },
              { key: 'internal',      label: 'Interno' },
              { key: 'client_return', label: 'Retorno' },
              { key: 'sla_reminder',  label: 'Lembrete SLA' },
            ].map(({ key, label }) => {
              const c = getEventColor(key);
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: c.border, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: '#64748B' }}>{label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Main panel */}
        <div style={{ flex: 1, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          {viewMode === 'month' && renderMonth()}
          {viewMode === 'week'  && renderWeek()}
          {viewMode === 'day'   && renderDay()}
          {viewMode === 'list'  && renderList()}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
