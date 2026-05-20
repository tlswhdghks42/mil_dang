import { GuardianSyncPayload } from "../domain/types";

export type GuardianChannelType = "push" | "sms";

export interface GuardianChannelResult {
  channel: GuardianChannelType;
  success: boolean;
  providerMessageId?: string;
  errorMessage?: string;
  attempts?: number;
}

export interface PushSender {
  send(args: { guardianUserId: string; title: string; body: string; data: Record<string, string> }): Promise<{ messageId: string }>;
}

export interface SmsSender {
  send(args: { phoneNumber: string; message: string }): Promise<{ messageId: string }>;
}

export interface GuardianContact {
  guardianUserId: string;
  phoneNumber?: string;
  prefersPush?: boolean;
}

export interface GuardianChannelSenders {
  push?: PushSender;
  sms?: SmsSender;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMsByAttempt: number[];
  sleep: (ms: number) => Promise<void>;
}

export interface FailedGuardianEvent {
  eventId: string;
  guardianUserId: string;
  channel: GuardianChannelType;
  reason: string;
  occurredAt: string;
}

export interface FailedGuardianEventStore {
  save(event: FailedGuardianEvent): Promise<void>;
}

export function buildGuardianAlertMessage(payload: GuardianSyncPayload): { title: string; body: string } {
  const title = payload.requiresAttention ? "[밀당] 보호자 주의 알림" : "[밀당] 보호자 상태 알림";
  const body = `${payload.summary} 혈당 ${payload.glucoseMgDl}mg/dL, 마일리지 ${payload.mileageTotal}점.`;
  return { title, body };
}

async function runWithRetry<T>(
  fn: () => Promise<T>,
  retryPolicy?: RetryPolicy,
): Promise<{ ok: true; value: T; attempts: number } | { ok: false; error: string; attempts: number }> {
  const maxAttempts = retryPolicy?.maxAttempts ?? 1;
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      const value = await fn();
      return { ok: true, value, attempts };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "전송 실패";
      if (attempts >= maxAttempts) {
        return { ok: false, error: errorMessage, attempts };
      }
      const waitMs = retryPolicy?.backoffMsByAttempt[attempts - 1] ?? 0;
      if (waitMs > 0 && retryPolicy) {
        await retryPolicy.sleep(waitMs);
      }
    }
  }

  return { ok: false, error: "전송 실패", attempts };
}

export async function sendGuardianAlert(args: {
  payload: GuardianSyncPayload;
  contact: GuardianContact;
  senders: GuardianChannelSenders;
  retryPolicy?: RetryPolicy;
  failedEventStore?: FailedGuardianEventStore;
  nowIso?: string;
}): Promise<GuardianChannelResult> {
  const { payload, contact, senders, retryPolicy, failedEventStore } = args;
  const nowIso = args.nowIso ?? new Date().toISOString();
  const message = buildGuardianAlertMessage(payload);

  if (contact.prefersPush && senders.push) {
    const pushOut = await runWithRetry(
      () => senders.push!.send({
        guardianUserId: contact.guardianUserId,
        title: message.title,
        body: message.body,
        data: {
          userId: payload.userId,
          measuredAt: payload.measuredAt,
          signalLevel: payload.signalLevel,
        },
      }),
      retryPolicy,
    );

    if (pushOut.ok) {
      return { channel: "push", success: true, providerMessageId: pushOut.value.messageId, attempts: pushOut.attempts };
    }

    if (!senders.sms || !contact.phoneNumber) {
      if (failedEventStore) {
        await failedEventStore.save({
          eventId: `guardian-fail-${Date.parse(nowIso)}`,
          guardianUserId: contact.guardianUserId,
          channel: "push",
          reason: pushOut.error,
          occurredAt: nowIso,
        });
      }
      return { channel: "push", success: false, errorMessage: pushOut.error, attempts: pushOut.attempts };
    }
  }

  if (senders.sms && contact.phoneNumber) {
    const smsOut = await runWithRetry(
      () => senders.sms!.send({
        phoneNumber: contact.phoneNumber!,
        message: `${message.title} ${message.body}`,
      }),
      retryPolicy,
    );

    if (smsOut.ok) {
      return { channel: "sms", success: true, providerMessageId: smsOut.value.messageId, attempts: smsOut.attempts };
    }

    if (failedEventStore) {
      await failedEventStore.save({
        eventId: `guardian-fail-${Date.parse(nowIso)}`,
        guardianUserId: contact.guardianUserId,
        channel: "sms",
        reason: smsOut.error,
        occurredAt: nowIso,
      });
    }
    return { channel: "sms", success: false, errorMessage: smsOut.error, attempts: smsOut.attempts };
  }

  const noChannelError = "사용 가능한 보호자 전송 채널이 없습니다.";
  if (failedEventStore) {
    await failedEventStore.save({
      eventId: `guardian-fail-${Date.parse(nowIso)}`,
      guardianUserId: contact.guardianUserId,
      channel: contact.prefersPush ? "push" : "sms",
      reason: noChannelError,
      occurredAt: nowIso,
    });
  }

  return {
    channel: contact.prefersPush ? "push" : "sms",
    success: false,
    errorMessage: noChannelError,
    attempts: 0,
  };
}
