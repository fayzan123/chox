export class ChoxError extends Error {
  readonly exitCode: number

  constructor(message: string, exitCode = 1, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ChoxError'
    this.exitCode = exitCode
  }
}

export class ChoxUsageError extends ChoxError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 2, options)
    this.name = 'ChoxUsageError'
  }
}
