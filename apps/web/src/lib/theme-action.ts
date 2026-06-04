"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

export async function toggleThemeAction() {
  const cookieStore = await cookies();
  const currentTheme = cookieStore.get("commons_theme")?.value;
  const nextTheme = currentTheme === "dark" ? "light" : "dark";

  cookieStore.set("commons_theme", nextTheme, {
    path: "/",
    maxAge: 31536000,
    sameSite: "lax",
  });

  const referer = (await headers()).get("referer");
  let revalidateTarget = "/dashboard";
  let redirectTarget = "/dashboard";

  if (referer) {
    try {
      const url = new URL(referer);
      revalidateTarget = url.pathname;
      redirectTarget = `${url.pathname}${url.search}`;
    } catch {
      // Fall back to the dashboard if a client sends a malformed referer.
    }
  }

  revalidatePath(revalidateTarget);
  redirect(redirectTarget);
}
