/**
 * PHASE-041 typed errors (the onboarding module's onboarding-errors
 * pattern): every communication-module failure carries a stable code for
 * the HTTP error filter (404/409/422 mapping) and a bilingual-safe
 * message. Provider SEND failures are NOT errors — they travel on the
 * OutboundSendResult (best-effort, BR-067); these errors are
 * configuration/validation shapes.
 */

export class CommunicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CommunicationError";
  }
}

/** A template CRUD/routing failure (T-04). */
export class TemplateError extends CommunicationError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "TemplateError";
  }
}

export class TemplateNotFoundError extends TemplateError {
  constructor(key: string, channel: string, locale: string) {
    super(
      "communication/template-not-found",
      `no template ${key} for ${channel}/${locale} and no builtin fallback`,
    );
    this.name = "TemplateNotFoundError";
  }
}

export class TemplateShapeInvalidError extends TemplateError {
  constructor(detail: string) {
    super("communication/template-shape-invalid", detail);
    this.name = "TemplateShapeInvalidError";
  }
}

export class TemplateRenderError extends TemplateError {
  constructor(detail: string) {
    super("communication/template-render-failed", detail);
    this.name = "TemplateRenderError";
  }
}

/** A provider configuration failure (T-03). */
export class ProviderConfigError extends CommunicationError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "ProviderConfigError";
  }
}

export class ProviderUnknownError extends ProviderConfigError {
  constructor(providerId: string) {
    super(
      "communication/provider-unknown",
      `unknown provider ${providerId} — not in the adapter registry`,
    );
    this.name = "ProviderUnknownError";
  }
}

export class ProviderCredentialsInvalidError extends ProviderConfigError {
  constructor(providerId: string, detail: string) {
    super(
      "communication/provider-credentials-invalid",
      `provider ${providerId} credentials invalid: ${detail}`,
    );
    this.name = "ProviderCredentialsInvalidError";
  }
}

/** An outbox/pipeline failure (T-05). */
export class OutboxError extends CommunicationError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "OutboxError";
  }
}

export class OutboxRecipientInvalidError extends OutboxError {
  constructor(channel: string, to: string) {
    super(
      "communication/outbox-recipient-invalid",
      `recipient ${to} is not a valid ${channel} address`,
    );
    this.name = "OutboxRecipientInvalidError";
  }
}

/** A preference-matrix failure (T-06). */
export class PreferencesError extends CommunicationError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "PreferencesError";
  }
}

/** A unified-inbox/call-logging failure (T-08). */
export class InboxError extends CommunicationError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "InboxError";
  }
}

export class CallLogInvalidError extends InboxError {
  constructor(detail: string) {
    super("communication/call-log-invalid", detail);
    this.name = "CallLogInvalidError";
  }
}

/** A calendar/contacts-sync failure (T-09). */
export class CalendarError extends CommunicationError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "CalendarError";
  }
}
