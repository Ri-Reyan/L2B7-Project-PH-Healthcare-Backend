class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperation: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperation = true;

    Error.captureStackTrace(this, this.constructor);
  }
}
