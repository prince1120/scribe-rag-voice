"use client";

// The behaviours a slide-over needs beyond sliding.
//
// The drawer already moved correctly; what it lacked is everything that makes
// an overlay feel finished: Escape did nothing, the page scrolled behind it
// (so flicking the drawer scrolled the chat underneath), and focus stayed in
// the hidden content behind it, which strands both keyboard and screen-reader
// users.

import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DrawerOptions {
  open: boolean;
  onClose: () => void;
  panelRef: RefObject<HTMLElement | null>;
  /** Only trap and lock below this width — on desktop the same element is a
   *  static sidebar, not an overlay, and trapping focus in it would be wrong. */
  maxWidth?: number;
}

export function useDrawer({ open, onClose, panelRef, maxWidth = 768 }: DrawerOptions) {
  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Lock the page behind the drawer.
  useEffect(() => {
    if (!open) return;
    if (window.innerWidth >= maxWidth) return;

    const { body } = document;
    const previousOverflow = body.style.overflow;
    // Compensate for the scrollbar's width so locking doesn't shift the page
    // sideways on desktop-width touch devices.
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    const previousPadding = body.style.paddingRight;

    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
    };
  }, [open, maxWidth]);

  // Keep Tab inside the panel, and restore focus to whatever opened it.
  useEffect(() => {
    if (!open) return;
    if (window.innerWidth >= maxWidth) return;

    const panel = panelRef.current;
    if (!panel) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the first control rather than the panel itself, so a screen
    // reader starts reading somewhere useful.
    const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
    focusables[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      // Re-queried per keypress: the drawer's contents change as documents
      // are added and removed, so a list captured on open goes stale.
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null
      );
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    panel.addEventListener("keydown", onKeyDown);
    return () => {
      panel.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open, panelRef, maxWidth]);
}
