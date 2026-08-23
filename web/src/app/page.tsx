import { redirect } from "next/navigation";
import { getSessionUser, homePathFor } from "@/lib/auth";

export default async function Home() {
  const user = await getSessionUser();
  redirect(user ? homePathFor(user) : "/login");
}
