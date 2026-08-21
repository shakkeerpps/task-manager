'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { format, addDays, startOfWeek, isToday, parseISO, getDay, getDate, differenceInSeconds, startOfDay } from 'date-fns';
import { 
  Search, Plus, Calendar, AlertCircle, Clock, History, Trash2, X, RotateCcw, 
  Repeat, Bell, CheckCircle2, Video, Eye, EyeOff, Users, Mail, Edit3, 
  Sparkles, Layers, ShieldCheck, Tag,
  Bold, Italic, Underline, Strikethrough, List, ListOrdered, Heading1, Heading2, 
  AlignLeft, AlignCenter, AlignRight, AlignJustify, Quote, Code, RemoveFormatting,
  Palette, Highlighter, Table as TableIcon, Undo, Redo, Type, CheckSquare, Ban,
  Check, RefreshCw, PlayCircle, ExternalLink, Volume2, Copy
} from 'lucide-react';

interface Department {
  id: string;
  name: string;
  color: string;
}

type TaskStatus = 'Open' | 'In Progress' | 'Pending' | 'Completed' | 'Resolved' | 'Blocked' | 'Cancelled';
type TaskPriority = 'Crit' | 'High' | 'Medi' | 'Low';
type TaskFrequency = 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly';
type EntryType = 'task' | 'event';

interface Task {
  id: string;
  title: string;
  department_id: string;
  priority: TaskPriority;
  status: TaskStatus;
  type: EntryType;
  meet_link?: string | null;
  participants: string[];
  start_date?: string | null;
  due_date: string;
  start_time?: string | null;
  due_time?: string | null;
  description?: string;
  frequency: TaskFrequency;
  recurring_day?: string;
  recurring_date?: number;
  completed_dates?: string[];
  cancelled_dates?: string[];
}

interface HistoryItem {
  id: string;
  action: string;
  changed_at: string;
}

interface ActiveReminder {
  task: Task;
  diffSeconds: number;
  timeLabel: string;
  isOverdue: boolean;
  typeLabel: 'start' | 'due' | 'start-pre' | 'due-pre';
}

interface SelectedInstance {
  task: Task;
  dateStr: string;
  isCompleted: boolean;
  isCancelled: boolean;
}

interface UrgentPopupAlert {
  task: Task;
  alertType: 'start' | 'due';
  timeStr: string;
  message: string;
}

const PRIORITY_STYLES: Record<TaskPriority, string> = {
  Crit: 'bg-rose-50 text-rose-700 border-rose-200 font-bold',
  High: 'bg-amber-50 text-amber-700 border-amber-200 font-bold',
  Medi: 'bg-blue-50 text-blue-700 border-blue-200 font-medium',
  Low: 'bg-slate-100 text-slate-600 border-slate-200 font-medium',
};

const STATUS_STYLES: Record<TaskStatus, string> = {
  Open: 'bg-blue-50 text-blue-700 border-blue-200',
  'In Progress': 'bg-sky-50 text-sky-700 border-sky-200',
  Pending: 'bg-amber-50 text-amber-700 border-amber-200',
  Completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Resolved: 'bg-purple-50 text-purple-700 border-purple-200',
  Blocked: 'bg-rose-50 text-rose-700 border-rose-200',
  Cancelled: 'bg-slate-100 text-slate-500 border-slate-200 line-through',
};

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// 🎯 ACCURATE TIMING & OVERDUE CALCULATION
const getTaskTimingState = (task: Task, now: Date) => {
  const isDone = task.status === 'Completed' || task.status === 'Resolved' || task.status === 'Cancelled';
  if (isDone) return { isOverdue: false, isStartingSoon: false, isStartNow: false, label: task.status, badgeClass: STATUS_STYLES[task.status] };

  // Due Time calculation
  const [dh, dm] = (task.due_time || '23:59').split(':').map(Number);
  const dueParts = task.due_date.split('-').map(Number);
  const dueDateTime = new Date(dueParts[0], dueParts[1] - 1, dueParts[2], dh, dm, 0);

  const diffDueSec = differenceInSeconds(dueDateTime, now);
  const diffDueMin = Math.floor(diffDueSec / 60);

  // Overdue Check (Only when current time is past Due Date & Time)
  if (diffDueSec < 0) {
    const overdueMins = Math.abs(diffDueMin);
    const hrs = Math.floor(overdueMins / 60);
    const mins = overdueMins % 60;
    const timeTxt = hrs > 0 ? `${hrs}h ${mins}m` : `${overdueMins}m`;
    return {
      isOverdue: true,
      isStartingSoon: false,
      isStartNow: false,
      label: `Overdue by ${timeTxt}`,
      badgeClass: 'bg-rose-100 text-rose-800 border-rose-300 font-bold',
      barClass: 'bg-rose-600 text-white ring-2 ring-rose-400 animate-pulse',
    };
  }

  // Start Time Check
  const effectiveStart = task.start_date || task.due_date;
  const [sh, sm] = (task.start_time || '00:00').split(':').map(Number);
  const startParts = effectiveStart.split('-').map(Number);
  const startDateTime = new Date(startParts[0], startParts[1] - 1, startParts[2], sh, sm, 0);

  const diffStartSec = differenceInSeconds(startDateTime, now);
  const diffStartMin = Math.floor(diffStartSec / 60);

  // Started or Starts within 10 mins
  if (diffStartMin <= 0 && diffDueSec > 0) {
    const hrs = Math.floor(diffDueMin / 60);
    const mins = diffDueMin % 60;
    const dueTxt = hrs > 0 ? `${hrs}h ${mins}m` : `${diffDueMin}m`;

    return {
      isOverdue: false,
      isStartingSoon: true,
      isStartNow: true,
      label: `Start Now (Due in ${dueTxt})`,
      badgeClass: 'bg-amber-100 text-amber-900 border-amber-300 font-bold',
      barClass: 'bg-amber-500 text-slate-950 font-bold ring-2 ring-amber-400',
    };
  }

  // Due in Minutes / Hours
  if (diffDueMin <= 1440) {
    const hrs = Math.floor(diffDueMin / 60);
    const mins = diffDueMin % 60;
    const dueTxt = hrs > 0 ? `${hrs}h ${mins}m` : `${diffDueMin}m`;

    return {
      isOverdue: false,
      isStartingSoon: false,
      isStartNow: false,
      label: `Due in ${dueTxt}`,
      badgeClass: 'bg-blue-100 text-blue-900 border-blue-300 font-semibold',
      barClass: task.type === 'event' ? 'bg-violet-600 text-white' : 'bg-blue-600 text-white',
    };
  }

  return {
    isOverdue: false,
    isStartingSoon: false,
    isStartNow: false,
    label: task.status,
    badgeClass: STATUS_STYLES[task.status],
    barClass: task.type === 'event' ? 'bg-violet-600 text-white' : 'bg-blue-600 text-white',
  };
};

