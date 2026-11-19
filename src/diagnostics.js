export class SceneError extends Error {
  constructor(reason, stage, detail) {
    super(detail || reason);
    this.name = 'SceneError';
    this.reason = reason;
    this.stage = stage;
  }
}

export function reportSceneError(error, stage, recoverable = false, reason = 'runtime-error') {
  const report = {
    reason: error instanceof SceneError ? error.reason : reason,
    stage: error instanceof SceneError ? error.stage : stage,
    recoverable,
  };
  // Driver logs and resource names are useful locally. The UI receives only
  // the category, and this diagnostic is never sent off the device.
  console[recoverable ? 'warn' : 'error']('[Sofia]', report, error);
  return report.reason;
}
