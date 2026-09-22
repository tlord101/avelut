export class AvelutLogger {
  private static instance = new AvelutLogger();
  private sessionId: string = 'unknown';
  private stage: string = 'INIT';

  private constructor() {}

  public static getInstance() {
    return AvelutLogger.instance;
  }

  public setSessionId(id: string) {
    this.sessionId = id;
  }

  public setStage(stage: string) {
    this.stage = stage;
  }

  public log(...args: any[]) {
    console.log(`[LiveClassroom][session=${this.sessionId}][stage=${this.stage}]`, ...args);
  }

  public error(...args: any[]) {
    console.error(`[LiveClassroom][session=${this.sessionId}][stage=${this.stage}]`, ...args);
  }

  public warn(...args: any[]) {
    console.warn(`[LiveClassroom][session=${this.sessionId}][stage=${this.stage}]`, ...args);
  }
}
export const liveLogger = AvelutLogger.getInstance();
