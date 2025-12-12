// Goals Data Layer
// Calculates gamification stats from session data
// Completely separate from session data layer to avoid coupling

import { listSessions } from './sessions';
import type { Session, SessionMetricsSummary } from '@/types/sessions';
import type {
  GoalsDashboard,
  Skill,
  SkillCategory,
  Achievement,
  Challenge,
  Streak,
  UserStats,
  ImprovementArea,
} from '@/types/goals';
import { getSkillLevel } from '@/types/goals';

// ============================================================================
// SKILL CALCULATION
// ============================================================================

/**
 * Calculate pace score (0-100)
 * Ideal: 110-160 WPM, penalize extremes
 */
function calculatePaceScore(metrics: SessionMetricsSummary): number {
  const wpm = metrics.avgWpm;
  if (wpm >= 110 && wpm <= 160) return 100; // Perfect range
  if (wpm >= 100 && wpm <= 170) return 85;  // Good range
  if (wpm >= 90 && wpm <= 180) return 70;   // Acceptable
  if (wpm >= 80 && wpm <= 200) return 50;   // Needs work
  return 30; // Far from ideal
}

/**
 * Calculate clarity score based on fillers and hedging
 * Lower fillers per minute = higher score
 */
function calculateClarityScore(metrics: SessionMetricsSummary): number {
  const fpm = metrics.fillerPerMinute;
  if (fpm <= 1) return 100;
  if (fpm <= 2) return 85;
  if (fpm <= 3) return 70;
  if (fpm <= 5) return 50;
  if (fpm <= 8) return 30;
  return 15;
}

/**
 * Calculate confidence score based on pace consistency and fillers
 */
function calculateConfidenceScore(metrics: SessionMetricsSummary): number {
  // Combine pace stability and low fillers
  const paceScore = calculatePaceScore(metrics);
  const clarityScore = calculateClarityScore(metrics);
  const stressIndex = metrics.stressSpeedIndex ?? 0;
  
  // Lower stress index = more confident
  const stressScore = Math.max(0, 100 - (stressIndex * 100));
  
  return Math.round((paceScore * 0.3 + clarityScore * 0.4 + stressScore * 0.3));
}

/**
 * Calculate engagement score based on duration and word count
 */
function calculateEngagementScore(metrics: SessionMetricsSummary): number {
  // Longer, more substantive sessions indicate engagement
  const duration = metrics.durationSec;
  const words = metrics.totalWords;
  
  let durationScore = 0;
  if (duration >= 180) durationScore = 100; // 3+ min
  else if (duration >= 120) durationScore = 85;
  else if (duration >= 60) durationScore = 70;
  else if (duration >= 30) durationScore = 50;
  else durationScore = 30;
  
  let wordScore = 0;
  if (words >= 500) wordScore = 100;
  else if (words >= 300) wordScore = 85;
  else if (words >= 150) wordScore = 70;
  else if (words >= 50) wordScore = 50;
  else wordScore = 30;
  
  return Math.round((durationScore * 0.5 + wordScore * 0.5));
}

/**
 * Calculate skill scores from a list of sessions
 */
