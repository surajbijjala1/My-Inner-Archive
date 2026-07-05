/**
 * Firebase web-app configuration for project "my-inner-archive".
 * Firebase is used ONLY for Cloud Messaging (push notifications) and App
 * Distribution — never hosting or database (Supabase owns those).
 *
 * SDK initialization (FCM registration) lands in Phase 3 alongside the
 * Capacitor push-notifications integration. Until then this just parks the
 * config that previously lived in the stray Untitled-1.js.
 *
 * These values are public client identifiers, not secrets.
 */

export const firebaseConfig = {
  apiKey: "AIzaSyBFivroL1a65A1iOUC4c3s0CokZaRBBCVA",
  authDomain: "my-inner-archive.firebaseapp.com",
  projectId: "my-inner-archive",
  storageBucket: "my-inner-archive.firebasestorage.app",
  messagingSenderId: "465916182629",
  appId: "1:465916182629:web:8acc7f23248c1124b1868c",
  measurementId: "G-R1RZPD9QWB",
} as const;
