import type { DraftService } from "../core/draftService.js";
import type { SlackEventEnvelope, SlackMessageLike } from "../types.js";

export function registerEvents(app: any, service: DraftService): void {
  app.event("app_mention", async ({ event, body }: { event: SlackMessageLike; body: Record<string, unknown> }) => {
    await handleSlackEvent(
      {
        event,
        ...(typeof body.event_id === "string" ? { event_id: body.event_id } : {}),
        ...(typeof body.team_id === "string" ? { team_id: body.team_id } : {})
      },
      service
    );
  });

  app.event("message", async ({ event, body }: { event: SlackMessageLike; body: Record<string, unknown> }) => {
    await handleSlackEvent(
      {
        event,
        ...(typeof body.event_id === "string" ? { event_id: body.event_id } : {}),
        ...(typeof body.team_id === "string" ? { team_id: body.team_id } : {})
      },
      service
    );
  });
}

export async function handleSlackEvent(envelope: SlackEventEnvelope, service: DraftService): Promise<void> {
  await service.handleEvent(envelope);
}
