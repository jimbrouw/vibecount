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
      capture_pageleave: true,
    });
  }, []);

  return children;
}
