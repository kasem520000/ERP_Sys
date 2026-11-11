/**
 * PHASE-041 (T-02) — the provider registry: the SINGLE place where real
 * adapters are constructed (BR-067's repo-grep half: outside this file +
 * the sandbox, no provider construction exists). Each entry carries the
 * catalog metadata the settings UI (T-03) renders: the bilingual label,
 * the credential field names (for the masked editor — values NEVER travel
 * back to the client), and the REQUIRES_VERIFICATION flag (the phase's
 * external-API volatility risk: approval/registration-dependent providers
 * surface the T-12 verification checklist until a live send is verified).
 */

import type { OutboundChannel, OutboundChannelPort } from "../domain/channel-port";
import { smtpTransportFromEnv } from "../../notifications/infrastructure/smtp-mailer";
import {
  MailgunAdapter,
  SendGridAdapter,
  SesAdapter,
  SmtpEmailAdapter,
  type SmtpProviderConfig,
} from "./providers/email-providers";
import {
  MsegatAdapter,
  TwilioAdapter,
  UnifonicAdapter,
} from "./providers/sms-providers";
import { WhatsappBusinessAdapter } from "./providers/whatsapp-business";
import { fetchProviderTransport, type ProviderHttpTransport } from "./providers/provider-http";

/** One credential field descriptor (the masked settings editor input). */
export interface ProviderCredentialField {
  readonly name: string;
  readonly label: { readonly ar: string; readonly en: string };
  /** true → masked input + sealed storage (the secret-store discipline). */
  readonly secret: boolean;
  readonly required: boolean;
}

/** The registry entry: metadata + the factory (BR-067's only door). */
export interface ProviderDescriptor {
  readonly id: string;
  readonly kind: OutboundChannel;
  readonly label: { readonly ar: string; readonly en: string };
  /**
   * Approval/registration-dependent behavior: the settings UI shows the
   * verification checklist (T-12's guide) until a live send is verified
   * per environment (WhatsApp template approvals, sender-name
   * registrations, SES/Mailgun domain verification).
   */
  readonly requiresVerification: boolean;
  readonly credentialFields: readonly ProviderCredentialField[];
  /** The factory — the ONLY adapter construction path outside tests. */
  readonly create: (
    credentials: Readonly<Record<string, string>>,
    transport?: ProviderHttpTransport,
  ) => OutboundChannelPort;
}

/** The raw credentials record shape every factory receives (T-03 reads
 * the sealed tenant_settings blob into this). */
export type ProviderCredentials = Readonly<Record<string, string>>;

function need(credentials: ProviderCredentials, field: string): string {
  const value = credentials[field];
  if (value === undefined || value.length === 0) {
    throw new Error(`missing credential field ${field}`);
  }
  return value;
}

function optional(credentials: ProviderCredentials, field: string): string | undefined {
  const value = credentials[field];
  return value !== undefined && value.length > 0 ? value : undefined;
}

