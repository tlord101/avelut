/**
 * Unified OneSignal notifications handler.
 *
 * POST /api/notifications
 * Body must include an `action` field:
 *   - "send"     → send an immediate push notification
 *   - "schedule" → schedule one or more future push notifications
 */

const ONESIGNAL_APP_ID = '805fdff6-e515-4ace-ad01-f2dcec4f0a37';

function getApiKey(): string | undefined {
  return process.env.ONESIGNAL_REST_API_KEY;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action } = body;

    const apiKey = getApiKey();
    if (!apiKey) {
      console.warn('ONESIGNAL_REST_API_KEY is not set.');
      return new Response(JSON.stringify({ success: false, reason: 'Missing API Key' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ── action: send ──────────────────────────────────────────────────────────
    if (action === 'send') {
      const { targetUserId, title, message } = body;

      if (!targetUserId || !message) {
        return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
      }

      const response = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Basic ${apiKey}`,
        },
        body: JSON.stringify({
          app_id: ONESIGNAL_APP_ID,
          include_aliases: { external_id: [targetUserId] },
          target_channel: 'push',
          headings: { en: title || 'New Message' },
          contents: { en: message },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('OneSignal API Error:', data);
        return new Response(JSON.stringify({ error: data }), { status: response.status });
      }

      return new Response(JSON.stringify({ success: true, data }), { status: 200 });
    }

    // ── action: schedule ──────────────────────────────────────────────────────
    if (action === 'schedule') {
      const { targetUserId, reminders } = body;

      if (!targetUserId || !Array.isArray(reminders) || reminders.length === 0) {
        return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
      }

      const results = await Promise.all(
        reminders.map(async (reminder: any) => {
          const sendAfterDate = new Date(reminder.time).toUTCString();

          const response = await fetch('https://onesignal.com/api/v1/notifications', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              Authorization: `Basic ${apiKey}`,
            },
            body: JSON.stringify({
              app_id: ONESIGNAL_APP_ID,
              include_aliases: { external_id: [targetUserId] },
              target_channel: 'push',
              headings: { en: reminder.title || 'Study Reminder' },
              contents: { en: reminder.body },
              send_after: sendAfterDate,
            }),
          });

          return response.json();
        }),
      );

      return new Response(JSON.stringify({ success: true, results }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: 'Unknown action. Use "send" or "schedule".' }), {
      status: 400,
    });
  } catch (error: any) {
    console.error('Error in /api/notifications:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
