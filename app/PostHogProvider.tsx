"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

type Props = {
  children: React.ReactNode;
};

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;

export default function PostHogProvider({ children }: Props) {
  useEffect(() => {
    if (!posthogKey || !posthogHost || posthog.__loaded) {
      return;
    }

    posthog.init(posthogKey, {
      api_host: posthogHost,
      capture_pageview: false,
      autocapture: false,
      disable_session_recording: true,
      mask_all_text: true,
      mask_all_element_attributes: true,
      capture_pageleave: true,
    });
  }, []);

  return children;
}
