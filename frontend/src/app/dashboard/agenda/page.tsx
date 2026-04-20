'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarDays, Plus, Link2, ChevronLeft, ChevronRight, Pencil, Trash2, X, Check } from 'lucide-react';
import {
  format, startOfMonth, endOfMonth, startOfWeek, addDays,
  addMonths, addWeeks, subMonths, subWeeks,
  isSameMonth, isSameDay, isToday, parseISO,
  getHours, getMinutes, startOfDay, isBefore, isAfter,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { api } from '@/lib/api';
import { useAuthStore, hasPermission } from '@/store/auth.store';

type ViewMode = 'month' | 'week' | 'day' | 'list';

// ── Event type config ────────────────────────────────────────────────────────
export type EventTypeConfig = { key: string; label: string; color: string };

const DEFAULT_TYPES: EventTypeConfig[] = [
  { key: 'meeting',       label: 'Reunião',      color: '#3B82F6' },
  { key: 'internal',      label: 'Interno',      color: '#8B5CF6' },
  { key: 'client_return', label: 'Retorno',       color: '#10B981' },
  { key: 'sla_reminder',  label: 'Lembrete SLA', color: '#F59E0B' },
  { key: 'sync_google',   label: 'Google',       color: '#EF4444' },
  { key: 'sync_outlook',  label: 'Outlook',      color: '#2563EB' },
];

const PRESET_COLORS = [
  '#3B82F6','#8B5CF6','#10B981','#F59E0B','#EF4444','#EC4899',
  '#06B6D4','#84CC16','#F97316','#6366F1','#14B8A6','#64748B',
];

const STORAGE_KEY = 'agenda_event_types';

function loadTypes(): EventTypeConfig[] {
  if (typeof window === 'undefined') return DEFAULT_TYPES;
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) return JSON.parse(s);
  } catch {}
  return DEFAULT_TYPES;
}

function saveTypes(types: EventTypeConfig[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(types)); } catch {}
}

function colorFromType(types: EventTypeConfig[], key: string) {
  return types.find(t => t.key === key)?.color || '#94A3B8';
}

function bgFromColor(color: string) {
  // Generate a soft bg from a hex color
  return color + '22';
}

