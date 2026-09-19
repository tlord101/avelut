package com.avelut.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import androidx.core.app.RemoteInput;
import android.app.NotificationManager;
import androidx.core.app.NotificationCompat;

public class NotificationActionReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String actionId = intent.getStringExtra("action_id");
        String chatId = intent.getStringExtra("chatId");

        CharSequence replyTextSeq = getMessageText(intent);
        String replyText = replyTextSeq != null ? replyTextSeq.toString().trim() : "";

        // Build the deep link URI that Capacitor's AppUrlOpen listener will intercept
        Uri.Builder uriBuilder = new Uri.Builder()
                .scheme("avelut")
                .authority("action")
                .appendQueryParameter("id", actionId != null ? actionId : "");

        if (chatId != null && !chatId.isEmpty()) {
            uriBuilder.appendQueryParameter("chatId", chatId);
        }

        // Always pass inline reply to JS to handle via Supabase instead of direct native Firebase DB insertion
        if ("reply_action".equals(actionId) && !replyText.isEmpty()) {
            uriBuilder.appendQueryParameter("replyText", replyText);

            // Optionally, immediately dismiss the notification to give a better UX,
            // since the JS app will do the actual sending
            NotificationManager notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (notificationManager != null && chatId != null) {
                notificationManager.cancel(chatId.hashCode());
            }
        }

        Uri deepLinkUri = uriBuilder.build();

        // Launch MainActivity with the ACTION_VIEW intent so Capacitor AppUrlOpen intercepts it
        Intent launchIntent = new Intent(context, MainActivity.class);
        launchIntent.setAction(Intent.ACTION_VIEW);
        launchIntent.setData(deepLinkUri);
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        context.startActivity(launchIntent);
    }

    private CharSequence getMessageText(Intent intent) {
        Bundle remoteInput = RemoteInput.getResultsFromIntent(intent);
        if (remoteInput != null) {
            return remoteInput.getCharSequence("inline_reply");
        }
        return null;
    }
}

