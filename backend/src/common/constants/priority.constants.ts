export enum SystemPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export const SYSTEM_PRIORITY_VALUES = [
  SystemPriority.LOW,
  SystemPriority.MEDIUM,
  SystemPriority.HIGH,
  SystemPriority.CRITICAL,
] as const;

export const DEFAULT_SYSTEM_PRIORITY = SystemPriority.MEDIUM;
