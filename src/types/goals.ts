// Goals & Gamification Types
// Completely separate from session types to avoid coupling

export type SkillCategory = 'pace' | 'clarity' | 'confidence' | 'engagement';

export type SkillLevel = 'beginner' | 'developing' | 'proficient' | 'advanced' | 'expert';

// Individual skill tracking
export interface Skill {
  id: SkillCategory;
  name: string;
  description: string;
  currentScore: number; // 0-100
  level: SkillLevel;
  trend: 'improving' | 'stable' | 'declining';
  recentChange: number; // +/- points from last session
}

// Achievement/Badge system
export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string; // emoji
  unlockedAt?: string; // ISO date if unlocked
  progress: number; // 0-100
  requirement: string;
  category: 'milestone' | 'streak' | 'skill' | 'challenge';
}

// Weekly/Daily challenges
export interface Challenge {
  id: string;
  title: string;
  description: string;
  type: 'daily' | 'weekly';
  progress: number; // 0-100
  target: number;
  current: number;
  unit: string;
  expiresAt: string; // ISO date
  reward: string;
  completed: boolean;
}

// Streak tracking
export interface Streak {
  current: number;
  longest: number;
  lastPracticeDate: string | null;
  isActiveToday: boolean;
}

// Overall user stats
export interface UserStats {
  totalSessions: number;
  totalPracticeMinutes: number;
  totalWords: number;
  averageSessionLength: number;
  sessionsThisWeek: number;
  sessionsThisMonth: number;
  streak: Streak;
  memberSince: string;
}

// Improvement areas with specific advice
export interface ImprovementArea {
  skill: SkillCategory;
  title: string;
  currentValue: number;
  targetValue: number;
  unit: string;
  advice: string;
  priority: 'high' | 'medium' | 'low';
}

// Complete goals dashboard data
export interface GoalsDashboard {
  userStats: UserStats;
  skills: Skill[];
  overallLevel: SkillLevel;
  overallScore: number;
  xp: number;
  xpToNextLevel: number;
  achievements: Achievement[];
  activeChallenges: Challenge[];
  improvementAreas: ImprovementArea[];
  weeklyProgress: {
    day: string;
    sessions: number;
    minutes: number;
  }[];
}

// Skill level thresholds
export const SKILL_LEVELS: { level: SkillLevel; minScore: number; label: string }[] = [
  { level: 'beginner', minScore: 0, label: 'Beginner' },
  { level: 'developing', minScore: 20, label: 'Developing' },
  { level: 'proficient', minScore: 40, label: 'Proficient' },
  { level: 'advanced', minScore: 70, label: 'Advanced' },
  { level: 'expert', minScore: 90, label: 'Expert' },
];

export function getSkillLevel(score: number): SkillLevel {
  for (let i = SKILL_LEVELS.length - 1; i >= 0; i--) {
    if (score >= SKILL_LEVELS[i].minScore) {
      return SKILL_LEVELS[i].level;
    }
  }
  return 'beginner';
}

export function getSkillLevelLabel(level: SkillLevel): string {
  return SKILL_LEVELS.find(l => l.level === level)?.label || 'Beginner';
}
