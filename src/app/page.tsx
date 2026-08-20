'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { format, addDays, startOfWeek, differenceInDays, isToday, parseISO, getDay, getDate, differenceInMinutes } from 'date-fns';
import { Search, Plus, Calendar, AlertCircle, Clock, History, Trash2, X, RotateCcw, Repeat, Bell, CheckCircle2 } from 'lucide-react';

interface Department {
  id: string;
  name: string;
  color: string;
}

type TaskStatus = 'Open' | 'In Progress' | 'Pending' | 'Completed' | 'Resolved' | 'Blocked' | 'Cancelled';
type TaskPriority = 'Crit' | 'High' | 'Medi' | 'Low';
type TaskFrequency = 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly';

interface Task {
  id: string;
  title: string;
  department_id: string;
  priority: TaskPriority;
  status: TaskStatus;
  start_date: string;
  due_date: string;
  start_time?: string;
  due_time?: string;
  description?: string;
  frequency: TaskFrequency;
  recurring_day?: string;
  recurring_date?: number;
}

interface HistoryItem {
  id: string;
  action: string;
  changed_at: string;
}

interface ActiveReminder {
  task: Task;
  diffMinutes: number;
  timeLabel: string;
  isOverdue: boolean;
}

const PRIORITY_STYLES: Record<TaskPriority, string> = {
  Crit: 'bg-red-100 text-red-700 border-red-300',
  High: 'bg-orange-100 text-orange-700 border-orange-300',
  Medi: 'bg-yellow-100 text-yellow-700 border-yellow-300',
  Low: 'bg-slate-100 text-slate-700 border-slate-300',
};

const STATUS_STYLES: Record<TaskStatus, string> = {
  Open: 'bg-blue-50 text-blue-700 border-blue-200',
  'In Progress': 'bg-sky-50 text-sky-700 border-sky-200',
  Pending: 'bg-amber-50 text-amber-700 border-amber-200',
  Completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Resolved: 'bg-purple-50 text-purple-700 border-purple-200',
  Blocked: 'bg-rose-50 text-rose-700 border-rose-200',
  Cancelled: 'bg-slate-100 text-slate-500 border-slate-300 line-through',
};

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Helper to format remaining vs overdue time
const formatTimeDifference = (diffMinutes: number) => {
  if (diffMinutes >= 0) {
    if (diffMinutes === 0) return 'Due right now!';
    if (diffMinutes < 60) return `${diffMinutes} min${diffMinutes === 1 ? '' : 's'} remaining`;
    const hrs = Math.floor(diffMinutes / 60);
    const mins = diffMinutes % 60;
    return `${hrs}h ${mins}m remaining`;
  } else {
    const overdueMins = Math.abs(diffMinutes);
    if (overdueMins < 60) return `Overdue by ${overdueMins} min${overdueMins === 1 ? '' : 's'}`;
    const hrs = Math.floor(overdueMins / 60);
    const mins = overdueMins % 60;
    return `Overdue by ${hrs}h ${mins}m`;
  }
};

