export async function POST(req: Request) {
  try {
    const { targetUserId, reminders } = await req.json();

    if (!targetUserId || !reminders || !Array.isArray(reminders) || reminders.length === 0) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
    }

    const ONESIGNAL_APP_ID = "805fdff6-e515-4ace-ad01-f2dcec4f0a37"; 
    const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;

    if (!ONESIGNAL_REST_API_KEY) {
      console.warn("ONESIGNAL_REST_API_KEY is not set.");
      return new Response(JSON.stringify({ success: false, reason: "Missing API Key" }), { status: 200 });
    }

    // OneSignal API limits array batching in certain ways, so we dispatch them sequentially or concurrently
    const results = await Promise.all(reminders.map(async (reminder: any) => {
      // time is in milliseconds, convert to GMT string for send_after
      const sendAfterDate = new Date(reminder.time).toUTCString();

      const response = await fetch("https://onesignal.com/api/v1/notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Authorization": `Basic ${ONESIGNAL_REST_API_KEY}`
        },
        body: JSON.stringify({
          app_id: ONESIGNAL_APP_ID,
          include_aliases: {
            external_id: [targetUserId]
          },
          target_channel: "push",
          headings: { en: reminder.title || "Study Reminder" },
          contents: { en: reminder.body },
          send_after: sendAfterDate,
        })
      });
      return response.json();
    }));

    return new Response(JSON.stringify({ success: true, results }), { status: 200 });
  } catch (error: any) {
    console.error("Error scheduling reminders:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
