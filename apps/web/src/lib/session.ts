import { getIronSession } from "iron-session";
import { cookies } from "next/headers";

export type SessionData = {
  accountId: string;
  displayName: string;
  nodeId: string;
  groupId: string | null;
};

if (!process.env.SESSION_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET must be set in production.");
}

export const sessionOptions = {
  password: process.env.SESSION_SECRET ?? "dev-commons-local-secret-do-not-use-in-production",
  cookieName: "commons_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
  },
} as const;

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}