// 🎵 Polyphonic Notification Chime
const playPremiumChime = (isOverdue: boolean) => {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    const notes = isOverdue ? [523.25, 659.25, 1046.50] : [587.33, 880.00];

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.12);

      gain.gain.setValueAtTime(0, ctx.currentTime + idx * 0.12);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + idx * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + idx * 0.12 + 0.6);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime + idx * 0.12);
      osc.stop(ctx.currentTime + idx * 0.12 + 0.65);
    });
  } catch (e) {
    // Audio restriction fallback
  }
};

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  
  // Track dismissed reminder IDs in session
  const [dismissedReminders, setDismissedReminders] = useState<Set<string>>(new Set());
  const soundPlayedRef = useRef<Set<string>>(new Set());

  // Filters
  const [search, setSearch] = useState('');
  const [selectedDept, setSelectedDept] = useState('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');
  const [filterFromDate, setFilterFromDate] = useState('');
  const [filterToDate, setFilterToDate] = useState('');
  const [activeQuickFilter, setActiveQuickFilter] = useState<'today' | 'overdue' | null>(null);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeptModal, setShowDeptModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  // Form States
  const [newDeptName, setNewDeptName] = useState('');
  const [newDeptColor, setNewDeptColor] = useState('#2563eb');
  
  const [formData, setFormData] = useState<{
    title: string;
    department_id: string;
    priority: TaskPriority;
    status: TaskStatus;
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
    frequency: 'once',
    recurring_day: 'Monday',
    recurring_date: 1,
    start_date: format(new Date(), 'yyyy-MM-dd'),
    due_date: format(addDays(new Date(), 3), 'yyyy-MM-dd'),
    start_time: '',
    due_time: '',
    description: '',
  });

  const timelineStart = useMemo(() => startOfWeek(new Date(), { weekStartsOn: 0 }), []);
  const daysArray = useMemo(() => Array.from({ length: 21 }, (_, i) => addDays(timelineStart, i)), [timelineStart]);

  // Request Native Notification Permission
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
      }
    }
  }, []);

  // Real-time Clock updating every 10 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  // Compute Active Reminders (from 1 hour before due until completed)
  const activeReminders = useMemo(() => {
    const reminders: ActiveReminder[] = [];

    tasks.forEach((task) => {
      if (task.status === 'Completed' || task.status === 'Resolved' || task.status === 'Cancelled') {
        return;
      }
      if (!task.due_date) return;

      const dueDateTimeStr = task.due_time ? `${task.due_date}T${task.due_time}:00` : `${task.due_date}T23:59:59`;
      const taskDueDateTime = new Date(dueDateTimeStr);
      const diffMinutes = differenceInMinutes(taskDueDateTime, currentTime);

      // Condition: 1 hour before due (<= 60 mins) OR already Overdue (diffMinutes < 0)
      if (diffMinutes <= 60) {
        if (!dismissedReminders.has(task.id)) {
          reminders.push({
            task,
            diffMinutes,
            timeLabel: formatTimeDifference(diffMinutes),
            isOverdue: diffMinutes < 0,
          });

          // Play sound when entering 1 hour window or due now for the first time
          const soundKey = `${task.id}-${diffMinutes <= 0 ? 'due' : '1hr'}`;
          if (!soundPlayedRef.current.has(soundKey)) {
            soundPlayedRef.current.add(soundKey);
            playPremiumChime(diffMinutes < 0);
          }
        }
      }
    });

    // Sort: Overdue first, then soonest due
    return reminders.sort((a, b) => a.diffMinutes - b.diffMinutes);
  }, [tasks, currentTime, dismissedReminders]);

  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    await Promise.all([fetchDepartments(), fetchTasks(), fetchHistory()]);
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
    if (data) setTasks(data as Task[]);
  };

  const fetchHistory = async () => {
    const { data } = await supabase.from('task_history').select('*').order('changed_at', { ascending: false }).limit(25);
    if (data) setHistory(data);
  };

  // Add Task
  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) return alert('Please enter a task title');
    if (!formData.department_id) return alert('Please select a Category');

    const payload = {
      title: formData.title,
      department_id: formData.department_id,
      priority: formData.priority,
      status: formData.status,
      frequency: formData.frequency,
      recurring_day: formData.frequency === 'weekly' ? formData.recurring_day : null,
      recurring_date: formData.frequency === 'monthly' ? Number(formData.recurring_date) : null,
      start_date: formData.start_date,
      due_date: formData.due_date,
      start_time: formData.start_time || null,
      due_time: formData.due_time || null,
      description: formData.description,
      owner_name: 'Me',
    };

    const { data, error } = await supabase.from('tasks').insert([payload]).select();
    if (error) {
      alert('Error saving task: ' + error.message);
    } else {
      if (data && data[0]) {
        await supabase.from('task_history').insert([{ task_id: data[0].id, action: `Created task: "${formData.title}"` }]);
      }
      setShowAddModal(false);
      setFormData((prev) => ({
        ...prev,
        title: '',
        description: '',
        start_time: '',
        due_time: '',
      }));
      fetchTasks();
      fetchHistory();
    }
  };

  // Quick mark complete directly from notification
  const handleQuickComplete = async (taskId: string, title: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const { error } = await supabase.from('tasks').update({ status: 'Completed' }).eq('id', taskId);
    if (!error) {
      await supabase.from('task_history').insert([{ task_id: taskId, action: `Completed task: "${title}"` }]);
      fetchTasks();
      fetchHistory();
    }
  };

  // Update Task
  const handleUpdateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTask) return;

    const { error } = await supabase.from('tasks').update({
      title: activeTask.title,
      department_id: activeTask.department_id,
      priority: activeTask.priority,
      status: activeTask.status,
      frequency: activeTask.frequency,
      recurring_day: activeTask.frequency === 'weekly' ? activeTask.recurring_day : null,
      recurring_date: activeTask.frequency === 'monthly' ? Number(activeTask.recurring_date) : null,
      start_date: activeTask.start_date,
      due_date: activeTask.due_date,
      start_time: activeTask.start_time || null,
      due_time: activeTask.due_time || null,
      description: activeTask.description,
    }).eq('id', activeTask.id);

    if (error) {
      alert('Error updating task: ' + error.message);
    } else {
      await supabase.from('task_history').insert([{ task_id: activeTask.id, action: `Updated task: "${activeTask.title}" (${activeTask.status})` }]);
      setActiveTask(null);
      fetchTasks();
      fetchHistory();
    }
  };

  // Delete Task
  const handleDeleteTask = async (taskId: string, title: string) => {
    if (!confirm(`Are you sure you want to delete "${title}"?`)) return;
    const { error } = await supabase.from('tasks').delete().eq('id', taskId);
    if (!error) {
      await supabase.from('task_history').insert([{ action: `Deleted task: "${title}"` }]);
      setActiveTask(null);
      fetchTasks();
      fetchHistory();
    }
  };

  // Add Department
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

  // Reset Filters
  const handleResetFilters = () => {
    setSearch('');
    setSelectedDept('All');
    setSelectedStatus('All');
    setFilterFromDate('');
    setFilterToDate('');
    setActiveQuickFilter(null);
  };

  const todayCount = useMemo(() => tasks.filter((t) => isToday(parseISO(t.start_date)) || isToday(parseISO(t.due_date))).length, [tasks]);
  const overdueCount = useMemo(() => tasks.filter((t) => parseISO(t.due_date) < new Date() && t.status !== 'Completed' && t.status !== 'Resolved' && t.status !== 'Cancelled').length, [tasks]);

  // Current Live Time Position Calculation
  const currentDayIndex = differenceInDays(new Date(), timelineStart);
  const currentHourPercent = (currentTime.getHours() * 60 + currentTime.getMinutes()) / 1440;
  const liveIndicatorPosition = currentDayIndex >= 0 && currentDayIndex < 21 ? (currentDayIndex + currentHourPercent) * 60 : null;

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (search && !task.title.toLowerCase().includes(search.toLowerCase()) && !(task.description || '').toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      if (selectedDept !== 'All' && task.department_id !== selectedDept) {
        return false;
      }
      if (selectedStatus !== 'All' && task.status !== selectedStatus) {
        return false;
      }
      if (activeQuickFilter === 'today') {
        if (!isToday(parseISO(task.start_date)) && !isToday(parseISO(task.due_date))) {
          return false;
        }
      } else if (activeQuickFilter === 'overdue') {
        if (!(parseISO(task.due_date) < new Date() && task.status !== 'Completed' && task.status !== 'Resolved' && task.status !== 'Cancelled')) {
          return false;
        }
      }
      if (filterFromDate && task.start_date < filterFromDate) return false;
      if (filterToDate && task.due_date > filterToDate) return false;

      return true;
    });
  }, [tasks, search, selectedDept, selectedStatus, activeQuickFilter, filterFromDate, filterToDate]);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans relative">
      
      {/* ========================================================================= */}
      {/* 🚀 LIVE ACTIVE REMINDERS (1 Hour Before until Complete - Floating Side List) */}
      {/* ========================================================================= */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 max-w-sm w-full pointer-events-none">
        {activeReminders.map((reminder) => (
          <div
            key={reminder.task.id}
            onClick={() => setActiveTask(reminder.task)}
            className={`pointer-events-auto cursor-pointer flex items-start gap-3 p-4 rounded-2xl shadow-2xl border backdrop-blur-md transition-all duration-300 transform hover:scale-102 hover:shadow-indigo-500/20 active:scale-98 animate-in slide-in-from-right-10 group ${
              reminder.isOverdue
                ? 'bg-rose-50/95 border-rose-300 text-rose-950'
                : 'bg-amber-50/95 border-amber-300 text-amber-950'
            }`}
          >
            {/* Glowing Status Icon */}
            <div
              className={`p-2.5 rounded-full shrink-0 shadow-sm transition-transform group-hover:scale-110 ${
                reminder.isOverdue
                  ? 'bg-rose-600 text-white animate-bounce'
                  : 'bg-amber-500 text-white animate-pulse'
              }`}
            >
              <Bell className="w-4 h-4" />
            </div>

            {/* Notification Text */}
            <div className="flex-1 overflow-hidden">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold truncate pr-2 group-hover:text-blue-600 transition">
                  {reminder.task.title}
                </h4>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                  reminder.isOverdue ? 'bg-rose-200 text-rose-800' : 'bg-amber-200 text-amber-800'
                }`}>
                  {reminder.task.due_time || 'Today'}
                </span>
              </div>

              {/* Remaining / Overdue Time Label */}
              <p className={`text-xs font-bold mt-1 ${reminder.isOverdue ? 'text-rose-700' : 'text-amber-800'}`}>
                {reminder.isOverdue ? '🚨 ' : '⏳ '}{reminder.timeLabel}
              </p>

              {/* Quick Actions */}
              <div className="flex items-center justify-between mt-2 pt-1 border-t border-black/5">
                <span className="text-[10px] text-blue-600 font-semibold opacity-0 group-hover:opacity-100 transition">
                  👆 Click to edit
                </span>
                <button
                  onClick={(e) => handleQuickComplete(reminder.task.id, reminder.task.title, e)}
                  className="flex items-center gap-1 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 rounded-md shadow-xs transition"
                >
                  <CheckCircle2 className="w-3 h-3" /> Mark Done
                </button>
              </div>
            </div>

            {/* Dismiss temporary */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDismissedReminders((prev) => new Set([...prev, reminder.task.id]));
              }}
              className="text-slate-400 hover:text-slate-700 p-1 rounded-full hover:bg-black/10 shrink-0 transition"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* 1. TOP HEADER & CONTROLS */}
      <header className="bg-white border-b border-slate-200 px-6 py-3 sticky top-0 z-40 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 text-white p-2 rounded-lg shadow-xs">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 leading-tight">Project Timeline Hub</h1>
              <p className="text-xs text-slate-500">Live Time: {format(currentTime, 'hh:mm:ss a')} • {filteredTasks.length} Showing</p>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-2.5">
            {/* Quick Filters */}
            <button
              onClick={() => setActiveQuickFilter((prev) => (prev === 'today' ? null : 'today'))}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition cursor-pointer ${
                activeQuickFilter === 'today'
                  ? 'bg-amber-500 text-white border-amber-600 shadow-xs'
                  : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
              }`}
            >
              <Clock className="w-3.5 h-3.5" /> Today: {todayCount}
            </button>

            <button
              onClick={() => setActiveQuickFilter((prev) => (prev === 'overdue' ? null : 'overdue'))}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition cursor-pointer ${
                activeQuickFilter === 'overdue'
                  ? 'bg-rose-600 text-white border-rose-700 shadow-xs'
                  : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
              }`}
            >
              <AlertCircle className="w-3.5 h-3.5" /> Overdue: {overdueCount}
            </button>

            {/* Search */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs w-36 outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              />
            </div>

            {/* Status Filter */}
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="All">All Statuses</option>
              <option value="Open">Open</option>
              <option value="In Progress">In Progress</option>
              <option value="Pending">Pending</option>
              <option value="Completed">Completed</option>
              <option value="Resolved">Resolved</option>
              <option value="Blocked">Blocked</option>
              <option value="Cancelled">Cancelled</option>
            </select>

            {/* Category Filter */}
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="All">All Categories</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>

            {/* Date Range */}
            <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
              <span className="text-[10px] text-slate-400 uppercase font-bold">From</span>
              <input
                type="date"
                value={filterFromDate}
                onChange={(e) => setFilterFromDate(e.target.value)}
                className="bg-transparent text-xs outline-none cursor-pointer text-slate-700"
              />
              <span className="text-[10px] text-slate-400 uppercase font-bold ml-1">To</span>
              <input
                type="date"
                value={filterToDate}
                onChange={(e) => setFilterToDate(e.target.value)}
                className="bg-transparent text-xs outline-none cursor-pointer text-slate-700"
              />
            </div>

            {/* Reset */}
            {(search || selectedDept !== 'All' || selectedStatus !== 'All' || filterFromDate || filterToDate || activeQuickFilter) && (
              <button onClick={handleResetFilters} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition" title="Reset Filters">
                <RotateCcw className="w-4 h-4" />
              </button>
            )}

            <button onClick={() => setShowDeptModal(true)} className="px-3 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 rounded-lg text-xs font-medium transition">
              Categories
            </button>

            <button onClick={() => setShowHistoryModal(true)} className="p-2 border border-slate-200 bg-white hover:bg-slate-50 rounded-lg text-slate-600 transition" title="History Log">
              <History className="w-4 h-4" />
            </button>

            <button onClick={() => setShowAddModal(true)} className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs transition">
              <Plus className="w-4 h-4" /> Add Task
            </button>
          </div>
        </div>
      </header>

      {/* 2. TIMELINE TABLE VIEW */}
      <div className="flex-1 overflow-x-auto overflow-y-auto">
        <div className="min-w-[1680px] relative">
          
          {/* LIVE CURRENT TIME INDICATOR LINE */}
          {liveIndicatorPosition !== null && (
            <div
              style={{ left: `calc(400px + ${liveIndicatorPosition}px)` }}
              className="absolute top-0 bottom-0 w-[2px] bg-rose-500 z-30 pointer-events-none shadow-[0_0_8px_rgba(244,63,94,0.6)]"
            >
              <div className="sticky top-11 -ml-[4px] w-2.5 h-2.5 rounded-full bg-rose-600 ring-4 ring-rose-200 animate-pulse" />
            </div>
          )}

          {/* Header Row */}
          <div className="grid grid-cols-[400px_repeat(21,60px)] bg-slate-100 border-b border-slate-200 sticky top-0 z-20 shadow-xs">
            <div className="p-3 text-xs font-bold text-slate-600 uppercase border-r border-slate-200 bg-slate-100 sticky left-0 z-30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
              Task & Details
            </div>
            
            {daysArray.map((date, idx) => {
              const current = isToday(date);
              return (
                <div key={idx} className={`text-center py-2 border-r border-slate-200/60 ${current ? 'bg-blue-100/60 font-bold' : ''}`}>
                  <div className={`text-[10px] uppercase font-semibold ${current ? 'text-blue-600' : 'text-slate-400'}`}>{format(date, 'EEE')}</div>
                  <div className={`text-sm ${current ? 'text-blue-600' : 'text-slate-700'}`}>{format(date, 'd')}</div>
                </div>
              );
            })}
          </div>

          {/* Department Categories & Task Rows */}
          {departments.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">
              No categories found. Click <b>Categories</b> above or run the SQL script to initialize.
            </div>
          ) : (
            departments
              .filter((dept) => selectedDept === 'All' || selectedDept === dept.id)
              .map((dept) => {
                const deptTasks = filteredTasks.filter((t) => t.department_id === dept.id);

                return (
                  <div key={dept.id} className="border-b border-slate-200">
                    {/* Category Banner */}
                    <div className="grid grid-cols-[400px_repeat(21,60px)] bg-slate-100/70 border-b border-slate-200/60">
                      <div className="px-4 py-2 flex items-center gap-2 bg-slate-100/90 border-r border-slate-200 sticky left-0 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold text-white shadow-2xs" style={{ backgroundColor: dept.color || '#475569' }}>
                          {dept.name}
                        </span>
                        <span className="text-xs text-slate-400 font-medium">({deptTasks.length})</span>
                      </div>
                      <div className="col-span-21"></div>
                    </div>

                    {/* Task Rows */}
                    {deptTasks.length === 0 ? (
                      <div className="py-2 px-6 text-xs text-slate-400 italic">No tasks in this category</div>
                    ) : (
                      deptTasks.map((task) => {
                        const taskStart = parseISO(task.start_date);
                        const taskEnd = parseISO(task.due_date);
                        
                        const rawStartDiff = differenceInDays(taskStart, timelineStart);
                        const rawDuration = differenceInDays(taskEnd, taskStart) + 1;

                        const clampedStart = Math.max(0, rawStartDiff);
                        const visibleEnd = Math.min(21, rawStartDiff + rawDuration);
                        const visibleDuration = Math.max(1, visibleEnd - clampedStart);
                        const isVisible = rawStartDiff + rawDuration > 0 && rawStartDiff < 21;

                        return (
                          <div
                            key={task.id}
                            onClick={() => setActiveTask(task)}
                            className="grid grid-cols-[400px_repeat(21,60px)] h-12 items-center hover:bg-slate-50 border-b border-slate-100 cursor-pointer group transition relative"
                          >
                            {/* Task Column (STICKY LEFT) */}
                            <div className="px-4 flex items-center justify-between border-r border-slate-200 h-full bg-white group-hover:bg-slate-50 sticky left-0 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                              <div className="flex flex-col truncate pr-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-semibold text-slate-800 truncate group-hover:text-blue-600 transition" title={task.title}>
                                    {task.title}
                                  </span>
                                  {task.frequency !== 'once' && (
                                    <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded flex items-center gap-0.5 border">
                                      <Repeat className="w-2.5 h-2.5" />
                                      {task.frequency === 'weekly' ? task.recurring_day?.slice(0, 3) : task.frequency === 'monthly' ? `${task.recurring_date}th` : task.frequency}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  {task.start_time && (
                                    <span className="text-[10px] text-blue-600 font-medium flex items-center gap-0.5">
                                      <Clock className="w-2.5 h-2.5" /> {task.start_time} {task.due_time ? `- ${task.due_time}` : ''}
                                    </span>
                                  )}
                                  {task.description && (
                                    <span className="text-[10px] text-slate-400 truncate max-w-[150px]">
                                      {task.description}
                                    </span>
                                  )}
                                </div>
                              </div>
                              
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${STATUS_STYLES[task.status]}`}>
                                  {task.status}
                                </span>
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${PRIORITY_STYLES[task.priority]}`}>
                                  {task.priority}
                                </span>
                              </div>
                            </div>

                            {/* Gantt Timeline Bar */}
                            <div className="col-span-21 relative h-full flex items-center">
                              {task.frequency === 'once' && isVisible && (
                                <div
                                  style={{
                                    left: `${clampedStart * 60 + 2}px`,
                                    width: `${visibleDuration * 60 - 6}px`,
                                  }}
                                  className={`absolute h-7 rounded-md px-2.5 flex items-center text-xs font-semibold shadow-2xs truncate transition ${
                                    task.status === 'Completed' || task.status === 'Resolved'
                                      ? 'bg-emerald-50 border border-emerald-300 text-emerald-800'
                                      : task.status === 'Blocked'
                                      ? 'bg-rose-50 border border-rose-300 text-rose-800'
                                      : 'bg-indigo-50 border border-indigo-300 text-indigo-800 hover:ring-2 hover:ring-indigo-400'
                                  }`}
                                >
                                  {task.title} {task.start_time ? `(${task.start_time})` : ''}
                                </div>
                              )}

                              {task.frequency !== 'once' && daysArray.map((dayDate, dayIdx) => {
                                let shouldShow = false;

                                if (task.frequency === 'daily') {
                                  shouldShow = true;
                                } else if (task.frequency === 'weekly' && task.recurring_day) {
                                  shouldShow = DAYS_OF_WEEK[getDay(dayDate)] === task.recurring_day;
                                } else if (task.frequency === 'monthly' && task.recurring_date) {
                                  shouldShow = getDate(dayDate) === Number(task.recurring_date);
                                }

                                if (!shouldShow) return null;

                                return (
                                  <div
                                    key={dayIdx}
                                    style={{ left: `${dayIdx * 60 + 4}px`, width: '52px' }}
                                    className="absolute h-7 rounded bg-blue-50 border border-blue-300 text-blue-800 px-1 flex items-center justify-center text-[10px] font-bold shadow-2xs truncate"
                                    title={`Recurring: ${task.title}`}
                                  >
                                    {task.title}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                );
              })
          )}
        </div>
      </div>

      {/* 3. TASK DETAILS & EDIT MODAL */}
      {activeTask && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 border border-slate-100">
            <div className="flex items-center justify-between border-b pb-3 mb-4">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold px-2 py-0.5 rounded border ${STATUS_STYLES[activeTask.status]}`}>
                  {activeTask.status}
                </span>
                <h2 className="text-base font-bold text-slate-800">Task Details & Edit</h2>
              </div>
              <button onClick={() => setActiveTask(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateTask} className="space-y-3.5">
              <div>
                <label className="text-xs font-semibold text-slate-600">Task Name</label>
                <input
                  type="text"
                  required
                  value={activeTask.title}
                  onChange={(e) => setActiveTask({ ...activeTask, title: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm mt-1 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600">Description / Notes</label>
                <textarea
                  rows={2}
                  value={activeTask.description || ''}
                  onChange={(e) => setActiveTask({ ...activeTask, description: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm mt-1 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs font-semibold text-slate-600">Category</label>
                  <select
                    value={activeTask.department_id}
                    onChange={(e) => setActiveTask({ ...activeTask, department_id: e.target.value })}
                    className="w-full px-2.5 py-1.5 border rounded-lg text-xs mt-1 outline-none"
                  >
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-600">Status</label>
                  <select
                    value={activeTask.status}
                    onChange={(e) => setActiveTask({ ...activeTask, status: e.target.value as TaskStatus })}
                    className="w-full px-2.5 py-1.5 border rounded-lg text-xs mt-1 outline-none"
                  >
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
                  <label className="text-xs font-semibold text-slate-600">Priority</label>
                  <select
                    value={activeTask.priority}
                    onChange={(e) => setActiveTask({ ...activeTask, priority: e.target.value as TaskPriority })}
                    className="w-full px-2.5 py-1.5 border rounded-lg text-xs mt-1 outline-none"
                  >
                    <option value="Medi">Medium</option>
                    <option value="Crit">Critical</option>
                    <option value="High">High</option>
                    <option value="Low">Low</option>
                  </select>
                </div>
              </div>

              {/* Date & Time Grid */}
              <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600">Start Date & Time (Optional)</label>
                  <input
                    type="date"
                    required
                    value={activeTask.start_date}
                    onChange={(e) => setActiveTask({ ...activeTask, start_date: e.target.value })}
                    className="w-full px-2.5 py-1 border rounded-lg text-xs mt-1 bg-white outline-none"
                  />
                  <input
                    type="time"
                    value={activeTask.start_time || ''}
                    onChange={(e) => setActiveTask({ ...activeTask, start_time: e.target.value })}
                    className="w-full px-2.5 py-1 border rounded-lg text-xs mt-1 bg-white outline-none"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600">Due Date & Time (Optional)</label>
                  <input
                    type="date"
                    required
                    value={activeTask.due_date}
                    onChange={(e) => setActiveTask({ ...activeTask, due_date: e.target.value })}
                    className="w-full px-2.5 py-1 border rounded-lg text-xs mt-1 bg-white outline-none"
                  />
                  <input
                    type="time"
                    value={activeTask.due_time || ''}
                    onChange={(e) => setActiveTask({ ...activeTask, due_time: e.target.value })}
                    className="w-full px-2.5 py-1 border rounded-lg text-xs mt-1 bg-white outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t">
                <button
                  type="button"
                  onClick={() => handleDeleteTask(activeTask.id, activeTask.title)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 rounded-lg font-medium transition"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete Task
                </button>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTask(null)}
                    className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold shadow-xs"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. CREATE TASK MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-base font-bold text-slate-800 mb-3">Add New Task</h2>
            <form onSubmit={handleAddTask} className="space-y-3">
              <input
                required
                type="text"
                placeholder="Task Name"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm outline-none"
              />
              
              <textarea
                rows={2}
                placeholder="Description / Notes (Optional)"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm outline-none resize-none"
              />

              <div className="grid grid-cols-2 gap-2">
                <select
                  required
                  value={formData.department_id}
                  onChange={(e) => setFormData({ ...formData, department_id: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-xs outline-none"
                >
                  <option value="">Select Category</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>

                <select
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value as TaskPriority })}
                  className="px-3 py-2 border rounded-lg text-xs outline-none"
                >
                  <option value="Medi">Medium Priority</option>
                  <option value="Crit">Critical Priority</option>
                  <option value="High">High Priority</option>
                  <option value="Low">Low Priority</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as TaskStatus })}
                  className="px-3 py-2 border rounded-lg text-xs outline-none"
                >
                  <option value="Open">Open</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Pending">Pending</option>
                  <option value="Completed">Completed</option>
                  <option value="Resolved">Resolved</option>
                  <option value="Blocked">Blocked</option>
                  <option value="Cancelled">Cancelled</option>
                </select>

                <select
                  value={formData.frequency}
                  onChange={(e) => setFormData({ ...formData, frequency: e.target.value as TaskFrequency })}
                  className="px-3 py-2 border rounded-lg text-xs outline-none"
                >
                  <option value="once">Once</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>

              {/* Dynamic Frequency Fields */}
              {formData.frequency === 'weekly' && (
                <div className="bg-slate-50 p-2 rounded-lg border">
                  <label className="text-[11px] font-semibold text-slate-600">Select Day of the Week</label>
                  <select
                    value={formData.recurring_day}
                    onChange={(e) => setFormData({ ...formData, recurring_day: e.target.value })}
                    className="w-full px-2.5 py-1.5 border rounded-lg text-xs mt-1 bg-white outline-none"
                  >
                    {DAYS_OF_WEEK.map((day) => <option key={day} value={day}>{day}</option>)}
                  </select>
                </div>
              )}

              {formData.frequency === 'monthly' && (
                <div className="bg-slate-50 p-2 rounded-lg border">
                  <label className="text-[11px] font-semibold text-slate-600">Select Day of the Month (1 to 31)</label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={formData.recurring_date}
                    onChange={(e) => setFormData({ ...formData, recurring_date: Number(e.target.value) })}
                    className="w-full px-2.5 py-1.5 border rounded-lg text-xs mt-1 bg-white outline-none"
                  />
                </div>
              )}

              {/* Start/Due Date & Time Grid */}
              <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2 rounded-lg border">
                <div>
                  <label className="text-[11px] text-slate-500 font-semibold">Start Date & Time</label>
                  <input
                    type="date"
                    required
                    value={formData.start_date}
                    onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                    className="w-full px-2.5 py-1 border rounded-lg text-xs mt-1 bg-white outline-none"
                  />
                  <input
                    type="time"
                    value={formData.start_time}
                    onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                    className="w-full px-2.5 py-1 border rounded-lg text-xs mt-1 bg-white outline-none"
                    placeholder="Time (Optional)"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-500 font-semibold">Due Date & Time</label>
                  <input
                    type="date"
                    required
                    value={formData.due_date}
                    onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                    className="w-full px-2.5 py-1 border rounded-lg text-xs mt-1 bg-white outline-none"
                  />
                  <input
                    type="time"
                    value={formData.due_time}
                    onChange={(e) => setFormData({ ...formData, due_time: e.target.value })}
                    className="w-full px-2.5 py-1 border rounded-lg text-xs mt-1 bg-white outline-none"
                    placeholder="Time (Optional)"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 text-sm text-slate-600">Cancel</button>
                <button type="submit" className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg font-medium">Save Task</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. DEPARTMENT MASTER MODAL */}
      {showDeptModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-base font-bold text-slate-800 mb-3">Categories Master</h2>
            <div className="flex gap-2 mb-3">
              <input type="text" placeholder="Category Name" value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} className="flex-1 px-3 py-1.5 border rounded-lg text-sm outline-none" />
              <input type="color" value={newDeptColor} onChange={(e) => setNewDeptColor(e.target.value)} className="w-10 h-9 p-0.5 border rounded-lg cursor-pointer" />
              <button onClick={handleAddDepartment} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium">Add</button>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto mb-4 border-t pt-2">
              {departments.map((d) => (
                <div key={d.id} className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 rounded-md">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }}></div>
                  <span className="text-sm font-medium text-slate-700">{d.name}</span>
                </div>
              ))}
            </div>
            <button onClick={() => setShowDeptModal(false)} className="w-full py-2 bg-slate-100 rounded-lg text-sm font-medium">Close</button>
          </div>
        </div>
      )}

      {/* 6. HISTORY LOG MODAL */}
      {showHistoryModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-base font-bold text-slate-800 mb-3 flex items-center gap-2">
              <History className="w-4 h-4 text-blue-600" /> Activity History Log
            </h2>
            <div className="space-y-2 max-h-72 overflow-y-auto border-t border-b py-3 mb-3">
              {history.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">No history records yet.</p>
              ) : (
                history.map((item) => (
                  <div key={item.id} className="text-xs bg-slate-50 p-2.5 rounded border border-slate-100">
                    <p className="font-semibold text-slate-700">{item.action}</p>
                    <p className="text-slate-400 mt-1">{format(parseISO(item.changed_at), 'MMM dd, yyyy - hh:mm a')}</p>
                  </div>
                ))
              )}
            </div>
            <button onClick={() => setShowHistoryModal(false)} className="w-full py-2 bg-slate-100 rounded-lg text-sm font-medium">Close</button>
          </div>
        </div>
      )}

    </main>
  );
}