function calculateSkills(sessions: Session[]): Skill[] {
  const sessionsWithMetrics = sessions.filter(s => s.analysis?.metrics);
  
  if (sessionsWithMetrics.length === 0) {
    // Return default skills for new users
    return [
      { id: 'pace', name: 'Speaking Pace', description: 'Maintain 110-160 WPM for clarity', currentScore: 0, level: 'beginner', trend: 'stable', recentChange: 0 },
      { id: 'clarity', name: 'Clarity', description: 'Minimize filler words and hedging', currentScore: 0, level: 'beginner', trend: 'stable', recentChange: 0 },
      { id: 'confidence', name: 'Confidence', description: 'Speak with steady pace and conviction', currentScore: 0, level: 'beginner', trend: 'stable', recentChange: 0 },
      { id: 'engagement', name: 'Engagement', description: 'Deliver substantive, focused content', currentScore: 0, level: 'beginner', trend: 'stable', recentChange: 0 },
    ];
  }
  
  // Calculate scores for each session
  const sessionScores = sessionsWithMetrics.map(s => ({
    date: s.createdAt,
    pace: calculatePaceScore(s.analysis!.metrics),
    clarity: calculateClarityScore(s.analysis!.metrics),
    confidence: calculateConfidenceScore(s.analysis!.metrics),
    engagement: calculateEngagementScore(s.analysis!.metrics),
  }));
  
  // Sort by date (newest first)
  sessionScores.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  
  // Calculate averages (weight recent sessions more)
  const weights = sessionScores.map((_, i) => Math.pow(0.85, i)); // Exponential decay
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  
  const calculateWeightedAvg = (key: 'pace' | 'clarity' | 'confidence' | 'engagement') => {
    const weighted = sessionScores.reduce((sum, s, i) => sum + s[key] * weights[i], 0);
    return Math.round(weighted / totalWeight);
  };
  
  // Calculate trend (compare recent 3 vs previous 3)
  const calculateTrend = (key: 'pace' | 'clarity' | 'confidence' | 'engagement'): 'improving' | 'stable' | 'declining' => {
    if (sessionScores.length < 2) return 'stable';
    const recent = sessionScores.slice(0, Math.min(3, sessionScores.length));
    const previous = sessionScores.slice(3, Math.min(6, sessionScores.length));
    if (previous.length === 0) return 'stable';
    
    const recentAvg = recent.reduce((sum, s) => sum + s[key], 0) / recent.length;
    const previousAvg = previous.reduce((sum, s) => sum + s[key], 0) / previous.length;
    const diff = recentAvg - previousAvg;
    
    if (diff > 5) return 'improving';
    if (diff < -5) return 'declining';
    return 'stable';
  };
  
  // Calculate recent change (last session vs average)
  const calculateRecentChange = (key: 'pace' | 'clarity' | 'confidence' | 'engagement', avg: number): number => {
    if (sessionScores.length === 0) return 0;
    return sessionScores[0][key] - avg;
  };
  
  const skills: Skill[] = [
    {
      id: 'pace',
      name: 'Speaking Pace',
      description: 'Maintain 110-160 WPM for clarity',
      currentScore: calculateWeightedAvg('pace'),
      level: getSkillLevel(calculateWeightedAvg('pace')),
      trend: calculateTrend('pace'),
      recentChange: calculateRecentChange('pace', calculateWeightedAvg('pace')),
    },
    {
      id: 'clarity',
      name: 'Clarity',
      description: 'Minimize filler words and hedging',
      currentScore: calculateWeightedAvg('clarity'),
      level: getSkillLevel(calculateWeightedAvg('clarity')),
      trend: calculateTrend('clarity'),
      recentChange: calculateRecentChange('clarity', calculateWeightedAvg('clarity')),
    },
    {
      id: 'confidence',
      name: 'Confidence',
      description: 'Speak with steady pace and conviction',
      currentScore: calculateWeightedAvg('confidence'),
      level: getSkillLevel(calculateWeightedAvg('confidence')),
      trend: calculateTrend('confidence'),
      recentChange: calculateRecentChange('confidence', calculateWeightedAvg('confidence')),
    },
    {
      id: 'engagement',
      name: 'Engagement',
      description: 'Deliver substantive, focused content',
      currentScore: calculateWeightedAvg('engagement'),
      level: getSkillLevel(calculateWeightedAvg('engagement')),
      trend: calculateTrend('engagement'),
      recentChange: calculateRecentChange('engagement', calculateWeightedAvg('engagement')),
    },
  ];
  
  return skills;
}

// ============================================================================
// STREAK CALCULATION
// ============================================================================

