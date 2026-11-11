/**
 * Test-only re-exports so the specs import the port types from ONE place
 * (the unit suite never touches the app module graph).
 */
export type {
  OutboundChannel,
  OutboundChannelPort,
  OutboundSendRequest,
  OutboundSendResult,
} from "../domain/channel-port";
export type { ProviderHttpTransport } from "../application/providers/provider-http";
