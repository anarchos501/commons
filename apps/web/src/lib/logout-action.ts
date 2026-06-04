"use server";
import { getSession } from "./session";
import { redirect } from "next/navigation";

export async function logoutAction() {
  const session = await getSession();
  await session.destroy();
  redirect("/login");
}
