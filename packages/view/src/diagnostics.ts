export {
  createViewDiagnostics,
  type ViewDiagnostics,
  type DiagnosticOptions,
  type DiagnosticSnapshot,
  type DiagnosticPlacement,
  type DiagnosticEvent,
  type TextProbe,
  type TextProbeResult,
} from './canvas/view-diagnostics.js';

export { checkInlineResources } from './internal/owned-inline-checks.js';

export { auditReflow, type ReflowAuditBlock } from './canvas/reflow-audit.js';
