export const LogLevel = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
  } as const;
  
  export type LogLevel = typeof LogLevel[keyof typeof LogLevel];
  
  export class Logger {
    public static currentLevel: LogLevel = LogLevel.INFO; 
  
    public static debug(category: string, message: string, ...data: any[]) {
      if (this.currentLevel <= LogLevel.DEBUG) {
        console.debug(`%c[${category}]%c ${message}`, 'color: #8b5cf6; font-weight: bold;', 'color: inherit;', ...data);
      }
    }
  
    public static info(category: string, message: string, ...data: any[]) {
      if (this.currentLevel <= LogLevel.INFO) {
        console.info(`%c[${category}]%c ${message}`, 'color: #10b981; font-weight: bold;', 'color: inherit;', ...data);
      }
    }
  
    public static warn(category: string, message: string, ...data: any[]) {
      if (this.currentLevel <= LogLevel.WARN) {
        console.warn(`%c[${category}]%c ${message}`, 'color: #f59e0b; font-weight: bold;', 'color: inherit;', ...data);
      }
    }
  
    public static error(category: string, message: string, ...data: any[]) {
      if (this.currentLevel <= LogLevel.ERROR) {
        console.error(`%c[${category}]%c ${message}`, 'color: #ef4444; font-weight: bold;', 'color: inherit;', ...data);
      }
    }
  }