package com.gymtrack.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;
import android.widget.RemoteViews;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "WorkoutNotification")
public class WorkoutNotificationPlugin extends Plugin {
    private static final String CHANNEL_ID = "gymtrack_workout_visible";
    private static final int NOTIFICATION_ID = 1001;

    @PluginMethod
    public void show(PluginCall call) {
        String title = call.getString("title", "Workout running");
        long workoutStartedAt = call.getLong("workoutStartedAt", System.currentTimeMillis());
        Long recoveryStartedAt = call.getLong("recoveryStartedAt");
        String recoveryLabel = call.getString("recoveryLabel", "Recovery not started");

        Context context = getContext();
        createChannel(context);

        RemoteViews compactContent = new RemoteViews(context.getPackageName(), R.layout.notification_workout_compact);
        setTimerViews(compactContent, workoutStartedAt, recoveryStartedAt);

        RemoteViews content = new RemoteViews(context.getPackageName(), R.layout.notification_workout);
        content.setTextViewText(R.id.notification_title, title);
        content.setTextViewText(R.id.notification_workout_label, "Workout");
        content.setTextViewText(R.id.notification_recovery_label, recoveryLabel);
        setTimerViews(content, workoutStartedAt, recoveryStartedAt);

        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            0,
            intent,
            pendingIntentFlags()
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_gymtrack)
            .setContentTitle(title)
            .setContentText("Workout running")
            .setCustomContentView(compactContent)
            .setCustomBigContentView(content)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setAutoCancel(false)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(pendingIntent);

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        manager.notify(NOTIFICATION_ID, builder.build());

        JSObject result = new JSObject();
        result.put("shown", true);
        call.resolve(result);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        manager.cancel(NOTIFICATION_ID);
        call.resolve();
    }

    private static long baseForTimestamp(long timestamp) {
        long elapsed = Math.max(0, System.currentTimeMillis() - timestamp);
        return SystemClock.elapsedRealtime() - elapsed;
    }

    private static void setTimerViews(RemoteViews views, long workoutStartedAt, Long recoveryStartedAt) {
        views.setChronometer(R.id.notification_workout_timer, baseForTimestamp(workoutStartedAt), null, true);
        if (recoveryStartedAt != null && recoveryStartedAt > 0) {
            views.setChronometer(R.id.notification_recovery_timer, baseForTimestamp(recoveryStartedAt), null, true);
        } else {
            views.setChronometer(R.id.notification_recovery_timer, SystemClock.elapsedRealtime(), null, false);
        }
    }

    private static int pendingIntentFlags() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return flags;
    }

    private static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Workout timer",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Persistent workout timer");
        channel.setShowBadge(false);
        channel.setSound(null, null);
        channel.enableVibration(false);
        manager.createNotificationChannel(channel);
    }
}
