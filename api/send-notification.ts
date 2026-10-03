export async function POST(req: Request) {
  try {
    const { targetUserId, title, message } = await req.json();

    if (!targetUserId || !message) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
    }

    // Replace with your actual OneSignal App ID and REST API Key
    // You should store the REST API Key in your Vercel Environment Variables as ONESIGNAL_REST_API_KEY
    const ONESIGNAL_APP_ID = "805fdff6-e515-4ace-ad01-f2dcec4f0a37"; 
    const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;

    if (!ONESIGNAL_REST_API_KEY) {
      console.warn("ONESIGNAL_REST_API_KEY is not set. Push notification skipped.");
      return new Response(JSON.stringify({ success: false, reason: "Missing API Key" }), { status: 200 });
    }

    const response = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": `Basic ${ONESIGNAL_REST_API_KEY}`
      },
      body: JSON.stringify({
        app_id: ONESIGNAL_APP_ID,
        include_aliases: {
          external_id: [targetUserId] // Targets the user via OneSignal.login(user.uid)
        },
        target_channel: "push",
        headings: { en: title || "New Message" },
        contents: { en: message },
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("OneSignal API Error:", data);
      return new Response(JSON.stringify({ error: data }), { status: response.status });
    }

    return new Response(JSON.stringify({ success: true, data }), { status: 200 });
  } catch (error: any) {
    console.error("Error sending notification:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
