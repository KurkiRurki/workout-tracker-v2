import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, startWorkout, deleteSession } from '../db/index.js'
import { format, startOfWeek, endOfWeek } from 'date-fns'
import { Play, Flame, CheckCircle2, Trash2, ChevronDown, ChevronUp } from 'lucide-react'

const S     = { background: '#111118', borderColor: '#1e1e2a' }
const BRAND = '#22d3a0'

export default function Dashboard() {
  const navigate  = useNavigate()
  const [starting, setStarting] = useState(false)
  const [showAll, setShowAll]   = useState(false)

  const state = useLiveQuery(async () => {
    const planId    = (await db.appState.get('activePlanId'))?.value
    const dayIdx    = (await db.appState.get('currentDayIndex'))?.value ?? 0
    const sessionId = (await db.appState.get('activeSessionId'))?.value
    return { planId, dayIdx, sessionId }
  })

  const plan = useLiveQuery(
    async () => state?.planId ? db.plans.get(state.planId) : null,
    [state?.planId]
  )

  const currentDay = useLiveQuery(async () => {
    if (!state?.planId) return null
    const days = await db.planDays.where('planId').equals(state.planId).sortBy('dayIndex')
    if (!days.length) return null
    return days[(state.dayIdx ?? 0) % days.length]
  }, [state?.planId, state?.dayIdx])

  const preview = useLiveQuery(
    async () => currentDay
      ? db.planExercises.where('planDayId').equals(currentDay.id).sortBy('order')
      : [],
    [currentDay?.id]
  )

  const weekStats = useLiveQuery(async () => {
    const wS   = startOfWeek(new Date(), { weekStartsOn: 1 })
    const wE   = endOfWeek(new Date(),   { weekStartsOn: 1 })
    const done  = await db.sessions.where('date').between(wS.toISOString(), wE.toISOString(), true, true).filter(s => s.completed === 1).count()
    const total = await db.sessions.where('completed').equals(1).count()
    return { done, total }
  })

  const activeSession = useLiveQuery(
    async () => state?.sessionId ? db.sessions.get(state.sessionId) : null,
    [state?.sessionId]
  )

  async function handleStart() {
    if (!currentDay || starting) return
    setStarting(true)
    try { await startWorkout(currentDay.id); navigate('/log') }
    finally { setStarting(false) }
  }

  if (!state) return <Spinner />

  return (
    <div className="space-y-5 fade-up">
      <div className="pt-1">
        <p className="text-xs tracking-widest uppercase" style={{ color: BRAND }}>
          {format(new Date(), 'EEEE, MMMM d')}
        </p>
        <h1 className="text-3xl font-bold mt-0.5 tracking-tight" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
          {plan ? `Good ${greeting()}` : 'Welcome'}
        </h1>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat icon={<Flame size={16} style={{ color: '#f59e0b' }} />} label="This Week" value={weekStats?.done ?? 0} sub="sessions" />
        <Stat icon={<CheckCircle2 size={16} style={{ color: BRAND }} />} label="All Time" value={weekStats?.total ?? 0} sub="completed" />
      </div>

      {!plan ? (
        <NoPlan onGo={() => navigate('/plan')} />
      ) : currentDay ? (
        <div className="rounded-2xl p-5 border" style={S}>
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-xs uppercase tracking-widest mb-1" style={{ color: '#6b6b80' }}>
                {activeSession ? 'In progress' : 'Up next · ' + plan.name}
              </p>
              <h2 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                {currentDay.name}
              </h2>
            </div>
            {activeSession && (
              <span className="text-xs px-2.5 py-1 rounded-full border pulse-active"
                style={{ background: '#0f3d2a', color: BRAND, borderColor: '#1a6b49' }}>
                ACTIVE
              </span>
            )}
          </div>

          {preview?.length > 0 && (
            <div className="mb-5 space-y-2">
              {preview.slice(0, 5).map(ex => (
                <div key={ex.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2.5">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: BRAND }} />
                    <span style={{ color: '#c8c8d8' }}>{ex.name}</span>
                  </div>
                  <span className="text-xs" style={{ color: '#6b6b80' }}>
                    {ex.targetSets && `${ex.targetSets}×`}{ex.targetReps || ''}
                  </span>
                </div>
              ))}
              {preview.length > 5 && (
                <p className="text-xs pl-4" style={{ color: '#6b6b80' }}>+{preview.length - 5} more</p>
              )}
            </div>
          )}

          <button
            onClick={activeSession ? () => navigate('/log') : handleStart}
            disabled={starting}
            className="w-full py-4 rounded-xl font-bold tracking-wider flex items-center justify-center gap-2.5 transition-all active:scale-[.98] disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #22d3a0, #0f9b70)', color: '#000', fontFamily: 'Barlow Condensed, sans-serif', fontSize: '1rem', letterSpacing: '0.1em' }}>
            <Play size={18} fill="currentColor" />
            {activeSession ? 'Continue Workout' : starting ? 'Starting…' : 'Start Workout'}
          </button>
        </div>
      ) : (
        <div className="rounded-2xl p-5 text-center border" style={S}>
          <p style={{ color: '#6b6b80' }} className="mb-3">No days in your plan.</p>
          <button onClick={() => navigate('/plan')} style={{ color: BRAND }} className="text-sm">Add training days →</button>
        </div>
      )}

      <RecentSessions showAll={showAll} onToggleAll={() => setShowAll(v => !v)} />
    </div>
  )
}

function RecentSessions({ showAll, onToggleAll }) {
  const [confirmDelete, setConfirmDelete] = useState(null)

  const sessions = useLiveQuery(async () => {
    const all = await db.sessions.where('completed').equals(1).reverse().limit(showAll ? 50 : 5).toArray()
    return Promise.all(all.map(async s => ({
      ...s,
      dayName: (await db.planDays.get(s.planDayId))?.name ?? 'Workout',
      exCount: await db.sessionExercises.where('sessionId').equals(s.id).count(),
    })))
  }, [showAll])

  // Also show incomplete/active sessions so they can be deleted
  const incomplete = useLiveQuery(async () => {
    const all = await db.sessions.where('completed').equals(0).reverse().toArray()
    return Promise.all(all.map(async s => ({
      ...s,
      dayName: (await db.planDays.get(s.planDayId))?.name ?? 'Workout',
      exCount: await db.sessionExercises.where('sessionId').equals(s.id).count(),
    })))
  })

  async function handleDelete(id) {
    await deleteSession(id)
    setConfirmDelete(null)
  }

  const allSessions = [...(incomplete ?? []), ...(sessions ?? [])]
  if (!allSessions.length) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-widest" style={{ color: '#6b6b80' }}>Session History</h3>
        {(sessions?.length ?? 0) >= 5 && (
          <button onClick={onToggleAll} className="text-xs flex items-center gap-1" style={{ color: '#6b6b80' }}>
            {showAll ? <><ChevronUp size={12} /> Show less</> : <><ChevronDown size={12} /> Show all</>}
          </button>
        )}
      </div>

      <div className="space-y-2">
        {allSessions.map(s => (
          <div key={s.id} className="flex items-center gap-3 rounded-xl px-4 py-3 border" style={{ background: '#111118', borderColor: '#1e1e2a' }}>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate" style={{ color: '#e8e8f0' }}>{s.dayName}</p>
              <p className="text-xs mt-0.5" style={{ color: '#6b6b80' }}>
                {format(new Date(s.date), 'EEE, MMM d')}
                {' · '}{s.exCount} exercises
                {s.completed === 0 && <span style={{ color: '#f59e0b' }}> · incomplete</span>}
              </p>
            </div>

            {confirmDelete === s.id ? (
              <div className="flex gap-2 items-center">
                <span className="text-xs" style={{ color: '#6b6b80' }}>Delete?</span>
                <button onClick={() => handleDelete(s.id)}
                  className="text-xs px-2 py-1 rounded-lg"
                  style={{ background: '#f43f5e20', color: '#f43f5e' }}>Yes</button>
                <button onClick={() => setConfirmDelete(null)}
                  className="text-xs px-2 py-1 rounded-lg"
                  style={{ background: '#1a1a24', color: '#6b6b80' }}>No</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {s.completed === 1
                  ? <CheckCircle2 size={16} style={{ color: BRAND }} />
                  : <span className="text-xs" style={{ color: '#f59e0b' }}>●</span>
                }
                <button onClick={() => setConfirmDelete(s.id)}
                  className="p-1.5 rounded-lg transition-colors"
                  style={{ color: '#6b6b80' }}>
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function Stat({ icon, label, value, sub }) {
  return (
    <div className="rounded-xl p-4 border" style={S}>
      <div className="flex items-center gap-1.5 mb-1">{icon}<span className="text-xs uppercase tracking-wider" style={{ color: '#6b6b80' }}>{label}</span></div>
      <p className="text-3xl font-bold" style={{ fontFamily: 'Barlow Condensed, sans-serif', color: '#e8e8f0' }}>{value}</p>
      <p className="text-xs mt-0.5" style={{ color: '#6b6b80' }}>{sub}</p>
    </div>
  )
}

function NoPlan({ onGo }) {
  return (
    <div className="rounded-2xl p-8 border text-center" style={S}>
      <div className="text-5xl mb-4">🏋️</div>
      <h2 className="text-xl font-bold mb-2">No plan yet</h2>
      <p className="text-sm mb-5" style={{ color: '#6b6b80' }}>Create a workout plan to get started.</p>
      <button onClick={onGo} className="px-6 py-3 rounded-xl font-bold text-sm"
        style={{ background: 'linear-gradient(135deg, #22d3a0, #0f9b70)', color: '#000' }}>
        Create a Plan
      </button>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: BRAND, borderTopColor: 'transparent' }} />
    </div>
  )
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Morning'
  if (h < 17) return 'Afternoon'
  return 'Evening'
}