export const PROVIDER_REGISTRY: readonly ProviderDescriptor[] = [
  {
    id: "whatsapp-business",
    kind: "WHATSAPP",
    label: { ar: "واتساب للأعمال (Cloud API)", en: "WhatsApp Business (Cloud API)" },
    requiresVerification: true,
    credentialFields: [
      {
        name: "accessToken",
        label: { ar: "رمز الوصول الدائم", en: "Permanent access token" },
        secret: true,
        required: true,
      },
      {
        name: "phoneNumberId",
        label: { ar: "معرّف رقم الإرسال الافتراضي", en: "Default phone-number id" },
        secret: false,
        required: true,
      },
    ],
    create: (credentials, transport) =>
      new WhatsappBusinessAdapter(
        {
          accessToken: need(credentials, "accessToken"),
          phoneNumberId: need(credentials, "phoneNumberId"),
        },
        transport ?? fetchProviderTransport,
      ),
  },
  {
    id: "unifonic",
    kind: "SMS",
    label: { ar: "يونيفونك", en: "Unifonic" },
    requiresVerification: true,
    credentialFields: [
      {
        name: "appSid",
        label: { ar: "معرّف التطبيق (AppSid)", en: "AppSid" },
        secret: true,
        required: true,
      },
      {
        name: "senderName",
        label: { ar: "اسم المُرسِل (اختياري)", en: "Sender name (optional)" },
        secret: false,
        required: false,
      },
    ],
    create: (credentials, transport) =>
      new UnifonicAdapter(
        {
          appSid: need(credentials, "appSid"),
          senderName: optional(credentials, "senderName"),
        },
        transport ?? fetchProviderTransport,
      ),
  },
  {
    id: "msegat",
    kind: "SMS",
    label: { ar: "مسجات", en: "Msegat" },
    requiresVerification: true,
    credentialFields: [
      {
        name: "username",
        label: { ar: "اسم المستخدم", en: "Username" },
        secret: false,
        required: true,
      },
      {
        name: "password",
        label: { ar: "كلمة المرور", en: "Password" },
        secret: true,
        required: true,
      },
      {
        name: "senderName",
        label: { ar: "اسم المُرسِل المعتمد", en: "Registered sender name" },
        secret: false,
        required: true,
      },
    ],
    create: (credentials, transport) =>
      new MsegatAdapter(
        {
          username: need(credentials, "username"),
          password: need(credentials, "password"),
          senderName: need(credentials, "senderName"),
        },
        transport ?? fetchProviderTransport,
      ),
  },
  {
    id: "twilio",
    kind: "SMS",
    label: { ar: "Twilio", en: "Twilio" },
    requiresVerification: true,
    credentialFields: [
      {
        name: "accountSid",
        label: { ar: "معرّف الحساب (SID)", en: "Account SID" },
        secret: false,
        required: true,
      },
      {
        name: "authToken",
        label: { ar: "رمز المصادقة", en: "Auth token" },
        secret: true,
        required: true,
      },
      {
        name: "fromNumber",
        label: { ar: "رقم الإرسال الافتراضي (E.164)", en: "Default from-number (E.164)" },
        secret: false,
        required: true,
      },
    ],
    create: (credentials, transport) =>
      new TwilioAdapter(
        {
          accountSid: need(credentials, "accountSid"),
          authToken: need(credentials, "authToken"),
          fromNumber: need(credentials, "fromNumber"),
        },
        transport ?? fetchProviderTransport,
      ),
  },
  {
    id: "smtp",
    kind: "EMAIL",
    label: { ar: "خادم SMTP", en: "SMTP server" },
    requiresVerification: false,
    credentialFields: [
      {
        name: "host",
        label: { ar: "الخادم", en: "Host" },
        secret: false,
        required: true,
      },
      {
        name: "port",
        label: { ar: "المنفذ", en: "Port" },
        secret: false,
        required: true,
      },
      {
        name: "user",
        label: { ar: "المستخدم (اختياري)", en: "User (optional)" },
        secret: false,
        required: false,
      },
      {
        name: "pass",
        label: { ar: "كلمة المرور (اختيارية)", en: "Password (optional)" },
        secret: true,
        required: false,
      },
      {
        name: "fromAddress",
        label: { ar: "عنوان المُرسِل (متوافق مع DKIM)", en: "From address (DKIM-aligned)" },
        secret: false,
        required: true,
      },
    ],
    create: (credentials) => {
      const config: SmtpProviderConfig = {
        host: need(credentials, "host"),
        port: Number.parseInt(need(credentials, "port"), 10),
        user: optional(credentials, "user"),
        pass: optional(credentials, "pass"),
        fromAddress: need(credentials, "fromAddress"),
      };
      // The SMTP bridge rides the EXISTING socket-client seam (the
      // PHASE-003 transport) — no HTTP involved.
      return new SmtpEmailAdapter(config, smtpTransportFromEnv);
    },
  },
  {
    id: "sendgrid",
    kind: "EMAIL",
    label: { ar: "SendGrid", en: "SendGrid" },
    requiresVerification: true,
    credentialFields: [
      {
        name: "apiKey",
        label: { ar: "مفتاح API", en: "API key" },
        secret: true,
        required: true,
      },
      {
        name: "fromAddress",
        label: { ar: "عنوان المُرسِل (موثَّق)", en: "From address (verified)" },
        secret: false,
        required: true,
      },
      {
        name: "fromName",
        label: { ar: "اسم المُرسِل (اختياري)", en: "From name (optional)" },
        secret: false,
        required: false,
      },
    ],
    create: (credentials, transport) =>
      new SendGridAdapter(
        {
          apiKey: need(credentials, "apiKey"),
          fromAddress: need(credentials, "fromAddress"),
          fromName: optional(credentials, "fromName"),
        },
        transport ?? fetchProviderTransport,
      ),
  },
  {
    id: "ses",
    kind: "EMAIL",
    label: { ar: "Amazon SES", en: "Amazon SES" },
    requiresVerification: true,
    credentialFields: [
      {
        name: "accessKeyId",
        label: { ar: "مفتاح الوصول (Access Key)", en: "Access key id" },
        secret: true,
        required: true,
      },
      {
        name: "secretAccessKey",
        label: { ar: "المفتاح السري", en: "Secret access key" },
        secret: true,
        required: true,
      },
      {
        name: "region",
        label: { ar: "المنطقة (مثل me-south-1)", en: "Region (e.g. me-south-1)" },
        secret: false,
        required: true,
      },
      {
        name: "fromAddress",
        label: { ar: "عنوان المُرسِل (موثَّق في SES)", en: "From address (SES-verified)" },
        secret: false,
        required: true,
      },
    ],
    create: (credentials, transport) =>
      new SesAdapter(
        {
          accessKeyId: need(credentials, "accessKeyId"),
          secretAccessKey: need(credentials, "secretAccessKey"),
          region: need(credentials, "region"),
          fromAddress: need(credentials, "fromAddress"),
        },
        transport ?? fetchProviderTransport,
      ),
  },
  {
    id: "mailgun",
    kind: "EMAIL",
    label: { ar: "Mailgun", en: "Mailgun" },
    requiresVerification: true,
    credentialFields: [
      {
        name: "apiKey",
        label: { ar: "مفتاح API", en: "API key" },
        secret: true,
        required: true,
      },
      {
        name: "domain",
        label: { ar: "نطاق الإرسال الموثَّق", en: "Verified sending domain" },
        secret: false,
        required: true,
      },
      {
        name: "fromAddress",
        label: { ar: "عنوان المُرسِل", en: "From address" },
        secret: false,
        required: true,
      },
      {
        name: "baseUrl",
        label: { ar: "عنوان الأساس (EU اختياري)", en: "Base URL (optional, EU)" },
        secret: false,
        required: false,
      },
    ],
    create: (credentials, transport) =>
      new MailgunAdapter(
        {
          apiKey: need(credentials, "apiKey"),
          domain: need(credentials, "domain"),
          fromAddress: need(credentials, "fromAddress"),
          baseUrl: optional(credentials, "baseUrl"),
        },
        transport ?? fetchProviderTransport,
      ),
  },
];

const REGISTRY_BY_ID = new Map(PROVIDER_REGISTRY.map((entry) => [entry.id, entry]));

export function findProviderDescriptor(id: string): ProviderDescriptor | undefined {
  return REGISTRY_BY_ID.get(id);
}

export const PROVIDER_IDS: readonly string[] = PROVIDER_REGISTRY.map((entry) => entry.id);
