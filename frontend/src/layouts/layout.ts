/** Must match the phone breakpoint in index.css (.mobile-only / .desktop-only). */
export const PHONE_LAYOUT = "(max-width: 768px)";

/**
 * The page is drawn twice — a desktop split and a phone view — and CSS hides
 * one. Anything that exists in both copies is told which one it is in.
 */
export type Layout = "desktop" | "phone";
