import { type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  crons: [
    {
      path: "/api/reminders/due",
      schedule: "0 9 * * *",
    },
  ],
};