// 🎨 ADVANCED WORD-STYLE RICH TEXT & TABLE EDITOR
function AdvancedRichEditor({ value, onChange }: { value: string; onChange: (val: string) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || '';
    }
  }, [value]);

  const exec = (command: string, val: string | undefined = undefined) => {
    document.execCommand(command, false, val);
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const insertTable = () => {
    const rows = prompt('Enter number of rows:', '3');
    const cols = prompt('Enter number of columns:', '3');
    if (!rows || !cols) return;

    const r = parseInt(rows, 10);
    const c = parseInt(cols, 10);
    if (isNaN(r) || isNaN(c) || r <= 0 || c <= 0) return;

    let tableHtml = `<table style="width:100%; border-collapse:collapse; margin:10px 0; border:1px solid #cbd5e1;"><tbody>`;
    for (let i = 0; i < r; i++) {
      tableHtml += `<tr>`;
      for (let j = 0; j < c; j++) {
        if (i === 0) {
          tableHtml += `<th style="border:1px solid #cbd5e1; padding:8px; background-color:#f1f5f9; text-align:left; font-weight:bold;">Header ${j + 1}</th>`;
        } else {
          tableHtml += `<td style="border:1px solid #cbd5e1; padding:8px;">Data</td>`;
        }
      }
      tableHtml += `</tr>`;
    }
    tableHtml += `</tbody></table><p><br></p>`;

    exec('insertHTML', tableHtml);
  };

  return (
    <div className="border border-slate-300 rounded-xl overflow-hidden bg-white shadow-xs focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent transition">
      <div className="flex flex-wrap items-center gap-1 p-2 bg-slate-100/80 border-b border-slate-200 select-none">
        <button type="button" onClick={() => exec('undo')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700 transition" title="Undo"><Undo className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={() => exec('redo')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700 transition" title="Redo"><Redo className="w-3.5 h-3.5" /></button>
        
        <div className="w-[1px] h-4 bg-slate-300 mx-1" />

        <button type="button" onClick={() => exec('formatBlock', '<h1>')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700 transition" title="Large Heading"><Heading1 className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={() => exec('formatBlock', '<h2>')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700 transition" title="Medium Heading"><Heading2 className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={() => exec('formatBlock', '<p>')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700 transition" title="Normal Paragraph"><Type className="w-3.5 h-3.5" /></button>

        <div className="w-[1px] h-4 bg-slate-300 mx-1" />

        <button type="button" onClick={() => exec('bold')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700 font-bold transition" title="Bold"><Bold className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={() => exec('italic')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700 italic transition" title="Italic"><Italic className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={() => exec('underline')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700 underline transition" title="Underline"><Underline className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={() => exec('strikeThrough')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700 line-through transition" title="Strikethrough"><Strikethrough className="w-3.5 h-3.5" /></button>

        <div className="w-[1px] h-4 bg-slate-300 mx-1" />

        <label className="flex items-center gap-0.5 p-1 hover:bg-slate-200 rounded cursor-pointer text-slate-700" title="Text Color">
          <Palette className="w-3.5 h-3.5 text-blue-600" />
          <input type="color" className="w-4 h-4 p-0 border-0 bg-transparent cursor-pointer" onChange={(e) => exec('foreColor', e.target.value)} />
        </label>

        <label className="flex items-center gap-0.5 p-1 hover:bg-slate-200 rounded cursor-pointer text-slate-700" title="Highlight Color">
          <Highlighter className="w-3.5 h-3.5 text-amber-500" />
          <input type="color" className="w-4 h-4 p-0 border-0 bg-transparent cursor-pointer" defaultValue="#fef08a" onChange={(e) => exec('hiliteColor', e.target.value)} />
        </label>

        <div className="w-[1px] h-4 bg-slate-300 mx-1" />

        <button type="button" onClick={() => exec('justifyLeft')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700 transition" title="Align Left"><AlignLeft className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={() => exec('justifyCenter')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700 transition" title="Align Center"><AlignCenter className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={() => exec('justifyRight')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700 transition" title="Align Right"><AlignRight className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={() => exec('justifyFull')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700 transition" title="Justify"><AlignJustify className="w-3.5 h-3.5" /></button>

        <div className="w-[1px] h-4 bg-slate-300 mx-1" />

        <button type="button" onClick={() => exec('insertUnorderedList')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700 transition" title="Bullet List"><List className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={() => exec('insertOrderedList')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700 transition" title="Numbered List"><ListOrdered className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={insertTable} className="flex items-center gap-1 px-2 py-1 bg-white hover:bg-slate-200 border border-slate-300 rounded text-xs font-bold text-slate-700 shadow-2xs transition" title="Insert Table">
          <TableIcon className="w-3.5 h-3.5 text-blue-600" /> Insert Table
        </button>

        <div className="w-[1px] h-4 bg-slate-300 mx-1" />

        <button type="button" onClick={() => exec('formatBlock', '<blockquote>')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700 transition" title="Quote"><Quote className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={() => exec('formatBlock', '<pre>')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700 transition" title="Code Block"><Code className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={() => exec('removeFormat')} className="p-1.5 hover:bg-slate-200 rounded text-rose-600 transition" title="Clear Formatting"><RemoveFormatting className="w-3.5 h-3.5" /></button>
      </div>

      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        className="p-4 min-h-[140px] max-h-[260px] overflow-y-auto text-xs text-slate-900 outline-none prose prose-sm max-w-none focus:bg-white [&_table]:border-collapse [&_th]:border [&_th]:border-slate-300 [&_th]:p-2 [&_th]:bg-slate-100 [&_td]:border [&_td]:border-slate-300 [&_td]:p-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
      />
    </div>
  );
}

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [savedEmails, setSavedEmails] = useState<string[]>([]);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [mounted, setMounted] = useState(false);
  
  const [dismissedReminders, setDismissedReminders] = useState<Set<string>>(new Set());
  const notifiedEventsRef = useRef<Set<string>>(new Set());
  const audioContextRef = useRef<AudioContext | null>(null);

  // Popups
  const [selectedInstance, setSelectedInstance] = useState<SelectedInstance | null>(null);
  const [urgentPopupAlert, setUrgentPopupAlert] = useState<UrgentPopupAlert | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // Audio Unlock
  const unlockAudio = useCallback(() => {
    try {
      if (!audioContextRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          audioContextRef.current = new AudioContextClass();
        }
      }
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
    } catch (e) {
      console.error("Audio unlock error:", e);
    }
  }, []);

  useEffect(() => {
    const handleUserGesture = () => unlockAudio();
    window.addEventListener('click', handleUserGesture);
    window.addEventListener('keydown', handleUserGesture);
    window.addEventListener('touchstart', handleUserGesture);
    return () => {
      window.removeEventListener('click', handleUserGesture);
      window.removeEventListener('keydown', handleUserGesture);
      window.removeEventListener('touchstart', handleUserGesture);
    };
  }, [unlockAudio]);

  const playAlarmSound = useCallback((mode: 'exact-alarm' | 'warning-beep') => {
    try {
      unlockAudio();
      const ctx = audioContextRef.current;
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();

      if (mode === 'exact-alarm') {
        const sirenPitches = [900, 1400, 900, 1400, 1800, 1400];
        sirenPitches.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.15);

          gain.gain.setValueAtTime(0, ctx.currentTime + idx * 0.15);
          gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + idx * 0.15 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.15 + 0.14);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(ctx.currentTime + idx * 0.15);
          osc.stop(ctx.currentTime + idx * 0.15 + 0.15);
        });
      } else {
        const warningPitches = [700, 1000];
        warningPitches.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'square';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.18);

          gain.gain.setValueAtTime(0, ctx.currentTime + idx * 0.18);
          gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + idx * 0.18 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.18 + 0.14);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(ctx.currentTime + idx * 0.18);
          osc.stop(ctx.currentTime + idx * 0.18 + 0.15);
        });
      }
    } catch (e) {
      console.error("Audio playback error:", e);
    }
  }, [unlockAudio]);

  // Request Notification Permission
  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
      }
    }
  }, []);

  // 1-Second Master Realtime Listener
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now);

      const todayStr = format(now, 'yyyy-MM-dd');

      tasks.forEach((task) => {
        const compDates = task.completed_dates || [];
        const cancDates = task.cancelled_dates || [];
        if (compDates.includes(todayStr) || cancDates.includes(todayStr)) return;
        if (task.frequency === 'once' && (task.status === 'Completed' || task.status === 'Cancelled' || task.status === 'Resolved')) return;

        let isApplicableToday = false;
        if (task.frequency === 'once' && (task.start_date === todayStr || task.due_date === todayStr)) isApplicableToday = true;
        else if (task.frequency === 'daily') isApplicableToday = true;
        else if (task.frequency === 'weekly' && task.recurring_day === DAYS_OF_WEEK[getDay(now)]) isApplicableToday = true;
        else if (task.frequency === 'monthly' && Number(task.recurring_date) === getDate(now)) isApplicableToday = true;

        if (!isApplicableToday) return;

        // 1. START TIME (3 MINS PRE-ALERT & EXACT START)
        if (task.start_time) {
          const [sh, sm] = task.start_time.split(':').map(Number);
          const startParts = (task.start_date || task.due_date).split('-').map(Number);
          const startTargetDate = new Date(startParts[0], startParts[1] - 1, startParts[2], sh, sm, 0);
          const diffSec = differenceInSeconds(startTargetDate, now);

          if (diffSec <= 180 && diffSec >= 170) {
            const notifKey = `start-pre3-${task.id}-${todayStr}-${task.start_time}`;
            if (!notifiedEventsRef.current.has(notifKey)) {
              notifiedEventsRef.current.add(notifKey);
              playAlarmSound('warning-beep');

              if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
                const n = new Notification(`⚠️ Starts in 3 Mins: ${task.title}`, {
                  body: `Scheduled at ${task.start_time}. Get ready!`,
                  icon: '/favicon.ico',
                  requireInteraction: true,
                });
                n.onclick = () => { window.focus(); setActiveTask(task); };
              }
            }
          }

          if (diffSec <= 0 && diffSec >= -5) {
            const notifKey = `start-exact-${task.id}-${todayStr}-${task.start_time}`;
            if (!notifiedEventsRef.current.has(notifKey)) {
              notifiedEventsRef.current.add(notifKey);
              playAlarmSound('exact-alarm');

              setUrgentPopupAlert({
                task,
                alertType: 'start',
                timeStr: task.start_time,
                message: 'Task is starting right now!',
              });

              if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
                const n = new Notification(`🚀 STARTING NOW: ${task.title}`, {
                  body: `Time: ${task.start_time}. Task has begun.`,
                  icon: '/favicon.ico',
                  requireInteraction: true,
                });
                n.onclick = () => { window.focus(); setActiveTask(task); };
              }
            }
          }
        }

        // 2. DUE TIME (3 MINS PRE-ALERT & EXACT DUE)
        if (task.due_time) {
          const [dh, dm] = task.due_time.split(':').map(Number);
          const dueParts = task.due_date.split('-').map(Number);
          const dueTargetDate = new Date(dueParts[0], dueParts[1] - 1, dueParts[2], dh, dm, 0);
          const diffSec = differenceInSeconds(dueTargetDate, now);

          if (diffSec <= 180 && diffSec >= 170) {
            const notifKey = `due-pre3-${task.id}-${todayStr}-${task.due_time}`;
            if (!notifiedEventsRef.current.has(notifKey)) {
              notifiedEventsRef.current.add(notifKey);
              playAlarmSound('warning-beep');

              if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
                const n = new Notification(`⏳ Due in 3 Mins: ${task.title}`, {
                  body: `Deadline: ${task.due_time}. Wrap up now!`,
                  icon: '/favicon.ico',
                  requireInteraction: true,
                });
                n.onclick = () => { window.focus(); setActiveTask(task); };
              }
            }
          }

          if (diffSec <= 0 && diffSec >= -5) {
            const notifKey = `due-exact-${task.id}-${todayStr}-${task.due_time}`;
            if (!notifiedEventsRef.current.has(notifKey)) {
              notifiedEventsRef.current.add(notifKey);
              playAlarmSound('exact-alarm');

              setUrgentPopupAlert({
                task,
                alertType: 'due',
                timeStr: task.due_time,
                message: 'Task deadline reached right now!',
              });

              if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
                const n = new Notification(`⏰ DUE RIGHT NOW: ${task.title}`, {
                  body: `Due Time: ${task.due_time} • Priority: ${task.priority}`,
                  icon: '/favicon.ico',
                  requireInteraction: true,
                });
                n.onclick = () => { window.focus(); setActiveTask(task); };
              }
            }
          }
        }

      });
    }, 1000);
    return () => clearInterval(timer);
  }, [tasks, playAlarmSound]);

  const handleCopyLink = (link: string) => {
    navigator.clipboard.writeText(link);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2500);
  };

  // Filters
  const [search, setSearch] = useState('');
  const [selectedDept, setSelectedDept] = useState('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');
  const [filterFromDate, setFilterFromDate] = useState('');
  const [filterToDate, setFilterToDate] = useState('');
  const [activeQuickFilter, setActiveQuickFilter] = useState<'today' | 'overdue' | null>(null);
  const [showCompletedCancelled, setShowCompletedCancelled] = useState(false);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeptModal, setShowDeptModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  // Category State
  const [newDeptName, setNewDeptName] = useState('');
  const [newDeptColor, setNewDeptColor] = useState('#2563eb');
  const [editingDeptId, setEditingDeptId] = useState<string | null>(null);
  const [editingDeptName, setEditingDeptName] = useState('');
  const [editingDeptColor, setEditingDeptColor] = useState('#2563eb');

  const [emailInput, setEmailInput] = useState('');
  
  const [formData, setFormData] = useState<{
    title: string;
    department_id: string;
    priority: TaskPriority;
    status: TaskStatus;
    type: EntryType;
    meet_link: string;
    participants: string[];
    frequency: TaskFrequency;
    recurring_day: string;
    recurring_date: number;
    start_date: string;
    due_date: string;
    start_time: string;
    due_time: string;
    description: string;
  }>({
    title: '',
    department_id: '',
    priority: 'Medi',
    status: 'Open',
    type: 'task',
    meet_link: '',
    participants: ['vertexsolutionsptb@gmail.com'],
    frequency: 'once',
    recurring_day: 'Monday',
    recurring_date: 1,
    start_date: format(new Date(), 'yyyy-MM-dd'),
    due_date: format(addDays(new Date(), 3), 'yyyy-MM-dd'),
    start_time: '',
    due_time: '',
    description: '',
  });

  const timelineStart = useMemo(() => startOfDay(startOfWeek(new Date(), { weekStartsOn: 0 })), []);
  const daysArray = useMemo(() => Array.from({ length: 21 }, (_, i) => addDays(timelineStart, i)), [timelineStart]);

  // Active Corner Reminders
  const activeReminders = useMemo(() => {
    if (!mounted) return [];
    const reminders: ActiveReminder[] = [];
    const now = currentTime;
    const todayStr = format(now, 'yyyy-MM-dd');

    tasks.forEach((task) => {
      const compDates = task.completed_dates || [];
      const cancDates = task.cancelled_dates || [];
      if (compDates.includes(todayStr) || cancDates.includes(todayStr)) return;
      if (task.frequency === 'once' && (task.status === 'Completed' || task.status === 'Resolved' || task.status === 'Cancelled')) return;

      if (task.start_time) {
        const [sh, sm] = task.start_time.split(':').map(Number);
        const startTarget = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sh, sm, 0);
        const diffSec = differenceInSeconds(startTarget, now);
        const diffMin = Math.round(diffSec / 60);

        if (diffMin <= 30 && diffMin >= -15) {
          if (!dismissedReminders.has(`${task.id}-start`)) {
            reminders.push({
              task,
              diffSeconds: diffSec,
              timeLabel: diffMin <= 0 ? 'Start Now!' : `Starts in ${diffMin}m`,
              isOverdue: false,
              typeLabel: diffMin <= 3 && diffMin >= 0 ? 'start-pre' : 'start',
            });
          }
        }
      }

      if (task.due_time) {
        const [dh, dm] = task.due_time.split(':').map(Number);
        const dueParts = task.due_date.split('-').map(Number);
        const dueTarget = new Date(dueParts[0], dueParts[1] - 1, dueParts[2], dh, dm, 0);
        const diffSec = differenceInSeconds(dueTarget, now);
        const diffMin = Math.round(diffSec / 60);

        if (diffMin <= 60 && diffMin >= -120) {
          if (!dismissedReminders.has(`${task.id}-due`)) {
            reminders.push({
              task,
              diffSeconds: diffSec,
              timeLabel: diffMin < 0 ? `Overdue by ${Math.abs(diffMin)}m` : diffMin === 0 ? 'Due right now!' : `Due in ${diffMin}m`,
              isOverdue: diffMin < 0,
              typeLabel: diffMin <= 3 && diffMin >= 0 ? 'due-pre' : 'due',
            });
          }
        }
      }
    });

    return reminders.sort((a, b) => a.diffSeconds - b.diffSeconds);
  }, [tasks, currentTime, dismissedReminders, mounted]);

  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    await Promise.all([fetchDepartments(), fetchTasks(), fetchHistory(), fetchSavedEmails()]);
  };

  const fetchSavedEmails = async () => {
    const { data } = await supabase.from('saved_participants').select('email');
    if (data) setSavedEmails(data.map((d) => d.email));
  };

  const fetchDepartments = async () => {
    const { data } = await supabase.from('departments').select('*').order('name');
    if (data) {
      setDepartments(data);
      if (data.length > 0 && !formData.department_id) {
        setFormData((prev) => ({ ...prev, department_id: data[0].id }));
      }
    }
  };

  const fetchTasks = async () => {
    const { data } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
    if (data) {
      setTasks(
        data.map((t: any) => ({
          ...t,
          type: t.type || 'task',
          participants: t.participants || ['vertexsolutionsptb@gmail.com'],
          completed_dates: t.completed_dates || [],
          cancelled_dates: t.cancelled_dates || [],
        }))
      );
    }
  };

  const fetchHistory = async () => {
    const { data } = await supabase.from('task_history').select('*').order('changed_at', { ascending: false }).limit(25);
    if (data) setHistory(data);
  };

  const saveNewEmails = async (emails: string[]) => {
    for (const email of emails) {
      if (email.trim() && !savedEmails.includes(email.trim())) {
        await supabase.from('saved_participants').insert([{ email: email.trim() }]);
      }
    }
    fetchSavedEmails();
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) return alert('Please enter a title');
    if (!formData.department_id) return alert('Please select a Category');

    const participantsList = Array.from(new Set([...formData.participants, 'vertexsolutionsptb@gmail.com']));

    const payload = {
      title: formData.title,
      department_id: formData.department_id,
      priority: formData.priority,
      status: formData.status,
      type: formData.type,
      meet_link: formData.type === 'event' ? formData.meet_link : null,
      participants: participantsList,
      frequency: formData.frequency,
      recurring_day: formData.frequency === 'weekly' ? formData.recurring_day : null,
      recurring_date: formData.frequency === 'monthly' ? Number(formData.recurring_date) : null,
      start_date: formData.start_date || formData.due_date,
      due_date: formData.due_date,
      start_time: formData.start_time || null,
      due_time: formData.due_time || null,
      description: formData.description,
      owner_name: 'Me',
      completed_dates: [],
      cancelled_dates: [],
    };

    const { data, error } = await supabase.from('tasks').insert([payload]).select();
    if (error) {
      alert('Error saving: ' + error.message);
    } else {
      if (data && data[0]) {
        await supabase.from('task_history').insert([{ task_id: data[0].id, action: `Created ${formData.type}: "${formData.title}"` }]);
      }
      await saveNewEmails(participantsList);
      setShowAddModal(false);
      setFormData((prev) => ({
        ...prev,
        title: '',
        description: '',
        start_time: '',
        due_time: '',
        meet_link: '',
        participants: ['vertexsolutionsptb@gmail.com'],
      }));
      fetchTasks();
      fetchHistory();
    }
  };

  const handleSetInstanceStatus = async (status: 'Active' | 'Completed' | 'Cancelled') => {
    if (!selectedInstance) return;
    const { task, dateStr } = selectedInstance;

    let comp = (task.completed_dates || []).filter((d) => d !== dateStr);
    let canc = (task.cancelled_dates || []).filter((d) => d !== dateStr);

    if (status === 'Completed') {
      comp.push(dateStr);
    } else if (status === 'Cancelled') {
      canc.push(dateStr);
    }

    const { error } = await supabase.from('tasks').update({
      completed_dates: comp,
      cancelled_dates: canc,
    }).eq('id', task.id);

    if (!error) {
      await supabase.from('task_history').insert([{
        task_id: task.id,
        action: `Marked "${task.title}" on ${dateStr} as ${status}`,
      }]);
      setSelectedInstance(null);
      fetchTasks();
      fetchHistory();
    }
  };

  const handleUpdateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTask) return;

    const participantsList = Array.from(new Set([...activeTask.participants, 'vertexsolutionsptb@gmail.com']));

    const { error } = await supabase.from('tasks').update({
      title: activeTask.title,
      department_id: activeTask.department_id,
      priority: activeTask.priority,
      status: activeTask.status,
      type: activeTask.type,
      meet_link: activeTask.type === 'event' ? activeTask.meet_link : null,
      participants: participantsList,
      frequency: activeTask.frequency,
      recurring_day: activeTask.frequency === 'weekly' ? activeTask.recurring_day : null,
      recurring_date: activeTask.frequency === 'monthly' ? Number(activeTask.recurring_date) : null,
      start_date: activeTask.start_date || activeTask.due_date,
      due_date: activeTask.due_date,
      start_time: activeTask.start_time || null,
      due_time: activeTask.due_time || null,
      description: activeTask.description,
    }).eq('id', activeTask.id);

    if (error) {
      alert('Error updating: ' + error.message);
    } else {
      await supabase.from('task_history').insert([{ task_id: activeTask.id, action: `Updated: "${activeTask.title}" (${activeTask.status})` }]);
      await saveNewEmails(participantsList);
      setActiveTask(null);
      fetchTasks();
      fetchHistory();
    }
  };

  const handleDeleteTask = async (taskId: string, title: string) => {
    if (!confirm(`Are you sure you want to delete "${title}"?`)) return;
    const { error } = await supabase.from('tasks').delete().eq('id', taskId);
    if (!error) {
      await supabase.from('task_history').insert([{ action: `Deleted: "${title}"` }]);
      setActiveTask(null);
      fetchTasks();
      fetchHistory();
    }
  };

  // Category Actions
  const handleAddDepartment = async () => {
    if (!newDeptName.trim()) return alert('Enter a category name');
    const { error } = await supabase.from('departments').insert([{ name: newDeptName.trim(), color: newDeptColor }]);
    if (error) {
      alert('Error adding category: ' + error.message);
    } else {
      setNewDeptName('');
      fetchDepartments();
    }
  };

  const handleUpdateDepartment = async (id: string) => {
    if (!editingDeptName.trim()) return alert('Category name cannot be empty');
    const { error } = await supabase.from('departments').update({ name: editingDeptName.trim(), color: editingDeptColor }).eq('id', id);
    if (error) {
      alert('Error updating category: ' + error.message);
    } else {
      setEditingDeptId(null);
      fetchDepartments();
    }
  };

  const handleDeleteDepartment = async (id: string, name: string) => {
    const hasTasks = tasks.some((t) => t.department_id === id);
    if (hasTasks) {
      return alert(`Cannot delete "${name}". There are tasks assigned to this category. Delete or move them first.`);
    }

    if (!confirm(`Are you sure you want to delete category "${name}"?`)) return;

    const { error } = await supabase.from('departments').delete().eq('id', id);
    if (error) {
      alert('Error deleting category: ' + error.message);
    } else {
      fetchDepartments();
    }
  };

  const handleResetFilters = () => {
    setSearch('');
    setSelectedDept('All');
    setSelectedStatus('All');
    setFilterFromDate('');
    setFilterToDate('');
    setActiveQuickFilter(null);
    setShowCompletedCancelled(false);
  };

  const todayCount = useMemo(() => tasks.filter((t) => isToday(parseISO(t.start_date || t.due_date)) || isToday(parseISO(t.due_date))).length, [tasks]);
  const overdueCount = useMemo(() => tasks.filter((t) => getTaskTimingState(t, currentTime).isOverdue).length, [tasks, currentTime]);

  const elapsedDays = (currentTime.getTime() - timelineStart.getTime()) / 86400000;
  const liveIndicatorPosition = mounted && elapsedDays >= 0 && elapsedDays < 21 ? elapsedDays * 60 : null;

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (!showCompletedCancelled && task.frequency === 'once' && (task.status === 'Completed' || task.status === 'Cancelled' || task.status === 'Resolved')) {
        return false;
      }
      if (search && !task.title.toLowerCase().includes(search.toLowerCase()) && !(task.description || '').toLowerCase().includes(search.toLowerCase())) return false;
      if (selectedDept !== 'All' && task.department_id !== selectedDept) return false;
      if (selectedStatus !== 'All' && task.status !== selectedStatus) return false;
      
      const effectiveStart = task.start_date || task.due_date;
      if (activeQuickFilter === 'today' && !isToday(parseISO(effectiveStart)) && !isToday(parseISO(task.due_date))) return false;
      if (activeQuickFilter === 'overdue' && !getTaskTimingState(task, currentTime).isOverdue) return false;
      if (filterFromDate && effectiveStart < filterFromDate) return false;
      if (filterToDate && task.due_date > filterToDate) return false;

      return true;
    });
  }, [tasks, search, selectedDept, selectedStatus, activeQuickFilter, filterFromDate, filterToDate, showCompletedCancelled, currentTime]);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans relative">
      
      {/* 🚨 LIVE URGENT ON-SCREEN ALARM MODAL POPUP */}
      {urgentPopupAlert && (
        <div className="fixed inset-0 bg-slate-950/65 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in zoom-in-95 duration-200">
          <div className={`bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 border-2 transform transition-all ${
            urgentPopupAlert.alertType === 'due' 
              ? 'border-rose-500 ring-4 ring-rose-500/30' 
              : 'border-blue-600 ring-4 ring-blue-500/30'
          }`}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-2xl ${
                  urgentPopupAlert.alertType === 'due' 
                    ? 'bg-rose-600 text-white animate-bounce' 
                    : 'bg-blue-600 text-white animate-bounce'
                }`}>
                  {urgentPopupAlert.alertType === 'due' ? <Bell className="w-6 h-6" /> : <PlayCircle className="w-6 h-6" />}
                </div>
                <div>
                  <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
                    urgentPopupAlert.alertType === 'due' 
                      ? 'bg-rose-100 text-rose-800' 
                      : 'bg-blue-100 text-blue-800'
                  }`}>
                    {urgentPopupAlert.alertType === 'due' 
                      ? '⏰ Due Right Now!' 
                      : '🚀 Starting Right Now!'}
                  </span>
                  <h3 className="text-base font-bold text-slate-900 mt-1">{urgentPopupAlert.task.title}</h3>
                </div>
              </div>
              <button onClick={() => setUrgentPopupAlert(null)} className="text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-100"><X className="w-5 h-5" /></button>
            </div>

            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 my-4 space-y-2.5">
              <p className="text-xs font-semibold text-slate-700">{urgentPopupAlert.message}</p>
              <div className="flex justify-between items-center text-xs pt-1">
                <span className="text-slate-500 font-medium">Scheduled Time:</span>
                <span className="font-bold text-slate-800 bg-white px-2.5 py-1 rounded-lg border shadow-2xs">{urgentPopupAlert.timeStr}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500 font-medium">Priority:</span>
                <span className={`font-bold px-2 py-0.5 rounded ${PRIORITY_STYLES[urgentPopupAlert.task.priority]}`}>{urgentPopupAlert.task.priority}</span>
              </div>

              {/* GOOGLE MEET ACTIONS */}
              {urgentPopupAlert.task.meet_link && (
                <div className="pt-2.5 border-t border-slate-200/80 space-y-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCopyLink(urgentPopupAlert.task.meet_link!)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold border transition ${
                        linkCopied ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200 shadow-2xs'
                      }`}
                      title="Copy meeting link to clipboard"
                    >
                      {linkCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
                      {linkCopied ? 'Link Copied!' : 'Copy Link'}
                    </button>

                    <a
                      href={urgentPopupAlert.task.meet_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-bold shadow-xs shadow-violet-500/25 transition"
                    >
                      <Video className="w-3.5 h-3.5" /> Join Now <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  const t = urgentPopupAlert.task;
                  setUrgentPopupAlert(null);
                  setActiveTask(t);
                }}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
              >
                View Details
              </button>
              <button
                onClick={() => setUrgentPopupAlert(null)}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition"
              >
                Acknowledge & Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🚀 LIVE ACTIVE FLOATING ALERTS */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col gap-3 max-w-sm w-full pointer-events-none">
        {activeReminders.map((reminder) => (
          <div
            key={`${reminder.task.id}-${reminder.typeLabel}`}
            onClick={() => setActiveTask(reminder.task)}
            className={`pointer-events-auto cursor-pointer flex items-start gap-3 p-4 rounded-2xl shadow-xl border backdrop-blur-md transition-all duration-300 transform hover:scale-102 active:scale-98 animate-in slide-in-from-right-10 group ${
              reminder.typeLabel.includes('start')
                ? 'bg-amber-50/95 border-amber-300 text-amber-950 ring-2 ring-amber-500/30'
                : reminder.isOverdue ? 'bg-rose-50/95 border-rose-300 text-rose-950 ring-2 ring-rose-500/30' : 'bg-white/95 border-slate-200 text-slate-900 shadow-slate-500/10'
            }`}
          >
            <div className={`p-2.5 rounded-xl shrink-0 shadow-sm transition-transform group-hover:scale-110 ${
              reminder.typeLabel.includes('start') ? 'bg-amber-500 text-white animate-pulse' : reminder.isOverdue ? 'bg-rose-600 text-white animate-bounce' : 'bg-blue-600 text-white'
            }`}>
              {reminder.typeLabel.includes('start') ? <PlayCircle className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
            </div>

            <div className="flex-1 overflow-hidden">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold truncate pr-2 group-hover:text-blue-600 transition">{reminder.task.title}</h4>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  reminder.typeLabel.includes('start') ? 'bg-amber-100 text-amber-900 border border-amber-300' : reminder.isOverdue ? 'bg-rose-200 text-rose-800' : 'bg-slate-100 text-slate-800 border border-slate-200'
                }`}>
                  {reminder.typeLabel.includes('start') ? reminder.task.start_time : reminder.task.due_time || 'Today'}
                </span>
              </div>
              <p className={`text-xs font-bold mt-1 ${reminder.typeLabel.includes('start') ? 'text-amber-700' : reminder.isOverdue ? 'text-rose-700' : 'text-slate-600'}`}>
                {reminder.typeLabel.includes('start') ? '⚠️ ' : reminder.isOverdue ? '🚨 ' : '⏳ '}{reminder.timeLabel}
              </p>
              <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-black/5">
                <span className="text-[10px] text-blue-600 font-semibold opacity-0 group-hover:opacity-100 transition">Click to view/edit</span>
              </div>
            </div>

            <button onClick={(e) => { e.stopPropagation(); setDismissedReminders((prev) => new Set([...prev, `${reminder.task.id}-${reminder.typeLabel}`])); }} className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 shrink-0 transition" title="Dismiss">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* 1. TOP HEADER & FILTERS */}
      <header className="bg-white border-b border-slate-200 px-6 py-3.5 sticky top-0 z-30 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 text-white p-2 rounded-xl shadow-xs">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-slate-900 leading-tight">Project Timeline Hub</h1>
              </div>
              <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {mounted ? `Live: ${format(currentTime, 'hh:mm:ss a')} • ` : ''}{filteredTasks.length} Active Tasks
              </p>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-2.5">
            <button
              onClick={() => playAlarmSound('exact-alarm')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition"
              title="Test aggressive alarm sound & ensure audio is unmuted"
            >
              <Volume2 className="w-3.5 h-3.5 text-rose-600" /> Test Sound
            </button>

            <button
              onClick={() => setShowCompletedCancelled((prev) => !prev)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                showCompletedCancelled ? 'bg-blue-600 text-white border-blue-600 shadow-xs' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {showCompletedCancelled ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {showCompletedCancelled ? 'Hide Done/Cancelled' : 'Show Done/Cancelled'}
            </button>

            <button onClick={() => setActiveQuickFilter((prev) => (prev === 'today' ? null : 'today'))} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${activeQuickFilter === 'today' ? 'bg-amber-500 text-white border-amber-600' : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100/50'}`}>
              <Clock className="w-3.5 h-3.5" /> Today: {todayCount}
            </button>

            <button onClick={() => setActiveQuickFilter((prev) => (prev === 'overdue' ? null : 'overdue'))} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${activeQuickFilter === 'overdue' ? 'bg-rose-600 text-white border-rose-700' : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100/50'}`}>
              <AlertCircle className="w-3.5 h-3.5" /> Overdue: {overdueCount}
            </button>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs w-36 text-slate-800 placeholder-slate-400 outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition" />
            </div>

            <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)} className="px-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-700 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500">
              <option value="All">All Statuses</option>
              <option value="Open">Open</option>
              <option value="In Progress">In Progress</option>
              <option value="Pending">Pending</option>
              <option value="Completed">Completed</option>
              <option value="Resolved">Resolved</option>
              <option value="Blocked">Blocked</option>
              <option value="Cancelled">Cancelled</option>
            </select>

            <select value={selectedDept} onChange={(e) => setSelectedDept(e.target.value)} className="px-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-700 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500">
              <option value="All">All Categories</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>

            <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1">
              <span className="text-[9px] text-slate-400 uppercase font-bold">From</span>
              <input type="date" value={filterFromDate} onChange={(e) => setFilterFromDate(e.target.value)} className="bg-transparent text-xs text-slate-700 outline-none cursor-pointer" />
              <span className="text-[9px] text-slate-400 uppercase font-bold ml-1">To</span>
              <input type="date" value={filterToDate} onChange={(e) => setFilterToDate(e.target.value)} className="bg-transparent text-xs text-slate-700 outline-none cursor-pointer" />
            </div>

            {(search || selectedDept !== 'All' || selectedStatus !== 'All' || filterFromDate || filterToDate || activeQuickFilter || showCompletedCancelled) && (
              <button onClick={handleResetFilters} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition" title="Reset Filters"><RotateCcw className="w-4 h-4" /></button>
            )}

            <button onClick={() => setShowDeptModal(true)} className="px-3 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition">Categories</button>
            <button onClick={() => setShowHistoryModal(true)} className="p-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 rounded-xl transition" title="History Log"><History className="w-4 h-4" /></button>
            <button onClick={() => setShowAddModal(true)} className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition"><Plus className="w-4 h-4" /> Add Task</button>
          </div>
        </div>
      </header>

      {/* 2. TIMELINE TABLE VIEW */}
      <div className="flex-1 overflow-x-auto overflow-y-auto">
        <div className="min-w-[1680px] relative">
          
          {/* 🔴 LIVE CURRENT TIME RED LINE */}
          {liveIndicatorPosition !== null && (
            <div 
              style={{ left: `calc(400px + ${liveIndicatorPosition}px)` }} 
              className="absolute top-0 bottom-0 w-[2px] bg-rose-500 z-20 pointer-events-none shadow-[0_0_8px_rgba(244,63,94,0.8)]"
            >
              <div className="sticky top-11 -ml-[4px] w-2.5 h-2.5 rounded-full bg-rose-600 ring-4 ring-rose-200 animate-pulse" />
            </div>
          )}

          <div className="grid grid-cols-[400px_repeat(21,60px)] bg-slate-100 border-b border-slate-200 sticky top-0 z-20 shadow-xs">
            <div className="p-3 text-xs font-bold text-slate-600 uppercase border-r border-slate-200 bg-slate-100 sticky left-0 z-30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">Task & Details</div>
            {daysArray.map((date, idx) => {
              const current = isToday(date);
              return (
                <div key={idx} className={`text-center py-2 border-r border-slate-200/60 ${current ? 'bg-blue-100/60 font-bold' : ''}`}>
                  <div className={`text-[10px] uppercase font-semibold ${current ? 'text-blue-600' : 'text-slate-400'}`}>{format(date, 'EEE')}</div>
                  <div className={`text-sm ${current ? 'text-blue-600 font-bold' : 'text-slate-700'}`}>{format(date, 'd')}</div>
                </div>
              );
            })}
          </div>

          {departments.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">No categories found. Click Categories above to initialize.</div>
          ) : (
            departments
              .filter((dept) => selectedDept === 'All' || selectedDept === dept.id)
              .filter((dept) => filteredTasks.some((t) => t.department_id === dept.id))
              .map((dept) => {
                const deptTasks = filteredTasks.filter((t) => t.department_id === dept.id);

                return (
                  <div key={dept.id} className="border-b border-slate-200">
                    <div className="grid grid-cols-[400px_repeat(21,60px)] bg-slate-100/70 border-b border-slate-200/60">
                      <div className="px-4 py-2 flex items-center gap-2 bg-slate-100/90 border-r border-slate-200 sticky left-0 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold text-white shadow-2xs" style={{ backgroundColor: dept.color || '#475569' }}>{dept.name}</span>
                        <span className="text-xs text-slate-400 font-medium">({deptTasks.length})</span>
                      </div>
                      <div className="col-span-21"></div>
                    </div>

                    {deptTasks.map((task) => {
                      const timingState = getTaskTimingState(task, currentTime);
                      const effectiveStart = task.start_date || task.due_date;
                      const startParsed = startOfDay(parseISO(effectiveStart));
                      const endParsed = startOfDay(parseISO(task.due_date));
                      
                      const rawStartDay = (startParsed.getTime() - timelineStart.getTime()) / 86400000;
                      const rawEndDay = (endParsed.getTime() - timelineStart.getTime()) / 86400000;

                      let startFraction = 0;
                      if (task.start_time) {
                        const [sh, sm] = task.start_time.split(':').map(Number);
                        startFraction = (sh * 60 + sm) / 1440;
                      }

                      let endFraction = 1;
                      if (task.due_time) {
                        const [dh, dm] = task.due_time.split(':').map(Number);
                        endFraction = (dh * 60 + dm) / 1440;
                      }

                      const exactStartPos = (rawStartDay + startFraction) * 60;
                      const exactEndPos = (rawEndDay + endFraction) * 60;
                      const exactWidth = Math.max(8, exactEndPos - exactStartPos);
                      const isVisible = (rawEndDay + 1) >= 0 && rawStartDay < 21;
                      const isNarrow = exactWidth < 80;

                      const plainDesc = task.description ? task.description.replace(/<[^>]*>?/gm, '') : '';

                      return (
                        <div key={task.id} className={`grid grid-cols-[400px_repeat(21,60px)] h-12 items-center hover:bg-slate-50 border-b border-slate-100 group transition relative ${timingState.isOverdue ? 'bg-rose-50/40' : timingState.isStartNow ? 'bg-amber-50/40' : ''}`}>
                          
                          <div onClick={() => setActiveTask(task)} className="px-4 flex items-center justify-between border-r border-slate-200 h-full bg-white group-hover:bg-slate-50 sticky left-0 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] cursor-pointer">
                            <div className="flex flex-col truncate pr-2">
                              <div className="flex items-center gap-1.5">
                                {task.type === 'event' && <Video className="w-3.5 h-3.5 text-violet-600 shrink-0" />}
                                <span className={`text-xs font-semibold truncate group-hover:text-blue-600 transition ${timingState.isOverdue ? 'text-rose-700 font-bold' : timingState.isStartNow ? 'text-amber-800 font-bold' : 'text-slate-800'}`} title={task.title}>
                                  {task.title}
                                </span>
                                {task.frequency !== 'once' && (
                                  <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded flex items-center gap-0.5 border"><Repeat className="w-2.5 h-2.5" />{task.frequency === 'weekly' ? task.recurring_day?.slice(0, 3) : task.frequency === 'monthly' ? `${task.recurring_date}th` : task.frequency}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {task.start_time && (
                                  <span className="text-[10px] text-blue-600 font-medium flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" /> {task.start_time} {task.due_time ? `- ${task.due_time}` : ''}</span>
                                )}
                                {task.participants && task.participants.length > 0 && (
                                  <span className="text-[10px] text-slate-500 font-medium flex items-center gap-0.5">
                                    <Users className="w-2.5 h-2.5" /> {task.participants.length}
                                  </span>
                                )}
                                {plainDesc && <span className="text-[10px] text-slate-400 truncate max-w-[120px]">{plainDesc}</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className={`text-[10px] px-2 py-0.5 rounded border ${timingState.badgeClass}`}>
                                {timingState.label}
                              </span>
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${PRIORITY_STYLES[task.priority]}`}>{task.priority}</span>
                            </div>
                          </div>

                          <div className="col-span-21 relative h-full flex items-center">
                            {/* 1. ONCE TASKS TIMELINE BAR */}
                            {task.frequency === 'once' && isVisible && (
                              <>
                                <div
                                  onClick={() => setActiveTask(task)}
                                  style={{ left: `${exactStartPos}px`, width: `${exactWidth}px` }}
                                  className={`absolute h-6.5 rounded-lg px-2 flex items-center shadow-xs transition z-10 cursor-pointer ${timingState.barClass}`}
                                  title={`${task.title} (${task.start_time || ''} - ${task.due_time || ''})`}
                                >
                                  {!isNarrow && (
                                    <div className="flex items-center justify-between w-full overflow-hidden text-[11px] font-semibold">
                                      <span className="truncate pr-1">{task.title}</span>
                                      {(task.start_time || task.due_time) && (
                                        <span className="px-1 py-0.2 bg-black/20 text-[9px] rounded whitespace-nowrap shrink-0">
                                          {task.due_time || task.start_time}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {isNarrow && (
                                  <div style={{ left: `${exactEndPos + 4}px` }} className={`absolute flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap z-0 pointer-events-none ${timingState.isOverdue ? 'text-rose-700 font-bold' : timingState.isStartNow ? 'text-amber-800 font-bold' : 'text-slate-800'}`}>
                                    <span>{task.title}</span>
                                  </div>
                                )}
                              </>
                            )}

                            {/* 2. RECURRING TASKS WITH INDIVIDUAL DAY STATUSES */}
                            {task.frequency !== 'once' && daysArray.map((dayDate, dayIdx) => {
                              const dayDateStr = format(dayDate, 'yyyy-MM-dd');
                              let shouldShow = false;

                              if (task.frequency === 'daily') shouldShow = true;
                              else if (task.frequency === 'weekly' && task.recurring_day) shouldShow = DAYS_OF_WEEK[getDay(dayDate)] === task.recurring_day;
                              else if (task.frequency === 'monthly' && task.recurring_date) shouldShow = getDate(dayDate) === Number(task.recurring_date);
                              
                              if (!shouldShow) return null;

                              const isCompletedThisDay = (task.completed_dates || []).includes(dayDateStr);
                              const isCancelledThisDay = (task.cancelled_dates || []).includes(dayDateStr);

                              if (!showCompletedCancelled && (isCompletedThisDay || isCancelledThisDay)) {
                                return null;
                              }

                              const recStartPos = (dayIdx + startFraction) * 60;
                              const recEndPos = (dayIdx + endFraction) * 60;
                              const recWidth = Math.max(8, recEndPos - recStartPos);
                              const recIsNarrow = recWidth < 80;

                              return (
                                <React.Fragment key={dayIdx}>
                                  <div
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedInstance({
                                        task,
                                        dateStr: dayDateStr,
                                        isCompleted: isCompletedThisDay,
                                        isCancelled: isCancelledThisDay,
                                      });
                                    }}
                                    style={{ left: `${recStartPos}px`, width: `${recWidth}px` }}
                                    className={`absolute h-6.5 rounded-lg px-2 flex items-center shadow-xs z-10 transition cursor-pointer hover:ring-2 ${
                                      isCompletedThisDay
                                        ? 'bg-emerald-600 text-white ring-emerald-300'
                                        : isCancelledThisDay
                                        ? 'bg-rose-500 text-white ring-rose-300 opacity-90'
                                        : timingState.barClass
                                    }`}
                                    title={`Click to manage status for ${dayDateStr}: ${isCompletedThisDay ? 'Done' : isCancelledThisDay ? 'Cancelled' : timingState.label}`}
                                  >
                                    {!recIsNarrow && (
                                      <div className="flex items-center justify-between w-full overflow-hidden text-[11px] font-bold">
                                        <span className={`truncate pr-1 ${isCancelledThisDay ? 'line-through' : ''}`}>{task.title}</span>
                                        <span className="text-[9px] px-1 py-0.2 rounded bg-black/20 font-extrabold uppercase shrink-0">
                                          {isCompletedThisDay ? 'Done' : isCancelledThisDay ? 'Cancelled' : timingState.isStartNow ? 'Start Now' : 'Active'}
                                        </span>
                                      </div>
                                    )}
                                  </div>

                                  {recIsNarrow && (
                                    <div style={{ left: `${recEndPos + 4}px` }} className="absolute flex items-center gap-1 text-[11px] font-semibold text-slate-800 whitespace-nowrap z-0 pointer-events-none">
                                      <span className={`truncate max-w-[80px] ${isCancelledThisDay ? 'line-through text-rose-600' : ''}`}>{task.title}</span>
                                    </div>
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })
          )}
        </div>
      </div>

      {/* 🎯 POPUP: MANAGE SPECIFIC DAY INSTANCE */}
      {selectedInstance && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 border border-slate-100">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 truncate max-w-[240px]">{selectedInstance.task.title}</h3>
                <p className="text-xs text-blue-600 font-semibold mt-0.5">Date: {selectedInstance.dateStr}</p>
              </div>
              <button onClick={() => setSelectedInstance(null)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>

            <p className="text-xs text-slate-600 mb-4">
              Change status for <b>this occurrence only</b>. Other recurring days will remain active.
            </p>

            <div className="space-y-2">
              <button
                onClick={() => handleSetInstanceStatus('Completed')}
                className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold transition ${
                  selectedInstance.isCompleted ? 'bg-emerald-600 text-white shadow-xs' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                <Check className="w-4 h-4" /> {selectedInstance.isCompleted ? 'Marked as Completed' : 'Mark Completed for This Day'}
              </button>

              <button
                onClick={() => handleSetInstanceStatus('Cancelled')}
                className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold transition ${
                  selectedInstance.isCancelled ? 'bg-rose-600 text-white shadow-xs' : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                }`}
              >
                <Ban className="w-4 h-4" /> {selectedInstance.isCancelled ? 'Marked as Cancelled' : 'Cancel for This Day Only'}
              </button>

              <button
                onClick={() => handleSetInstanceStatus('Active')}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
              >
                <RefreshCw className="w-4 h-4" /> Reset to Active
              </button>
            </div>

            <div className="border-t border-slate-100 pt-3 mt-4 flex justify-between items-center">
              <button
                onClick={() => {
                  const t = selectedInstance.task;
                  setSelectedInstance(null);
                  setActiveTask(t);
                }}
                className="text-xs text-blue-600 font-bold hover:underline"
              >
                Edit Master Task
              </button>
              <button onClick={() => setSelectedInstance(null)} className="text-xs text-slate-500 hover:text-slate-700">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* 3. WIDE DOUBLE COLUMN EDIT TASK MODAL */}
      {activeTask && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl p-7 border border-slate-100 max-h-[92vh] overflow-y-auto">
            
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-5">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl border ${activeTask.type === 'event' ? 'bg-violet-50 border-violet-200 text-violet-600' : 'bg-blue-50 border-blue-200 text-blue-600'}`}>
                  {activeTask.type === 'event' ? <Video className="w-5 h-5" /> : <Edit3 className="w-5 h-5" />}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Edit {activeTask.type === 'event' ? 'Event' : 'Task'}</h2>
                  <p className="text-xs text-slate-500">Update timeline dates, descriptions & participant reminders</p>
                </div>
              </div>
              <button onClick={() => setActiveTask(null)} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleUpdateTask} className="space-y-4">
              
              <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-xl border border-slate-200/70 max-w-sm">
                <button
                  type="button"
                  onClick={() => setActiveTask({ ...activeTask, type: 'task' })}
                  className={`py-1.5 text-xs font-bold rounded-lg transition ${activeTask.type === 'task' ? 'bg-white shadow-xs text-blue-600' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  Standard Task
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTask({ ...activeTask, type: 'event' })}
                  className={`py-1.5 text-xs font-bold rounded-lg transition ${activeTask.type === 'event' ? 'bg-white shadow-xs text-violet-600' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  Meeting / Event
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-slate-700 mb-1.5 block">Title *</label>
                    <input
                      required type="text" placeholder="Task title..." value={activeTask.title}
                      onChange={(e) => setActiveTask({ ...activeTask, title: e.target.value })}
                      className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
                    />
                  </div>

                  {activeTask.type === 'event' && (
                    <div className="bg-violet-50/60 border border-violet-200 p-3 rounded-xl space-y-1">
                      <label className="text-xs font-bold text-violet-900 flex items-center gap-1.5">
                        <Video className="w-3.5 h-3.5 text-violet-600" /> Google Meet Link
                      </label>
                      <input
                        type="url"
                        placeholder="https://meet.google.com/..."
                        value={activeTask.meet_link || ''}
                        onChange={(e) => setActiveTask({ ...activeTask, meet_link: e.target.value })}
                        className="w-full px-3 py-1.5 bg-white border border-violet-300 rounded-lg text-xs text-slate-900 placeholder-slate-400 outline-none focus:ring-2 focus:ring-violet-500"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-700 mb-1.5 block">Category *</label>
                      <select required value={activeTask.department_id} onChange={(e) => setActiveTask({ ...activeTask, department_id: e.target.value })} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">Select Category</option>
                        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-bold text-slate-700 mb-1.5 block">Priority</label>
                      <select value={activeTask.priority} onChange={(e) => setActiveTask({ ...activeTask, priority: e.target.value as TaskPriority })} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="Medi">Medium</option>
                        <option value="Crit">Critical</option>
                        <option value="High">High</option>
                        <option value="Low">Low</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-700 mb-1.5 block">Status</label>
                      <select value={activeTask.status} onChange={(e) => setActiveTask({ ...activeTask, status: e.target.value as TaskStatus })} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="Open">Open</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Pending">Pending</option>
                        <option value="Completed">Completed</option>
                        <option value="Resolved">Resolved</option>
                        <option value="Blocked">Blocked</option>
                        <option value="Cancelled">Cancelled</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-bold text-slate-700 mb-1.5 block">Frequency</label>
                      <select value={activeTask.frequency} onChange={(e) => setActiveTask({ ...activeTask, frequency: e.target.value as TaskFrequency })} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="once">One-time Task</option>
                        <option value="daily">Daily Repeat</option>
                        <option value="weekly">Weekly Repeat</option>
                        <option value="monthly">Monthly Repeat</option>
                        <option value="yearly">Yearly Repeat</option>
                      </select>
                    </div>
                  </div>

                  {activeTask.frequency === 'weekly' && (
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                      <label className="text-[11px] font-bold text-slate-700">Repeat Day of the Week</label>
                      <select value={activeTask.recurring_day || 'Monday'} onChange={(e) => setActiveTask({ ...activeTask, recurring_day: e.target.value })} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs mt-1 bg-white outline-none">
                        {DAYS_OF_WEEK.map((day) => <option key={day} value={day}>{day}</option>)}
                      </select>
                    </div>
                  )}

                  {activeTask.frequency === 'monthly' && (
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                      <label className="text-[11px] font-bold text-slate-700">Repeat Day of Month (1-31)</label>
                      <input type="number" min={1} max={31} value={activeTask.recurring_date || 1} onChange={(e) => setActiveTask({ ...activeTask, recurring_date: Number(e.target.value) })} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs mt-1 bg-white outline-none"/>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl space-y-3">
                    <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-blue-600" /> Date & Time Configuration
                    </h3>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] text-slate-600 font-bold block mb-1">Start Date</label>
                        <input
                          type="date"
                          value={activeTask.start_date || ''}
                          onChange={(e) => setActiveTask({ ...activeTask, start_date: e.target.value })}
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 outline-none"
                        />
                        <input
                          type="time"
                          value={activeTask.start_time || ''}
                          onChange={(e) => setActiveTask({ ...activeTask, start_time: e.target.value })}
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 outline-none mt-1.5"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-600 font-bold block mb-1">Due Date *</label>
                        <input
                          type="date"
                          required
                          value={activeTask.due_date || ''}
                          onChange={(e) => setActiveTask({ ...activeTask, due_date: e.target.value })}
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 outline-none"
                        />
                        <input
                          type="time"
                          value={activeTask.due_time || ''}
                          onChange={(e) => setActiveTask({ ...activeTask, due_time: e.target.value })}
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 outline-none mt-1.5"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
                    <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                      <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 text-blue-600" /> Alert Participants</span>
                      <span className="text-[10px] text-emerald-600 flex items-center gap-1 font-semibold"><ShieldCheck className="w-3 h-3" /> Mandatory Synced</span>
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        list="saved-emails"
                        placeholder="Add participant email..."
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        className="flex-1 px-3 py-1.5 bg-white border border-slate-200 text-xs text-slate-900 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <datalist id="saved-emails">
                        {savedEmails.map((em) => <option key={em} value={em} />)}
                      </datalist>
                      <button
                        type="button"
                        onClick={() => {
                          if (emailInput.trim() && !activeTask.participants.includes(emailInput.trim())) {
                            setActiveTask({ ...activeTask, participants: [...activeTask.participants, emailInput.trim()] });
                            setEmailInput('');
                          }
                        }}
                        className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition"
                      >
                        Add
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pt-1">
                      {activeTask.participants?.map((pEmail) => (
                        <span key={pEmail} className={`px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1.5 border shadow-2xs ${pEmail === 'vertexsolutionsptb@gmail.com' ? 'bg-blue-100 text-blue-800 border-blue-200' : 'bg-white text-slate-700 border-slate-200'}`}>
                          {pEmail}
                          {pEmail !== 'vertexsolutionsptb@gmail.com' && (
                            <X
                              className="w-3 h-3 cursor-pointer text-slate-400 hover:text-rose-600"
                              onClick={() => setActiveTask({ ...activeTask, participants: activeTask.participants.filter((e) => e !== pEmail) })}
                            />
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

              </div>

              {/* 🎨 Word-Style Color, Alignment, List & Table Editor */}
              <div className="pt-2">
                <label className="text-xs font-bold text-slate-700 mb-1.5 block">Rich Description, Lists & Custom Tables</label>
                <AdvancedRichEditor
                  value={activeTask.description || ''}
                  onChange={(newHtml) => setActiveTask({ ...activeTask, description: newHtml })}
                />
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-slate-100 mt-2">
                <button type="button" onClick={() => handleDeleteTask(activeTask.id, activeTask.title)} className="flex items-center gap-1.5 px-4 py-2 text-xs text-rose-600 hover:bg-rose-50 rounded-xl font-bold transition"><Trash2 className="w-4 h-4" /> Delete Task</button>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setActiveTask(null)} className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-xl font-semibold">Cancel</button>
                  <button type="submit" className="px-6 py-2 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-xs transition">Save Changes</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. WIDE DOUBLE COLUMN ADD TASK MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl p-7 border border-slate-100 max-h-[92vh] overflow-y-auto">
            
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-5">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl border ${formData.type === 'event' ? 'bg-violet-50 border-violet-200 text-violet-600' : 'bg-blue-50 border-blue-200 text-blue-600'}`}>
                  {formData.type === 'event' ? <Video className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Create New {formData.type === 'event' ? 'Event' : 'Task'}</h2>
                  <p className="text-xs text-slate-500">Configure task timeline, repeating rules, tables & participants</p>
                </div>
              </div>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleAddTask} className="space-y-4">
              
              <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-xl border border-slate-200/70 max-w-sm">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, type: 'task' })}
                  className={`py-1.5 text-xs font-bold rounded-lg transition ${formData.type === 'task' ? 'bg-white shadow-xs text-blue-600' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  Standard Task
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, type: 'event' })}
                  className={`py-1.5 text-xs font-bold rounded-lg transition ${formData.type === 'event' ? 'bg-white shadow-xs text-violet-600' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  Meeting / Event
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-slate-700 mb-1.5 block">Title *</label>
                    <input required type="text" placeholder="Title..." value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition" />
                  </div>

                  {formData.type === 'event' && (
                    <div className="bg-violet-50/60 border border-violet-200 p-3 rounded-xl space-y-1">
                      <label className="text-xs font-bold text-violet-900 flex items-center gap-1.5">
                        <Video className="w-3.5 h-3.5 text-violet-600" /> Google Meet Link
                      </label>
                      <input
                        type="url"
                        placeholder="https://meet.google.com/..."
                        value={formData.meet_link}
                        onChange={(e) => setFormData({ ...formData, meet_link: e.target.value })}
                        className="w-full px-3 py-1.5 bg-white border border-violet-300 rounded-lg text-xs text-slate-900 placeholder-slate-400 outline-none focus:ring-2 focus:ring-violet-500"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-700 mb-1.5 block">Category *</label>
                      <select required value={formData.department_id} onChange={(e) => setFormData({ ...formData, department_id: e.target.value })} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">Select Category</option>
                        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-bold text-slate-700 mb-1.5 block">Priority</label>
                      <select value={formData.priority} onChange={(e) => setFormData({ ...formData, priority: e.target.value as TaskPriority })} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="Medi">Medium</option>
                        <option value="Crit">Critical</option>
                        <option value="High">High</option>
                        <option value="Low">Low</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-700 mb-1.5 block">Status</label>
                      <select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value as TaskStatus })} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="Open">Open</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Pending">Pending</option>
                        <option value="Completed">Completed</option>
                        <option value="Resolved">Resolved</option>
                        <option value="Blocked">Blocked</option>
                        <option value="Cancelled">Cancelled</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-bold text-slate-700 mb-1.5 block">Frequency</label>
                      <select value={formData.frequency} onChange={(e) => setFormData({ ...formData, frequency: e.target.value as TaskFrequency })} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="once">One-time Task</option>
                        <option value="daily">Daily Repeat</option>
                        <option value="weekly">Weekly Repeat</option>
                        <option value="monthly">Monthly Repeat</option>
                        <option value="yearly">Yearly Repeat</option>
                      </select>
                    </div>
                  </div>

                  {formData.frequency === 'weekly' && (
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                      <label className="text-[11px] font-bold text-slate-700">Repeat Day of the Week</label>
                      <select value={formData.recurring_day} onChange={(e) => setFormData({ ...formData, recurring_day: e.target.value })} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs mt-1 bg-white outline-none">
                        {DAYS_OF_WEEK.map((day) => <option key={day} value={day}>{day}</option>)}
                      </select>
                    </div>
                  )}

                  {formData.frequency === 'monthly' && (
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                      <label className="text-[11px] font-bold text-slate-700">Repeat Day of Month (1-31)</label>
                      <input type="number" min={1} max={31} value={formData.recurring_date} onChange={(e) => setFormData({ ...formData, recurring_date: Number(e.target.value) })} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs mt-1 bg-white outline-none" />
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl space-y-3">
                    <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-blue-600" /> Date & Time Configuration
                    </h3>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] text-slate-600 font-bold block mb-1">Start Date</label>
                        <input
                          type="date"
                          value={formData.start_date || ''}
                          onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 outline-none"
                        />
                        <input
                          type="time"
                          value={formData.start_time || ''}
                          onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 outline-none mt-1.5"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-600 font-bold block mb-1">Due Date *</label>
                        <input
                          type="date"
                          required
                          value={formData.due_date || ''}
                          onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 outline-none"
                        />
                        <input
                          type="time"
                          value={formData.due_time || ''}
                          onChange={(e) => setFormData({ ...formData, due_time: e.target.value })}
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 outline-none mt-1.5"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
                    <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                      <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 text-blue-600" /> Email Participants</span>
                      <span className="text-[10px] text-emerald-600 flex items-center gap-1 font-semibold"><ShieldCheck className="w-3 h-3" /> Mandatory Synced</span>
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        list="saved-emails"
                        placeholder="Add participant email..."
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        className="flex-1 px-3 py-1.5 bg-white border border-slate-200 text-xs text-slate-900 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <datalist id="saved-emails">
                        {savedEmails.map((em) => <option key={em} value={em} />)}
                      </datalist>
                      <button
                        type="button"
                        onClick={() => {
                          if (emailInput.trim() && !formData.participants.includes(emailInput.trim())) {
                            setFormData({ ...formData, participants: [...formData.participants, emailInput.trim()] });
                            setEmailInput('');
                          }
                        }}
                        className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition"
                      >
                        Add
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pt-1">
                      {formData.participants.map((pEmail) => (
                        <span key={pEmail} className={`px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1.5 border shadow-2xs ${pEmail === 'vertexsolutionsptb@gmail.com' ? 'bg-blue-100 text-blue-800 border-blue-200' : 'bg-white text-slate-700 border-slate-200'}`}>
                          {pEmail}
                          {pEmail !== 'vertexsolutionsptb@gmail.com' && (
                            <X
                              className="w-3 h-3 cursor-pointer text-slate-400 hover:text-rose-600"
                              onClick={() => setFormData({ ...formData, participants: formData.participants.filter((e) => e !== pEmail) })}
                            />
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

              </div>

              {/* 🎨 Word-Style Color, Alignment, List & Table Editor */}
              <div className="pt-2">
                <label className="text-xs font-bold text-slate-700 mb-1.5 block">Rich Description, Lists & Custom Tables</label>
                <AdvancedRichEditor
                  value={formData.description}
                  onChange={(newHtml) => setFormData({ ...formData, description: newHtml })}
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 mt-2">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-xl font-semibold">Cancel</button>
                <button type="submit" className="px-6 py-2 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-xs transition">Create Entry</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. CATEGORIES MASTER MODAL */}
      {showDeptModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 border border-slate-100">
            
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Tag className="w-5 h-5 text-blue-600" />
                <h2 className="text-base font-bold text-slate-900">Categories Manager</h2>
              </div>
              <button onClick={() => setShowDeptModal(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="flex gap-2 mb-4 bg-slate-50 p-2 rounded-xl border border-slate-200">
              <input type="text" placeholder="Category Name" value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} className="flex-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 outline-none focus:ring-2 focus:ring-blue-500" />
              <input type="color" value={newDeptColor} onChange={(e) => setNewDeptColor(e.target.value)} className="w-9 h-8 p-0.5 border border-slate-200 bg-white rounded-lg cursor-pointer" />
              <button onClick={handleAddDepartment} className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition">Add</button>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto mb-4">
              {departments.map((d) => {
                const taskCount = tasks.filter((t) => t.department_id === d.id).length;

                return (
                  <div key={d.id} className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-xl border border-slate-200/70">
                    {editingDeptId === d.id ? (
                      <div className="flex items-center gap-2 flex-1 mr-2">
                        <input
                          type="text"
                          value={editingDeptName}
                          onChange={(e) => setEditingDeptName(e.target.value)}
                          className="flex-1 px-2.5 py-1 bg-white border border-slate-200 text-xs text-slate-900 rounded-lg outline-none"
                        />
                        <input
                          type="color"
                          value={editingDeptColor}
                          onChange={(e) => setEditingDeptColor(e.target.value)}
                          className="w-7 h-7 p-0.5 border border-slate-200 bg-white rounded-md cursor-pointer"
                        />
                        <button
                          onClick={() => handleUpdateDepartment(d.id)}
                          className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-xs font-bold"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingDeptId(null)}
                          className="px-2 py-1 bg-slate-200 text-slate-700 rounded-lg text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <div className="w-3.5 h-3.5 rounded-full shadow-2xs" style={{ backgroundColor: d.color }}></div>
                          <span className="text-xs font-bold text-slate-800">{d.name}</span>
                          <span className="text-[10px] px-2 py-0.5 bg-slate-200 text-slate-600 rounded-full font-semibold">
                            {taskCount} tasks
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              setEditingDeptId(d.id);
                              setEditingDeptName(d.name);
                              setEditingDeptColor(d.color || '#2563eb');
                            }}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-white rounded-lg transition"
                            title="Edit Category"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteDepartment(d.id, d.name)}
                            className={`p-1.5 rounded-lg transition ${taskCount > 0 ? 'text-slate-300 cursor-not-allowed' : 'text-slate-400 hover:text-rose-600 hover:bg-white'}`}
                            title={taskCount > 0 ? 'Cannot delete category containing active tasks' : 'Delete Category'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            
            <button onClick={() => setShowDeptModal(false)} className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition">Close</button>
          </div>
        </div>
      )}

      {/* 6. HISTORY LOG MODAL */}
      {showHistoryModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 border border-slate-100">
            <h2 className="text-base font-bold text-slate-900 mb-3 flex items-center gap-2">
              <History className="w-5 h-5 text-blue-600" /> Activity History Log
            </h2>
            <div className="space-y-2 max-h-72 overflow-y-auto border-t border-b border-slate-100 py-3 mb-3">
              {history.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">No history records yet.</p>
              ) : (
                history.map((item) => (
                  <div key={item.id} className="text-xs bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <p className="font-semibold text-slate-800">{item.action}</p>
                    <p className="text-[10px] text-slate-400 mt-1">{format(parseISO(item.changed_at), 'MMM dd, yyyy - hh:mm a')}</p>
                  </div>
                ))
              )}
            </div>
            <button onClick={() => setShowHistoryModal(false)} className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition">Close</button>
          </div>
        </div>
      )}

    </main>
  );
}