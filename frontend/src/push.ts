/**
 * push.ts — FCM push notifications via @capacitor/push-notifications (Feature 5/6).
 * Native (Android APK) only: registration is a no-op on the web. Firebase is
 * used strictly for messaging — never hosting or data.
 */

import { isNativeApp } from "./native";
import { registerDeviceToken } from "./api";

/**
 * Ask permission, register with FCM, and sync the device token to the backend.
 * Call after login. `onOpenEntry` fires when the user taps a notification.
 */
export async function initPush(onOpenEntry: (entryId: string) => void): Promise<void> {
  if (!isNativeApp()) return;

  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");

    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== "granted") return;

    await PushNotifications.addListener("registration", async (token) => {
      try {
        await registerDeviceToken(token.value, "android");
      } catch (e) {
        console.error("Device token sync failed:", (e as Error).message);
      }
    });

    await PushNotifications.addListener("registrationError", (err) => {
      console.error("Push registration error:", JSON.stringify(err));
    });

    // Tap on a notification → open the referenced entry
    await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      const entryId = (action.notification.data as { entry_id?: string })?.entry_id;
      if (entryId) onOpenEntry(entryId);
    });

    await PushNotifications.register();
  } catch (e) {
    // Never let push setup break the app
    console.error("initPush failed:", (e as Error).message);
  }
}
