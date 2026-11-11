/**
 * PHASE-041 (BR-067) — the SANDBOX default channel provider.
 *
 * ZERO external calls: the adapter holds no transport, constructs no
 * client, and touches no socket — ever. Every send "succeeds"
 * deterministically with a sandbox provider message id and zero cost, and
 * reports INSTANT delivery (the ledger row walks QUEUED → DELIVERED in one
 * transition, exercising the full status vocabulary). This is the default
 * until a real provider is configured AND credentialed (T-03); the
 * network-blocked adapter-contract proof pins the zero-external-calls
 * contract (a poisoned global fetch stays untouched through a full
 * sandbox send).
 *
 * The sandbox is also what keeps the test suite hermetic: no spec ever
 * reaches a real provider; real-adapter specs inject fake transports at
 * the seam.
 */

import { randomUUID } from "node:crypto";

import {
  isE164Phone,
  isEmailShape,
  type OutboundChannel,
  type OutboundChannelPort,
  type OutboundSendRequest,
  type OutboundSendResult,
} from "../../domain/channel-port";

export class SandboxChannelProvider implements OutboundChannelPort {
  readonly id = "sandbox";

  constructor(readonly kind: OutboundChannel) {}

  async send(request: OutboundSendRequest): Promise<OutboundSendResult> {
    // Shape discipline identical to the real adapters (fail-closed on a
    // malformed recipient — a misconfigured recipient must NEVER look
    // delivered, even in the sandbox).
    if (this.kind === "EMAIL" && !isEmailShape(request.to)) {
      return { ok: false, error: "sandbox-invalid-email-recipient" };
    }
    if (this.kind !== "EMAIL" && !isE164Phone(request.to)) {
      return { ok: false, error: "sandbox-invalid-phone-recipient" };
    }
    return {
      ok: true,
      providerMessageId: `sandbox-${randomUUID()}`,
      delivered: true,
      cost: { amount: "0.0000", currency: "SAR" },
    };
  }
}

/** The three channel defaults (one instance per channel kind). */
export const sandboxProviders = (): Record<OutboundChannel, SandboxChannelProvider> => ({
  EMAIL: new SandboxChannelProvider("EMAIL"),
  WHATSAPP: new SandboxChannelProvider("WHATSAPP"),
  SMS: new SandboxChannelProvider("SMS"),
});
