import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { fetchGoalsDashboard } from '@/data/goals';
import type { GoalsDashboard, Skill, Achievement, Challenge, ImprovementArea } from '@/types/goals';
import { getSkillLevelLabel } from '@/types/goals';

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

// XP Progress Bar
function XPBar({ xp, xpToNextLevel }: { xp: number; xpToNextLevel: number }) {
  const currentLevelXP = xp % 500;
  const progress = (currentLevelXP / 500) * 100;
  const level = Math.floor(xp / 500) + 1;
  
  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-violet-900/30 to-indigo-900/30 p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 text-xl font-bold text-white shadow-lg shadow-violet-500/30">
            {level}
          </div>
          <div>
            <div className="text-sm text-slate-400">Level {level}</div>
            <div className="font-semibold text-white">{xp.toLocaleString()} XP</div>
          </div>
        </div>
        <div className="text-right text-sm text-slate-400">
          {xpToNextLevel} XP to Level {level + 1}
        </div>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-slate-700/50">
        <div 
          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-400 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

// Streak Display
function StreakDisplay({ current, longest, isActiveToday }: { current: number; longest: number; isActiveToday: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-orange-900/20 to-amber-900/20 p-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-2xl">{isActiveToday ? '🔥' : '💤'}</span>
        <span className="text-lg font-semibold text-white">
          {current} Day Streak
        </span>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <span className={isActiveToday ? 'text-green-400' : 'text-amber-400'}>
          {isActiveToday ? '✓ Practiced today' : 'Practice to keep streak!'}
        </span>
        <span className="text-slate-500">|</span>
        <span className="text-slate-400">Best: {longest} days</span>
      </div>
    </div>
  );
}

// Skill Card
function SkillCard({ skill }: { skill: Skill }) {
  const trendIcon = skill.trend === 'improving' ? '↑' : skill.trend === 'declining' ? '↓' : '→';
  const trendColor = skill.trend === 'improving' ? 'text-green-400' : skill.trend === 'declining' ? 'text-red-400' : 'text-slate-400';
  
  const getScoreColor = (score: number) => {
    if (score >= 80) return 'from-green-500 to-emerald-400';
    if (score >= 60) return 'from-blue-500 to-cyan-400';
    if (score >= 40) return 'from-amber-500 to-yellow-400';
    return 'from-red-500 to-orange-400';
  };
  
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 transition-all hover:bg-white/10">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium text-white">{skill.name}</span>
        <span className={`text-sm ${trendColor}`}>{trendIcon} {skill.trend}</span>
      </div>
      <div className="mb-2 text-2xl font-bold text-white">{skill.currentScore}</div>
      <div className="mb-2 h-2 overflow-hidden rounded-full bg-slate-700/50">
        <div 
          className={`h-full rounded-full bg-gradient-to-r ${getScoreColor(skill.currentScore)} transition-all duration-500`}
          style={{ width: `${skill.currentScore}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400">{getSkillLevelLabel(skill.level)}</span>
        {skill.recentChange !== 0 && (
          <span className={skill.recentChange > 0 ? 'text-green-400' : 'text-red-400'}>
            {skill.recentChange > 0 ? '+' : ''}{skill.recentChange} last session
          </span>
        )}
      </div>
    </div>
  );
}

// Achievement Badge
function AchievementBadge({ achievement }: { achievement: Achievement }) {
  const isUnlocked = !!achievement.unlockedAt;
  
  return (
    <div 
      className={`flex flex-col items-center rounded-xl border p-3 text-center transition-all ${
        isUnlocked 
          ? 'border-amber-500/30 bg-gradient-to-br from-amber-900/20 to-yellow-900/20' 
          : 'border-white/5 bg-white/5 opacity-50'
      }`}
      title={achievement.description}
    >
      <div className={`mb-1 text-3xl ${isUnlocked ? '' : 'grayscale'}`}>
        {achievement.icon}
      </div>
      <div className="mb-1 text-xs font-medium text-white">{achievement.name}</div>
      {!isUnlocked && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700/50">
          <div 
            className="h-full rounded-full bg-slate-500 transition-all"
            style={{ width: `${achievement.progress}%` }}
          />
        </div>
      )}
      {isUnlocked && (
        <div className="text-xs text-amber-400">Unlocked!</div>
      )}
    </div>
  );
}

// Challenge Card
function ChallengeCard({ challenge }: { challenge: Challenge }) {
  const timeLeft = new Date(challenge.expiresAt).getTime() - Date.now();
  const hoursLeft = Math.max(0, Math.floor(timeLeft / (1000 * 60 * 60)));
  
  return (
    <div className={`rounded-xl border p-4 transition-all ${
      challenge.completed 
        ? 'border-green-500/30 bg-green-900/20' 
        : 'border-white/10 bg-white/5'
    }`}>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs ${
            challenge.type === 'daily' ? 'bg-blue-500/20 text-blue-300' : 'bg-purple-500/20 text-purple-300'
          }`}>
            {challenge.type}
          </span>
          <span className="font-medium text-white">{challenge.title}</span>
        </div>
        {challenge.completed ? (
          <span className="text-green-400">✓ Done</span>
        ) : (
          <span className="text-xs text-slate-400">{hoursLeft}h left</span>
        )}
      </div>
      <div className="mb-2 text-sm text-slate-400">{challenge.description}</div>
      <div className="mb-2 h-2 overflow-hidden rounded-full bg-slate-700/50">
        <div 
          className={`h-full rounded-full transition-all ${
            challenge.completed ? 'bg-green-500' : 'bg-gradient-to-r from-violet-500 to-indigo-400'
          }`}
          style={{ width: `${challenge.progress}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400">{challenge.current}/{challenge.target} {challenge.unit}</span>
        <span className="text-amber-400">{challenge.reward}</span>
      </div>
    </div>
  );
}

// Improvement Area Card
function ImprovementCard({ area }: { area: ImprovementArea }) {
  const priorityColors = {
    high: 'border-red-500/30 bg-red-900/10',
    medium: 'border-amber-500/30 bg-amber-900/10',
    low: 'border-green-500/30 bg-green-900/10',
  };
  
  const priorityLabels = {
    high: '🔴 Focus',
    medium: '🟡 Improve',
    low: '🟢 Polish',
  };
  
  return (
    <div className={`rounded-xl border p-4 ${priorityColors[area.priority]}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium text-white">{area.title}</span>
        <span className="text-xs text-slate-400">{priorityLabels[area.priority]}</span>
      </div>
      <div className="mb-2 flex items-center gap-2 text-sm">
        <span className="text-slate-400">Current:</span>
        <span className="font-mono text-white">{area.currentValue} {area.unit}</span>
        <span className="text-slate-500">→</span>
        <span className="text-slate-400">Target:</span>
        <span className="font-mono text-green-400">{area.targetValue} {area.unit}</span>
      </div>
      <div className="text-sm text-slate-300">{area.advice}</div>
    </div>
  );
}

// Weekly Activity Chart
function WeeklyChart({ data }: { data: { day: string; sessions: number; minutes: number }[] }) {
  const maxSessions = Math.max(...data.map(d => d.sessions), 1);
  
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <h3 className="mb-4 font-semibold text-white">This Week</h3>
      <div className="flex items-end justify-between gap-2">
        {data.map((day, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            <div className="relative h-24 w-full">
              <div 
                className={`absolute bottom-0 w-full rounded-t transition-all ${
                  day.sessions > 0 
                    ? 'bg-gradient-to-t from-violet-600 to-violet-400' 
                    : 'bg-slate-700/30'
                }`}
                style={{ height: `${Math.max(10, (day.sessions / maxSessions) * 100)}%` }}
              />
            </div>
            <span className="text-xs text-slate-400">{day.day}</span>
            <span className="text-xs font-medium text-white">{day.sessions}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Stats Overview
function StatsOverview({ stats }: { stats: GoalsDashboard['userStats'] }) {
  const statItems = [
    { label: 'Total Sessions', value: stats.totalSessions, icon: '🎯' },
    { label: 'Practice Time', value: `${stats.totalPracticeMinutes}m`, icon: '⏱️' },
    { label: 'Words Spoken', value: stats.totalWords.toLocaleString(), icon: '💬' },
    { label: 'This Week', value: stats.sessionsThisWeek, icon: '📅' },
  ];
  
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {statItems.map((stat, i) => (
        <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
          <div className="mb-1 text-2xl">{stat.icon}</div>
          <div className="text-xl font-bold text-white">{stat.value}</div>
          <div className="text-xs text-slate-400">{stat.label}</div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function GoalsPage() {
  const [dashboard, setDashboard] = useState<GoalsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    async function load() {
      try {
        const data = await fetchGoalsDashboard();
        setDashboard(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load goals');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);
  
  if (loading) {
    return (
      <AppShell title="Goals & Progress" subtitle="Track your speaking journey">
        <div className="flex h-64 items-center justify-center">
          <div className="text-slate-400">Loading your progress...</div>
        </div>
      </AppShell>
    );
  }
  
  if (error || !dashboard) {
    return (
      <AppShell title="Goals & Progress" subtitle="Track your speaking journey">
        <div className="rounded-2xl border border-red-500/20 bg-red-900/10 p-6 text-center">
          <div className="mb-2 text-red-400">Failed to load goals</div>
          <div className="text-sm text-slate-400">{error}</div>
        </div>
      </AppShell>
    );
  }
  
  const { userStats, skills, xp, xpToNextLevel, achievements, activeChallenges, improvementAreas, weeklyProgress } = dashboard;
  
  // Separate locked and unlocked achievements
  const unlockedAchievements = achievements.filter(a => a.unlockedAt);
  const lockedAchievements = achievements.filter(a => !a.unlockedAt).slice(0, 4);
  
  return (
    <AppShell title="Goals & Progress" subtitle="Track your speaking journey">
      <div className="space-y-6">
        {/* Top Row: XP & Streak */}
        <div className="grid gap-4 md:grid-cols-2">
          <XPBar xp={xp} xpToNextLevel={xpToNextLevel} />
          <StreakDisplay 
            current={userStats.streak.current} 
            longest={userStats.streak.longest}
            isActiveToday={userStats.streak.isActiveToday}
          />
        </div>
        
        {/* Stats Overview */}
        <StatsOverview stats={userStats} />
        
        {/* Skills Section */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <h3 className="mb-4 text-lg font-semibold text-white">Your Skills</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {skills.map(skill => (
              <SkillCard key={skill.id} skill={skill} />
            ))}
          </div>
        </div>
        
        {/* Middle Row: Challenges & Weekly Activity */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Active Challenges */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h3 className="mb-4 text-lg font-semibold text-white">Active Challenges</h3>
            <div className="space-y-3">
              {activeChallenges.length > 0 ? (
                activeChallenges.map(challenge => (
                  <ChallengeCard key={challenge.id} challenge={challenge} />
                ))
              ) : (
                <div className="py-4 text-center text-slate-400">
                  Complete more sessions to unlock challenges!
                </div>
              )}
            </div>
          </div>
          
          {/* Weekly Activity */}
          <WeeklyChart data={weeklyProgress} />
        </div>
        
        {/* Improvement Areas */}
        {improvementAreas.length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h3 className="mb-4 text-lg font-semibold text-white">Areas to Improve</h3>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {improvementAreas.map((area, i) => (
                <ImprovementCard key={i} area={area} />
              ))}
            </div>
          </div>
        )}
        
        {/* Achievements */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <h3 className="mb-4 text-lg font-semibold text-white">
            Achievements 
            <span className="ml-2 text-sm font-normal text-slate-400">
              ({unlockedAchievements.length}/{achievements.length} unlocked)
            </span>
          </h3>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {unlockedAchievements.map(achievement => (
              <AchievementBadge key={achievement.id} achievement={achievement} />
            ))}
            {lockedAchievements.map(achievement => (
              <AchievementBadge key={achievement.id} achievement={achievement} />
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