// ── Calendar helpers ─────────────────────────────────────────────────────────
function getMonthGridDays(date: Date): Date[] {
  const start = startOfWeek(startOfMonth(date), { weekStartsOn: 0 });
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

function getWeekDays(date: Date): Date[] {
  const start = startOfWeek(date, { weekStartsOn: 0 });
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function evStartDay(ev: any) { return startOfDay(parseISO(ev.startsAt)); }
function evEndDay(ev: any)   { return startOfDay(ev.endsAt ? parseISO(ev.endsAt) : parseISO(ev.startsAt)); }

function eventsForDay(evs: any[], day: Date) {
  const d = startOfDay(day);
  return evs.filter(ev => {
    try { return !isBefore(d, evStartDay(ev)) && !isAfter(d, evEndDay(ev)); }
    catch { return false; }
  });
}

type EventLayout = {
  ev: any; startCol: number; endCol: number; lane: number;
  isStart: boolean; isEnd: boolean;
};

function layoutWeekEvents(weekDays: Date[], allEvents: any[]): EventLayout[] {
  const wStart = startOfDay(weekDays[0]);
  const wEnd   = startOfDay(weekDays[6]);

  const overlapping = allEvents
    .filter(ev => {
      try { return !isBefore(evEndDay(ev), wStart) && !isAfter(evStartDay(ev), wEnd); }
      catch { return false; }
    })
    .sort((a, b) => {
      const diff = evStartDay(a).getTime() - evStartDay(b).getTime();
      if (diff !== 0) return diff;
      return (evEndDay(b).getTime() - evStartDay(b).getTime()) -
             (evEndDay(a).getTime() - evStartDay(a).getTime());
    });

  const layouts: EventLayout[] = [];
  const laneNext: number[] = [];

  for (const ev of overlapping) {
    const es = evStartDay(ev);
    const ee = evEndDay(ev);

    let startCol = 0;
    for (let i = 0; i < 7; i++) {
      if (!isBefore(startOfDay(weekDays[i]), es)) { startCol = i; break; }
    }
    if (isBefore(es, wStart)) startCol = 0;

    let endCol = 6;
    for (let i = 6; i >= 0; i--) {
      if (!isAfter(startOfDay(weekDays[i]), ee)) { endCol = i; break; }
    }

    const isStart = !isBefore(es, wStart) && isSameDay(es, weekDays[startCol]);
    const isEnd   = !isAfter(ee, wEnd);

    let lane = 0;
    while (laneNext[lane] !== undefined && laneNext[lane] > startCol) lane++;
    laneNext[lane] = endCol + 1;

    layouts.push({ ev, startCol, endCol, lane, isStart, isEnd });
  }
  return layouts;
}

const DOW_FULL  = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
const DOW_SHORT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

const STATUS_LABELS: Record<string, string> = {
  scheduled:'Agendado', confirmed:'Confirmado', cancelled:'Cancelado',
  completed:'Concluído', rescheduled:'Reagendado',
};

const HOUR_HEIGHT = 56;
const START_HOUR  = 7;
const END_HOUR    = 22;
const HOURS       = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => i + START_HOUR);
const MAX_LANES   = 3;
const LANE_H      = 22;
const DATE_H      = 32;

// ── Component ────────────────────────────────────────────────────────────────
export default function AgendaPage() {
  const { user } = useAuthStore();
  const router   = useRouter();

  const [viewMode,     setViewMode]     = useState<ViewMode>('month');
  const [currentDate,  setCurrentDate]  = useState(new Date());
  const [events,       setEvents]       = useState<any[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [miniMonth,    setMiniMonth]    = useState(new Date());
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter,   setTypeFilter]   = useState('');

  // Event types (customizable)
  const [eventTypes, setEventTypes] = useState<EventTypeConfig[]>(DEFAULT_TYPES);
  useEffect(() => { setEventTypes(loadTypes()); }, []);

  // Type manager state
  const [showTypeManager, setShowTypeManager] = useState(false);
  const [newTypeName,     setNewTypeName]     = useState('');
  const [newTypeColor,    setNewTypeColor]    = useState(PRESET_COLORS[0]);
  const [editingType,     setEditingType]     = useState<string | null>(null);
  const [editLabel,       setEditLabel]       = useState('');

  function persistTypes(types: EventTypeConfig[]) {
    setEventTypes(types);
    saveTypes(types);
  }

  function addType() {
    if (!newTypeName.trim()) return;
    const key = newTypeName.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (eventTypes.some(t => t.key === key)) return;
    const next = [...eventTypes, { key, label: newTypeName.trim(), color: newTypeColor }];
    persistTypes(next);
    setNewTypeName('');
    setNewTypeColor(PRESET_COLORS[0]);
  }

  function deleteType(key: string) {
    persistTypes(eventTypes.filter(t => t.key !== key));
  }

  function saveEditType(key: string) {
    if (!editLabel.trim()) { setEditingType(null); return; }
    persistTypes(eventTypes.map(t => t.key === key ? { ...t, label: editLabel.trim() } : t));
    setEditingType(null);
  }

  // Helpers
  function getTypeColor(key: string) { return colorFromType(eventTypes, key); }
  function getTypeBg(key: string)    { return bgFromColor(getTypeColor(key)); }
  function getTypeLabel(key: string) { return eventTypes.find(t => t.key === key)?.label || key; }

  // Data fetching
  const getVisibleRange = useCallback(() => {
    if (viewMode === 'month') {
      const s = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 0 });
      return { from: s, to: addDays(s, 41) };
    }
    if (viewMode === 'week') {
      const s = startOfWeek(currentDate, { weekStartsOn: 0 });
      return { from: s, to: addDays(s, 6) };
    }
    if (viewMode === 'day')
      return { from: startOfDay(currentDate), to: startOfDay(currentDate) };
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
      setEvents(raw?.data || raw?.items || (Array.isArray(raw) ? raw : []));
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
        return `${format(s,'d')}–${format(e,'d')} de ${format(s,'MMMM yyyy',{locale:ptBR})}`;
      return `${format(s,'d MMM',{locale:ptBR})} – ${format(e,'d MMM yyyy',{locale:ptBR})}`;
    }
    if (viewMode === 'day') return format(currentDate, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });
    return format(currentDate, 'MMMM yyyy', { locale: ptBR });
  }

  if (!hasPermission(user, 'agenda.view')) {
    return <div style={{ padding:40, textAlign:'center', color:'#94A3B8' }}>Acesso negado.</div>;
  }

  // ── MONTH VIEW ──────────────────────────────────────────────────────────────
  function renderWeekRow(weekDays: Date[], weekIdx: number) {
    const layouts = layoutWeekEvents(weekDays, events);
    const usedLanes = layouts.length > 0 ? Math.max(...layouts.map(l => l.lane)) + 1 : 0;
    const cellHeight = DATE_H + Math.min(usedLanes, MAX_LANES) * LANE_H + 10;

    const hiddenPerDay: Record<number, number> = {};
    layouts.forEach(({ startCol, lane, isStart }) => {
      if (lane >= MAX_LANES && isStart) hiddenPerDay[startCol] = (hiddenPerDay[startCol] || 0) + 1;
    });

    return (
      <div key={weekIdx} style={{
        display: 'grid', gridTemplateColumns: 'repeat(7,1fr)',
        position: 'relative', minHeight: Math.max(cellHeight, 110),
        borderBottom: weekIdx < 5 ? '1px solid #E5E9F0' : 'none',
        flex: 1,
      }}>
        {weekDays.map((day, di) => {
          const inMonth   = isSameMonth(day, currentDate);
          const todayFlag = isToday(day);
          const hidden    = hiddenPerDay[di] || 0;
          const dateStr   = format(day, 'yyyy-MM-dd');
          return (
            <div key={di}
              style={{ borderRight: di < 6 ? '1px solid #E5E9F0' : 'none', position: 'relative', background: '#fff' }}
              onMouseEnter={e => { (e.currentTarget.style.background = '#F8FAFC'); }}
              onMouseLeave={e => { (e.currentTarget.style.background = '#fff'); }}
            >
              {/* Day number + quick-add */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'6px 8px 2px' }}>
                <span
                  onClick={() => { setCurrentDate(day); setViewMode('day'); }}
                  style={{
                    width:26, height:26, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:12, fontWeight: todayFlag ? 700 : 500, cursor:'pointer',
                    background: todayFlag ? '#1D4ED8' : 'transparent',
                    color: todayFlag ? '#fff' : inMonth ? '#1D4ED8' : '#CBD5E1',
                  }}>{format(day,'d')}</span>
                {hasPermission(user, 'agenda.create') && (
                  <button
                    onClick={() => router.push(`/dashboard/agenda/novo?date=${dateStr}`)}
                    style={{ width:22, height:22, borderRadius:'50%', border:'1.5px solid #BFDBFE', background:'transparent', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#3B82F6', opacity: inMonth ? 1 : 0.3 }}
                  ><Plus size={11} /></button>
                )}
              </div>
              {/* Hidden count */}
              {hidden > 0 && (
                <div style={{ position:'absolute', bottom:4, left:0, right:0, textAlign:'center', fontSize:9, color:'#6366F1', fontWeight:700 }}>+{hidden} mais</div>
              )}
            </div>
          );
        })}

        {/* Event bars */}
        {layouts.filter(l => l.lane < MAX_LANES).map(({ ev, startCol, endCol, lane, isStart, isEnd }) => {
          const color  = getTypeColor(ev.eventType);
          const bg     = getTypeBg(ev.eventType);
          const cancelled = ev.status === 'cancelled';
          const colW   = 100 / 7;
          const left   = `calc(${startCol * colW}% + 1px)`;
          const width  = `calc(${(endCol - startCol + 1) * colW}% - 2px)`;
          const top    = DATE_H + lane * LANE_H;
          const br     = `${isStart?4:0}px ${isEnd?4:0}px ${isEnd?4:0}px ${isStart?4:0}px`;
          return (
            <div key={`${ev.id}-w${weekIdx}`}
              onClick={e => { e.stopPropagation(); router.push(`/dashboard/agenda/${ev.id}`); }}
              title={ev.title}
              style={{
                position:'absolute', left, width, top, height: LANE_H - 3,
                background: isStart ? bg : bg,
                borderLeft: isStart ? `3px solid ${color}` : `1px solid ${color}33`,
                borderRight: isEnd ? `1px solid ${color}33` : 'none',
                borderTop: `1px solid ${color}33`, borderBottom: `1px solid ${color}33`,
                borderRadius: br,
                padding:'2px 6px', fontSize:11, fontWeight:600, color,
                cursor:'pointer', overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis',
                textDecoration: cancelled ? 'line-through' : 'none',
                opacity: cancelled ? 0.55 : 1, zIndex: lane + 2,
              }}>
              {isStart && (
                <>{!ev.allDay && <span style={{opacity:0.65, fontSize:10}}>{format(parseISO(ev.startsAt),'HH:mm')} </span>}{ev.title}</>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  function renderMonth() {
    const days  = getMonthGridDays(currentDate);
    const weeks = Array.from({ length: 6 }, (_, w) => days.slice(w*7, w*7+7));
    return (
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        {/* Header — dark blue, full day names */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', background:'#0F2B5B', flexShrink:0 }}>
          {DOW_FULL.map((d, i) => (
            <div key={d} style={{ padding:'11px 8px', textAlign:'center', fontSize:12, fontWeight:700, color:'#fff', borderRight: i < 6 ? '1px solid rgba(255,255,255,0.1)' : 'none', letterSpacing:'0.01em' }}>{d}</div>
          ))}
        </div>
        {/* Grid */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
          {weeks.map((wd, wi) => renderWeekRow(wd, wi))}
        </div>
      </div>
    );
  }

  // ── WEEK VIEW ───────────────────────────────────────────────────────────────
  function renderWeek() {
    const days = getWeekDays(currentDate);
    const multiDayLayouts = layoutWeekEvents(days, events.filter(e => {
      try { return e.allDay || !isSameDay(parseISO(e.startsAt), e.endsAt ? parseISO(e.endsAt) : parseISO(e.startsAt)); }
      catch { return false; }
    }));
    const maxAllDayLane = multiDayLayouts.length > 0 ? Math.max(...multiDayLayouts.map(l => l.lane)) + 1 : 0;
    const timedEvents   = events.filter(e => {
      try { return !e.allDay && isSameDay(parseISO(e.startsAt), e.endsAt ? parseISO(e.endsAt) : parseISO(e.startsAt)); }
      catch { return false; }
    });

    return (
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ display:'grid', gridTemplateColumns:'52px repeat(7,1fr)', background:'#0F2B5B', flexShrink:0 }}>
          <div style={{ borderRight:'1px solid rgba(255,255,255,0.1)' }} />
          {days.map((day, i) => {
            const todayFlag = isToday(day);
            return (
              <div key={i} style={{ textAlign:'center', padding:'6px 4px', borderRight: i<6 ? '1px solid rgba(255,255,255,0.1)' : 'none' }}>
                <div style={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.7)', textTransform:'uppercase', letterSpacing:'0.05em' }}>{DOW_SHORT[i]}</div>
                <div onClick={() => { setCurrentDate(day); setViewMode('day'); }}
                  style={{ width:26, height:26, borderRadius:'50%', margin:'2px auto 0', background: todayFlag ? '#3B82F6' : 'transparent', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, color: todayFlag ? '#fff' : isSameDay(day,currentDate) ? '#93C5FD' : '#fff', cursor:'pointer' }}>
                  {format(day,'d')}
                </div>
              </div>
            );
          })}
        </div>

        {maxAllDayLane > 0 && (
          <div style={{ display:'grid', gridTemplateColumns:'52px repeat(7,1fr)', borderBottom:'1px solid #E5E9F0', flexShrink:0, position:'relative', height: DATE_H + maxAllDayLane * LANE_H + 4 }}>
            <div style={{ fontSize:9, color:'#94A3B8', padding:'4px 6px', textAlign:'right', paddingTop:6, borderRight:'1px solid #E5E9F0' }}>dia todo</div>
            {days.map((_,i) => <div key={i} style={{ borderRight: i<6?'1px solid #E5E9F0':'none' }} />)}
            {multiDayLayouts.map(({ ev, startCol, endCol, lane, isStart, isEnd }) => {
              const color = getTypeColor(ev.eventType);
              const bg    = getTypeBg(ev.eventType);
              const colW  = 100 / 7;
              const left  = `calc(52px + ${startCol * colW}% + 1px)`;
              const width = `calc(${(endCol - startCol + 1) * colW}% - 2px)`;
              const top   = 4 + lane * LANE_H;
              const br    = `${isStart?3:0}px ${isEnd?3:0}px ${isEnd?3:0}px ${isStart?3:0}px`;
              return (
                <div key={`${ev.id}-wk-ad`}
                  onClick={() => router.push(`/dashboard/agenda/${ev.id}`)}
                  title={ev.title}
                  style={{ position:'absolute', left, width, top, height: LANE_H - 3, background: bg, borderLeft: isStart ? `3px solid ${color}` : 'none', borderRadius: br, padding:'1px 5px', fontSize:10, fontWeight:600, color, cursor:'pointer', overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis', zIndex: lane+2 }}>
                  {isStart && ev.title}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ flex:1, overflowY:'auto' }}>
          <div style={{ display:'grid', gridTemplateColumns:'52px repeat(7,1fr)' }}>
            <div>{HOURS.map(h => (
              <div key={h} style={{ height:HOUR_HEIGHT, display:'flex', alignItems:'flex-start', justifyContent:'flex-end', paddingRight:8, paddingTop:3, fontSize:10, color:'#94A3B8', fontWeight:600, boxSizing:'border-box' }}>
                {String(h).padStart(2,'0')}:00
              </div>
            ))}</div>
            {days.map((day, colIdx) => {
              const dayTimed = eventsForDay(timedEvents, day);
              return (
                <div key={colIdx} style={{ borderLeft:'1px solid #E5E9F0', position:'relative', height: HOURS.length * HOUR_HEIGHT }}>
                  {HOURS.map((_,hi) => <div key={hi} style={{ position:'absolute', top: hi*HOUR_HEIGHT, left:0, right:0, borderTop:'1px solid #F1F5F9' }} />)}
                  {isToday(day) && (() => {
                    const now = new Date();
                    const top = (getHours(now) + getMinutes(now)/60 - START_HOUR) * HOUR_HEIGHT;
                    if (top < 0 || top > HOURS.length * HOUR_HEIGHT) return null;
                    return (
                      <div style={{ position:'absolute', top, left:0, right:0, zIndex:10, pointerEvents:'none' }}>
                        <div style={{ height:2, background:'#EF4444' }} />
                        <div style={{ width:8, height:8, borderRadius:'50%', background:'#EF4444', position:'absolute', left:-4, top:-3 }} />
                      </div>
                    );
                  })()}
                  {dayTimed.map(ev => {
                    const start  = parseISO(ev.startsAt);
                    const startH = getHours(start) + getMinutes(start)/60;
                    const endH   = ev.endsAt ? getHours(parseISO(ev.endsAt)) + getMinutes(parseISO(ev.endsAt))/60 : startH+1;
                    const top    = Math.max(0, (startH - START_HOUR) * HOUR_HEIGHT);
                    const height = Math.max(18, (endH - startH) * HOUR_HEIGHT - 2);
                    const color  = getTypeColor(ev.eventType);
                    const bg     = getTypeBg(ev.eventType);
                    return (
                      <div key={ev.id} onClick={() => router.push(`/dashboard/agenda/${ev.id}`)}
                        style={{ position:'absolute', top, left:2, right:2, height, background: bg, borderLeft:`3px solid ${color}`, borderRadius:4, padding:'2px 4px', fontSize:10, fontWeight:600, color, cursor:'pointer', overflow:'hidden', opacity: ev.status==='cancelled'?0.5:1, zIndex:2, boxShadow:'0 1px 3px rgba(0,0,0,0.08)' }}>
                        <div style={{ overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>{ev.title}</div>
                        {height > 28 && <div style={{ fontSize:9, opacity:0.75 }}>{format(start,'HH:mm')}{ev.endsAt ? ` – ${format(parseISO(ev.endsAt),'HH:mm')}` : ''}</div>}
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
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ display:'grid', gridTemplateColumns:'52px 1fr', background:'#0F2B5B', flexShrink:0, padding:'8px 0' }}>
          <div />
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:11, fontWeight:700, color:'rgba(255,255,255,0.7)', textTransform:'uppercase', letterSpacing:'0.05em' }}>{format(currentDate,'EEEE',{locale:ptBR})}</div>
            <div style={{ width:36, height:36, borderRadius:'50%', margin:'4px auto 0', background: isToday(currentDate) ? '#3B82F6' : 'transparent', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, fontWeight:700, color:'#fff' }}>
              {format(currentDate,'d')}
            </div>
          </div>
        </div>
        {dayAllDay.length > 0 && (
          <div style={{ display:'grid', gridTemplateColumns:'52px 1fr', borderBottom:'1px solid #E5E9F0', flexShrink:0, padding:'4px 0' }}>
            <div style={{ fontSize:9, color:'#94A3B8', textAlign:'right', paddingRight:8, paddingTop:6 }}>dia todo</div>
            <div style={{ padding:'2px 8px' }}>
              {dayAllDay.map(ev => {
                const color = getTypeColor(ev.eventType);
                const bg    = getTypeBg(ev.eventType);
                return <div key={ev.id} onClick={() => router.push(`/dashboard/agenda/${ev.id}`)} style={{ fontSize:11, fontWeight:600, padding:'3px 8px', borderRadius:4, marginBottom:2, background: bg, color, borderLeft:`3px solid ${color}`, cursor:'pointer' }}>{ev.title}</div>;
              })}
            </div>
          </div>
        )}
        <div style={{ flex:1, overflowY:'auto' }}>
          <div style={{ display:'grid', gridTemplateColumns:'52px 1fr' }}>
            <div>{HOURS.map(h => (
              <div key={h} style={{ height:HOUR_HEIGHT, display:'flex', alignItems:'flex-start', justifyContent:'flex-end', paddingRight:8, paddingTop:3, fontSize:10, color:'#94A3B8', fontWeight:600, boxSizing:'border-box' }}>
                {String(h).padStart(2,'0')}:00
              </div>
            ))}</div>
            <div style={{ position:'relative', height: HOURS.length * HOUR_HEIGHT, borderLeft:'1px solid #E5E9F0' }}>
              {HOURS.map((_,hi) => <div key={hi} style={{ position:'absolute', top: hi*HOUR_HEIGHT, left:0, right:0, borderTop:'1px solid #F1F5F9' }} />)}
              {isToday(currentDate) && (() => {
                const now = new Date();
                const top = (getHours(now) + getMinutes(now)/60 - START_HOUR) * HOUR_HEIGHT;
                if (top < 0 || top > HOURS.length * HOUR_HEIGHT) return null;
                return (
                  <div style={{ position:'absolute', top, left:0, right:0, zIndex:10, pointerEvents:'none' }}>
                    <div style={{ height:2, background:'#EF4444' }} />
                    <div style={{ width:8, height:8, borderRadius:'50%', background:'#EF4444', position:'absolute', left:-4, top:-3 }} />
                  </div>
                );
              })()}
              {dayTimed.map(ev => {
                const start  = parseISO(ev.startsAt);
                const startH = getHours(start) + getMinutes(start)/60;
                const endH   = ev.endsAt ? getHours(parseISO(ev.endsAt)) + getMinutes(parseISO(ev.endsAt))/60 : startH+1;
                const top    = Math.max(0, (startH - START_HOUR) * HOUR_HEIGHT);
                const height = Math.max(22, (endH - startH) * HOUR_HEIGHT - 2);
                const color  = getTypeColor(ev.eventType);
                const bg     = getTypeBg(ev.eventType);
                return (
                  <div key={ev.id} onClick={() => router.push(`/dashboard/agenda/${ev.id}`)}
                    style={{ position:'absolute', top, left:6, right:6, height, background: bg, borderLeft:`3px solid ${color}`, borderRadius:5, padding:'4px 8px', cursor:'pointer', overflow:'hidden', opacity: ev.status==='cancelled'?0.5:1, zIndex:2, boxShadow:'0 1px 4px rgba(0,0,0,0.1)' }}>
                    <div style={{ fontSize:12, fontWeight:700, color, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis', textDecoration: ev.status==='cancelled'?'line-through':'none' }}>{ev.title}</div>
                    {height > 30 && <div style={{ fontSize:10, color, opacity:0.75 }}>{format(start,'HH:mm')}{ev.endsAt ? ` – ${format(parseISO(ev.endsAt),'HH:mm')}` : ''}</div>}
                    {height > 46 && ev.location && <div style={{ fontSize:10, color, opacity:0.65 }}>📍 {ev.location}</div>}
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
      .filter(ev => !typeFilter  || ev.eventType === typeFilter)
      .sort((a,b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

    const groups: Record<string, any[]> = {};
    filtered.forEach(ev => {
      const key = format(parseISO(ev.startsAt), 'yyyy-MM-dd');
      if (!groups[key]) groups[key] = [];
      groups[key].push(ev);
    });

    return (
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ display:'flex', gap:8, padding:'12px 16px', borderBottom:'1px solid #E5E9F0', flexShrink:0 }}>
          <select style={{ padding:'6px 10px', border:'1.5px solid #E2E8F0', borderRadius:8, fontSize:12, color:'#0F172A', background:'#fff' }}
            value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">Todos os status</option>
            {Object.entries(STATUS_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select style={{ padding:'6px 10px', border:'1.5px solid #E2E8F0', borderRadius:8, fontSize:12, color:'#0F172A', background:'#fff' }}
            value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="">Todos os tipos</option>
            {eventTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'0 16px 24px' }}>
          {Object.keys(groups).length === 0 && !loading && (
            <div style={{ textAlign:'center', padding:40, color:'#94A3B8', fontSize:14 }}>Nenhum evento neste período</div>
          )}
          {Object.entries(groups).map(([dateKey, dayEvents]) => {
            const day = parseISO(dateKey);
            return (
              <div key={dateKey} style={{ marginBottom:8 }}>
                <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 0 6px' }}>
                  <div style={{ width:36, height:36, borderRadius:'50%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', flexShrink:0, background: isToday(day) ? '#1D4ED8' : '#F1F5F9', color: isToday(day) ? '#fff' : '#64748B' }}>
                    <span style={{ fontSize:14, fontWeight:700, lineHeight:1 }}>{format(day,'d')}</span>
                  </div>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:'#0F172A', textTransform:'capitalize' }}>{format(day,'EEEE',{locale:ptBR})}</div>
                    <div style={{ fontSize:11, color:'#94A3B8' }}>{format(day,"dd 'de' MMMM",{locale:ptBR})}</div>
                  </div>
                  <div style={{ flex:1, height:1, background:'#E5E9F0', marginLeft:4 }} />
                </div>
                {dayEvents.map(ev => {
                  const color = getTypeColor(ev.eventType);
                  const bg    = getTypeBg(ev.eventType);
                  return (
                    <div key={ev.id} onClick={() => router.push(`/dashboard/agenda/${ev.id}`)}
                      style={{ display:'flex', alignItems:'flex-start', gap:12, padding:'10px 14px', borderRadius:8, marginBottom:4, border:'1px solid #E5E9F0', background:'#fff', cursor:'pointer', borderLeft:`4px solid ${color}`, transition:'background 0.1s' }}
                      onMouseEnter={e => (e.currentTarget.style.background='#F8FAFC')}
                      onMouseLeave={e => (e.currentTarget.style.background='#fff')}
                    >
                      <div style={{ width:42, textAlign:'center', flexShrink:0 }}>
                        {ev.allDay ? <span style={{ fontSize:10, color:'#94A3B8', fontWeight:600 }}>dia todo</span>
                          : <span style={{ fontSize:12, fontWeight:700, color }}>{format(parseISO(ev.startsAt),'HH:mm')}</span>}
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:700, color:'#0F172A', overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>{ev.title}</div>
                        <div style={{ fontSize:11, color:'#64748B', marginTop:2 }}>
                          {getTypeLabel(ev.eventType)}{ev.location && ` · 📍 ${ev.location}`}{ev.assignedUser?.name && ` · 👤 ${ev.assignedUser.name}`}
                        </div>
                      </div>
                      <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20, background: bg, color, whiteSpace:'nowrap' }}>
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

  // ── MINI CALENDAR ───────────────────────────────────────────────────────────
  function renderMiniCalendar() {
    const days = getMonthGridDays(miniMonth);
    return (
      <div style={{ padding:'0 6px' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
          <button onClick={() => setMiniMonth(d => subMonths(d,1))} style={{ background:'none', border:'none', cursor:'pointer', color:'#64748B', padding:4, display:'flex', alignItems:'center' }}><ChevronLeft size={13}/></button>
          <span style={{ fontSize:11, fontWeight:700, color:'#0F172A', textTransform:'capitalize' }}>{format(miniMonth,'MMM yyyy',{locale:ptBR})}</span>
          <button onClick={() => setMiniMonth(d => addMonths(d,1))} style={{ background:'none', border:'none', cursor:'pointer', color:'#64748B', padding:4, display:'flex', alignItems:'center' }}><ChevronRight size={13}/></button>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', marginBottom:2 }}>
          {['D','S','T','Q','Q','S','S'].map((d,i) => (
            <div key={i} style={{ textAlign:'center', fontSize:9, fontWeight:700, color:'#94A3B8', padding:'2px 0' }}>{d}</div>
          ))}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)' }}>
          {days.map((day, idx) => {
            const inMonth   = isSameMonth(day, miniMonth);
            const todayFlag = isToday(day);
            const selected  = isSameDay(day, currentDate);
            const hasEvent  = eventsForDay(events, day).length > 0;
            return (
              <div key={idx} onClick={() => { setCurrentDate(day); setMiniMonth(day); if (viewMode==='month') setViewMode('day'); }}
                style={{ textAlign:'center', padding:'2px 0', cursor:'pointer' }}>
                <span style={{ width:22, height:22, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto', fontSize:10, fontWeight: selected||todayFlag ? 700 : 400, background: selected ? '#1D4ED8' : todayFlag ? '#3B82F6' : 'transparent', color: selected||todayFlag ? '#fff' : inMonth ? '#0F172A' : '#CBD5E1' }}>
                  {format(day,'d')}
                </span>
                {hasEvent && !selected && !todayFlag && (
                  <div style={{ width:3, height:3, borderRadius:'50%', background:'#3B82F6', margin:'-2px auto 0' }} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── TYPE MANAGER ────────────────────────────────────────────────────────────
  function renderTypeManager() {
    return (
      <div style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:14, padding:'14px', boxShadow:'0 1px 4px rgba(0,0,0,0.04)' }}>
        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
          <span style={{ fontSize:11, fontWeight:700, color:'#0F172A', letterSpacing:'0.04em' }}>TIPOS DE EVENTO</span>
          <button onClick={() => setShowTypeManager(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'#94A3B8', display:'flex', alignItems:'center' }}><X size={14}/></button>
        </div>

        {/* Existing types */}
        <div style={{ marginBottom:12 }}>
          {eventTypes.map(t => (
            <div key={t.key} style={{ display:'flex', alignItems:'center', gap:6, marginBottom:6, padding:'4px 6px', borderRadius:8, background:'#F8FAFC' }}>
              <div style={{ width:12, height:12, borderRadius:3, background: t.color, flexShrink:0 }} />
              {editingType === t.key ? (
                <>
                  <input
                    autoFocus
                    value={editLabel}
                    onChange={e => setEditLabel(e.target.value)}
                    onKeyDown={e => { if (e.key==='Enter') saveEditType(t.key); if (e.key==='Escape') setEditingType(null); }}
                    style={{ flex:1, fontSize:11, padding:'2px 6px', border:'1.5px solid #6366F1', borderRadius:6, outline:'none' }}
                  />
                  <button onClick={() => saveEditType(t.key)} style={{ background:'none', border:'none', cursor:'pointer', color:'#10B981', display:'flex' }}><Check size={12}/></button>
                  <button onClick={() => setEditingType(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'#94A3B8', display:'flex' }}><X size={12}/></button>
                </>
              ) : (
                <>
                  <span style={{ flex:1, fontSize:11, color:'#0F172A', fontWeight:500 }}>{t.label}</span>
                  <button onClick={() => { setEditingType(t.key); setEditLabel(t.label); }} style={{ background:'none', border:'none', cursor:'pointer', color:'#94A3B8', display:'flex', alignItems:'center' }}><Pencil size={11}/></button>
                  <button onClick={() => deleteType(t.key)} style={{ background:'none', border:'none', cursor:'pointer', color:'#EF4444', display:'flex', alignItems:'center' }}><Trash2 size={11}/></button>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Add new type */}
        <div style={{ borderTop:'1px solid #F1F5F9', paddingTop:10 }}>
          <div style={{ fontSize:10, fontWeight:700, color:'#94A3B8', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.06em' }}>Novo tipo</div>
          <input
            placeholder="Nome do tipo..."
            value={newTypeName}
            onChange={e => setNewTypeName(e.target.value)}
            onKeyDown={e => { if (e.key==='Enter') addType(); }}
            style={{ width:'100%', padding:'6px 8px', border:'1.5px solid #E2E8F0', borderRadius:8, fontSize:11, color:'#0F172A', outline:'none', marginBottom:8, boxSizing:'border-box' as const }}
          />
          {/* Color swatches */}
          <div style={{ display:'flex', flexWrap:'wrap' as const, gap:5, marginBottom:8 }}>
            {PRESET_COLORS.map(c => (
              <div key={c} onClick={() => setNewTypeColor(c)}
                style={{ width:18, height:18, borderRadius:4, background: c, cursor:'pointer', border: newTypeColor===c ? '2px solid #0F172A' : '2px solid transparent', boxSizing:'border-box' as const }} />
            ))}
          </div>
          <button onClick={addType}
            style={{ width:'100%', padding:'7px', borderRadius:8, background: newTypeName.trim() ? '#1D4ED8' : '#E2E8F0', color: newTypeName.trim() ? '#fff' : '#94A3B8', fontSize:11, fontWeight:600, border:'none', cursor: newTypeName.trim() ? 'pointer' : 'default', display:'flex', alignItems:'center', justifyContent:'center', gap:5 }}>
            <Plus size={12}/> Adicionar tipo
          </button>
        </div>
      </div>
    );
  }

  const VIEW_BUTTONS: { key: ViewMode; label: string }[] = [
    { key:'day', label:'Dia' }, { key:'week', label:'Semana' },
    { key:'month', label:'Mês' }, { key:'list', label:'Lista' },
  ];

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 120px)', overflow:'hidden' }}>
      {/* Toolbar */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', paddingBottom:12, flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:38, height:38, borderRadius:11, display:'flex', alignItems:'center', justifyContent:'center', background:'linear-gradient(135deg,#1D4ED8,#3B82F6)', boxShadow:'0 4px 12px rgba(59,130,246,0.3)' }}>
            <CalendarDays size={17} color="#fff"/>
          </div>
          <button onClick={() => { setCurrentDate(new Date()); setMiniMonth(new Date()); }}
            style={{ padding:'6px 14px', borderRadius:8, border:'1.5px solid #E2E8F0', background:'#fff', color:'#0F172A', fontSize:12, fontWeight:600, cursor:'pointer' }}>
            Hoje
          </button>
          <button onClick={() => navigate(-1)} style={{ width:30, height:30, borderRadius:8, border:'1.5px solid #E2E8F0', background:'#fff', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#64748B' }}>
            <ChevronLeft size={15}/>
          </button>
          <button onClick={() => navigate(1)} style={{ width:30, height:30, borderRadius:8, border:'1.5px solid #E2E8F0', background:'#fff', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#64748B' }}>
            <ChevronRight size={15}/>
          </button>
          <h1 style={{ fontSize:17, fontWeight:700, color:'#0F172A', margin:0, textTransform:'capitalize' }}>{periodTitle()}</h1>
          {loading && <div style={{ width:13, height:13, border:'2px solid #E2E8F0', borderTopColor:'#3B82F6', borderRadius:'50%', animation:'spin 0.7s linear infinite' }}/>}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ display:'flex', background:'#F1F5F9', borderRadius:10, padding:3, gap:2 }}>
            {VIEW_BUTTONS.map(v => (
              <button key={v.key} onClick={() => setViewMode(v.key)}
                style={{ padding:'5px 13px', borderRadius:8, border:'none', cursor:'pointer', fontSize:12, fontWeight:600, background: viewMode===v.key ? '#fff' : 'transparent', color: viewMode===v.key ? '#1D4ED8' : '#64748B', boxShadow: viewMode===v.key ? '0 1px 4px rgba(0,0,0,0.1)' : 'none', transition:'all 0.15s' }}>
                {v.label}
              </button>
            ))}
          </div>
          <Link href="/dashboard/agenda/integracoes"
            style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'7px 12px', borderRadius:8, border:'1.5px solid #E2E8F0', background:'#fff', color:'#64748B', fontSize:12, fontWeight:500, textDecoration:'none' }}>
            <Link2 size={12}/> Integrações
          </Link>
          {hasPermission(user, 'agenda.create') && (
            <Link href="/dashboard/agenda/novo"
              style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'7px 14px', borderRadius:8, background:'linear-gradient(135deg,#1D4ED8,#3B82F6)', color:'#fff', fontSize:12, fontWeight:600, textDecoration:'none', boxShadow:'0 2px 8px rgba(29,78,216,0.35)' }}>
              <Plus size={13}/> Novo Evento
            </Link>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex:1, display:'flex', gap:12, overflow:'hidden' }}>
        {/* Sidebar */}
        <div style={{ width:190, flexShrink:0, display:'flex', flexDirection:'column', gap:10, overflowY:'auto' }}>
          {/* Mini calendar */}
          <div style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:14, padding:'12px 4px', boxShadow:'0 1px 4px rgba(0,0,0,0.04)' }}>
            {renderMiniCalendar()}
          </div>

          {/* Legend / Type manager toggle */}
          {showTypeManager ? renderTypeManager() : (
            <div style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:14, padding:'12px 14px', boxShadow:'0 1px 4px rgba(0,0,0,0.04)' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                <span style={{ fontSize:10, fontWeight:700, color:'#94A3B8', letterSpacing:'0.06em', textTransform:'uppercase' }}>Legenda</span>
                <button
                  onClick={() => setShowTypeManager(true)}
                  title="Gerenciar tipos"
                  style={{ background:'none', border:'none', cursor:'pointer', color:'#64748B', display:'flex', alignItems:'center', padding:2 }}>
                  <Pencil size={12}/>
                </button>
              </div>
              {eventTypes.map(t => (
                <div key={t.key} style={{ display:'flex', alignItems:'center', gap:7, marginBottom:6 }}>
                  <div style={{ width:10, height:10, borderRadius:3, background: t.color, flexShrink:0 }} />
                  <span style={{ fontSize:11, color:'#64748B' }}>{t.label}</span>
                </div>
              ))}
              <button onClick={() => setShowTypeManager(true)}
                style={{ marginTop:6, width:'100%', padding:'6px', borderRadius:8, border:'1.5px dashed #E2E8F0', background:'transparent', color:'#94A3B8', fontSize:11, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:5 }}>
                <Plus size={11}/> Novo tipo
              </button>
            </div>
          )}
        </div>

        {/* Main panel */}
        <div style={{ flex:1, background:'#fff', border:'1px solid #E2E8F0', borderRadius:14, overflow:'hidden', display:'flex', flexDirection:'column', boxShadow:'0 1px 4px rgba(0,0,0,0.04)' }}>
          {viewMode==='month' && renderMonth()}
          {viewMode==='week'  && renderWeek()}
          {viewMode==='day'   && renderDay()}
          {viewMode==='list'  && renderList()}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