function calculateStreak(sessions: Session[]): Streak {
  if (sessions.length === 0) {
    return { current: 0, longest: 0, lastPracticeDate: null, isActiveToday: false };
  }
  
  // Sort by date (newest first)
  const sorted = [...sessions].sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  // Get unique practice days
  const practiceDays = new Set<string>();
  sorted.forEach(s => {
    const date = new Date(s.createdAt);
    date.setHours(0, 0, 0, 0);
    practiceDays.add(date.toISOString().split('T')[0]);
  });
  
  const sortedDays = Array.from(practiceDays).sort().reverse();
  const lastPracticeDate = sortedDays[0] || null;
  
  // Check if practiced today
  const todayStr = today.toISOString().split('T')[0];
  const isActiveToday = practiceDays.has(todayStr);
  
  // Calculate current streak
  let currentStreak = 0;
  let checkDate = new Date(today);
  
  // If not practiced today, start checking from yesterday
  if (!isActiveToday) {
    checkDate = new Date(yesterday);
  }
  
  while (true) {
    const dateStr = checkDate.toISOString().split('T')[0];
    if (practiceDays.has(dateStr)) {
      currentStreak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }
  
  // Calculate longest streak
  let longestStreak = 0;
  let tempStreak = 0;
  
  for (let i = 0; i < sortedDays.length; i++) {
    if (i === 0) {
      tempStreak = 1;
    } else {
      const current = new Date(sortedDays[i]);
      const previous = new Date(sortedDays[i - 1]);
      const diffDays = Math.round((previous.getTime() - current.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diffDays === 1) {
        tempStreak++;
      } else {
        longestStreak = Math.max(longestStreak, tempStreak);
        tempStreak = 1;
      }
    }
  }
  longestStreak = Math.max(longestStreak, tempStreak);
  
  return {
    current: currentStreak,
    longest: longestStreak,
    lastPracticeDate,
    isActiveToday,
  };
}

// ============================================================================
// STATS CALCULATION
// ============================================================================

function calculateUserStats(sessions: Session[]): UserStats {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  
  const totalMinutes = sessions.reduce((sum, s) => sum + (s.durationSec || 0), 0) / 60;
  const totalWords = sessions.reduce((sum, s) => sum + (s.analysis?.metrics.totalWords || 0), 0);
  
  const sessionsThisWeek = sessions.filter(s => new Date(s.createdAt) >= oneWeekAgo).length;
  const sessionsThisMonth = sessions.filter(s => new Date(s.createdAt) >= oneMonthAgo).length;
  
  const avgLength = sessions.length > 0 
    ? sessions.reduce((sum, s) => sum + (s.durationSec || 0), 0) / sessions.length 
    : 0;
  
  const oldestSession = sessions.length > 0 
    ? sessions.reduce((oldest, s) => 
        new Date(s.createdAt) < new Date(oldest.createdAt) ? s : oldest
      ).createdAt 
    : new Date().toISOString();
  
  return {
    totalSessions: sessions.length,
    totalPracticeMinutes: Math.round(totalMinutes),
    totalWords,
    averageSessionLength: Math.round(avgLength),
    sessionsThisWeek,
    sessionsThisMonth,
    streak: calculateStreak(sessions),
    memberSince: oldestSession,
  };
}

// ============================================================================
// ACHIEVEMENTS
// ============================================================================

function calculateAchievements(sessions: Session[], stats: UserStats, skills: Skill[]): Achievement[] {
  const achievements: Achievement[] = [];
  
  // Milestone achievements
  achievements.push({
    id: 'first-session',
    name: 'First Steps',
    description: 'Complete your first practice session',
    icon: '🎯',
    unlockedAt: stats.totalSessions >= 1 ? sessions[sessions.length - 1]?.createdAt : undefined,
    progress: Math.min(100, stats.totalSessions > 0 ? 100 : 0),
    requirement: '1 session',
    category: 'milestone',
  });
  
  achievements.push({
    id: 'five-sessions',
    name: 'Getting Started',
    description: 'Complete 5 practice sessions',
    icon: '⭐',
    unlockedAt: stats.totalSessions >= 5 ? new Date().toISOString() : undefined,
    progress: Math.min(100, (stats.totalSessions / 5) * 100),
    requirement: '5 sessions',
    category: 'milestone',
  });
  
  achievements.push({
    id: 'twenty-sessions',
    name: 'Dedicated Speaker',
    description: 'Complete 20 practice sessions',
    icon: '🏆',
    unlockedAt: stats.totalSessions >= 20 ? new Date().toISOString() : undefined,
    progress: Math.min(100, (stats.totalSessions / 20) * 100),
    requirement: '20 sessions',
    category: 'milestone',
  });
  
  achievements.push({
    id: 'fifty-sessions',
    name: 'Master Orator',
    description: 'Complete 50 practice sessions',
    icon: '👑',
    unlockedAt: stats.totalSessions >= 50 ? new Date().toISOString() : undefined,
    progress: Math.min(100, (stats.totalSessions / 50) * 100),
    requirement: '50 sessions',
    category: 'milestone',
  });
  
  // Streak achievements
  achievements.push({
    id: 'streak-3',
    name: 'On a Roll',
    description: 'Practice 3 days in a row',
    icon: '🔥',
    unlockedAt: stats.streak.longest >= 3 ? new Date().toISOString() : undefined,
    progress: Math.min(100, (stats.streak.longest / 3) * 100),
    requirement: '3-day streak',
    category: 'streak',
  });
  
  achievements.push({
    id: 'streak-7',
    name: 'Week Warrior',
    description: 'Practice 7 days in a row',
    icon: '💪',
    unlockedAt: stats.streak.longest >= 7 ? new Date().toISOString() : undefined,
    progress: Math.min(100, (stats.streak.longest / 7) * 100),
    requirement: '7-day streak',
    category: 'streak',
  });
  
  achievements.push({
    id: 'streak-30',
    name: 'Monthly Master',
    description: 'Practice 30 days in a row',
    icon: '🌟',
    unlockedAt: stats.streak.longest >= 30 ? new Date().toISOString() : undefined,
    progress: Math.min(100, (stats.streak.longest / 30) * 100),
    requirement: '30-day streak',
    category: 'streak',
  });
  
  // Skill achievements
  const paceSkill = skills.find(s => s.id === 'pace');
  const claritySkill = skills.find(s => s.id === 'clarity');
  
  achievements.push({
    id: 'pace-master',
    name: 'Pace Perfect',
    description: 'Achieve 90+ pace score',
    icon: '⚡',
    unlockedAt: (paceSkill?.currentScore ?? 0) >= 90 ? new Date().toISOString() : undefined,
    progress: Math.min(100, ((paceSkill?.currentScore ?? 0) / 90) * 100),
    requirement: '90+ pace score',
    category: 'skill',
  });
  
  achievements.push({
    id: 'clarity-master',
    name: 'Crystal Clear',
    description: 'Achieve 90+ clarity score',
    icon: '💎',
    unlockedAt: (claritySkill?.currentScore ?? 0) >= 90 ? new Date().toISOString() : undefined,
    progress: Math.min(100, ((claritySkill?.currentScore ?? 0) / 90) * 100),
    requirement: '90+ clarity score',
    category: 'skill',
  });
  
  // Word count achievements
  achievements.push({
    id: 'wordsmith-1k',
    name: 'Wordsmith',
    description: 'Speak 1,000 words total',
    icon: '📝',
    unlockedAt: stats.totalWords >= 1000 ? new Date().toISOString() : undefined,
    progress: Math.min(100, (stats.totalWords / 1000) * 100),
    requirement: '1,000 words',
    category: 'milestone',
  });
  
  achievements.push({
    id: 'wordsmith-10k',
    name: 'Eloquent',
    description: 'Speak 10,000 words total',
    icon: '📚',
    unlockedAt: stats.totalWords >= 10000 ? new Date().toISOString() : undefined,
    progress: Math.min(100, (stats.totalWords / 10000) * 100),
    requirement: '10,000 words',
    category: 'milestone',
  });
  
  return achievements;
}

// ============================================================================
// CHALLENGES
// ============================================================================

function generateChallenges(stats: UserStats, skills: Skill[]): Challenge[] {
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  
  const endOfWeek = new Date(now);
  endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
  endOfWeek.setHours(23, 59, 59, 999);
  
  const challenges: Challenge[] = [];
  
  // Daily challenge - practice today
  challenges.push({
    id: 'daily-practice',
    title: 'Daily Practice',
    description: 'Complete at least one session today',
    type: 'daily',
    progress: stats.streak.isActiveToday ? 100 : 0,
    target: 1,
    current: stats.streak.isActiveToday ? 1 : 0,
    unit: 'session',
    expiresAt: endOfDay.toISOString(),
    reward: '+10 XP',
    completed: stats.streak.isActiveToday,
  });
  
  // Weekly sessions challenge
  challenges.push({
    id: 'weekly-sessions',
    title: 'Weekly Warrior',
    description: 'Complete 5 sessions this week',
    type: 'weekly',
    progress: Math.min(100, (stats.sessionsThisWeek / 5) * 100),
    target: 5,
    current: stats.sessionsThisWeek,
    unit: 'sessions',
    expiresAt: endOfWeek.toISOString(),
    reward: '+50 XP',
    completed: stats.sessionsThisWeek >= 5,
  });
  
  // Skill-based challenge (focus on weakest skill)
  const weakestSkill = skills.reduce((min, s) => s.currentScore < min.currentScore ? s : min, skills[0]);
  if (weakestSkill) {
    challenges.push({
      id: 'improve-skill',
      title: `Improve ${weakestSkill.name}`,
      description: `Boost your ${weakestSkill.name.toLowerCase()} score by 5 points`,
      type: 'weekly',
      progress: 0, // Would need historical tracking
      target: 5,
      current: 0,
      unit: 'points',
      expiresAt: endOfWeek.toISOString(),
      reward: '+30 XP',
      completed: false,
    });
  }
  
  // Streak challenge
  if (stats.streak.current < 3) {
    challenges.push({
      id: 'build-streak',
      title: 'Build Your Streak',
      description: 'Practice 3 days in a row',
      type: 'weekly',
      progress: Math.min(100, (stats.streak.current / 3) * 100),
      target: 3,
      current: stats.streak.current,
      unit: 'days',
      expiresAt: endOfWeek.toISOString(),
      reward: '+25 XP',
      completed: stats.streak.current >= 3,
    });
  }
  
  return challenges;
}

// ============================================================================
// IMPROVEMENT AREAS
// ============================================================================

function calculateImprovementAreas(sessions: Session[], skills: Skill[]): ImprovementArea[] {
  const areas: ImprovementArea[] = [];
  const recentSessions = sessions.slice(0, 5);
  
  if (recentSessions.length === 0) {
    return [{
      skill: 'engagement',
      title: 'Start Practicing',
      currentValue: 0,
      targetValue: 1,
      unit: 'sessions',
      advice: 'Record your first session to get personalized improvement recommendations.',
      priority: 'high',
    }];
  }
  
  // Analyze recent metrics
  const avgMetrics = recentSessions.reduce((acc, s) => {
    const m = s.analysis?.metrics;
    if (m) {
      acc.wpm += m.avgWpm;
      acc.fpm += m.fillerPerMinute;
      acc.count++;
    }
    return acc;
  }, { wpm: 0, fpm: 0, count: 0 });
  
  if (avgMetrics.count > 0) {
    avgMetrics.wpm /= avgMetrics.count;
    avgMetrics.fpm /= avgMetrics.count;
  }
  
  // Check pace
  if (avgMetrics.wpm > 170) {
    areas.push({
      skill: 'pace',
      title: 'Slow Down',
      currentValue: Math.round(avgMetrics.wpm),
      targetValue: 140,
      unit: 'WPM',
      advice: 'You\'re speaking too fast. Try pausing after key points and taking a breath between sentences.',
      priority: 'high',
    });
  } else if (avgMetrics.wpm < 100) {
    areas.push({
      skill: 'pace',
      title: 'Pick Up the Pace',
      currentValue: Math.round(avgMetrics.wpm),
      targetValue: 130,
      unit: 'WPM',
      advice: 'Your pace is a bit slow. Try to maintain more energy and momentum in your delivery.',
      priority: 'medium',
    });
  }
  
  // Check fillers
  if (avgMetrics.fpm > 4) {
    areas.push({
      skill: 'clarity',
      title: 'Reduce Filler Words',
      currentValue: Math.round(avgMetrics.fpm * 10) / 10,
      targetValue: 2,
      unit: 'per minute',
      advice: 'Replace "um" and "like" with confident pauses. Silence is powerful!',
      priority: 'high',
    });
  } else if (avgMetrics.fpm > 2) {
    areas.push({
      skill: 'clarity',
      title: 'Polish Your Delivery',
      currentValue: Math.round(avgMetrics.fpm * 10) / 10,
      targetValue: 1,
      unit: 'per minute',
      advice: 'You\'re doing well! Focus on replacing remaining fillers with brief pauses.',
      priority: 'low',
    });
  }
  
  // Check skill trends
  skills.forEach(skill => {
    if (skill.trend === 'declining' && skill.currentScore < 70) {
      areas.push({
        skill: skill.id,
        title: `${skill.name} Declining`,
        currentValue: skill.currentScore,
        targetValue: skill.currentScore + 15,
        unit: 'score',
        advice: `Your ${skill.name.toLowerCase()} has been declining recently. Focus on this area in your next sessions.`,
        priority: 'medium',
      });
    }
  });
  
  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  areas.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  
  return areas.slice(0, 3); // Top 3 improvement areas
}

// ============================================================================
// WEEKLY PROGRESS
// ============================================================================

function calculateWeeklyProgress(sessions: Session[]): { day: string; sessions: number; minutes: number }[] {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const now = new Date();
  const result: { day: string; sessions: number; minutes: number }[] = [];
  
  // Last 7 days
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);
    
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);
    
    const daySessions = sessions.filter(s => {
      const sessionDate = new Date(s.createdAt);
      return sessionDate >= date && sessionDate < nextDate;
    });
    
    const minutes = daySessions.reduce((sum, s) => sum + (s.durationSec || 0), 0) / 60;
    
    result.push({
      day: days[date.getDay()],
      sessions: daySessions.length,
      minutes: Math.round(minutes),
    });
  }
  
  return result;
}

// ============================================================================
// XP CALCULATION
// ============================================================================

function calculateXP(stats: UserStats, skills: Skill[], achievements: Achievement[]): { xp: number; xpToNextLevel: number } {
  let xp = 0;
  
  // XP from sessions (10 XP each)
  xp += stats.totalSessions * 10;
  
  // XP from practice time (1 XP per minute)
  xp += stats.totalPracticeMinutes;
  
  // XP from streak (5 XP per day)
  xp += stats.streak.current * 5;
  
  // XP from achievements (50 XP each unlocked)
  xp += achievements.filter(a => a.unlockedAt).length * 50;
  
  // XP from skill levels
  const skillLevelXP = { beginner: 0, developing: 25, proficient: 50, advanced: 100, expert: 200 };
  skills.forEach(s => {
    xp += skillLevelXP[s.level] || 0;
  });
  
  // Calculate XP to next level (every 500 XP)
  const currentLevel = Math.floor(xp / 500);
  const xpToNextLevel = ((currentLevel + 1) * 500) - xp;
  
  return { xp, xpToNextLevel };
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

/**
 * Fetch and calculate all goals dashboard data
 * This is the main entry point for the Goals page
 */
export async function fetchGoalsDashboard(): Promise<GoalsDashboard> {
  // Fetch all sessions
  const sessions = await listSessions();
  const readySessions = sessions.filter(s => s.analysisStatus === 'ready');
  
  // Calculate all data
  const skills = calculateSkills(readySessions);
  const stats = calculateUserStats(readySessions);
  const achievements = calculateAchievements(readySessions, stats, skills);
  const challenges = generateChallenges(stats, skills);
  const improvementAreas = calculateImprovementAreas(readySessions, skills);
  const weeklyProgress = calculateWeeklyProgress(readySessions);
  
  // Calculate overall score (average of skills)
  const overallScore = skills.length > 0 
    ? Math.round(skills.reduce((sum, s) => sum + s.currentScore, 0) / skills.length)
    : 0;
  
  const { xp, xpToNextLevel } = calculateXP(stats, skills, achievements);
  
  return {
    userStats: stats,
    skills,
    overallLevel: getSkillLevel(overallScore),
    overallScore,
    xp,
    xpToNextLevel,
    achievements,
    activeChallenges: challenges,
    improvementAreas,
    weeklyProgress,
  };
}
